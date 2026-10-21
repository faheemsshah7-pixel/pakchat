package expo.modules.pakchatsignal

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Saves Signal's keys on the phone, in their own small database ("signal-keys.db").
 *
 * Two layers of protection:
 *  1. The file is in the app's private "no backup" folder, so other apps can't
 *     read it and it never goes into a cloud backup.
 *  2. Every value is locked (AES-GCM) with a key that lives in Android's
 *     Keystore. That key can't be copied out of the phone, so even a copy of
 *     the file is useless anywhere else.
 */
class AndroidKeyBackend(context: Context) : KeyBackend {
  private val helper = object : SQLiteOpenHelper(context, java.io.File(context.noBackupFilesDir, "signal-keys.db").path, null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL("CREATE TABLE kv (tbl TEXT NOT NULL, k TEXT NOT NULL, v BLOB NOT NULL, PRIMARY KEY (tbl, k))")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
  }

  private val db: SQLiteDatabase by lazy { helper.writableDatabase }
  private val secret: SecretKey by lazy { keystoreKey() }

  override fun get(table: String, key: String): ByteArray? =
    db.rawQuery("SELECT v FROM kv WHERE tbl = ? AND k = ?", arrayOf(table, key)).use { c ->
      if (c.moveToFirst()) unlock(c.getBlob(0)) else null
    }

  override fun put(table: String, key: String, value: ByteArray) {
    val row = ContentValues().apply {
      put("tbl", table)
      put("k", key)
      put("v", lock(value))
    }
    db.insertWithOnConflict("kv", null, row, SQLiteDatabase.CONFLICT_REPLACE)
  }

  override fun delete(table: String, key: String) {
    db.delete("kv", "tbl = ? AND k = ?", arrayOf(table, key))
  }

  override fun keys(table: String, prefix: String): List<String> =
    db.rawQuery("SELECT k FROM kv WHERE tbl = ? AND substr(k, 1, ?) = ?", arrayOf(table, prefix.length.toString(), prefix)).use { c ->
      buildList { while (c.moveToNext()) add(c.getString(0)) }
    }

  override fun <T> transaction(block: () -> T): T {
    db.beginTransaction()
    try {
      val result = block()
      db.setTransactionSuccessful()
      return result
    } finally {
      db.endTransaction()
    }
  }

  // ---- Locking each value with the Keystore key ----

  private fun lock(plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(AES_GCM)
    cipher.init(Cipher.ENCRYPT_MODE, secret)
    // Saved as: 12-byte nonce, then the locked bytes.
    return cipher.iv + cipher.doFinal(plain)
  }

  private fun unlock(stored: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(AES_GCM)
    cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, stored, 0, 12))
    return cipher.doFinal(stored, 12, stored.size - 12)
  }

  private fun keystoreKey(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val ALIAS = "pakchat-signal-keys"
    const val AES_GCM = "AES/GCM/NoPadding"
  }
}
