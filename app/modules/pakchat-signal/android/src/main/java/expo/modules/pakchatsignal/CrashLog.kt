package expo.modules.pakchatsignal

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.util.Date

/**
 * What made PakChat close by mistake last time, so it can be fixed.
 *
 * Two sources. A crash in Java or Kotlin (or a JavaScript error, which React
 * Native turns into one) is written to a file the moment it happens, with its
 * whole story (the stack trace). A crash deep in C++ (calls, video) can't be
 * caught like that, so Android's own record of how PakChat last ended is read
 * too (Android 11 and newer), with the names of the libraries it was in.
 *
 * The app asks once as it starts (lastCrash) and offers to copy the details.
 */
object CrashLog {
  private const val FILE = "last-crash.txt"
  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    val before = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, e ->
      try {
        val trace = StringWriter().also { e.printStackTrace(PrintWriter(it)) }.toString()
        File(app.filesDir, FILE).writeText("${Date()}, on thread ${thread.name}\n\n$trace".take(40_000))
      } catch (_: Throwable) {
        // Never let writing it down get in the way of the crash itself.
      }
      before?.uncaughtException(thread, e)
    }
  }

  /** The details of what went wrong since last asked, or null if nothing did. Each is told once. */
  fun take(context: Context): String? {
    val parts = mutableListOf<String>()
    val f = File(context.filesDir, FILE)
    if (f.exists()) {
      try {
        parts += f.readText()
      } catch (_: Exception) {
      }
      f.delete()
    }
    exits(context)?.let { parts += it }
    if (parts.isEmpty()) return null
    return "PakChat ${version(context)}, ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}\n\n" + parts.joinToString("\n\n")
  }

  private fun version(context: Context) = try {
    context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
  } catch (_: Exception) {
    ""
  }

  /** Android's record of PakChat crashing (or freezing) since last asked: newest first. */
  private fun exits(context: Context): String? {
    if (Build.VERSION.SDK_INT < 30) return null
    val am = context.getSystemService(ActivityManager::class.java) ?: return null
    val prefs = context.getSharedPreferences("pakchat-crashes", Context.MODE_PRIVATE)
    val seen = prefs.getLong("seen", 0)
    val list = try {
      am.getHistoricalProcessExitReasons(context.packageName, 0, 10)
    } catch (_: Throwable) {
      return null
    }
    val newest = list.maxOfOrNull { it.timestamp } ?: return null
    prefs.edit().putLong("seen", maxOf(seen, newest)).apply()
    // The first time, only the last day (older ones are long gone from anyone's memory).
    val since = if (seen == 0L) System.currentTimeMillis() - 86_400_000 else seen
    val out = list.filter { it.timestamp > since }.mapNotNull { describe(it) }
    return if (out.isEmpty()) null else out.joinToString("\n\n")
  }

  private fun describe(e: ApplicationExitInfo): String? {
    if (Build.VERSION.SDK_INT < 30) return null
    val kind = when (e.reason) {
      ApplicationExitInfo.REASON_CRASH -> "Crash"
      ApplicationExitInfo.REASON_CRASH_NATIVE -> "Native crash"
      ApplicationExitInfo.REASON_ANR -> "Not responding"
      else -> return null
    }
    val head = "$kind at ${Date(e.timestamp)} (signal or status ${e.status})${e.description?.let { ": $it" } ?: ""}"
    // A native crash's report (Android 12+) is in a packed format; the readable bits
    // in it (the libraries and functions it went through, the reason) are enough.
    val words = if (Build.VERSION.SDK_INT >= 31 && e.reason != ApplicationExitInfo.REASON_CRASH) readable(e) else ""
    return if (words.isEmpty()) head else "$head\n$words"
  }

  private fun readable(e: ApplicationExitInfo): String = try {
    // At most 400 KB (read by hand: readNBytes is only on Android 13 and newer).
    val bytes = e.traceInputStream?.use { input ->
      val out = java.io.ByteArrayOutputStream()
      val buf = ByteArray(16_384)
      while (out.size() < 400_000) {
        val n = input.read(buf)
        if (n < 0) break
        out.write(buf, 0, n)
      }
      out.toByteArray()
    } ?: ByteArray(0)
    val found = mutableListOf<String>()
    val run = StringBuilder()
    for (b in bytes) {
      val c = b.toInt() and 0xFF
      if (c in 32..126) run.append(c.toChar())
      else {
        if (run.length >= 6) found += run.toString()
        run.setLength(0)
      }
    }
    found.filter { w -> listOf(".so", "Abort", "abort", "signal", "SIG", "Exception", "Error", "Java_", "art::", "webrtc", "_Z").any { it in w } }
      .distinct()
      .take(80)
      .joinToString("\n")
  } catch (_: Throwable) {
    ""
  }
}
