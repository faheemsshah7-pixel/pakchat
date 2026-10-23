package expo.modules.pakchatsignal

import android.Manifest
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import org.json.JSONObject

/**
 * Keeps a call going when you leave PakChat (go home, open another app, lock
 * the phone). Android only lets an app use the mic and camera in the
 * background while it shows an "ongoing" alert, so this shows the call's alert
 * (CallAlerts.ongoing) for as long as the call lasts.
 */
class CallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val json = intent?.getStringExtra("json")
    if (json == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    val o = JSONObject(json)
    val n = CallAlerts.ongoing(this, o)
    // The mic always; the camera too in a video call, if you allowed it.
    var type = 0
    if (Build.VERSION.SDK_INT >= 30) {
      if (granted(Manifest.permission.RECORD_AUDIO)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (o.optBoolean("video") && granted(Manifest.permission.CAMERA)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    try {
      ServiceCompat.startForeground(this, CallAlerts.ONGOING_ID, n, type)
    } catch (e: Exception) {
      // Without the mic permission there is nothing to keep going.
      Log.w("PakChat", "Couldn't keep the call going in the background: ${e.message}")
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  companion object {
    /** Starts the service, or updates its alert ("Ringing…" becomes a timer). */
    fun show(context: Context, json: String) {
      // No mic permission, no call: and a started service that can't show its
      // alert in time would crash the app, so it isn't started at all.
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
      val intent = Intent(context, CallService::class.java).putExtra("json", json)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        Log.w("PakChat", "Couldn't show the ongoing call: ${e.message}")
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, CallService::class.java))
    }
  }
}

/**
 * Decline (on a ringing call) or Hang up (on an ongoing one), pressed on the
 * alert. Ringing stops at once; then the "PakchatCallAction" task in the
 * app's JavaScript (app/src/core/background.ts) tells the other phones.
 */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.getStringExtra("action") ?: return
    val callId = intent.getStringExtra("callId") ?: return
    val chatId = intent.getStringExtra("chatId") ?: return
    CallAlerts.stopRing(context, callId)
    val work = Intent(context, CallActionService::class.java)
      .putExtra("action", action)
      .putExtra("callId", callId)
      .putExtra("chatId", chatId)
    try {
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(work)
    } catch (e: Exception) {
      Log.w("PakChat", "Couldn't start the call action: ${e.message}")
    }
  }
}

/** Runs the "PakchatCallAction" task in PakChat's JavaScript, for up to 20 seconds. */
class CallActionService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig("PakchatCallAction", Arguments.fromBundle(extras), 20_000, true)
  }
}
