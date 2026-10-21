package expo.modules.pakchatsignal

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.DuplicateMessageException
import org.signal.libsignal.protocol.NoSessionException
import java.util.concurrent.ConcurrentHashMap

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

    AsyncFunction("decrypt") { handle: String, fromName: String, fromDeviceId: Int, sealed: SealedRecord ->
      using(handle) { d ->
        coded(group = false) {
          String(d.decrypt(fromName, fromDeviceId, Sealed(sealed.type, bytes(sealed.body))), Charsets.UTF_8)
        }
      }
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

    AsyncFunction("groupDecrypt") { handle: String, fromName: String, fromDeviceId: Int, body: String ->
      using(handle) { d ->
        coded(group = true) { String(d.groupDecrypt(fromName, fromDeviceId, bytes(body)), Charsets.UTF_8) }
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
