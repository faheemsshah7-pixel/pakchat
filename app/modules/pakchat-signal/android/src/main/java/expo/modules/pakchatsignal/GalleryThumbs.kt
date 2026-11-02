package expo.modules.pakchatsignal

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import java.io.File
import java.util.concurrent.Executors

/**
 * Small previews for PakChat's gallery (Gallery.tsx, and the row under the camera), like
 * WhatsApp's and Google Photos'.
 *
 * Making a tile's picture from the whole photo or video (what we did in build 18) is slow and
 * takes a lot of memory: on a phone full of videos the tiles stayed empty and Android froze the
 * app (owner's Pixel, 2 Nov). The phone already keeps a small preview of every photo and video
 * for its own gallery; this asks for that one instead, saves it once as a small JPEG in the
 * app's cache, and answers its address. The next time it's there at once.
 */
object GalleryThumbs {
  // Two at a time, apart from everything else, so a page of tiles never crowds out files or calls.
  private val pool = Executors.newFixedThreadPool(2)

  fun run(job: () -> Unit) = pool.execute(job)

  /**
   * The preview of the gallery item `id` (its MediaStore id), about `px` pixels across. Null if
   * the phone has none. `stamp` is when the item last changed, so an edited photo gets a new one.
   */
  fun get(context: Context, id: String, video: Boolean, px: Int, stamp: Long): String? {
    val n = id.toLongOrNull() ?: return null
    val size = px.coerceIn(64, 512)
    val dir = File(context.cacheDir, "gallery-thumbs").apply { mkdirs() }
    val out = File(dir, "${if (video) "v" else "i"}$n-$size-$stamp.jpg")
    if (out.length() > 0) return Uri.fromFile(out).toString()

    val resolver = context.contentResolver
    val bitmap: Bitmap = (
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val base = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        resolver.loadThumbnail(ContentUris.withAppendedId(base, n), Size(size, size), null)
      } else {
        @Suppress("DEPRECATION")
        if (video) MediaStore.Video.Thumbnails.getThumbnail(resolver, n, MediaStore.Video.Thumbnails.MINI_KIND, null)
        else MediaStore.Images.Thumbnails.getThumbnail(resolver, n, MediaStore.Images.Thumbnails.MINI_KIND, null)
      }
    ) ?: return null

    // Written next to it first, so a half-written file is never shown.
    val part = File(dir, "${out.name}.part")
    try {
      part.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 82, it) }
    } finally {
      bitmap.recycle()
    }
    if (!part.renameTo(out)) return null
    return Uri.fromFile(out).toString()
  }
}
