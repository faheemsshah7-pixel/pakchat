package expo.modules.pakchatsignal

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log

/**
 * A voice note held to your ear, like WhatsApp: while one plays, the ear sensor
 * is watched. Raise the phone to your ear and the screen goes dark and the note
 * carries on quietly from the earpiece; take it away and it pauses.
 *
 * The chat's own player (expo-audio) plays through the loudspeaker as music
 * does, and Android won't send music to the earpiece on newer phones. So at
 * the ear a second player here takes over from the same spot, as speech on a
 * call does, and hands back where it got to.
 *
 * Never during a call (CallAudio has the sound and the ear sensor then), and
 * not with headphones in: the sound is at your ears already.
 */
object VoiceEar {
  private const val TAG = "PakChat"
  private val main = Handler(Looper.getMainLooper())

  private var watching = false
  private var near = false
  private var sensor: Sensor? = null
  private var proximity: PowerManager.WakeLock? = null
  private var player: MediaPlayer? = null
  private var appContext: Context? = null
  private var onEvent: ((Map<String, Any?>) -> Unit)? = null

  private val listener = object : SensorEventListener {
    override fun onSensorChanged(e: SensorEvent) {
      val s = sensor ?: return
      // Most phones only say "near" (0) or "far" (the most they can tell).
      val isNear = e.values[0] < minOf(5f, s.maximumRange)
      main.post { changed(isNear) }
    }

    override fun onAccuracyChanged(s: Sensor?, accuracy: Int) = Unit
  }

  /** Starts or stops watching the ear sensor (while a voice note plays). "voiceEar" says near or far. */
  @Synchronized
  fun watch(context: Context, on: Boolean, event: (Map<String, Any?>) -> Unit) {
    appContext = context.applicationContext
    onEvent = event
    if (on == watching) return
    if (on) {
      if (CallAudio.inCall()) return
      val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      val s = sm.getDefaultSensor(Sensor.TYPE_PROXIMITY) ?: return
      sensor = s
      watching = true
      near = false
      sm.registerListener(listener, s, SensorManager.SENSOR_DELAY_NORMAL)
      // Only darkens the screen while something is near it, so it can be held the whole time.
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
        if (proximity == null) proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "pakchat:voice")
        proximity?.let { if (!it.isHeld) it.acquire(30 * 60 * 1000L) }
      }
    } else {
      stopWatching(context)
    }
  }

  private fun stopWatching(context: Context) {
    if (watching) {
      val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      runCatching { sm.unregisterListener(listener) }
    }
    watching = false
    near = false
    proximity?.let { if (it.isHeld) it.release() }
  }

  @Synchronized
  private fun changed(isNear: Boolean) {
    if (!watching || isNear == near) return
    val context = appContext ?: return
    // Headphones in, or a call started meanwhile: nothing changes.
    if (isNear && (headphones(context) || CallAudio.inCall())) return
    near = isNear
    onEvent?.invoke(mapOf("near" to isNear))
  }

  private fun headphones(context: Context): Boolean {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
      it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
    }
  }

  /** Plays `uri` from `fromMs` at the earpiece. "voiceEar" says {done: true} when it reaches the end. */
  @SuppressLint("NewApi")
  @Synchronized
  fun play(context: Context, uri: String, fromMs: Int, speed: Float) {
    release(context)
    if (CallAudio.inCall()) return
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    try {
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= 31) {
        am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }?.let { am.setCommunicationDevice(it) }
      } else {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
      }
      val p = MediaPlayer()
      p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      p.setDataSource(context, Uri.parse(uri))
      p.prepare()
      if (fromMs > 0) p.seekTo(fromMs)
      if (speed != 1f) runCatching { p.playbackParams = p.playbackParams.setSpeed(speed) }
      p.setOnCompletionListener {
        main.post {
          synchronized(this) {
            if (player === it) {
              release(context)
              onEvent?.invoke(mapOf("done" to true))
            }
          }
        }
      }
      p.start()
      player = p
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't play the voice note at the ear: ${e.message}")
      release(context)
    }
  }

  /** Where the ear player is (ms), or -1 when it isn't playing. */
  @Synchronized
  fun position(): Int = player?.let { runCatching { it.currentPosition }.getOrDefault(-1) } ?: -1

  /** Stops the ear player and gives the sound back; answers where it got to (ms), or -1. */
  @Synchronized
  fun stop(context: Context): Int {
    val at = position()
    release(context)
    return at
  }

  /** Everything off: the call screen starts (CallAudio.start), or PakChat stops playing. */
  @Synchronized
  fun off(context: Context) {
    release(context)
    stopWatching(context)
  }

  @SuppressLint("NewApi")
  private fun release(context: Context) {
    val p = player ?: return
    player = null
    runCatching { p.stop() }
    runCatching { p.release() }
    // Hand the sound back, unless a call has it now.
    if (CallAudio.inCall()) return
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= 31) runCatching { am.clearCommunicationDevice() }
    am.mode = AudioManager.MODE_NORMAL
  }
}
