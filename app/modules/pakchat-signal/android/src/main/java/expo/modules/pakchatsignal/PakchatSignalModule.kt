package expo.modules.pakchatsignal

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.signal.libsignal.protocol.DuplicateMessageException
import java.util.concurrent.ConcurrentHashMap

/** A bundle as JavaScript sends it: the same fields as PublicBundle, with bytes as base64 text. */
class BundleRecord : Record {
  @Field val registrationId: Int = 0
  @Field val deviceId: Int = 0
  @Field val preKeyId: Int = 0
  @Field val preKey: String = ""
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

/** Thrown when the same message arrives twice, so the app can quietly skip it. */
class DuplicateException(cause: Throwable) :
  CodedException("ERR_DUPLICATE", "This message was already received", cause)

/**
 * The bridge between JavaScript and SignalDevice. JavaScript only ever holds a
 * "handle" (a short name like "Ali:1"), never a key. Bytes cross the bridge as
 * base64 text.
 */
class PakchatSignalModule : Module() {
  private val devices = ConcurrentHashMap<String, SignalDevice>()

  private fun device(handle: String): SignalDevice =
    devices[handle] ?: throw IllegalArgumentException("No device called $handle")

  // One call at a time per device, so two messages never change its keys at once.
  private inline fun <T> using(handle: String, block: (SignalDevice) -> T): T {
    val d = device(handle)
    return synchronized(d) { block(d) }
  }

  override fun definition() = ModuleDefinition {
    Name("PakchatSignal")

    AsyncFunction("createDevice") { name: String, deviceId: Int ->
      val handle = "$name:$deviceId"
      devices[handle] = SignalDevice(name, deviceId)
      handle
    }

    AsyncFunction("newBundle") { handle: String ->
      using(handle) { d ->
        val b = d.newBundle()
        mapOf(
          "registrationId" to b.registrationId,
          "deviceId" to b.deviceId,
          "preKeyId" to b.preKeyId,
          "preKey" to b64(b.preKey),
          "signedPreKeyId" to b.signedPreKeyId,
          "signedPreKey" to b64(b.signedPreKey),
          "signedPreKeySignature" to b64(b.signedPreKeySignature),
          "identityKey" to b64(b.identityKey),
          "kyberPreKeyId" to b.kyberPreKeyId,
          "kyberPreKey" to b64(b.kyberPreKey),
          "kyberPreKeySignature" to b64(b.kyberPreKeySignature),
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
            preKey = bytes(b.preKey),
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

    AsyncFunction("encrypt") { handle: String, toName: String, toDeviceId: Int, text: String ->
      using(handle) { d ->
        val sealed = d.encrypt(toName, toDeviceId, text.toByteArray(Charsets.UTF_8))
        mapOf("type" to sealed.type, "body" to b64(sealed.body))
      }
    }

    AsyncFunction("decrypt") { handle: String, fromName: String, fromDeviceId: Int, sealed: SealedRecord ->
      using(handle) { d ->
        dupesAsCoded {
          String(d.decrypt(fromName, fromDeviceId, Sealed(sealed.type, bytes(sealed.body))), Charsets.UTF_8)
        }
      }
    }

    AsyncFunction("createGroupKey") { handle: String, groupId: String ->
      using(handle) { d -> b64(d.createGroupKey(groupId)) }
    }

    AsyncFunction("acceptGroupKey") { handle: String, fromName: String, fromDeviceId: Int, groupKey: String ->
      using(handle) { d -> d.acceptGroupKey(fromName, fromDeviceId, bytes(groupKey)) }
    }

    AsyncFunction("groupEncrypt") { handle: String, groupId: String, text: String ->
      using(handle) { d -> b64(d.groupEncrypt(groupId, text.toByteArray(Charsets.UTF_8))) }
    }

    AsyncFunction("groupDecrypt") { handle: String, fromName: String, fromDeviceId: Int, body: String ->
      using(handle) { d ->
        dupesAsCoded { String(d.groupDecrypt(fromName, fromDeviceId, bytes(body)), Charsets.UTF_8) }
      }
    }

    AsyncFunction("safetyNumber") { handle: String, theirName: String, theirDeviceId: Int ->
      using(handle) { d -> d.safetyNumber(theirName, theirDeviceId) }
    }
  }

  private fun <T> dupesAsCoded(block: () -> T): T =
    try {
      block()
    } catch (e: DuplicateMessageException) {
      throw DuplicateException(e)
    }

  private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun bytes(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)
}
