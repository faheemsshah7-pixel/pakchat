package expo.modules.pakchatsignal

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

/**
 * Hooks into PakChat's screen (its one Android "activity") as it opens. Expo
 * finds this class by itself (any *Package.kt in a module), so nothing has to
 * be added to the app's own Android code.
 */
class PakchatPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> = listOf(CallLockScreen)
}

/**
 * Shows the call screen on top of a locked phone, like a phone call. When a
 * call alert opens PakChat (pakchat://call/...), the screen turns on and the
 * call shows without unlocking. Only the call: when it ends, the app asks for
 * the lock again (show(false)), so nobody can read your chats without it.
 */
object CallLockScreen : ReactActivityLifecycleListener {
  private var activity: WeakReference<Activity>? = null

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    this.activity = WeakReference(activity)
    if (isCall(activity.intent)) show(true)
  }

  override fun onNewIntent(intent: Intent): Boolean {
    if (isCall(intent)) show(true)
    return false
  }

  override fun onDestroy(activity: Activity) {
    if (this.activity?.get() === activity) this.activity = null
  }

  private fun isCall(intent: Intent?) = intent?.data?.let { it.scheme == "pakchat" && it.host == "call" } == true

  /** Over the lock screen (and keep the screen on) during a call, or back to normal. */
  fun show(on: Boolean, keepOn: Boolean = on) {
    val a = activity?.get() ?: return
    a.runOnUiThread {
      if (Build.VERSION.SDK_INT >= 27) {
        a.setShowWhenLocked(on)
        a.setTurnScreenOn(on)
      } else {
        @Suppress("DEPRECATION")
        val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        if (on) a.window.addFlags(flags) else a.window.clearFlags(flags)
      }
      if (keepOn) a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }
}
