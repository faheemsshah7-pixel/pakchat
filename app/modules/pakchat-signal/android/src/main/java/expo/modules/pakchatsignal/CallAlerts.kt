package expo.modules.pakchatsignal

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject

/**
 * Call alerts, like a phone call:
 *
 *  - Ringing: a full-screen call alert with Answer and Decline that wakes a
 *    locked phone. Its sound is the phone's ringtone, repeated until you
 *    answer, decline, or 45 seconds pass. Android plays it, so it rings even
 *    when PakChat is closed (a push woke the app just long enough to post it).
 *  - Ongoing: "Ongoing voice call · 02:15" with Hang up, while you talk (CallService).
 *  - Missed: "Missed voice call" afterwards.
 *
 * The app sends what to show as JSON (app/src/core/calls.ts). Tapping Answer
 * opens pakchat://call/<id>?chat=<chat>&answer=1 (app/src/app/+native-intent.tsx).
 */
object CallAlerts {
  private const val RING_CHANNEL = "calls_ringing"
  private const val MISSED_CHANNEL = "calls_missed"
  const val ONGOING_CHANNEL = "calls_ongoing"
  private const val ID = 7302
  const val ONGOING_ID = 7303
  private const val TAG = "PakChat"
  /** How long a call rings before it counts as missed (the app hangs up at the same time). */
  const val RING_MS = 45_000L

