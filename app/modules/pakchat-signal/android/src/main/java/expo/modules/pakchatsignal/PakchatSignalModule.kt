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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

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

  /** Runs a slow file job away from everything else, and answers when it's done. */
  private fun slowly(promise: Promise, job: () -> Any?) {
    transfers.execute {
      try {
        promise.resolve(job())
      } catch (e: SecurityException) {
        promise.reject("ERR_FILE_CHANGED", e.message ?: "The file was changed", e)
      } catch (e: Exception) {
        promise.reject("ERR_FILE", e.message ?: "The file couldn't be moved", e)
      }
    }
  }

  // Progress for a file, at most every 1% (so the bridge isn't flooded).
  private fun progress(tag: String): (Long, Long) -> Unit {
    var last = -1L
    return { done, total ->
      val pct = if (total > 0) done * 100 / total else -1
      if (pct != last) {
        last = pct
        sendEvent("progress", mapOf("tag" to tag, "done" to done.toDouble(), "total" to total.toDouble()))
      }
    }
  }

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

    Events("progress")

    // ---- Files (see FileLock and FileTransfer) ----

    /** How big a file is once locked, so the app can ask the server for room first. */
    Function("lockedSize") { plain: Double -> FileLock.lockedSize(plain.toLong()).toDouble() }

    /** Locks a file and uploads it. `key` (base64) only for backups; files get a new one. */
    AsyncFunction("uploadFile") { uri: String, url: String, key: String?, tag: String, promise: Promise ->
      slowly(promise) {
        val up = FileTransfer.upload(path(uri), url, key?.let { bytes(it) }, progress(tag))
        mapOf("key" to b64(up.key), "digest" to b64(up.digest), "size" to up.size.toDouble())
      }
    }

    /** Downloads a locked file, checks it, and unlocks it to `to`. */
    AsyncFunction("downloadFile") { url: String, to: String, key: String, digest: String?, tag: String, promise: Promise ->
      slowly(promise) {
        FileTransfer.download(url, path(to), bytes(key), digest?.let { bytes(it) }, progress(tag))
        to
      }
    }

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
