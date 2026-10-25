package expo.modules.pakchatsignal

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Live location: while you share where you are, this "Sharing live location"
 * alert keeps PakChat allowed to follow the phone's location after you leave
 * the app (Android only allows that with an alert showing). The moves are
 * read and sent by the app's JavaScript (app/src/core/live.ts). "Stop" on the
 * alert tells it to stop (the "liveStop" event).
 */
class LiveLocationService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra("title") ?: "Sharing live location"
    val text = intent?.getStringExtra("text") ?: ""
    val stop = intent?.getStringExtra("stop") ?: "Stop"
    channel(this)
    val stopIntent = PendingIntent.getBroadcast(
      this,
      "live:stop".hashCode(),
      Intent(this, LiveStopReceiver::class.java).setAction("expo.modules.pakchatsignal.LIVE_STOP"),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val open = PendingIntent.getActivity(
      this,
      "live:open".hashCode(),
      Intent(Intent.ACTION_VIEW, Uri.parse("pakchat://")).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val n = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.pakchat_alert)
      .setColor(Color.parseColor("#2F6BF0"))
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(open)
      .addAction(0, stop, stopIntent)
      .build()
    val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
    try {
      ServiceCompat.startForeground(this, ID, n, type)
    } catch (e: Exception) {
      Log.w("PakChat", "Couldn't keep live location going: ${e.message}")
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val CHANNEL = "live-location"
    private const val ID = 7401
    /** Set by the module, so "Stop" on the alert reaches JavaScript. */
    var onStop: (() -> Unit)? = null

    private fun channel(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL) != null) return
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Live location", NotificationManager.IMPORTANCE_LOW))
    }

    fun start(context: Context, title: String, text: String, stop: String) {
      val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
      val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
      if (!fine && !coarse) return
      val intent = Intent(context, LiveLocationService::class.java).putExtra("title", title).putExtra("text", text).putExtra("stop", stop)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        Log.w("PakChat", "Couldn't show live location: ${e.message}")
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LiveLocationService::class.java))
    }
  }
}

class LiveStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    LiveLocationService.stop(context)
    LiveLocationService.onStop?.invoke()
  }
}
