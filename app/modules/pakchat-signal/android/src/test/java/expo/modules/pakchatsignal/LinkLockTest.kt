package expo.modules.pakchatsignal

import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.signal.libsignal.protocol.ecc.ECKeyPair
import org.signal.libsignal.protocol.ecc.ECPrivateKey
import org.signal.libsignal.protocol.ecc.ECPublicKey
import org.signal.libsignal.protocol.kdf.HKDF

/**
 * The provision lock for QR linking. The website opens it with WebCrypto
 * (shared/src/link.ts); this opens it the same way, step by step.
 */
class LinkLockTest {
  private fun open(locked: ByteArray, websitePrivate: ECPrivateKey, websitePublic: ByteArray): ByteArray {
    val phonePublic = locked.copyOfRange(1, 33)
    val shared = websitePrivate.calculateAgreement(ECPublicKey(byteArrayOf(0x05) + phonePublic))
    val key = HKDF.deriveSecrets(shared, ByteArray(32), "PakChat link provision v1".toByteArray(), 32)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, locked.copyOfRange(33, 45)))
    cipher.updateAAD(byteArrayOf(1) + phonePublic + websitePublic)
    return cipher.doFinal(locked.copyOfRange(45, locked.size))
  }

  @Test
  fun onlyTheWebsiteInTheQrCanOpenIt() {
    val website = ECKeyPair.generate()
    val websitePublic = website.publicKey.serialize().copyOfRange(1, 33)
    val plain = """{"v":1,"userId":"u1","phoneName":"Pixel 7"}""".toByteArray()
    val locked = LinkLock.lock(plain, websitePublic)
    assertEquals(1.toByte(), locked[0])
    assertArrayEquals(plain, open(locked, website.privateKey, websitePublic))

    val someoneElse = ECKeyPair.generate()
    assertThrows(AEADBadTagException::class.java) { open(locked, someoneElse.privateKey, websitePublic) }
    locked[locked.size - 1] = (locked[locked.size - 1].toInt() xor 1).toByte()
    assertThrows(AEADBadTagException::class.java) { open(locked, website.privateKey, websitePublic) }
  }
}
