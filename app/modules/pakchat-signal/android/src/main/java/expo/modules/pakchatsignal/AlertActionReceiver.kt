package expo.modules.pakchatsignal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Reply, Mark as read or Mute, pressed on a message alert. The real work
 * (unlocking keys, sending, ticks) is the app's, so this wakes PakChat's
 * JavaScript without any screens (AlertActionService) and hands it over to
 * the "PakchatAlertAction" task (app/src/core/background.ts).
 */
class AlertActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val chatId = intent.getStringExtra("chatId") ?: return
    val action = intent.getStringExtra("action") ?: return
    val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(ChatAlerts.REPLY_KEY)?.toString()?.trim()
    if (action == "reply") {
      if (text.isNullOrEmpty()) return
      // Show it under their message straight away, like WhatsApp.
      ChatAlerts.addMine(context, chatId, text)
    }
    val work = Intent(context, AlertActionService::class.java)
      .putExtra("action", action)
      .putExtra("chatId", chatId)
      .putExtra("text", text ?: "")
    try {
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(work)
    } catch (e: Exception) {
      Log.w("PakChat", "Couldn't start the alert action: ${e.message}")
    }
  }
}

/** Runs the "PakchatAlertAction" task in PakChat's JavaScript, for up to 30 seconds. */
class AlertActionService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig("PakchatAlertAction", Arguments.fromBundle(extras), 30_000, true)
  }
}
