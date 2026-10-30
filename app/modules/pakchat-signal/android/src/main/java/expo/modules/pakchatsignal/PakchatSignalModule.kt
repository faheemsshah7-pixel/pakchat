package expo.modules.pakchatsignal

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.DuplicateMessageException
import org.signal.libsignal.protocol.NoSessionException
import java.io.File
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** A bundle as JavaScript sends it: the same fields as PublicBundle, with bytes as base64 text. */
class BundleRecord : Record {
  @Field val registrationId: Int = 0
  @Field val deviceId: Int = 0
  @Field val preKeyId: Int? = null
  @Field val preKey: String? = null
  @Field val signedPreKeyId: Int = 0
  @Field val signedPreKey: String = ""
  @Field val signedPreKeySignature: String = ""
  @Field val identityKey: String = ""
  @Field val kyberPreKeyId: Int = 0
  @Field val kyberPreKey: String = ""
  @Field val kyberPreKeySignature: String = ""
}

class SealedRecord : Record {
  @Field val type: Int = 0
  @Field val body: String = ""
}

// The error codes the shared core understands (shared/src/signal.ts, SignalError).

/** The same message arrived twice. The app quietly skips it. */
class DuplicateException(cause: Throwable) : CodedException("ERR_DUPLICATE", "This message was already received", cause)

/** No session with that device (for example, it was reinstalled). */
class NoSessionCodedException(cause: Throwable) : CodedException("ERR_NO_SESSION", cause.message ?: "No session", cause)

/** No group key from that device yet. */
class NoGroupKeyException(cause: Throwable) : CodedException("ERR_NO_GROUP_KEY", cause.message ?: "No group key", cause)

/**
 * The bridge between JavaScript and SignalDevice. JavaScript only ever holds a
 * "handle" (like "<user id>:1"), never a key. Bytes cross the bridge as base64 text.
 */
class PakchatSignalModule : Module() {
  private val backend: KeyBackend by lazy {
    AndroidKeyBackend(appContext.reactContext ?: throw Exceptions.ReactContextLost())
  }
  private val devices = ConcurrentHashMap<String, SignalDevice>()

  // Files go up and down on their own threads, so a big upload never holds up messages.
  private val transfers = Executors.newFixedThreadPool(3)
  // For wait(): one thread that only keeps time.
  private val clock = Executors.newSingleThreadScheduledExecutor()

  // Transfers queued or moving now, and the ones you've asked to stop (by tag).
  private val running = ConcurrentHashMap.newKeySet<String>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  private class Cancelled : InterruptedIOException("Cancelled")

  /** Runs a slow file job away from everything else, and answers when it's done. */
  private fun slowly(promise: Promise, tag: String? = null, job: () -> Any?) {
    tag?.let { running.add(it) }
    transfers.execute {
      try {
        if (tag != null && cancelled.contains(tag)) throw Cancelled()
        promise.resolve(job())
      } catch (e: Cancelled) {
        promise.reject("ERR_CANCELLED", "Cancelled", e)
      } catch (e: SecurityException) {
        promise.reject("ERR_FILE_CHANGED", e.message ?: "The file was changed", e)
      } catch (e: Exception) {
        // Stopping mid-way can also break the connection: still a cancel.
        if (tag != null && cancelled.contains(tag)) promise.reject("ERR_CANCELLED", "Cancelled", e)
        else promise.reject("ERR_FILE", e.message ?: "The file couldn't be moved", e)
      } finally {
        tag?.let {
          running.remove(it)
          cancelled.remove(it)
        }
      }
    }
  }

  // Progress for a file, at most every 1% (so the bridge isn't flooded). It's
  // called for every piece, so it's also where a cancelled transfer stops.
  private fun progress(tag: String): (Long, Long) -> Unit {
    var last = -1L
    return { done, total ->
      if (cancelled.contains(tag)) throw Cancelled()
      val pct = if (total > 0) done * 100 / total else -1
      if (pct != last) {
        last = pct
        sendEvent("progress", mapOf("tag" to tag, "done" to done.toDouble(), "total" to total.toDouble()))
      }
    }
  }

  private fun context() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun path(uri: String) = File(uri.removePrefix("file://"))

  private fun resolver() = (appContext.reactContext ?: throw Exceptions.ReactContextLost()).contentResolver

