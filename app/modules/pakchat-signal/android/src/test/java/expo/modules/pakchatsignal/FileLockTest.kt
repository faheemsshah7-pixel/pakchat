package expo.modules.pakchatsignal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import kotlin.random.Random

/** Locking and unlocking files, on a computer. */
class FileLockTest {
  private fun temp(bytes: ByteArray? = null) =
    File.createTempFile("pakchat", ".bin").apply {
      deleteOnExit()
      if (bytes != null) writeBytes(bytes)
    }

  private fun locked(plain: ByteArray, key: ByteArray): Pair<File, ByteArray> {
    val out = ByteArrayOutputStream()
    val digest = FileLock.lock(plain.inputStream(), out, key)
    return temp(out.toByteArray()) to digest
  }

  @Test
  fun aFileComesBackTheSameAtEverySize() {
    for (size in listOf(0, 1, 15, 16, 17, 65_536, 200_001)) {
      val plain = Random.nextBytes(size)
      val key = FileLock.newKey()
      val (file, digest) = locked(plain, key)
      assertEquals(FileLock.lockedSize(size.toLong()), file.length())
      assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(file.readBytes()), digest)
      val back = temp()
      FileLock.unlock(file, back, key, digest)
      assertArrayEquals(plain, back.readBytes())
    }
  }

  @Test
  fun aChangedFileOrWrongKeyIsRefused() {
    val plain = "Assalam o Alaikum".repeat(1000).toByteArray()
    val key = FileLock.newKey()
    val (file, digest) = locked(plain, key)

    val changed = file.readBytes().also { it[it.size / 2] = (it[it.size / 2].toInt() xor 1).toByte() }
    val out = temp()
    assertThrows(SecurityException::class.java) { FileLock.unlock(temp(changed), out, key, digest) }
    assertThrows(SecurityException::class.java) { FileLock.unlock(file, out, FileLock.newKey(), null) }
    // Another file locked with the same key, but not the one the message named.
    val (other, _) = locked("something else".toByteArray(), key)
    assertThrows(SecurityException::class.java) { FileLock.unlock(other, out, key, digest) }
    assertThrows(SecurityException::class.java) { FileLock.unlock(temp(ByteArray(10)), out, key, null) }
  }

  @Test
  fun lockingTheSameFileTwiceGivesDifferentBytes() {
    val plain = Random.nextBytes(1000)
    val key = FileLock.newKey()
    assertFalse(locked(plain, key).first.readBytes().contentEquals(locked(plain, key).first.readBytes()))
  }

  @Test
  fun theBackupKeyComesFromThePasswordAndThePerson() {
    val a = FileLock.backupKey("my secret words", "user-1")
    assertEquals(64, a.size)
    assertArrayEquals(a, FileLock.backupKey("my secret words", "user-1"))
    assertFalse(a.contentEquals(FileLock.backupKey("my secret words", "user-2")))
    assertFalse(a.contentEquals(FileLock.backupKey("my secret wordz", "user-1")))
  }
}
