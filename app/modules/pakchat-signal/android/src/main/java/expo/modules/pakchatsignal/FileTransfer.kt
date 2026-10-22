package expo.modules.pakchatsignal

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sends a file to the server locked, and fetches one back, straight from and
 * to the phone's storage. Locking happens while uploading, so there's never
 * an unlocked copy anywhere but the original.
 */
object FileTransfer {
  class Uploaded(val key: ByteArray, val digest: ByteArray, val size: Long)

  /** Locks `file` and PUTs it to `url` (a signed link). `key` is new unless one is given (backups). */
  fun upload(file: File, url: String, key: ByteArray? = null, progress: (Long, Long) -> Unit = { _, _ -> }): Uploaded {
    val k = key ?: FileLock.newKey()
    val plain = file.length()
    val size = FileLock.lockedSize(plain)
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "PUT"
      doOutput = true
      connectTimeout = 15_000
      readTimeout = 120_000
      setRequestProperty("Content-Type", "application/octet-stream")
      setFixedLengthStreamingMode(size)
    }
    try {
      val digest = file.inputStream().buffered().use { input ->
        conn.outputStream.buffered(64 * 1024).use { out -> FileLock.lock(input, out, k) { progress(it, plain) } }
      }
      val status = conn.responseCode
      if (status !in 200..299) throw IOException("The server said $status")
      return Uploaded(k, digest, size)
    } finally {
      conn.disconnect()
    }
  }

  /** Fetches the locked file at `url`, checks it, and unlocks it into `out`. */
  fun download(url: String, out: File, key: ByteArray, digest: ByteArray?, progress: (Long, Long) -> Unit = { _, _ -> }) {
    val tmp = File(out.parentFile, out.name + ".locked")
    out.parentFile?.mkdirs()
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 120_000
    }
    try {
      if (conn.responseCode !in 200..299) throw IOException("The server said ${conn.responseCode}")
      val total = conn.contentLengthLong
      conn.inputStream.buffered(64 * 1024).use { input ->
        tmp.outputStream().buffered(64 * 1024).use { output ->
          val buffer = ByteArray(64 * 1024)
          var done = 0L
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            output.write(buffer, 0, n)
            done += n
            progress(done, total)
          }
        }
      }
      FileLock.unlock(tmp, out, key, digest)
    } catch (e: Exception) {
      out.delete()
      throw e
    } finally {
      tmp.delete()
      conn.disconnect()
    }
  }
}
