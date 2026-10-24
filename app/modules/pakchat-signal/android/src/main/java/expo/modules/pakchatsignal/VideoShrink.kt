package expo.modules.pakchatsignal

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
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
 */
object VideoShrink {
  private const val SHORT_SIDE = 720
  private const val BITRATE = 2_000_000

  @OptIn(UnstableApi::class)
  fun shrink(context: Context, input: String, output: String, promise: Promise) {
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
        val transformer = Transformer.Builder(app)
          .setVideoMimeType(MimeTypes.VIDEO_H264)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .setEncoderFactory(encoders)
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
        val item = EditedMediaItem.Builder(MediaItem.fromUri(input))
          .setEffects(Effects(listOf(), listOf(Presentation.createForShortSide(SHORT_SIDE))))
          .build()
        transformer.start(item, out.path)
      } catch (e: Exception) {
        out.delete()
        promise.reject("ERR_VIDEO_SHRINK", e.message ?: "Couldn't make the video smaller", e)
      }
    }
  }
}
