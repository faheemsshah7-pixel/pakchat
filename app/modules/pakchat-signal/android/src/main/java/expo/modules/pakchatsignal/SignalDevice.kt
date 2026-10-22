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
import org.signal.libsignal.protocol.util.KeyHelper
import java.nio.ByteBuffer
import java.util.UUID

/** A signed public key, ready for the server. */
class SignedKey(val keyId: Int, val publicKey: ByteArray, val signature: ByteArray)

/** A one-time public key, ready for the server. */
class OneTimeKey(val keyId: Int, val publicKey: ByteArray)

/** What a device puts on the server once, when it signs in. */
class DeviceKeys(val registrationId: Int, val identityKey: ByteArray, val signedPreKey: SignedKey, val kyberLastResort: SignedKey)

/**
 * The public half of another device's keys, from the server. `preKeyId` and
 * `preKey` are missing when that device's one-time keys have run out.
 */
class PublicBundle(
  val registrationId: Int,
  val deviceId: Int,
  val preKeyId: Int?,
  val preKey: ByteArray?,
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
 * Every call goes straight to Signal's own library (libsignal); we only glue
 * the pieces together. The secret keys stay in the store and never go back to
 * JavaScript. Since phase 4 the store is saved (SavedStore), so the keys
 * survive the app closing.
 *
 * `name` is the user id and `deviceId` the device number, as the server knows them.
 */
class SignalDevice private constructor(
  private val backend: KeyBackend,
  val uid: String,
  var name: String,
  var deviceId: Int,
  identity: IdentityKeyPair,
  registrationId: Int,
) {
  private val store = SavedStore(backend, uid, identity, registrationId)
  private val address get() = SignalProtocolAddress(name, deviceId)

  /** Puts this device's real address on it (after signing in). */
  fun rename(newName: String, newDeviceId: Int) {
    backend.transaction {
      // An older device on this phone with the same address (signed in before) is forgotten.
      val info = "$newName\n$newDeviceId"
      for (other in backend.keys(DEVICES, "")) {
        if (other != uid && backend.get(DEVICES, other)?.let { String(it) } == info) backend.delete(DEVICES, other)
      }
      name = newName
      deviceId = newDeviceId
      saveInfo()
    }
  }

  private fun saveInfo() {
    backend.put(DEVICES, uid, "$name\n$deviceId".toByteArray())
  }

  /** The keys the server needs once, when this device signs in. */
  fun deviceKeys(): DeviceKeys {
    val signed = store.loadSignedPreKey(SavedStore.SIGNED_PRE_KEY_ID)
    val kyber = store.loadKyberPreKey(SavedStore.LAST_RESORT_KYBER_ID)
    return DeviceKeys(
      registrationId = store.localRegistrationId,
      identityKey = store.identityKeyPair.publicKey.serialize(),
      signedPreKey = SignedKey(signed.id, signed.keyPair.publicKey.serialize(), signed.signature),
      kyberLastResort = SignedKey(kyber.id, kyber.keyPair.publicKey.serialize(), kyber.signature),
    )
  }

  /**
   * Makes `count` new one-time keys of each kind (a normal one and a Kyber one).
   * The server hands each out once. Numbers count up from 1 and wrap before the
   * last-resort Kyber key's number.
   */
  fun newPreKeys(count: Int): Pair<List<OneTimeKey>, List<SignedKey>> =
    backend.transaction {
      var next = backend.get(META, "$uid/nextPreKeyId")?.let { ByteBuffer.wrap(it).int } ?: 1
      val ec = mutableListOf<OneTimeKey>()
      val kyber = mutableListOf<SignedKey>()
      repeat(count) {
        val id = next
        next = if (id + 1 >= SavedStore.LAST_RESORT_KYBER_ID) 1 else id + 1

        val pre = ECKeyPair.generate()
        store.storePreKey(id, PreKeyRecord(id, pre))
        ec += OneTimeKey(id, pre.publicKey.serialize())

        val k = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
        val sig = store.identityKeyPair.privateKey.calculateSignature(k.publicKey.serialize())
        store.storeKyberPreKey(id, KyberPreKeyRecord(id, System.currentTimeMillis(), k, sig))
        kyber += SignedKey(id, k.publicKey.serialize(), sig)
      }
      backend.put(META, "$uid/nextPreKeyId", ByteBuffer.allocate(4).putInt(next).array())
      ec to kyber
    }

  /** Starts a session with another device, from the bundle the server gave us. */
  fun startSession(theirName: String, theirDeviceId: Int, b: PublicBundle) {
    val hasPreKey = b.preKeyId != null && b.preKey != null
    val bundle = PreKeyBundle(
      b.registrationId,
      b.deviceId,
      if (hasPreKey) b.preKeyId!! else PreKeyBundle.NULL_PRE_KEY_ID,
      if (hasPreKey) ECPublicKey(b.preKey!!) else null,
      b.signedPreKeyId,
      ECPublicKey(b.signedPreKey),
      b.signedPreKeySignature,
      IdentityKey(b.identityKey),
      b.kyberPreKeyId,
      KEMPublicKey(b.kyberPreKey),
      b.kyberPreKeySignature,
    )
    // The library checks the signatures and refuses a bundle that was tampered with.
    // Careful: SessionBuilder takes (them, us), but SessionCipher takes (us, them).
    backend.transaction { SessionBuilder(store, SignalProtocolAddress(theirName, theirDeviceId), address).process(bundle) }
  }

  fun hasSession(theirName: String, theirDeviceId: Int): Boolean =
    store.containsSession(SignalProtocolAddress(theirName, theirDeviceId))

  fun deleteSession(theirName: String, theirDeviceId: Int) {
    store.deleteSession(SignalProtocolAddress(theirName, theirDeviceId))
  }

  /** Their identity key as we last saw it, or null if we never talked. */
  fun identityKey(theirName: String, theirDeviceId: Int): ByteArray? =
    store.getIdentity(SignalProtocolAddress(theirName, theirDeviceId))?.serialize()

  /** Locks a message for one other device. */
  fun encrypt(toName: String, toDeviceId: Int, plaintext: ByteArray): Sealed =
    backend.transaction {
      val message = SessionCipher(store, address, SignalProtocolAddress(toName, toDeviceId)).encrypt(plaintext)
      Sealed(message.type, message.serialize())
    }

  /**
   * Unlocks a message from another device. Throws if it was changed, repeated or isn't for us.
   *
   * With `keep` (the envelope's number), the unlocked text is saved in the same
   * transaction as the new session state, and asking again with the same number
   * gives the same text back. So if the app is killed before it saves the
   * message, it can still open it when the server sends it again. `forgetOpened`
   * clears it once the message is safely saved.
   */
  fun decrypt(fromName: String, fromDeviceId: Int, sealed: Sealed, keep: Long? = null): ByteArray =
    opening(keep, fromName, fromDeviceId) {
      val cipher = SessionCipher(store, address, SignalProtocolAddress(fromName, fromDeviceId))
      when (sealed.type) {
        CiphertextMessage.PREKEY_TYPE -> cipher.decrypt(PreKeySignalMessage(sealed.body))
        CiphertextMessage.WHISPER_TYPE -> cipher.decrypt(SignalMessage(sealed.body))
        else -> throw IllegalArgumentException("Unknown message type ${sealed.type}")
      }
    }

  /** Forgets texts kept by `decrypt` or `groupDecrypt`, once the app has saved them. */
  fun forgetOpened(keeps: List<Long>) {
    backend.transaction {
      for (k in keeps) for (key in backend.keys(OPENED, "$uid/$k/")) backend.delete(OPENED, key)
    }
  }

  // The kept text is filed under the sender too, so a resent number can't come back as someone else's.
  private fun opening(keep: Long?, fromName: String, fromDeviceId: Int, open: () -> ByteArray): ByteArray =
    backend.transaction {
      val key = keep?.let { "$uid/$it/$fromName.$fromDeviceId" }
      key?.let { k -> backend.get(OPENED, k) }
        ?: open().also { plain -> key?.let { backend.put(OPENED, it, plain) } }
    }

  /**
   * Groups use "sender keys": each device makes one key per group and sends it
   * to the others inside normal 1-to-1 locked messages. After that, a group
   * message is locked once and the server copies it to everyone.
   * `distributionId` (a UUID) names the key; a new one means a new key.
   */
  fun createGroupKey(distributionId: String): ByteArray =
    backend.transaction { GroupSessionBuilder(store).create(address, UUID.fromString(distributionId)).serialize() }

  /** Saves another device's group key, so we can read its group messages. */
  fun acceptGroupKey(fromName: String, fromDeviceId: Int, groupKey: ByteArray) {
    backend.transaction {
      GroupSessionBuilder(store).process(SignalProtocolAddress(fromName, fromDeviceId), SenderKeyDistributionMessage(groupKey))
    }
  }

  fun groupEncrypt(distributionId: String, plaintext: ByteArray): ByteArray =
    backend.transaction { GroupCipher(store, address).encrypt(UUID.fromString(distributionId), plaintext).serialize() }

  fun groupDecrypt(fromName: String, fromDeviceId: Int, body: ByteArray, keep: Long? = null): ByteArray =
    opening(keep, fromName, fromDeviceId) { GroupCipher(store, SignalProtocolAddress(fromName, fromDeviceId)).decrypt(body) }

  /**
   * The safety number for a chat, like WhatsApp's "Verify security code".
   * Both people see the same 60 digits if nobody is in the middle.
   */
  fun safetyNumber(theirName: String, theirDeviceId: Int): String {
    val theirKey = store.getIdentity(SignalProtocolAddress(theirName, theirDeviceId))
      ?: throw org.signal.libsignal.protocol.NoSessionException("No session with $theirName yet")
    return NumericFingerprintGenerator(5200)
      .createFor(2, name.toByteArray(), store.identityKeyPair.publicKey, theirName.toByteArray(), theirKey)
      .displayableFingerprint
      .displayText
  }

  companion object {
    private const val DEVICES = "devices"
    private const val SELF = "self"
    private const val META = "meta"
    private const val OPENED = "opened"

    /** Makes a brand-new device with fresh keys, and saves it. */
    fun create(backend: KeyBackend, name: String, deviceId: Int): SignalDevice =
      backend.transaction {
        val uid = UUID.randomUUID().toString()
        val identity = IdentityKeyPair.generate()
        val registrationId = KeyHelper.generateRegistrationId(false)
        backend.put(SELF, "$uid/identity", identity.serialize())
        backend.put(SELF, "$uid/registrationId", ByteBuffer.allocate(4).putInt(registrationId).array())

        val device = SignalDevice(backend, uid, name, deviceId, identity, registrationId)
        // The signed pre-key, and the "last resort" Kyber key for when the one-time ones run out.
        val signed = ECKeyPair.generate()
        val signedSig = identity.privateKey.calculateSignature(signed.publicKey.serialize())
        device.store.storeSignedPreKey(
          SavedStore.SIGNED_PRE_KEY_ID,
          SignedPreKeyRecord(SavedStore.SIGNED_PRE_KEY_ID, System.currentTimeMillis(), signed, signedSig),
        )
        val kyber = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
        val kyberSig = identity.privateKey.calculateSignature(kyber.publicKey.serialize())
        device.store.storeKyberPreKey(
          SavedStore.LAST_RESORT_KYBER_ID,
          KyberPreKeyRecord(SavedStore.LAST_RESORT_KYBER_ID, System.currentTimeMillis(), kyber, kyberSig),
        )
        device.saveInfo()
        device
      }

    /** Finds a device made earlier with this address, or null. */
    fun open(backend: KeyBackend, name: String, deviceId: Int): SignalDevice? {
      val uid = backend.keys(DEVICES, "").firstOrNull { String(backend.get(DEVICES, it) ?: return@firstOrNull false) == "$name\n$deviceId" }
        ?: return null
      val identity = backend.get(SELF, "$uid/identity")?.let { IdentityKeyPair(it) } ?: return null
      val registrationId = backend.get(SELF, "$uid/registrationId")?.let { ByteBuffer.wrap(it).int } ?: return null
      return SignalDevice(backend, uid, name, deviceId, identity, registrationId)
    }
  }
}
