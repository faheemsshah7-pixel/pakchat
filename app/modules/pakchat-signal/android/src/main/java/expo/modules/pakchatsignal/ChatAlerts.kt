package expo.modules.pakchatsignal

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject

/**
 * Message alerts the way WhatsApp shows them: one per chat, with the person's
 * picture and each new message on its own line ("Sara: See you at 5" in a
 * group), Reply, Mark as read and Mute buttons, and all chats bundled under
 * "PakChat · 5 messages from 2 chats". The app sends what to show as JSON
 * (push.ts); the words were unlocked on this phone and never left it.
 */
object ChatAlerts {
  const val CHANNEL = "messages"
  private const val GROUP = "pakchat.messages"
  private const val ID = 7301
  private const val SUMMARY_TAG = "pakchat:summary"
  private const val COUNT = "pakchat.count"
  const val REPLY_KEY = "pakchat.reply"
  private const val TAG = "PakChat"

  private fun tag(chatId: String) = "chat:$chatId"

  /** Shows (or updates) one chat's alert, then the bundle above it. */
  fun show(context: Context, json: String) {
    val o = JSONObject(json)
    val chatId = o.getString("chatId")
    val title = o.getString("title")
    val group = o.optBoolean("group")
    val words = o.getJSONObject("words")
    val me = Person.Builder().setName(o.optString("me", "You")).setKey("me").build()
    val picture = avatar(o.getJSONObject("avatar"))
    val avatar = IconCompat.createWithBitmap(picture)
    val them = Person.Builder().setName(title).setKey(chatId).setIcon(avatar).build()

    val style = NotificationCompat.MessagingStyle(me)
    if (group) {
      style.conversationTitle = title
      style.isGroupConversation = true
    }
    val lines = o.getJSONArray("lines")
    var last = System.currentTimeMillis()
    for (i in 0 until lines.length()) {
      val l = lines.getJSONObject(i)
      last = l.optLong("at", last)
      val who = if (l.optBoolean("mine")) null else if (group) Person.Builder().setName(l.optString("name")).setKey("${chatId}:${l.optString("name")}").build() else them
      style.addMessage(l.getString("text"), last, who)
    }
    val count = o.optInt("count", lines.length())

    val builder = base(context)
      .setStyle(style)
      .setContentTitle(title)
      .setContentText(lines.getJSONObject(lines.length() - 1).getString("text"))
      .setWhen(last)
      .setShowWhen(true)
      .setNumber(count)
      .setContentIntent(open(context, chatId))
      .addPerson(them)
      .addAction(replyAction(context, chatId, words))
      .addAction(action(context, chatId, "read", words.optString("markRead", "Mark as read"), NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ))
      .addAction(action(context, chatId, "mute", words.optString("mute", "Mute"), NotificationCompat.Action.SEMANTIC_ACTION_MUTE))
    if (o.optBoolean("quiet")) builder.setSilent(true)
    builder.extras.putInt(COUNT, count)
    builder.extras.putString("pakchat.summaryLine", "$title: ${lines.getJSONObject(lines.length() - 1).getString("text")}")
    builder.setLargeIcon(picture)

    post(context, tag(chatId), builder.build())
    summary(context, words.optString("summary", "{n} messages from {c} chats"))
  }

