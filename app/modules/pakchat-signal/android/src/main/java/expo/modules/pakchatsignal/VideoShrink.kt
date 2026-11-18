package expo.modules.pakchatsignal

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Effect
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.container.Mp4LocationData
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.InAppMp4Muxer
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import java.io.File
import kotlin.math.min
import kotlin.math.roundToInt

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
 *
 * Drawing on a video (the editor's pen, words and stickers): `overlay` is a
 * picture of them with a see-through background, the video's shape. It's
 * stretched to the finished video's size and put on every frame, so it's part
 * of the video for everyone, like WhatsApp's. A video with a drawing is always
 * made again (with HD, at its own size and quality).
 *
 * Build 34: a phone that can't turn HDR into normal one way tries the other, and if neither
 * works the video goes as it did before (it can always be sent). Videos are made one at a
 * time, and one that stops moving is given up on, so an album never hangs.
 *
 * Build 32: a small video is never made bigger (its own bitrate when that's
 * under 2 megabits, and never stretched past its own size). An HDR video (the
 * bright kind new phones film) is always turned into a normal one, as WhatsApp
 * does, because many phones can't play HDR: with HD at up to 1080 px on its
 * short side and close to its own quality.
 */
object VideoShrink {
  private const val SHORT_SIDE = 720
  private const val BITRATE = 2_000_000
  private const val HD_HDR_SHORT_SIDE = 1080
  private const val STALL_MS = 30_000L

  /** What the video is: its size as it's seen, its bitrate (0 if unknown), and whether it's HDR. */
  private class Facts(val width: Int, val height: Int, val bitrate: Int, val hdr: Boolean)

  private val main = Handler(Looper.getMainLooper())

  // One video at a time: several at once (an album) can run out of the phone's video chips, and
  // then they all wait for each other for ever. Only touched on the main thread.
  private val waiting = ArrayDeque<() -> Unit>()
  private var running = false

  private fun next() {
    running = false
    val job = waiting.removeFirstOrNull() ?: return
    running = true
    job()
  }

  @OptIn(UnstableApi::class)
  fun shrink(context: Context, input: String, output: String, startMs: Long, endMs: Long, hd: Boolean, mute: Boolean, overlay: String?, promise: Promise) {
    val app = context.applicationContext
    main.post {
      waiting.addLast {
        val out = File(Uri.parse(output).path ?: output)
        // Each video ends here once (made, or given up), and lets the next one start.
        val finish: (() -> Unit) -> Unit = { answer ->
          answer()
          main.post { next() }
        }
        try {
          val info = facts(app, input)
          // An HDR video is turned into a normal one: first with the phone's graphics chip, then (on a
          // phone where that fails) with its video chip, and if neither works it goes as before build 33
          // (as it is), so it can always be sent.
          val tries = if (info?.hdr == true) listOf(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL, Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_MEDIACODEC, null) else listOf(null)
          attempt(app, input, out, startMs, endMs, hd, mute, overlay, info, tries, promise, finish)
        } catch (e: Exception) {
          out.delete()
          finish { promise.reject("ERR_VIDEO_SHRINK", e.message ?: "Couldn't make the video smaller", e) }
        }
      }
      if (!running) next()
    }
  }

  /**
   * One try at making the copy, with `tries.first()` as the HDR tone-mapping (null: none). A failure,
   * or no progress for a while (some phones just stop), tries the next one.
   */
  @OptIn(UnstableApi::class)
  private fun attempt(app: Context, input: String, out: File, startMs: Long, endMs: Long, hd: Boolean, mute: Boolean, overlay: String?, info: Facts?, tries: List<Int?>, promise: Promise, finish: (() -> Unit) -> Unit) {
    out.parentFile?.mkdirs()
    if (out.exists()) out.delete()
    val toneMap = tries.first()
    val hdr = toneMap != null
    val shortSide = info?.let { min(it.width, it.height) }?.takeIf { it > 0 }
    // The short side it's made at (null: as it is).
    val target = when {
      !hd -> min(SHORT_SIDE, shortSide ?: SHORT_SIDE)
      hdr -> min(HD_HDR_SHORT_SIDE, shortSide ?: HD_HDR_SHORT_SIDE)
      else -> null
    }
    val own = info?.bitrate ?: 0
    val bitrate = if (!hd) (if (own > 0) min(BITRATE, own) else BITRATE).coerceAtLeast(300_000) else (if (own > 0) own else 8_000_000).coerceIn(BITRATE, 10_000_000)
    val encoders = DefaultEncoderFactory.Builder(app)
      .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
      // A phone that can't do exactly this does the nearest it can.
      .setEnableFallback(true)
      .build()
    // Where it was filmed never goes in the copy.
    val muxer = InAppMp4Muxer.Factory { entries -> entries.removeAll { it is Mp4LocationData } }
    val builder = Transformer.Builder(app).setMuxerFactory(muxer)
    if (!hd || hdr) {
      builder
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(encoders)
    }
    var over = false
    fun failed(e: Exception) {
      over = true
      out.delete()
      if (tries.size > 1) {
        // Started again from the main thread, as Transformer needs.
        main.post {
          try {
            attempt(app, input, out, startMs, endMs, hd, mute, overlay, info, tries.drop(1), promise, finish)
          } catch (again: Exception) {
            out.delete()
            finish { promise.reject("ERR_VIDEO_SHRINK", again.message ?: "Couldn't make the video smaller", again) }
          }
        }
      } else {
        finish { promise.reject("ERR_VIDEO_SHRINK", e.message ?: "Couldn't make the video smaller", e) }
      }
    }
    val transformer = builder
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, result: ExportResult) {
          if (over) return
          over = true
          finish {
            promise.resolve(
              mapOf(
                "uri" to Uri.fromFile(out).toString(),
                "size" to out.length().toDouble(),
                "width" to result.width.coerceAtLeast(0),
                "height" to result.height.coerceAtLeast(0),
              ),
            )
          }
        }

        override fun onError(composition: Composition, result: ExportResult, exportException: ExportException) {
          if (!over) failed(exportException)
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
    // The editor's speaker button: sent without its sound, like WhatsApp's.
    if (mute) item.setRemoveAudio(true)
    val effects = mutableListOf<Effect>()
    if (target != null) effects.add(Presentation.createForShortSide(target))
    if (overlay != null) {
      // A drawing that can't be read must not quietly go missing: the whole thing fails, and JavaScript says so.
      val picture = drawing(app, input, overlay, target) ?: throw IllegalStateException("Couldn't read the drawing")
      effects.add(OverlayEffect(listOf(BitmapOverlay.createStaticBitmapOverlay(picture))))
    }
    if (effects.isNotEmpty()) item.setEffects(Effects(listOf(), effects))
    if (toneMap != null) {
      val composition = Composition.Builder(EditedMediaItemSequence.Builder(item.build()).build())
        .setHdrMode(toneMap)
        .build()
      transformer.start(composition, out.path)
    } else {
      transformer.start(item.build(), out.path)
    }

    // Stuck: no progress for 30 seconds (3 minutes when the phone can't say how far it is).
    val holder = ProgressHolder()
    var last = -2
    var since = System.currentTimeMillis()
    main.postDelayed(object : Runnable {
      override fun run() {
        if (over) return
        val state = transformer.getProgress(holder)
        val now = System.currentTimeMillis()
        val at = if (state == Transformer.PROGRESS_STATE_AVAILABLE) holder.progress else -1
        if (at != last) {
          last = at
          since = now
        } else if (now - since > if (state == Transformer.PROGRESS_STATE_UNAVAILABLE) 180_000 else STALL_MS) {
          transformer.cancel()
          failed(IllegalStateException("The video stopped getting ready"))
          return
        }
        main.postDelayed(this, 1_000)
      }
    }, 1_000)
  }

  /**
   * The drawing, stretched to the finished video's size (as it's seen, so turned
   * when the video is), so it covers each frame exactly. With a `shortSide` the
   * short side becomes that, as Presentation does it.
   */
  private fun drawing(context: Context, input: String, overlay: String, shortSide: Int?): Bitmap? {
    val picture = BitmapFactory.decodeFile(Uri.parse(overlay).path ?: overlay) ?: return null
    val r = MediaMetadataRetriever()
    var w: Int
    var h: Int
    try {
      if (input.startsWith("content:") || input.startsWith("file:")) r.setDataSource(context, Uri.parse(input)) else r.setDataSource(input)
      w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val turn = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (turn == 90 || turn == 270) w = h.also { h = w }
    } catch (e: Exception) {
      return null
    } finally {
      r.release()
    }
    if (w <= 0 || h <= 0) return null
    if (shortSide != null) {
      val scale = shortSide.toFloat() / min(w, h)
      w = (w * scale).roundToInt()
      h = (h * scale).roundToInt()
    }
    return if (picture.width == w && picture.height == h) picture else Bitmap.createScaledBitmap(picture, w, h, true)
  }

  private fun facts(context: Context, input: String): Facts? {
    val local = input.startsWith("content:") || input.startsWith("file:")
    val r = MediaMetadataRetriever()
    var w: Int
    var h: Int
    val bitrate: Int
    try {
      if (local) r.setDataSource(context, Uri.parse(input)) else r.setDataSource(input)
      w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val turn = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (turn == 90 || turn == 270) w = h.also { h = w }
      bitrate = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull() ?: 0
    } catch (e: Exception) {
      return null
    } finally {
      r.release()
    }
    // HDR: a picture track with the HDR10 (PQ) or HLG light curve, or Dolby Vision.
    var hdr = false
    val x = MediaExtractor()
    try {
      if (local) x.setDataSource(context, Uri.parse(input), null) else x.setDataSource(input)
      for (i in 0 until x.trackCount) {
        val f = x.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("video/")) continue
        val transfer = if (f.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) f.getInteger(MediaFormat.KEY_COLOR_TRANSFER) else 0
        hdr = transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer == MediaFormat.COLOR_TRANSFER_HLG || mime == MimeTypes.VIDEO_DOLBY_VISION
        break
      }
    } catch (e: Exception) {
      // Not known: taken as a normal video.
    } finally {
      x.release()
    }
    return Facts(w, h, bitrate, hdr)
  }
}
