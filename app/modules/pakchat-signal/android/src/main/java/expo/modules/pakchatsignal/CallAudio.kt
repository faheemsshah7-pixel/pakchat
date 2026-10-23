package expo.modules.pakchatsignal

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log

/**
 * The sound side of a call: what a phone call app has to do that WebRTC doesn't.
 *
 *  - Puts the phone in "call mode", so the mic cancels echo and the volume
 *    buttons change the call's volume.
 *  - Chooses where the other person's voice comes out: the earpiece (phone at
 *    your ear), the loudspeaker, wired headphones or Bluetooth.
 *  - Turns the screen off when the phone is at your ear (the proximity sensor),
 *    so your cheek can't press buttons.
 *  - Plays the "it's ringing" and "busy" beeps to the person calling.
 *
 * The ringing on the phone being called is the call alert's sound (CallAlerts),
 * so it rings even when PakChat isn't open.
 */
object CallAudio {
  private const val TAG = "PakChat"
  private val main = Handler(Looper.getMainLooper())

  private var focus: AudioFocusRequest? = null
  private var proximity: PowerManager.WakeLock? = null
  private var tones: ToneGenerator? = null
  private var ringing = false
  private var active = false
  private var video = false
  /** What you picked last; null lets PakChat choose (headphones first). */
  private var chosen: String? = null
  private var onChange: ((Map<String, Any?>) -> Unit)? = null

  private fun audio(context: Context) = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  /** Starts call mode. Video calls start on the loudspeaker, voice calls at the earpiece. */
  fun start(context: Context, isVideo: Boolean, changed: (Map<String, Any?>) -> Unit) {
    val am = audio(context)
    onChange = changed
    video = isVideo
    if (!active) {
      active = true
      chosen = null
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build()
      am.requestAudioFocus(request)
      focus = request
      am.registerAudioDeviceCallback(devices, main)
    }
    apply(context)
  }

  /** Ends call mode and gives the sound back to other apps. */
  fun stop(context: Context) {
    // The ringing beep stops with the call; a "busy" or "ended" beep is left to finish.
    if (ringing) stopTone()
    if (!active) return
    active = false
    val am = audio(context)
    runCatching { am.unregisterAudioDeviceCallback(devices) }
    if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
    else {
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = false
      @Suppress("DEPRECATION")
      if (am.isBluetoothScoOn) am.stopBluetoothSco()
    }
    am.mode = AudioManager.MODE_NORMAL
    focus?.let { am.abandonAudioFocusRequest(it) }
    focus = null
    near(context, false)
    onChange = null
  }

  /** You picked where the sound goes: "earpiece", "speaker", "headset" or "bluetooth". */
  fun route(context: Context, to: String) {
    chosen = to
    apply(context)
  }

  /** The camera was turned on or off: video calls default to the loudspeaker. */
  fun setVideo(context: Context, on: Boolean) {
    if (video == on) return
    video = on
    if (active) apply(context)
  }

  /** Where the sound can go now, and where it goes. */
  fun state(context: Context): Map<String, Any?> {
    val kinds = available(context)
    return mapOf("routes" to kinds.keys.toList(), "route" to current(context, kinds))
  }

  // ---- Choosing the output ----

  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changedDevices()
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changedDevices()
  }

  private var appContext: Context? = null

  private fun changedDevices() {
    val context = appContext ?: return
    // Headphones plugged in or out: if what you picked is gone, choose again.
    if (chosen != null && chosen !in available(context)) chosen = null
    apply(context)
  }

  private fun kind(type: Int) = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET -> "headset"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
    else -> if (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET) "bluetooth" else null
  }

  /** Each kind of output this phone has right now, with the device to use for it. */
  private fun available(context: Context): Map<String, AudioDeviceInfo?> {
    val am = audio(context)
    val found = linkedMapOf<String, AudioDeviceInfo?>()
    val list = if (Build.VERSION.SDK_INT >= 31) am.availableCommunicationDevices else am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
    for (d in list) kind(d.type)?.let { if (it !in found) found[it] = d }
    // Older phones don't list the earpiece and speaker as devices: they always exist.
    if (Build.VERSION.SDK_INT < 31) {
      found.putIfAbsent("earpiece", null)
      found.putIfAbsent("speaker", null)
    }
    return found
  }

  /** What to use: your pick, else headphones, else the loudspeaker for video, else the earpiece. */
  private fun target(kinds: Map<String, AudioDeviceInfo?>): String {
    chosen?.let { if (it in kinds) return it }
    return listOf("bluetooth", "headset").firstOrNull { it in kinds }
      ?: if (video || "earpiece" !in kinds) "speaker" else "earpiece"
  }

  @SuppressLint("NewApi")
  private fun current(context: Context, kinds: Map<String, AudioDeviceInfo?>): String {
    val am = audio(context)
    if (Build.VERSION.SDK_INT >= 31) am.communicationDevice?.let { d -> kind(d.type)?.let { return it } }
    return target(kinds)
  }

  private fun apply(context: Context) {
    appContext = context.applicationContext
    if (!active) return
    val am = audio(context)
    val kinds = available(context)
    val to = target(kinds)
    try {
      if (Build.VERSION.SDK_INT >= 31) {
        kinds[to]?.let { am.setCommunicationDevice(it) }
      } else {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = to == "speaker"
        @Suppress("DEPRECATION")
        if (to == "bluetooth") am.startBluetoothSco() else if (am.isBluetoothScoOn) am.stopBluetoothSco()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't switch the call's sound to $to: ${e.message}")
    }
    // The screen goes dark at your ear only when the sound is at your ear.
    near(context, to == "earpiece")
    onChange?.invoke(mapOf("routes" to kinds.keys.toList(), "route" to to))
  }

  private fun near(context: Context, on: Boolean) {
    if (on) {
      if (proximity == null) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
        proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "pakchat:call")
      }
      proximity?.let { if (!it.isHeld) it.acquire(4 * 60 * 60 * 1000L) }
    } else {
      proximity?.let { if (it.isHeld) it.release() }
    }
  }

  // ---- Beeps for the person calling ----

  /** "ringing" (repeats until stopped), "busy" (a few seconds) or "ended" (one short beep). */
  fun tone(kind: String) {
    stopTone()
    val g = runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70) }.getOrNull() ?: return
    tones = g
    ringing = kind == "ringing"
    when (kind) {
      "ringing" -> g.startTone(ToneGenerator.TONE_SUP_RINGTONE)
      "busy" -> g.startTone(ToneGenerator.TONE_SUP_BUSY, 3_000)
      else -> g.startTone(ToneGenerator.TONE_PROP_PROMPT, 300)
    }
  }

  fun stopTone() {
    tones?.let {
      runCatching { it.stopTone() }
      // Let a short beep finish before the generator is freed.
      main.postDelayed({ runCatching { it.release() } }, 3_100)
    }
    tones = null
    ringing = false
  }
}
