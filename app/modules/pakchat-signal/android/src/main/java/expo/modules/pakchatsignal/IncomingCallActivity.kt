package expo.modules.pakchatsignal

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * The incoming call screen on a locked phone, like WhatsApp's: the caller's
 * picture and name, with Decline and Answer. A ringing call's alert opens it
 * full screen (CallAlerts.ring). It's a small screen of its own, drawn without
 * React, because Android shows a screen over the lock screen only if it says
 * so before it opens (showWhenLocked in the manifest): PakChat's main screen
 * can't, or your chats would show over the lock screen too.
 *
 * Answer opens PakChat's call screen (over the lock screen, see CallLockScreen)
 * and picks up. Decline goes the same way as Decline on the alert. It closes by
 * itself when the call stops ringing (CallAlerts.stopRing).
 */
class IncomingCallActivity : Activity() {
  private var callId = ""
  private var chatId = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Android 7 and 8.0 take these as window flags (newer ones read the manifest).
    if (Build.VERSION.SDK_INT < 27) {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    show(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    show(intent)
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun show(intent: Intent) {
    val o = try {
      JSONObject(intent.getStringExtra("call") ?: "{}")
    } catch (e: Exception) {
      JSONObject()
    }
    callId = o.optString("callId")
    chatId = o.optString("chatId")
    if (callId.isEmpty()) {
      finish()
      return
    }
    current = WeakReference(this)
    val words = o.optJSONObject("words") ?: JSONObject()
    setContentView(layout(o, words))
    // Rings for 45 seconds at most, like the alert.
    Handler(Looper.getMainLooper()).postDelayed({ if (!isFinishing) finish() }, CallAlerts.RING_MS)
  }

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

  private fun layout(o: JSONObject, words: JSONObject): View {
    val root = FrameLayout(this)
    root.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor("#13233F"), Color.parseColor("#0B1424")))

    // The caller, near the top.
    val top = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
    }
    top.addView(text(o.optString("text"), 15f, Color.parseColor("#B8C6DE"), false))
    top.addView(text(o.optString("title"), 30f, Color.WHITE, true).apply { setPadding(dp(24f), dp(8f), dp(24f), dp(28f)) })
    val avatar = o.optJSONObject("avatar")
    if (avatar != null) {
      top.addView(ImageView(this).apply { setImageBitmap(ChatAlerts.avatar(avatar)) }, LinearLayout.LayoutParams(dp(120f), dp(120f)))
    }
    root.addView(top, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP).apply { topMargin = dp(96f) })

    // Decline and Answer, near the bottom.
    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    buttons.addView(button(words.optString("decline", "Decline"), "#E5484D", 135f) { decline() }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    buttons.addView(button(words.optString("answer", "Answer"), "#22A35A", 0f) { answer() }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    root.addView(buttons, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply { bottomMargin = dp(80f) })
    return root
  }

  private fun text(s: String, size: Float, color: Int, bold: Boolean) = TextView(this).apply {
    text = s
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    gravity = Gravity.CENTER
    maxLines = 2
    if (bold) typeface = Typeface.DEFAULT_BOLD
  }

  /** A round button with the handset in it (turned down for Decline), and its name under it. */
  private fun button(label: String, color: String, turn: Float, onTap: () -> Unit): View {
    val box = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
    }
    val circle = FrameLayout(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(color))
      }
      isClickable = true
      contentDescription = label
      setOnClickListener { onTap() }
    }
    circle.addView(ImageView(this).apply {
      setImageResource(R.drawable.pakchat_call)
      rotation = turn
    }, FrameLayout.LayoutParams(dp(34f), dp(34f), Gravity.CENTER))
    box.addView(circle, LinearLayout.LayoutParams(dp(72f), dp(72f)))
    box.addView(text(label, 14f, Color.WHITE, false).apply { setPadding(0, dp(10f), 0, 0) })
    return box
  }

  private fun answer() {
    CallAlerts.stopRing(this, callId)
    // PakChat's call screen may show over the lock screen from now on (before it opens).
    CallLockScreen.show(true)
    val uri = "pakchat://call/${Uri.encode(callId)}?chat=${Uri.encode(chatId)}&answer=1"
    startActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        .setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
    )
    finish()
  }

  private fun decline() {
    try {
      CallAlerts.declineIntent(this, callId, chatId).send()
    } catch (e: Exception) {
      // The alert's own Decline still works.
    }
    finish()
  }

  companion object {
    private var current: WeakReference<IncomingCallActivity>? = null

    /** Opens it for a ringing call (`json` is what CallAlerts.ring got). */
    fun intent(context: Context, json: String): Intent =
      Intent(context, IncomingCallActivity::class.java)
        .putExtra("call", json)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)

    /** The call stopped ringing (answered, declined, or they hung up): close it. */
    fun close(callId: String) {
      val a = current?.get() ?: return
      if (callId.isEmpty() || a.callId == callId) a.runOnUiThread { a.finish() }
    }
  }
}
