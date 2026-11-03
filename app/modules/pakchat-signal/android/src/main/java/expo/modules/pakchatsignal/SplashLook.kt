package expo.modules.pakchatsignal

import android.app.UiModeManager
import android.content.Context
import android.os.Build

/**
 * PakChat's light or dark follows the phone (owner, 3 Nov), and so does the opening screen.
 *
 * Build 23 told Android the whole app was light or dark when a look was picked in PakChat; on a
 * phone in dark mode with Sky picked, Android then darkened the app by itself and turned Sky's
 * colours inside out. undoOld takes that back, once, on the phones that got it.
 */
object SplashLook {
  private const val PREFS = "pakchat_look"
  private const val OLD = "mode"

  /** As the app starts (MainApplication). */
  fun undoOld(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.contains(OLD)) return
    val old = prefs.getString(OLD, "auto")
    prefs.edit().remove(OLD).apply()
    if (old == "auto" || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    try {
      context.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO)
    } catch (e: Throwable) {}
  }
}
