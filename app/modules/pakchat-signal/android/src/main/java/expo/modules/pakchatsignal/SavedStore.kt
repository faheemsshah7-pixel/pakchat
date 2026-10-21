package expo.modules.pakchatsignal

import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.InvalidKeyIdException
import org.signal.libsignal.protocol.NoSessionException
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.groups.state.SenderKeyRecord
import org.signal.libsignal.protocol.state.IdentityKeyStore
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignalProtocolStore
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import java.util.UUID

/**
 * Everything Signal needs to remember for one device, saved in a KeyBackend so
 * it survives the app closing. Signal's library asks this store for keys and
 * sessions while it works; we only save and load bytes.
 *
 * `uid` is this device's own private name in the backend. It never changes,
 * even when the device gets its real address after signing in.
 */
class SavedStore(
  private val backend: KeyBackend,
  private val uid: String,
  private val identity: IdentityKeyPair,
  private val registrationId: Int,
) : SignalProtocolStore {

  private fun k(rest: String) = "$uid/$rest"
  private fun addr(a: SignalProtocolAddress) = "${a.name}.${a.deviceId}"

  // ---- Who we are ----

  override fun getIdentityKeyPair() = identity

  override fun getLocalRegistrationId() = registrationId

  // ---- Who they are ----

  override fun saveIdentity(address: SignalProtocolAddress, identityKey: IdentityKey): IdentityKeyStore.IdentityChange {
    val old = backend.get(IDENTITIES, k(addr(address)))
    backend.put(IDENTITIES, k(addr(address)), identityKey.serialize())
    return if (old != null && !old.contentEquals(identityKey.serialize())) {
      IdentityKeyStore.IdentityChange.REPLACED_EXISTING
    } else {
      IdentityKeyStore.IdentityChange.NEW_OR_UNCHANGED
    }
  }

  // Like WhatsApp: a changed key is trusted, and the app shows "security code changed".
  override fun isTrustedIdentity(address: SignalProtocolAddress, identityKey: IdentityKey, direction: IdentityKeyStore.Direction) = true

  override fun getIdentity(address: SignalProtocolAddress): IdentityKey? =
    backend.get(IDENTITIES, k(addr(address)))?.let { IdentityKey(it) }

  // ---- Sessions (one per device we talk to) ----

  override fun loadSession(address: SignalProtocolAddress): SessionRecord =
    backend.get(SESSIONS, k(addr(address)))?.let { SessionRecord(it) } ?: SessionRecord()

  override fun loadExistingSessions(addresses: List<SignalProtocolAddress>): List<SessionRecord> =
    addresses.map { a ->
      backend.get(SESSIONS, k(addr(a)))?.let { SessionRecord(it) } ?: throw NoSessionException("No session for ${addr(a)}")
    }

  override fun getSubDeviceSessions(name: String): List<Int> =
    backend.keys(SESSIONS, k("$name.")).mapNotNull { it.substringAfterLast('.').toIntOrNull() }.filter { it != 1 }

  override fun storeSession(address: SignalProtocolAddress, record: SessionRecord) {
    backend.put(SESSIONS, k(addr(address)), record.serialize())
  }

  override fun containsSession(address: SignalProtocolAddress): Boolean =
    backend.get(SESSIONS, k(addr(address)))?.let { SessionRecord(it).hasSenderChain() } ?: false

  override fun deleteSession(address: SignalProtocolAddress) {
    backend.delete(SESSIONS, k(addr(address)))
  }

  override fun deleteAllSessions(name: String) {
    for (key in backend.keys(SESSIONS, k("$name."))) backend.delete(SESSIONS, key)
  }

  // ---- One-time keys ----

  override fun loadPreKey(preKeyId: Int): PreKeyRecord =
    backend.get(PRE_KEYS, k("$preKeyId"))?.let { PreKeyRecord(it) } ?: throw InvalidKeyIdException("No pre-key $preKeyId")

  override fun storePreKey(preKeyId: Int, record: PreKeyRecord) {
    backend.put(PRE_KEYS, k("$preKeyId"), record.serialize())
  }

  override fun containsPreKey(preKeyId: Int) = backend.get(PRE_KEYS, k("$preKeyId")) != null

  override fun removePreKey(preKeyId: Int) {
    backend.delete(PRE_KEYS, k("$preKeyId"))
  }

  // ---- The signed pre-key ----

  override fun loadSignedPreKey(signedPreKeyId: Int): SignedPreKeyRecord =
    backend.get(SIGNED_PRE_KEYS, k("$signedPreKeyId"))?.let { SignedPreKeyRecord(it) }
      ?: throw InvalidKeyIdException("No signed pre-key $signedPreKeyId")

  override fun loadSignedPreKeys(): List<SignedPreKeyRecord> =
    backend.keys(SIGNED_PRE_KEYS, k("")).mapNotNull { backend.get(SIGNED_PRE_KEYS, it) }.map { SignedPreKeyRecord(it) }

  override fun storeSignedPreKey(signedPreKeyId: Int, record: SignedPreKeyRecord) {
    backend.put(SIGNED_PRE_KEYS, k("$signedPreKeyId"), record.serialize())
  }

  override fun containsSignedPreKey(signedPreKeyId: Int) = backend.get(SIGNED_PRE_KEYS, k("$signedPreKeyId")) != null

  override fun removeSignedPreKey(signedPreKeyId: Int) {
    backend.delete(SIGNED_PRE_KEYS, k("$signedPreKeyId"))
  }

  // ---- Kyber (post-quantum) keys ----

  override fun loadKyberPreKey(kyberPreKeyId: Int): KyberPreKeyRecord =
    backend.get(KYBER_KEYS, k("$kyberPreKeyId"))?.let { KyberPreKeyRecord(it) }
      ?: throw InvalidKeyIdException("No kyber pre-key $kyberPreKeyId")

  override fun loadKyberPreKeys(): List<KyberPreKeyRecord> =
    backend.keys(KYBER_KEYS, k("")).mapNotNull { backend.get(KYBER_KEYS, it) }.map { KyberPreKeyRecord(it) }

  override fun storeKyberPreKey(kyberPreKeyId: Int, record: KyberPreKeyRecord) {
    backend.put(KYBER_KEYS, k("$kyberPreKeyId"), record.serialize())
  }

  override fun containsKyberPreKey(kyberPreKeyId: Int) = backend.get(KYBER_KEYS, k("$kyberPreKeyId")) != null

  // One-time Kyber keys are used once, then deleted. The "last resort" one stays.
  override fun markKyberPreKeyUsed(kyberPreKeyId: Int, signedPreKeyId: Int, baseKey: ECPublicKey) {
    if (kyberPreKeyId != LAST_RESORT_KYBER_ID) backend.delete(KYBER_KEYS, k("$kyberPreKeyId"))
  }

  // ---- Group keys (sender keys) ----

  override fun storeSenderKey(sender: SignalProtocolAddress, distributionId: UUID, record: SenderKeyRecord) {
    backend.put(SENDER_KEYS, k("${addr(sender)}/$distributionId"), record.serialize())
  }

  override fun loadSenderKey(sender: SignalProtocolAddress, distributionId: UUID): SenderKeyRecord? =
    backend.get(SENDER_KEYS, k("${addr(sender)}/$distributionId"))?.let { SenderKeyRecord(it) }

  companion object {
    // The same ids as the website's module and the computer tests (shared/test/nodeSignal.ts).
    const val LAST_RESORT_KYBER_ID = 0xFFFFFF
    const val SIGNED_PRE_KEY_ID = 1

    const val IDENTITIES = "identities"
    const val SESSIONS = "sessions"
    const val PRE_KEYS = "preKeys"
    const val SIGNED_PRE_KEYS = "signedPreKeys"
    const val KYBER_KEYS = "kyberKeys"
    const val SENDER_KEYS = "senderKeys"
  }
}