  private fun device(handle: String): SignalDevice {
    devices[handle]?.let { return it }
    // Not opened yet since the app started: find it in the saved keys.
    val name = handle.substringBeforeLast(':')
    val id = handle.substringAfterLast(':').toIntOrNull() ?: throw IllegalArgumentException("Bad handle $handle")
    val found = SignalDevice.open(backend, name, id) ?: throw IllegalArgumentException("No device called $handle")
    return devices.getOrPut(handle) { found }
  }

  // One call at a time per device, so two messages never change its keys at once.
  private inline fun <T> using(handle: String, block: (SignalDevice) -> T): T {
    val d = device(handle)
    return synchronized(d) { block(d) }
  }

  override fun definition() = ModuleDefinition {
    Name("PakchatSignal")

    Events("progress", "callAudio", "pip", "liveStop", "voiceEar")

    OnCreate {
      appContext.reactContext?.let { CrashLog.install(it) }
      appContext.reactContext?.let { ScreenWatch.start(it) }
      LiveLocationService.onStop = { sendEvent("liveStop", mapOf<String, Any>()) }
    }

    // ---- Phase 7 (see Privacy, Scheduled, LiveLocation, Transcribe) ----

    /** No screenshots or screen recording while a view once photo or video is open. */
    Function("setSecure") { on: Boolean -> Secure.set(appContext.currentActivity, on) }

    /** When the screen last went off (ms), for "App lock: when the phone locks". */
    Function("screenOffAt") { ScreenWatch.offAt.toDouble() }

    /** Writes an exported chat (its words, then its files) as one zip. Answers its size. */
    AsyncFunction("zipChat") { out: String, textName: String, text: String, paths: List<String>, names: List<String>, promise: Promise ->
      slowly(promise) { Zipper.zip(path(out), textName, text, paths.map { path(it) }.zip(names)).toDouble() }
    }

    /** A scheduled message's time on the phone's alarm clock (it wakes PakChat to send it). */
    Function("scheduleAlarm") { id: String, at: Double -> Scheduled.set(context(), id, at.toLong()) }

    Function("cancelAlarm") { id: String -> Scheduled.cancel(context(), id) }

    Function("canExactAlarms") { Scheduled.canExact(context()) }

    Function("openExactAlarmSettings") { Scheduled.openExactSettings(context()) }

    /** The "Sharing live location" alert, which lets PakChat follow the phone's location in the background. */
    Function("liveLocationStart") { title: String, text: String, stop: String -> LiveLocationService.start(context(), title, text, stop) }

    Function("liveLocationStop") { LiveLocationService.stop(context()) }

    Function("transcriptsAvailable") { Transcribe.available(context()) }

    /** A voice note's words, made on the phone. `language` like "en-US" or "ur-PK". */
    AsyncFunction("transcribe") { uri: String, language: String, promise: Promise ->
      Transcribe.run(context(), uri, language, promise)
    }

    /** A chat on the home screen (Shortcuts.kt). False if this phone's home screen can't take one. */
    Function("addShortcut") { json: String -> Shortcuts.add(context(), json) }

    // ---- Files (see FileLock and FileTransfer) ----

    /** How big a file is once locked, so the app can ask the server for room first. */
    Function("lockedSize") { plain: Double -> FileLock.lockedSize(plain.toLong()).toDouble() }

    /** Locks a file and uploads it. `key` (base64) only for backups; files get a new one. */
    AsyncFunction("uploadFile") { uri: String, url: String, key: String?, tag: String, promise: Promise ->
      slowly(promise, tag) {
        val up = FileTransfer.upload(path(uri), url, key?.let { bytes(it) }, progress(tag))
        mapOf("key" to b64(up.key), "digest" to b64(up.digest), "size" to up.size.toDouble())
      }
    }

    /** Downloads a locked file, checks it, and unlocks it to `to`. */
    AsyncFunction("downloadFile") { url: String, to: String, key: String, digest: String?, tag: String, promise: Promise ->
      slowly(promise, tag) {
        FileTransfer.download(url, path(to), bytes(key), digest?.let { bytes(it) }, progress(tag))
        to
      }
    }

    // ---- Message alerts (see ChatAlerts) ----

    /** Shows or updates one chat's alert. What to show comes as JSON (see push.ts). */
    Function("showChatAlert") { json: String ->
      ChatAlerts.show(context(), json)
    }

    Function("dismissChatAlert") { chatId: String ->
      ChatAlerts.dismiss(context(), chatId)
    }

    /** Is this chat's alert still there (not swiped away)? */
    Function("chatAlertShowing") { chatId: String ->
      ChatAlerts.isShowing(context(), chatId)
    }

    /** Stops an upload or download (by its tag) as soon as it can. It fails with ERR_CANCELLED. */
    Function("cancelTransfer") { tag: String ->
      if (running.contains(tag)) cancelled.add(tag)
    }

    /**
     * Answers after `ms`. JavaScript's own timers (setTimeout) stop while PakChat
     * isn't on screen; this one keeps going, so a push that wakes the app can
     * still count down while it collects messages.
     */
    AsyncFunction("wait") { ms: Int, promise: Promise ->
      clock.schedule({ promise.resolve(null) }, ms.coerceIn(0, 60_000).toLong(), TimeUnit.MILLISECONDS)
    }

    // ---- Voice notes (see AudioJoin) ----

    /** Joins the pieces of a paused-and-resumed voice note into one file. Answers its length (ms). */
    AsyncFunction("joinAudio") { parts: List<String>, to: String, promise: Promise ->
      slowly(promise) { AudioJoin.join(parts.map { path(it) }, path(to)).toDouble() }
    }

    // ---- A voice note held to the ear (see VoiceEar) ----

    /** Watches the ear sensor while a voice note plays; "voiceEar" says {near} (and {done} for the ear player). */
    Function("voiceWatch") { on: Boolean -> VoiceEar.watch(context(), on) { sendEvent("voiceEar", it) } }

    Function("voiceEarPlay") { uri: String, fromMs: Int, speed: Double -> VoiceEar.play(context(), uri, fromMs, speed.toFloat()) }

    Function("voiceEarPosition") { VoiceEar.position() }

    /** Stops the ear player; answers where it got to (ms), or -1. */
    Function("voiceEarStop") { VoiceEar.stop(context()) }

    Function("voiceEarOff") { VoiceEar.off(context()) }

    // ---- Calls (see CallAlerts, CallAudio, CallService, CallLockScreen) ----

    /** Rings: the full-screen incoming call alert. What to show comes as JSON (calls.ts). */
    Function("callRing") { json: String -> CallAlerts.ring(context(), json) }

    Function("callStopRing") { callId: String -> CallAlerts.stopRing(context(), callId) }

    Function("callMissed") { json: String -> CallAlerts.missed(context(), json) }

    Function("callDismissMissed") { chatId: String -> CallAlerts.dismissMissed(context(), chatId) }

    /** Shows (or updates) the "Ongoing call" alert that keeps the call going in the background. */
    Function("callOngoing") { json: String -> CallService.show(context(), json) }

    Function("callEnded") {
      val c = context()
      CallService.stop(c)
      CallAudio.stop(c)
      CallLockScreen.show(false)
    }

    /** Call mode for the sound; tells JavaScript where the sound can go ("callAudio"). */
    Function("callAudioStart") { video: Boolean ->
      CallAudio.start(context(), video) { sendEvent("callAudio", it) }
    }

    Function("callRoute") { to: String -> CallAudio.route(context(), to) }

    Function("callVideo") { on: Boolean -> CallAudio.setVideo(context(), on) }

    /** The phone's maker if it blocks apps in the background (Realme, Xiaomi…), else null (Autostart.kt). */
    Function("autostartBrand") { Autostart.brand() }

    /** Opens the maker's Autostart page, or PakChat's app settings. */
    Function("openAutostart") { Autostart.open(context()) }

    /** A smaller copy of a video, for sending (VideoShrink.kt). */
    AsyncFunction("shrinkVideo") { input: String, output: String, startMs: Double, endMs: Double, hd: Boolean, promise: Promise ->
      VideoShrink.shrink(context(), input, output, startMs.toLong(), endMs.toLong(), hd, promise)
    }

    /**
     * This copy of PakChat: its build number, version, and which app installed it
     * ("com.android.vending" for Google Play; null or a browser's for the website's APK).
     */
    Function("appInstall") {
      val ctx = context()
      val pm = ctx.packageManager
      val info = pm.getPackageInfo(ctx.packageName, 0)
      val code = if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
      val installer = try {
        if (android.os.Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(ctx.packageName).installingPackageName
        else @Suppress("DEPRECATION") pm.getInstallerPackageName(ctx.packageName)
      } catch (_: Throwable) {
        null
      }
      mapOf("versionCode" to code.toDouble(), "versionName" to (info.versionName ?: ""), "installer" to installer)
    }

    /** What made PakChat close by mistake since last asked (CrashLog), or null. */
    Function("lastCrash") {
      try {
        appContext.reactContext?.let { CrashLog.take(it) }
      } catch (_: Throwable) {
        null
      }
    }

    /** Picture-in-picture is wanted (the call screen, in a video call); "pip" says when the small window opens or closes. */
    Function("callPip") { on: Boolean ->
      CallPip.onChange = { sendEvent("pip", mapOf("on" to it)) }
      appContext.currentActivity?.let { CallPip.allow(it, on) }
    }

    Function("callAudioState") { CallAudio.state(context()) }

    /** "ringing", "busy" or "ended", for the person calling. */
    Function("callTone") { kind: String -> CallAudio.tone(kind) }

    Function("callStopTone") { CallAudio.stopTone() }

    /** Shows the app over the lock screen during a call (and keeps the screen on), or stops. */
    Function("callShowOverLock") { on: Boolean, keepOn: Boolean -> CallLockScreen.show(on, keepOn) }

    /** Can calls wake the screen? Android 14+ lets people turn that off. */
    Function("callFullScreenAllowed") { CallAlerts.fullScreenAllowed(context()) }

    Function("callOpenFullScreenSettings") { CallAlerts.openFullScreenSettings(context()) }

    /** Where a contact can be saved: Google accounts, the phone, SIMs. Needs the contacts permission. */
    AsyncFunction("contactAccounts") { promise: Promise ->
      slowly(promise) {
        PhoneBook.accounts(resolver()).map { mapOf("type" to it.type, "name" to it.name, "kind" to it.kind) }
      }
    }

    /** Saves a contact in the phone's address book, in the account picked. */
    AsyncFunction("saveToPhoneBook") { type: String?, account: String?, name: String, phone: String?, email: String?, promise: Promise ->
      slowly(promise) { PhoneBook.save(resolver(), type, account, name, phone, email) }
    }

    /** The backup key from the backup password (slow on purpose). */
    /** Locks what the phone tells a website it links by QR code, to the QR's key (see LinkLock.kt). */
    AsyncFunction("lockProvision") { json: String, websiteKey: String ->
      b64(LinkLock.lock(json.toByteArray(Charsets.UTF_8), bytes(websiteKey)))
    }

    AsyncFunction("backupKey") { password: String, userId: String, promise: Promise ->
      slowly(promise) { b64(FileLock.backupKey(password, userId)) }
    }

    AsyncFunction("createDevice") { name: String, deviceId: Int ->
      val d = SignalDevice.create(backend, name, deviceId)
      val handle = "$name:$deviceId"
      devices[handle] = d
      handle
    }

    AsyncFunction("openDevice") { name: String, deviceId: Int ->
      val handle = "$name:$deviceId"
      if (devices.containsKey(handle)) return@AsyncFunction handle
      val d = SignalDevice.open(backend, name, deviceId) ?: return@AsyncFunction null
      devices[handle] = d
      handle
    }

    AsyncFunction("setAddress") { handle: String, name: String, deviceId: Int ->
      val d = device(handle)
      synchronized(d) { d.rename(name, deviceId) }
      devices.remove(handle)
      val next = "$name:$deviceId"
      devices[next] = d
      next
    }

    AsyncFunction("deviceKeys") { handle: String ->
      using(handle) { d ->
        val k = d.deviceKeys()
        mapOf(
          "registrationId" to k.registrationId,
          "identityKey" to b64(k.identityKey),
          "signedPreKey" to signed(k.signedPreKey),
          "kyberLastResort" to signed(k.kyberLastResort),
        )
      }
    }

    AsyncFunction("newPreKeys") { handle: String, count: Int ->
      using(handle) { d ->
        val (ec, kyber) = d.newPreKeys(count)
        mapOf(
          "preKeys" to ec.map { mapOf("keyId" to it.keyId, "publicKey" to b64(it.publicKey)) },
          "kyberPreKeys" to kyber.map { signed(it) },
        )
      }
    }

    AsyncFunction("startSession") { handle: String, theirName: String, theirDeviceId: Int, b: BundleRecord ->
      using(handle) { d ->
        d.startSession(
          theirName,
          theirDeviceId,
          PublicBundle(
            registrationId = b.registrationId,
            deviceId = b.deviceId,
            preKeyId = b.preKeyId,
            preKey = b.preKey?.let { bytes(it) },
            signedPreKeyId = b.signedPreKeyId,
            signedPreKey = bytes(b.signedPreKey),
            signedPreKeySignature = bytes(b.signedPreKeySignature),
            identityKey = bytes(b.identityKey),
            kyberPreKeyId = b.kyberPreKeyId,
            kyberPreKey = bytes(b.kyberPreKey),
            kyberPreKeySignature = bytes(b.kyberPreKeySignature),
          ),
        )
      }
    }

    AsyncFunction("hasSession") { handle: String, theirName: String, theirDeviceId: Int ->
      using(handle) { d -> d.hasSession(theirName, theirDeviceId) }
    }

    AsyncFunction("deleteSession") { handle: String, theirName: String, theirDeviceId: Int ->
      using(handle) { d -> d.deleteSession(theirName, theirDeviceId) }
    }

    AsyncFunction("identityKey") { handle: String, theirName: String, theirDeviceId: Int ->
      using(handle) { d -> d.identityKey(theirName, theirDeviceId)?.let { b64(it) } }
    }

    AsyncFunction("encrypt") { handle: String, toName: String, toDeviceId: Int, text: String ->
      using(handle) { d ->
        coded(group = false) {
          val sealed = d.encrypt(toName, toDeviceId, text.toByteArray(Charsets.UTF_8))
          mapOf("type" to sealed.type, "body" to b64(sealed.body))
        }
      }
    }

    // `keep` is the envelope's number (a JavaScript number, so it comes as a Double).
    AsyncFunction("decrypt") { handle: String, fromName: String, fromDeviceId: Int, sealed: SealedRecord, keep: Double? ->
      using(handle) { d ->
        coded(group = false) {
          String(d.decrypt(fromName, fromDeviceId, Sealed(sealed.type, bytes(sealed.body)), keep?.toLong()), Charsets.UTF_8)
        }
      }
    }

    AsyncFunction("forgetOpened") { handle: String, keeps: List<Double> ->
      using(handle) { d -> d.forgetOpened(keeps.map { it.toLong() }) }
    }

    AsyncFunction("createGroupKey") { handle: String, distributionId: String ->
      using(handle) { d -> b64(d.createGroupKey(distributionId)) }
    }

    AsyncFunction("acceptGroupKey") { handle: String, fromName: String, fromDeviceId: Int, groupKey: String ->
      using(handle) { d -> d.acceptGroupKey(fromName, fromDeviceId, bytes(groupKey)) }
    }

    AsyncFunction("groupEncrypt") { handle: String, distributionId: String, text: String ->
      using(handle) { d -> coded(group = true) { b64(d.groupEncrypt(distributionId, text.toByteArray(Charsets.UTF_8))) } }
    }

    AsyncFunction("groupDecrypt") { handle: String, fromName: String, fromDeviceId: Int, body: String, keep: Double? ->
      using(handle) { d ->
        coded(group = true) { String(d.groupDecrypt(fromName, fromDeviceId, bytes(body), keep?.toLong()), Charsets.UTF_8) }
      }
    }

    AsyncFunction("safetyNumber") { handle: String, theirName: String, theirDeviceId: Int ->
      using(handle) { d -> coded(group = false) { d.safetyNumber(theirName, theirDeviceId) } }
    }
  }

  /** Turns the library's errors into the codes the shared core understands. */
  private fun <T> coded(group: Boolean, block: () -> T): T =
    try {
      block()
    } catch (e: DuplicateMessageException) {
      throw DuplicateException(e)
    } catch (e: NoSessionException) {
      throw if (group) NoGroupKeyException(e) else NoSessionCodedException(e)
    }

  private fun signed(k: SignedKey) = mapOf("keyId" to k.keyId, "publicKey" to b64(k.publicKey), "signature" to b64(k.signature))

  private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun bytes(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)
}
