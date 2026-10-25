package expo.modules.pakchatsignal

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Scheduled messages: the phone's alarm clock wakes PakChat at the time you
 * picked, even if it's closed, and the "PakchatScheduled" task in the app's
 * JavaScript (app/src/core/scheduled.ts) sends what's due. The times are kept
 * here too, so they're set again after the phone restarts.
 *
 * An exact alarm when Android allows it, otherwise the nearest it allows
 * (usually within a few minutes). Opening PakChat sends anything late at once.
 */
object Scheduled {
  private const val PREFS = "pakchat-scheduled"

  fun set(context: Context, id: String, at: Long) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(id, at).apply()
    arm(context, id, at)
  }

  fun cancel(context: Context, id: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
    alarms(context).cancel(pending(context, id))
  }

  /** After a restart: every time still waiting goes back on the alarm clock. */
  fun rearm(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    for ((id, at) in prefs.all) if (at is Long) arm(context, id, at)
  }

  private fun alarms(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun pending(context: Context, id: String): PendingIntent {
    val intent = Intent(context, ScheduledReceiver::class.java).setAction("expo.modules.pakchatsignal.SCHEDULED").putExtra("id", id)
    return PendingIntent.getBroadcast(context, "scheduled:$id".hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun arm(context: Context, id: String, at: Long) {
    val am = alarms(context)
    val when_ = at.coerceAtLeast(System.currentTimeMillis() + 1_000)
    try {
      if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when_, pending(context, id))
      else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when_, pending(context, id))
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when_, pending(context, id))
    }
  }

  /** Android 12+ lets an alarm ring at the exact minute only with "Alarms & reminders" allowed. */
  fun canExact(context: Context) = Build.VERSION.SDK_INT < 31 || alarms(context).canScheduleExactAlarms()

  /** Opens "Alarms & reminders" for PakChat; allowing it sets every waiting alarm again, exactly. */
  fun openExactSettings(context: Context) {
    if (Build.VERSION.SDK_INT < 31) return
    val intent = Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      Log.w("PakChat", "Couldn't open Alarms & reminders: ${e.message}")
    }
  }

  fun forget(context: Context, id: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
  }
}

/** The alarm went off: send what's due (in JavaScript, without any screens). */
class ScheduledReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return
    Scheduled.forget(context, id)
    try {
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(Intent(context, ScheduledService::class.java).putExtra("id", id))
    } catch (e: Exception) {
      Log.w("PakChat", "Couldn't send a scheduled message now: ${e.message}")
    }
  }
}

/** Runs "PakchatScheduled" for up to 40 seconds (enough to connect and send). */
class ScheduledService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig("PakchatScheduled", Arguments.fromBundle(extras), 40_000, true)
  }
}

/** The phone restarted, PakChat was updated, or exact alarms were allowed: put the times back. */
class ScheduledBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> Scheduled.rearm(context)
    }
  }
}
