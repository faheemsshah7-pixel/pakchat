package expo.modules.pakchatsignal

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.kdf.HKDF

/**
 * Locks the "provision" the phone sends a website it links by QR code, so
 * only that website can read it (see shared/src/link.ts, which opens it):
 *
 *   X25519 between a new one-off key of ours and the key in the QR, then
 *   HKDF-SHA256 (salt 32 zero bytes, info "PakChat link provision v1") to
 *   an AES-256-GCM key.
 *
 *   locked = version byte 1, our one-off public key (32), IV (12), AES-GCM output
 *   AES-GCM also checks: version byte, our public key, the QR's public key
 *
 * The X25519 and HKDF are libsignal's; AES-GCM is Android's own.
 */
object LinkLock {
  private const val VERSION: Byte = 1
  private val INFO = "PakChat link provision v1".toByteArray()

  fun lock(plain: ByteArray, websiteKey: ByteArray): ByteArray {
    require(websiteKey.size == 32) { "The QR's key must be 32 bytes" }
    val mine = ECKeyPair.generate()
    // libsignal writes Curve25519 public keys with a 0x05 type byte in front.
    val myPublic = mine.publicKey.serialize().copyOfRange(1, 33)
    val shared = mine.privateKey.calculateAgreement(ECPublicKey(byteArrayOf(0x05) + websiteKey))
    val key = HKDF.deriveSecrets(shared, ByteArray(32), INFO, 32)
    val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    cipher.updateAAD(byteArrayOf(VERSION) + myPublic + websiteKey)
    return byteArrayOf(VERSION) + myPublic + iv + cipher.doFinal(plain)
  }
}