  private fun manager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  /** Makes the three call channels (once; later calls only refresh their names). */
  private fun channels(context: Context, words: JSONObject) {
    if (Build.VERSION.SDK_INT < 26) return
    val m = manager(context)
    val ring = NotificationChannel(RING_CHANNEL, words.optString("ringChannel", "Calls"), NotificationManager.IMPORTANCE_HIGH).apply {
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
      )
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 1000, 1000)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setBypassDnd(false)
    }
    val missed = NotificationChannel(MISSED_CHANNEL, words.optString("missedChannel", "Missed calls"), NotificationManager.IMPORTANCE_DEFAULT)
    val ongoing = NotificationChannel(ONGOING_CHANNEL, words.optString("ongoingChannel", "Ongoing calls"), NotificationManager.IMPORTANCE_LOW).apply {
      setSound(null, null)
      enableVibration(false)
    }
    m.createNotificationChannels(listOf(ring, missed, ongoing))
  }

  private fun tag(callId: String) = "call:$callId"

  /** Rings: shows the incoming call. */
  fun ring(context: Context, json: String) {
    val o = JSONObject(json)
    val callId = o.getString("callId")
    val chatId = o.getString("chatId")
    val words = o.optJSONObject("words") ?: JSONObject()
    channels(context, words)
    val picture = ChatAlerts.avatar(o.getJSONObject("avatar"))
    val caller = Person.Builder()
      .setName(o.getString("title"))
      .setKey(chatId)
      .setIcon(IconCompat.createWithBitmap(picture))
      .setImportant(true)
      .build()
    val screen = open(context, callId, chatId, answer = false)
    val style = NotificationCompat.CallStyle.forIncomingCall(
      caller,
      action(context, callId, chatId, "decline"),
      open(context, callId, chatId, answer = true),
    )
    if (o.optBoolean("video")) style.setIsVideo(true)
    val builder = NotificationCompat.Builder(context, RING_CHANNEL)
      .setSmallIcon(R.drawable.pakchat_call)
      .setColor(Color.parseColor("#2F6BF0"))
      .setStyle(style)
      .setContentTitle(o.getString("title"))
      .setContentText(o.optString("text"))
      .setLargeIcon(picture)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(screen)
      // Wakes a locked phone and shows the incoming call screen (IncomingCallActivity).
      .setFullScreenIntent(lockScreen(context, callId, json), true)
      .setTimeoutAfter(RING_MS)
      // Phones before Android 8 take the sound from here, not the channel.
      .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), AudioManager.STREAM_RING)
      .setVibrate(longArrayOf(0, 1000, 1000))
    val n = builder.build()
    // Repeat the ringtone until the alert goes away.
    n.flags = n.flags or Notification.FLAG_INSISTENT
    post(context, tag(callId), ID, n)
  }

  /** Stops ringing (answered, declined, or the caller hung up). */
  fun stopRing(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(tag(callId), ID)
    IncomingCallActivity.close(callId)
  }

  /** "Missed voice call" from someone; one alert per chat, with how many. */
  fun missed(context: Context, json: String) {
    val o = JSONObject(json)
    val chatId = o.getString("chatId")
    val words = o.optJSONObject("words") ?: JSONObject()
    channels(context, words)
    val picture = ChatAlerts.avatar(o.getJSONObject("avatar"))
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("pakchat://chat/$chatId"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = PendingIntent.getActivity(context, "missed:$chatId".hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val n = NotificationCompat.Builder(context, MISSED_CHANNEL)
      .setSmallIcon(R.drawable.pakchat_call)
      .setColor(Color.parseColor("#2F6BF0"))
      .setContentTitle(o.getString("title"))
      .setContentText(o.optString("text"))
      .setLargeIcon(picture)
      .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setWhen(o.optLong("at", System.currentTimeMillis()))
      .setShowWhen(true)
      .setNumber(o.optInt("count", 1))
      .setContentIntent(tap)
      .build()
    post(context, "missed:$chatId", ID, n)
  }

  fun dismissMissed(context: Context, chatId: String) {
    NotificationManagerCompat.from(context).cancel("missed:$chatId", ID)
  }

  /** "Ongoing voice call" with a running timer and Hang up. Shown by CallService. */
  fun ongoing(context: Context, o: JSONObject): Notification {
    val callId = o.getString("callId")
    val chatId = o.getString("chatId")
    val words = o.optJSONObject("words") ?: JSONObject()
    channels(context, words)
    val picture = ChatAlerts.avatar(o.getJSONObject("avatar"))
    val person = Person.Builder().setName(o.getString("title")).setKey(chatId).setIcon(IconCompat.createWithBitmap(picture)).build()
    val style = NotificationCompat.CallStyle.forOngoingCall(person, action(context, callId, chatId, "hangup"))
    if (o.optBoolean("video")) style.setIsVideo(true)
    val since = o.optLong("since", 0L)
    val builder = NotificationCompat.Builder(context, ONGOING_CHANNEL)
      .setSmallIcon(R.drawable.pakchat_call)
      .setColor(Color.parseColor("#2F6BF0"))
      .setStyle(style)
      .setContentTitle(o.getString("title"))
      .setContentText(o.optString("text"))
      .setLargeIcon(picture)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open(context, callId, chatId, answer = false))
    // The timer starts when someone answers; until then it says "Calling…" or "Ringing…".
    if (since > 0) builder.setWhen(since).setUsesChronometer(true).setShowWhen(true) else builder.setShowWhen(false)
    return builder.build()
  }

  // ---- "Show calls on a locked screen" (Android 14+ lets people turn this off) ----

  fun fullScreenAllowed(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= 34) manager(context).canUseFullScreenIntent() else true

  /** Opens the system page where full-screen calls can be allowed for PakChat. */
  fun openFullScreenSettings(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
    } else {
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    }
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  // ---- Helpers ----

  /** Opens the call screen; `answer` picks up at the same time. */
  private fun open(context: Context, callId: String, chatId: String, answer: Boolean): PendingIntent {
    val uri = "pakchat://call/${Uri.encode(callId)}?chat=${Uri.encode(chatId)}" + if (answer) "&answer=1" else ""
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, "call:$answer:$callId".hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** The incoming call screen over the lock screen. */
  private fun lockScreen(context: Context, callId: String, json: String): PendingIntent =
    PendingIntent.getActivity(context, "lock:$callId".hashCode(), IncomingCallActivity.intent(context, json), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  /** Decline, as the incoming call screen's button. */
  fun declineIntent(context: Context, callId: String, chatId: String) = action(context, callId, chatId, "decline")

  /** Decline or Hang up, handed to the app's JavaScript (CallActionReceiver). */
  private fun action(context: Context, callId: String, chatId: String, what: String): PendingIntent {
    val intent = Intent(context, CallActionReceiver::class.java)
      .setAction("expo.modules.pakchatsignal.CALL_$what")
      .putExtra("action", what)
      .putExtra("callId", callId)
      .putExtra("chatId", chatId)
    return PendingIntent.getBroadcast(context, "$what:$callId".hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun post(context: Context, tag: String, id: Int, n: Notification) {
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      Log.w(TAG, "Alerts are off: the call can't ring")
      return
    }
    try {
      NotificationManagerCompat.from(context).notify(tag, id, n)
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't show the call: ${e.message}")
    }
  }
}
