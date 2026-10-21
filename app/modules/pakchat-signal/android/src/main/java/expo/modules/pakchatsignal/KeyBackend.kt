package expo.modules.pakchatsignal

import java.util.concurrent.ConcurrentHashMap

/**
 * Where Signal's keys are saved: a simple table of (table, key) -> bytes.
 *
 * On the phone it's a small SQLite file with every value locked by a key in
 * Android's Keystore (AndroidKeyBackend). In the computer tests it's a map in
 * memory (MemoryKeyBackend), so a "restart" is just making a new SignalDevice
 * on the same backend.
 */
interface KeyBackend {
  fun get(table: String, key: String): ByteArray?
  fun put(table: String, key: String, value: ByteArray)
  fun delete(table: String, key: String)
  /** Every key in a table that starts with `prefix`. */
  fun keys(table: String, prefix: String): List<String>
  /** Runs `block` so that all of its changes are saved, or none. */
  fun <T> transaction(block: () -> T): T
}

/** Keeps everything in memory. For the tests. */
class MemoryKeyBackend : KeyBackend {
  private val data = ConcurrentHashMap<String, ByteArray>()

  private fun id(table: String, key: String) = "$table\u0000$key"

  override fun get(table: String, key: String) = data[id(table, key)]?.copyOf()

  override fun put(table: String, key: String, value: ByteArray) {
    data[id(table, key)] = value.copyOf()
  }

  override fun delete(table: String, key: String) {
    data.remove(id(table, key))
  }

  override fun keys(table: String, prefix: String): List<String> {
    val start = id(table, prefix)
    return data.keys.filter { it.startsWith(start) }.map { it.substringAfter('\u0000') }
  }

  @Synchronized
  override fun <T> transaction(block: () -> T): T {
    val before = HashMap(data)
    try {
      return block()
    } catch (e: Throwable) {
      data.clear()
      data.putAll(before)
      throw e
    }
  }
}
