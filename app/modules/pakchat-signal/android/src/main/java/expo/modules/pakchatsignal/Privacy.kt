package expo.modules.pakchatsignal

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.view.WindowManager
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Small native helpers for phase 7's privacy features:
 *   secure      no screenshots or screen recording (a view once photo or video is open)
 *   ScreenWatch when the phone's screen last went off, for "App lock: when the phone locks"
 *   Zipper      "Export chat" with its photos and files, as one .zip
 */
object Secure {
  fun set(activity: Activity?, on: Boolean) {
    val a = activity ?: return
    a.runOnUiThread {
      if (on) a.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else a.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}

object ScreenWatch {
  /** When the screen last went off (ms), or 0 since PakChat started. */
  @Volatile var offAt = 0L
  private var receiver: BroadcastReceiver? = null

  /** The screen going off can't be heard from the manifest, only while PakChat runs. */
  fun start(context: Context) {
    if (receiver != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_SCREEN_OFF) offAt = System.currentTimeMillis()
      }
    }
    context.applicationContext.registerReceiver(r, IntentFilter(Intent.ACTION_SCREEN_OFF))
    receiver = r
  }
}

object Zipper {
  /** Writes `text` as `textName`, then each file (path → name in the zip), into `out`. Answers its size. */
  fun zip(out: File, textName: String, text: String, files: List<Pair<File, String>>): Long {
    out.parentFile?.mkdirs()
    ZipOutputStream(out.outputStream().buffered()).use { zip ->
      zip.putNextEntry(ZipEntry(textName))
      zip.write(text.toByteArray(Charsets.UTF_8))
      zip.closeEntry()
      val used = HashSet<String>()
      for ((file, name) in files) {
        if (!file.exists() || !used.add(name)) continue
        zip.putNextEntry(ZipEntry(name))
        file.inputStream().use { it.copyTo(zip) }
        zip.closeEntry()
      }
    }
    return out.length()
  }
}
