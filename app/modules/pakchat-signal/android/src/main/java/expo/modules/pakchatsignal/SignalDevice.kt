package expo.modules.pakchatsignal

import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.fingerprint.NumericFingerprintGenerator
import org.signal.libsignal.protocol.groups.GroupCipher
import org.signal.libsignal.protocol.groups.GroupSessionBuilder
import org.signal.libsignal.protocol.kem.KEMKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyType
import org.signal.libsignal.protocol.kem.KEMPublicKey
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SenderKeyDistributionMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyBundle
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore
import org.signal.libsignal.protocol.util.KeyHelper
import java.util.UUID

/**
 * The public half of a device's keys: what the server hands out so someone can
 * start a chat with this device. It holds no secrets.
 */
class PublicBundle(
  val registrationId: Int,
  val deviceId: Int,
  val preKeyId: Int,
  val preKey: ByteArray,
  val signedPreKeyId: Int,
  val signedPreKey: ByteArray,
  val signedPreKeySignature: ByteArray,
  val identityKey: ByteArray,
  val kyberPreKeyId: Int,
  val kyberPreKey: ByteArray,
  val kyberPreKeySignature: ByteArray,
)

/** An encrypted 1-to-1 message. `type` says if it also starts a session (PREKEY) or not (WHISPER). */
class Sealed(val type: Int, val body: ByteArray)

/**
 * One phone (or linked device) and its Signal keys.
 *
 * Every call here goes straight to Signal's own library (libsignal). We only
 * glue the pieces together; the library does all the maths. The secret keys
 * stay inside this object and never go back to JavaScript.
 *
 * For the spike the keys live in memory (InMemorySignalProtocolStore), so they
 * are lost when the app closes. Phase 3 saves them on the phone.
 */
class SignalDevice(val name: String, val deviceId: Int) {
  private val identity: IdentityKeyPair = IdentityKeyPair.generate()
  private val registrationId: Int = KeyHelper.generateRegistrationId(false)
  private val store = InMemorySignalProtocolStore(identity, registrationId)
  private val address = SignalProtocolAddress(name, deviceId)

  // The signed pre-key is medium-term: one per device, renewed now and then (not in the spike).
  private val signedPreKey: SignedPreKeyRecord

  // Each bundle gets fresh one-time keys, numbered from 1.
  private var nextPreKeyId = 1

  init {
    val keyPair = ECKeyPair.generate()
    val signature = identity.privateKey.calculateSignature(keyPair.publicKey.serialize())
    signedPreKey = SignedPreKeyRecord(1, System.currentTimeMillis(), keyPair, signature)
    store.storeSignedPreKey(1, signedPreKey)
  }

  /**
   * Makes a new bundle with fresh one-time keys: a normal one, and a post-quantum
   * (Kyber) one. The server gives each bundle out once, then it's used up.
   */
  fun newBundle(): PublicBundle {
    val id = nextPreKeyId++

    val preKey = ECKeyPair.generate()
    store.storePreKey(id, PreKeyRecord(id, preKey))

    val kyber = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
    val kyberSignature = identity.privateKey.calculateSignature(kyber.publicKey.serialize())
    store.storeKyberPreKey(id, KyberPreKeyRecord(id, System.currentTimeMillis(), kyber, kyberSignature))

    return PublicBundle(
      registrationId = registrationId,
      deviceId = deviceId,
      preKeyId = id,
      preKey = preKey.publicKey.serialize(),
      signedPreKeyId = signedPreKey.id,
      signedPreKey = signedPreKey.keyPair.publicKey.serialize(),
      signedPreKeySignature = signedPreKey.signature,
      identityKey = identity.publicKey.serialize(),
      kyberPreKeyId = id,
      kyberPreKey = kyber.publicKey.serialize(),
      kyberPreKeySignature = kyberSignature,
    )
  }

  /** Starts a session with another device, from the bundle the server gave us. */
  fun startSession(theirName: String, theirDeviceId: Int, bundle: PublicBundle) {
    val them = SignalProtocolAddress(theirName, theirDeviceId)
    val preKeyBundle = PreKeyBundle(
      bundle.registrationId,
      bundle.deviceId,
      bundle.preKeyId,
      ECPublicKey(bundle.preKey),
      bundle.signedPreKeyId,
      ECPublicKey(bundle.signedPreKey),
      bundle.signedPreKeySignature,
      IdentityKey(bundle.identityKey),
      bundle.kyberPreKeyId,
      KEMPublicKey(bundle.kyberPreKey),
      bundle.kyberPreKeySignature,
    )
    // The library checks the signatures and refuses a bundle that was tampered with.
    // Careful: SessionBuilder takes (them, us), but SessionCipher takes (us, them).
    SessionBuilder(store, them, address).process(preKeyBundle)
  }

  fun hasSession(theirName: String, theirDeviceId: Int): Boolean =
    store.containsSession(SignalProtocolAddress(theirName, theirDeviceId))

  /** Locks a message for one other device. */
  fun encrypt(toName: String, toDeviceId: Int, plaintext: ByteArray): Sealed {
    val them = SignalProtocolAddress(toName, toDeviceId)
    val message = SessionCipher(store, address, them).encrypt(plaintext)
    return Sealed(message.type, message.serialize())
  }

  /** Unlocks a message from another device. Throws if it was changed, repeated or isn't for us. */
  fun decrypt(fromName: String, fromDeviceId: Int, sealed: Sealed): ByteArray {
    val them = SignalProtocolAddress(fromName, fromDeviceId)
    val cipher = SessionCipher(store, address, them)
    return when (sealed.type) {
      CiphertextMessage.PREKEY_TYPE -> cipher.decrypt(PreKeySignalMessage(sealed.body))
      CiphertextMessage.WHISPER_TYPE -> cipher.decrypt(SignalMessage(sealed.body))
      else -> throw IllegalArgumentException("Unknown message type ${sealed.type}")
    }
  }

  /**
   * Groups use "sender keys": each member makes one key for the group and sends it
   * to the others (inside normal 1-to-1 encrypted messages). After that, a group
   * message is locked once and the server copies it to everyone.
   */
  fun createGroupKey(groupId: String): ByteArray =
    GroupSessionBuilder(store).create(address, UUID.fromString(groupId)).serialize()

  /** Saves another member's group key, so we can read their group messages. */
  fun acceptGroupKey(fromName: String, fromDeviceId: Int, groupKey: ByteArray) {
    GroupSessionBuilder(store).process(
      SignalProtocolAddress(fromName, fromDeviceId),
      SenderKeyDistributionMessage(groupKey),
    )
  }

  fun groupEncrypt(groupId: String, plaintext: ByteArray): ByteArray =
    GroupCipher(store, address).encrypt(UUID.fromString(groupId), plaintext).serialize()

  fun groupDecrypt(fromName: String, fromDeviceId: Int, body: ByteArray): ByteArray =
    GroupCipher(store, SignalProtocolAddress(fromName, fromDeviceId)).decrypt(body)

  /**
   * The safety number for a chat, like WhatsApp's "Verify security code".
   * Both people see the same 60 digits if nobody is in the middle.
   */
  fun safetyNumber(theirName: String, theirDeviceId: Int): String {
    val theirKey = store.getIdentity(SignalProtocolAddress(theirName, theirDeviceId))
      ?: throw IllegalStateException("No session with $theirName yet")
    return NumericFingerprintGenerator(5200)
      .createFor(2, name.toByteArray(), identity.publicKey, theirName.toByteArray(), theirKey)
      .displayableFingerprint
      .displayText
  }
}