  /** You replied from the alert: your message shows under theirs at once (it also stops the spinner). */
  fun addMine(context: Context, chatId: String, text: String) {
    val active = manager(context).activeNotifications.firstOrNull { it.tag == tag(chatId) } ?: return
    val n = active.notification
    val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n) ?: return
    style.addMessage(text, System.currentTimeMillis(), null as Person?)
    val builder = NotificationCompat.Builder(context, n)
      .setStyle(style)
      .setSilent(true)
      .setOnlyAlertOnce(true)
    post(context, tag(chatId), builder.build())
  }

  fun dismiss(context: Context, chatId: String) {
    NotificationManagerCompat.from(context).cancel(tag(chatId), ID)
    summary(context, null)
  }

  fun isShowing(context: Context, chatId: String) = manager(context).activeNotifications.any { it.tag == tag(chatId) }

  // ---- Helpers ----

  private fun manager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun base(context: Context) = NotificationCompat.Builder(context, CHANNEL)
    .setSmallIcon(R.drawable.pakchat_alert)
    .setColor(Color.parseColor("#2F6BF0"))
    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
    .setPriority(NotificationCompat.PRIORITY_HIGH)
    .setAutoCancel(true)
    .setGroup(GROUP)

  private fun post(context: Context, tag: String, n: android.app.Notification) {
    try {
      NotificationManagerCompat.from(context).notify(tag, ID, n)
    } catch (e: SecurityException) {
      // Alerts are switched off for PakChat.
      Log.w(TAG, "Alerts are off: ${e.message}")
    }
  }

  /**
   * "PakChat · 5 messages from 2 chats" above the chats. `template` is null when
   * a chat went away: the bundle is redrawn quietly, or removed with the last chat.
   */
  private var lastTemplate = "{n} messages from {c} chats"

  private fun summary(context: Context, template: String?) {
    if (template != null) lastTemplate = template
    val chats = manager(context).activeNotifications.filter { it.tag?.startsWith("chat:") == true }
    if (chats.isEmpty()) {
      NotificationManagerCompat.from(context).cancel(SUMMARY_TAG, ID)
      return
    }
    val n = chats.sumOf { it.notification.extras.getInt(COUNT, 1) }
    val text = lastTemplate.replace("{n}", n.toString()).replace("{c}", chats.size.toString())
    val inbox = NotificationCompat.InboxStyle().setSummaryText(text)
    for (c in chats) c.notification.extras.getString("pakchat.summaryLine")?.let { inbox.addLine(it) }
    val s = base(context)
      .setContentTitle("PakChat")
      .setContentText(text)
      .setSubText(text)
      .setStyle(inbox)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(open(context, null))
      .build()
    post(context, SUMMARY_TAG, s)
  }

  /** Tapping opens the chat (pakchat://chat/<id>, see app/src/app/+native-intent.tsx). */
  private fun open(context: Context, chatId: String?): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(if (chatId != null) "pakchat://chat/$chatId" else "pakchat://"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, ("open:" + (chatId ?: "")).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun actionIntent(context: Context, chatId: String, what: String) =
    Intent(context, AlertActionReceiver::class.java)
      .setAction("expo.modules.pakchatsignal.ALERT_$what")
      .putExtra("action", what)
      .putExtra("chatId", chatId)

  private fun action(context: Context, chatId: String, what: String, label: String, semantic: Int): NotificationCompat.Action {
    val pi = PendingIntent.getBroadcast(context, "$what:$chatId".hashCode(), actionIntent(context, chatId, what), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Action.Builder(null as IconCompat?, label, pi)
      .setSemanticAction(semantic)
      .setShowsUserInterface(false)
      .build()
  }

  private fun replyAction(context: Context, chatId: String, words: JSONObject): NotificationCompat.Action {
    // A reply box needs a changeable intent (Android puts the words in it).
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    val pi = PendingIntent.getBroadcast(context, "reply:$chatId".hashCode(), actionIntent(context, chatId, "reply"), flags)
    val input = RemoteInput.Builder(REPLY_KEY).setLabel(words.optString("replyHint", "Message")).build()
    return NotificationCompat.Action.Builder(null as IconCompat?, words.optString("reply", "Reply"), pi)
      .addRemoteInput(input)
      .setAllowGeneratedReplies(true)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()
  }

  /** The same picture the app shows: initials on a soft gradient (photos come later). */
  internal fun avatar(a: JSONObject): Bitmap {
    val size = 192
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(0f, 0f, size.toFloat(), size.toFloat(), color(a.optString("a"), "#DCE9FF"), color(a.optString("b"), "#C5D9FD"), Shader.TileMode.CLAMP)
    }
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, bg)
    val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = color(a.optString("ink"), "#1E3A8A")
      textSize = size * 0.38f
      textAlign = Paint.Align.CENTER
      isFakeBoldText = true
    }
    val y = size / 2f - (ink.descent() + ink.ascent()) / 2f
    canvas.drawText(a.optString("letters", "?"), size / 2f, y, ink)
    return bmp
  }

  private fun color(hex: String, fallback: String) = try {
    Color.parseColor(hex)
  } catch (e: Exception) {
    Color.parseColor(fallback)
  }
}
