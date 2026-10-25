package expo.modules.pakchatsignal

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.container.Mp4LocationData
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.InAppMp4Muxer
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import java.io.File

/**
 * Makes a video smaller before it's sent, like WhatsApp: at most 720 px on its
 * short side, about 2 megabits a second, in H.264 with AAC sound, the kind
 * every phone plays. A minute of phone video (often 100 MB or more) becomes
 * about 15 MB. With HD on, JavaScript skips this and sends the original.
 *
 * It uses Google's Media3 Transformer, which uses the phone's own video
 * chips, so it's quick and free. Transformer must be started on the main thread.
 *
 * Phase 7: it can also cut the video to `startMs`..`endMs` (the trim strip in
 * the editor), and with `hd` it keeps the size and quality (a straight copy
 * when nothing is cut). Either way, where it was filmed is left out, like
 * photos (the "Private" badge).
 */
object VideoShrink {
  private const val SHORT_SIDE = 720
  private const val BITRATE = 2_000_000

  @OptIn(UnstableApi::class)
  fun shrink(context: Context, input: String, output: String, startMs: Long, endMs: Long, hd: Boolean, promise: Promise) {
    val app = context.applicationContext
    Handler(Looper.getMainLooper()).post {
      val out = File(Uri.parse(output).path ?: output)
      try {
        out.parentFile?.mkdirs()
        if (out.exists()) out.delete()
        val encoders = DefaultEncoderFactory.Builder(app)
          .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(BITRATE).build())
          // A phone that can't do exactly this does the nearest it can.
          .setEnableFallback(true)
          .build()
        // Where it was filmed never goes in the copy.
        val muxer = InAppMp4Muxer.Factory { entries -> entries.removeAll { it is Mp4LocationData } }
        val builder = Transformer.Builder(app).setMuxerFactory(muxer)
        if (!hd) {
          builder
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoders)
        }
        val transformer = builder
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, result: ExportResult) {
              promise.resolve(
                mapOf(
                  "uri" to Uri.fromFile(out).toString(),
                  "size" to out.length().toDouble(),
                  "width" to result.width.coerceAtLeast(0),
                  "height" to result.height.coerceAtLeast(0),
                ),
              )
            }

            override fun onError(composition: Composition, result: ExportResult, exportException: ExportException) {
              out.delete()
              promise.reject("ERR_VIDEO_SHRINK", exportException.message ?: "Couldn't make the video smaller", exportException)
            }
          })
          .build()
        val media = MediaItem.Builder().setUri(input)
        if (startMs > 0 || endMs > 0) {
          val clip = MediaItem.ClippingConfiguration.Builder().setStartPositionMs(startMs.coerceAtLeast(0))
          if (endMs > startMs) clip.setEndPositionMs(endMs)
          media.setClippingConfiguration(clip.build())
        }
        val item = EditedMediaItem.Builder(media.build())
        if (!hd) item.setEffects(Effects(listOf(), listOf(Presentation.createForShortSide(SHORT_SIDE))))
        transformer.start(item.build(), out.path)
      } catch (e: Exception) {
        out.delete()
        promise.reject("ERR_VIDEO_SHRINK", e.message ?: "Couldn't make the video smaller", e)
      }
    }
  }
}
