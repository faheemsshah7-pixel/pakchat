package expo.modules.pakchatsignal

import android.app.Activity
import android.app.PictureInPictureParams
import android.os.Build
import android.util.Log
import android.util.Rational

/**
 * Picture-in-picture during a video call, like WhatsApp: leave PakChat (Home, or
 * another app) while the call screen shows a video call, and the video carries
 * on in a small window over everything. Tapping the window brings PakChat back.
 *
 * JavaScript says when it's wanted (callPip): only on the call screen, in a video
 * call that's on. Android 12 and newer go small by themselves ("auto enter").
 * Older ones (8 to 11) are told to by MainActivity when you leave (onUserLeaveHint,
 * added by plugins/withCallPip.js). Android 7 has no picture-in-picture.
 */
object CallPip {
  private const val TAG = "PakChatPip"
  private var wanted = false
  /** Tells JavaScript when the small window opens or closes (the "pip" event). */
  var onChange: ((Boolean) -> Unit)? = null

  private fun params(on: Boolean): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < 26) return null
    val b = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16))
    if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(on).setSeamlessResizeEnabled(false)
    return b.build()
  }

  /** Picture-in-picture is wanted now (or not). */
  fun allow(activity: Activity, on: Boolean) {
    wanted = on
    if (Build.VERSION.SDK_INT < 26) return
    activity.runOnUiThread {
      try {
        params(on)?.let { activity.setPictureInPictureParams(it) }
      } catch (e: Exception) {
        // Some phones turn picture-in-picture off for an app in its settings.
        Log.w(TAG, "No picture-in-picture: ${e.message}")
      }
    }
  }

  /** From MainActivity.onUserLeaveHint: you're leaving PakChat. */
  @JvmStatic
  fun userLeaving(activity: Activity) {
    if (!wanted || Build.VERSION.SDK_INT < 26 || Build.VERSION.SDK_INT >= 31) return
    try {
      params(true)?.let { activity.enterPictureInPictureMode(it) }
    } catch (e: Exception) {
      Log.w(TAG, "No picture-in-picture: ${e.message}")
    }
  }

  /** From MainActivity.onPictureInPictureModeChanged. */
  @JvmStatic
  fun changed(on: Boolean) {
    onChange?.invoke(on)
  }
}
