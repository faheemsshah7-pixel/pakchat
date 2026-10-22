package expo.modules.pakchatsignal

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Locks and unlocks files (photos, videos, documents, backups) before they go
 * to the server, the way Signal does its attachments:
 *
 *   key    = 64 random bytes: the first 32 lock (AES-256-CBC), the last 32 check (HMAC-SHA256)
 *   locked = 16-byte IV, then the locked bytes, then a 32-byte HMAC of both
 *   digest = SHA-256 of all the locked bytes, sent in the message so the other phone can check
 *
 * It works a piece at a time, so a 100 MB video never sits in memory. These are
 * the standard tools built into Android (javax.crypto); we only put them together.
 */
object FileLock {
  const val KEY_SIZE = 64
  private const val IV_SIZE = 16
  private const val MAC_SIZE = 32
  private const val CHUNK = 64 * 1024

  fun newKey(): ByteArray = ByteArray(KEY_SIZE).also { SecureRandom().nextBytes(it) }

  /** How big a file of `plain` bytes is once locked (CBC pads to the next 16 bytes). */
  fun lockedSize(plain: Long): Long = IV_SIZE + (plain / 16 + 1) * 16 + MAC_SIZE

  /**
   * Locks everything from `input` into `output`. Returns the digest.
   * `progress` is told how many plain bytes have gone so far.
   */
  fun lock(input: InputStream, output: OutputStream, key: ByteArray, progress: (Long) -> Unit = {}): ByteArray {
    require(key.size == KEY_SIZE) { "The key must be $KEY_SIZE bytes" }
    val iv = ByteArray(IV_SIZE).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, 0, 32, "AES"), IvParameterSpec(iv))
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, 32, 32, "HmacSHA256")) }
    val digest = MessageDigest.getInstance("SHA-256")

    fun write(bytes: ByteArray?) {
      if (bytes == null || bytes.isEmpty()) return
      mac.update(bytes)
      digest.update(bytes)
      output.write(bytes)
    }

    write(iv)
    val buffer = ByteArray(CHUNK)
    var done = 0L
    while (true) {
      val n = input.read(buffer)
      if (n < 0) break
      write(cipher.update(buffer, 0, n))
      done += n
      progress(done)
    }
    write(cipher.doFinal())
    val check = mac.doFinal()
    digest.update(check)
    output.write(check)
    output.flush()
    return digest.digest()
  }

  /**
   * Unlocks a locked file into `out`. First checks the digest (if given) and the
   * HMAC over the whole file, so nothing changed is ever unlocked. Throws
   * `SecurityException` if either doesn't match.
   */
  fun unlock(locked: File, out: File, key: ByteArray, digest: ByteArray?, progress: (Long) -> Unit = {}) {
    require(key.size == KEY_SIZE) { "The key must be $KEY_SIZE bytes" }
    val size = locked.length()
    if (size < IV_SIZE + 16 + MAC_SIZE) throw SecurityException("Too short to be a locked file")

    // 1. Check the digest and the HMAC.
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, 32, 32, "HmacSHA256")) }
    val sha = MessageDigest.getInstance("SHA-256")
    val theirMac = ByteArray(MAC_SIZE)
    locked.inputStream().buffered(CHUNK).use { input ->
      val buffer = ByteArray(CHUNK)
      var left = size - MAC_SIZE
      while (left > 0) {
        val n = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
        if (n < 0) throw SecurityException("The file ended early")
        mac.update(buffer, 0, n)
        sha.update(buffer, 0, n)
        left -= n
      }
      var got = 0
      while (got < MAC_SIZE) {
        val n = input.read(theirMac, got, MAC_SIZE - got)
        if (n < 0) throw SecurityException("The file ended early")
        got += n
      }
    }
    sha.update(theirMac)
    if (!MessageDigest.isEqual(mac.doFinal(), theirMac)) throw SecurityException("The file was changed")
    if (digest != null && !MessageDigest.isEqual(sha.digest(), digest)) throw SecurityException("The file isn't the one that was sent")

    // 2. Unlock.
    locked.inputStream().buffered(CHUNK).use { input ->
      val iv = ByteArray(IV_SIZE)
      var got = 0
      while (got < IV_SIZE) got += input.read(iv, got, IV_SIZE - got).also { if (it < 0) throw SecurityException("Too short") }
      val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, 0, 32, "AES"), IvParameterSpec(iv))
      out.outputStream().buffered(CHUNK).use { output ->
        val buffer = ByteArray(CHUNK)
        var left = size - IV_SIZE - MAC_SIZE
        var done = 0L
        while (left > 0) {
          val n = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
          if (n < 0) throw SecurityException("The file ended early")
          cipher.update(buffer, 0, n)?.let { output.write(it) }
          left -= n
          done += n
          progress(done)
        }
        output.write(cipher.doFinal())
      }
    }
  }

  /**
   * The key for backups, made from the backup password (PBKDF2, many rounds,
   * so guessing passwords is slow). The salt is the person's user id, so the
   * same password gives the same key on their new phone, and a different one
   * for anyone else.
   */
  fun backupKey(password: String, userId: String): ByteArray {
    val spec = PBEKeySpec(password.toCharArray(), "pakchat-backup:$userId".toByteArray(), 310_000, KEY_SIZE * 8)
    return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
  }
}
