package expo.modules.pakchatsignal

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject
import java.io.File

/**
 * A chat on the phone's home screen (the chat's ⋮ › Add shortcut), like
 * WhatsApp's. The phone asks "Add to home screen?" itself. The icon is the
 * chat's photo, or the same initials the app shows, and a tap opens
 * pakchat://chat/<id>, the link a message alert opens (+native-intent.tsx).
 */
object Shortcuts {
  /** The icon's size: the whole picture is 108 dp, and the home screen shows the middle 72 dp in its own shape. */
  private const val SIZE = 288

  fun supported(context: Context) = ShortcutManagerCompat.isRequestPinShortcutSupported(context)

  /**
   * Asks the home screen to add the chat. `json`: {chatId, name, photo (a file:// path, or ""),
   * avatar: {a, b, ink, letters}}. False if this phone's home screen can't take shortcuts.
   */
  fun add(context: Context, json: String): Boolean {
    if (!supported(context)) return false
    val o = JSONObject(json)
    val chatId = o.getString("chatId")
    val name = o.optString("name").ifEmpty { "PakChat" }
    val id = "chat:$chatId"
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("pakchat://chat/$chatId")).setPackage(context.packageName)
    val info = ShortcutInfoCompat.Builder(context, id)
      .setShortLabel(name)
      .setLongLabel(name)
      .setIcon(IconCompat.createWithAdaptiveBitmap(photo(o.optString("photo")) ?: letters(o.optJSONObject("avatar") ?: JSONObject())))
      .setIntent(intent)
      .build()
    return ShortcutManagerCompat.requestPinShortcut(context, info, null)
  }

  /** The chat's photo, cut square to fill the icon. Null if there isn't one, or it can't be read. */
  private fun photo(uri: String): Bitmap? {
    if (uri.isEmpty()) return null
    return try {
      val file = File(Uri.parse(uri).path ?: uri.removePrefix("file://"))
      if (!file.exists()) return null
      // Read it no bigger than needed, so a big photo doesn't use up an older phone's memory.
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      var sample = 1
      while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIZE) sample *= 2
      val full = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
      val side = minOf(full.width, full.height)
      val out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
      val from = Rect((full.width - side) / 2, (full.height - side) / 2, (full.width + side) / 2, (full.height + side) / 2)
      Canvas(out).drawBitmap(full, from, Rect(0, 0, SIZE, SIZE), Paint(Paint.FILTER_BITMAP_FLAG))
      full.recycle()
      out
    } catch (e: Exception) {
      null
    }
  }

  /** Initials on the app's soft gradient, filling the icon (the letters sized for the middle part). */
  private fun letters(a: JSONObject): Bitmap {
    val out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(0f, 0f, SIZE.toFloat(), SIZE.toFloat(), color(a.optString("a"), "#DCE9FF"), color(a.optString("b"), "#C5D9FD"), Shader.TileMode.CLAMP)
    }
    canvas.drawRect(0f, 0f, SIZE.toFloat(), SIZE.toFloat(), bg)
    val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = color(a.optString("ink"), "#1E3A8A")
      textSize = SIZE * 0.25f
      textAlign = Paint.Align.CENTER
      isFakeBoldText = true
    }
    val y = SIZE / 2f - (ink.descent() + ink.ascent()) / 2f
    canvas.drawText(a.optString("letters", "?"), SIZE / 2f, y, ink)
    return out
  }

  private fun color(hex: String, fallback: String) = try {
    Color.parseColor(hex)
  } catch (e: Exception) {
    Color.parseColor(fallback)
  }
}
