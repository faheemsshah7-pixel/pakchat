package expo.modules.pakchatsignal

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.Promise
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Voice note transcripts, made on the phone itself with Android's own speech
 * recognition (free, and the voice note never leaves the phone). It needs
 * Android 13 or newer with on-device recognition installed; otherwise the app
 * says transcripts aren't available on this phone.
 *
 * The voice note (AAC) is decoded to plain sound (16 kHz, mono) and fed to the
 * recognizer through a pipe, in pieces, until it ends.
 */
object Transcribe {
  private const val RATE = 16_000

  fun available(context: Context) = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  fun run(context: Context, path: String, language: String, promise: Promise) {
    if (!available(context)) {
      promise.reject("ERR_UNAVAILABLE", "On-device speech recognition isn't available", null)
      return
    }
    val pipe = ParcelFileDescriptor.createPipe()
    Thread {
      try {
        ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { decode(path, it) }
      } catch (_: Exception) {
        // The recognizer stopped reading (an error): nothing more to write.
      }
    }.start()

    val main = Handler(Looper.getMainLooper())
    main.post {
      val parts = StringBuilder()
      var done = false
      val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
      fun finish(error: Int?) {
        if (done) return
        done = true
        try {
          recognizer.destroy()
        } catch (_: Exception) {
        }
        try {
          pipe[0].close()
        } catch (_: Exception) {
        }
        val text = parts.toString().trim()
        when {
          text.isNotEmpty() -> promise.resolve(text)
          error == null || error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> promise.resolve("")
          error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
            promise.reject("ERR_LANGUAGE", "This language isn't available for transcripts", null)
          else -> promise.reject("ERR_TRANSCRIBE", "Speech recognition error $error", null)
        }
      }
      recognizer.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onError(error: Int) = finish(error)
        override fun onResults(results: Bundle?) {
          add(results)
          finish(null)
        }
        override fun onSegmentResults(segmentResults: Bundle) = add(segmentResults)
        override fun onEndOfSegmentedSession() = finish(null)
        private fun add(b: Bundle?) {
          val best = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
          if (!best.isNullOrEmpty()) parts.append(best).append(' ')
        }
      })
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
        .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipe[0])
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE)
        .putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
      recognizer.startListening(intent)
      // A voice note can be 15 minutes long; give up after a little more than that.
      main.postDelayed({ finish(null) }, 16 * 60_000L)
    }
  }

  /** Decodes the file and writes it as 16 kHz mono 16-bit sound. */
  private fun decode(path: String, out: OutputStream) {
    val extractor = MediaExtractor()
    extractor.setDataSource(path.removePrefix("file://"))
    val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      ?: throw IllegalArgumentException("No sound in the file")
    extractor.selectTrack(track)
    val format = extractor.getTrackFormat(track)
    val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
    codec.configure(format, null, null, 0)
    codec.start()
    var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var pos = 0.0
    try {
      while (true) {
        if (!inputDone) {
          val i = codec.dequeueInputBuffer(10_000)
          if (i >= 0) {
            val buf = codec.getInputBuffer(i)!!
            val n = extractor.readSampleData(buf, 0)
            if (n < 0) {
              codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val o = codec.dequeueOutputBuffer(info, 10_000)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        } else if (o >= 0) {
          val buf = codec.getOutputBuffer(o)!!
          buf.position(info.offset)
          buf.limit(info.offset + info.size)
          pos = write(buf.slice().order(ByteOrder.LITTLE_ENDIAN), rate, channels, pos, out)
          codec.releaseOutputBuffer(o, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
      }
    } finally {
      codec.stop()
      codec.release()
      extractor.release()
    }
  }

  /** Mixes to one channel and picks the 16 kHz samples (simple, and plenty for speech). */
  private fun write(pcm: ByteBuffer, rate: Int, channels: Int, start: Double, out: OutputStream): Double {
    val shorts = pcm.asShortBuffer()
    val frames = shorts.remaining() / channels.coerceAtLeast(1)
    val step = rate.toDouble() / RATE
    var p = start
    val bytes = java.io.ByteArrayOutputStream(frames * 2)
    while (p < frames) {
      val f = p.toInt()
      var sum = 0
      for (c in 0 until channels) sum += shorts.get(f * channels + c)
      val s = (sum / channels.coerceAtLeast(1)).toShort().toInt()
      bytes.write(s and 0xff)
      bytes.write((s shr 8) and 0xff)
      p += step
    }
    out.write(bytes.toByteArray())
    return p - frames
  }
}
