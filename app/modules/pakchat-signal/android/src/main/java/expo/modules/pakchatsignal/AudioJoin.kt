package expo.modules.pakchatsignal

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * Joins voice-note pieces into one file, like WhatsApp's pause and resume.
 *
 * Pausing a recording stops the recorder and keeps what it made (a piece);
 * resuming starts a new piece. To listen back or to send, the pieces are
 * copied one after another into a single .m4a. Nothing is re-encoded: the
 * sound is moved as-is, only its timestamps are shifted so each piece starts
 * where the previous one ended. All pieces come from the same recorder
 * settings (app/src/core/voice.ts), so they share one format.
 */
object AudioJoin {
  /** Joins `parts` (file paths, in order) into `to`. Answers the length in milliseconds. */
  fun join(parts: List<File>, to: File): Long {
    require(parts.isNotEmpty()) { "Nothing to join" }
    to.parentFile?.mkdirs()
    if (to.exists()) to.delete()
    val muxer = MediaMuxer(to.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var track = -1
    var offset = 0L // where the next piece starts, in microseconds
    val buffer = ByteBuffer.allocate(1 shl 20)
    val info = MediaCodec.BufferInfo()
    try {
      for (part in parts) {
        val ex = MediaExtractor()
        try {
          // A piece cut off too soon can be unreadable: leave it out.
          if (runCatching { ex.setDataSource(part.path) }.isFailure) continue
          val index = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            ?: continue // an empty piece (stopped too fast): skip it
          val format = ex.getTrackFormat(index)
          if (track < 0) {
            track = muxer.addTrack(format)
            muxer.start()
          }
          ex.selectTrack(index)
          // One AAC frame is 1024 samples: the gap to leave after this piece's last frame.
          val rate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44_100
          val frame = 1024L * 1_000_000L / rate
          var last = -1L
          while (true) {
            buffer.clear()
            val size = ex.readSampleData(buffer, 0)
            if (size < 0) break
            val time = ex.sampleTime
            info.set(0, size, offset + time, ex.sampleFlags.toCodecFlags())
            muxer.writeSampleData(track, buffer, info)
            last = time
            ex.advance()
          }
          if (last >= 0) offset += last + frame
        } finally {
          ex.release()
        }
      }
      require(track >= 0) { "No sound was recorded" }
      muxer.stop()
    } finally {
      // release() throws if the muxer never started; that only matters when nothing was joined.
      runCatching { muxer.release() }
    }
    return offset / 1000
  }

  // MediaExtractor and MediaCodec number "this is a key frame" differently.
  private fun Int.toCodecFlags() = if (this and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
}
