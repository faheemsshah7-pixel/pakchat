package expo.modules.pakchatsignal

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log

/**
 * Realme, Oppo, OnePlus, Xiaomi, Vivo, Huawei and Honor phones stop apps
 * starting in the background unless you allow it, so messages and calls don't
 * come while PakChat is closed (WhatsApp is allowed by the phone maker). This
 * opens the right settings page: the maker's "Autostart" list where there is
 * one, otherwise PakChat's own app settings (Battery → Allow background
 * activity on Realme). The chat list shows a card for it once (AlertsCard.tsx).
 */
object Autostart {
  private const val TAG = "PakChatAutostart"

  /** Phone makers known to block apps in the background. */
  private val BRANDS = setOf("xiaomi", "redmi", "poco", "oppo", "realme", "oneplus", "vivo", "iqoo", "huawei", "honor")

  /** Each maker's Autostart page (the names change between versions, so several are tried). */
  private val PAGES = listOf(
    "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
    "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
    "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
    "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
    "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
    "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
    "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    "com.hihonor.systemmanager" to "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
  )

  /** This phone's maker, if it's one that blocks apps in the background (else null). */
  fun brand(): String? {
    val names = listOf(Build.MANUFACTURER, Build.BRAND).map { it.lowercase() }
    return names.firstOrNull { it in BRANDS }
  }

  /** Opens the Autostart page, or PakChat's app settings. False if neither would open. */
  fun open(context: Context): Boolean {
    for ((pkg, cls) in PAGES) {
      val intent = Intent().setComponent(ComponentName(pkg, cls)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (start(context, intent)) return true
    }
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return start(context, details)
  }

  private fun start(context: Context, intent: Intent): Boolean {
    return try {
      if (intent.resolveActivity(context.packageManager) == null) return false
      context.startActivity(intent)
      true
    } catch (e: Exception) {
      // Some of these pages exist but aren't open to other apps.
      Log.w(TAG, "Couldn't open ${intent.component ?: intent.action}: ${e.message}")
      false
    }
  }
}
