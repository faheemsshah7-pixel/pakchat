package expo.modules.pakchatsignal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.signal.libsignal.protocol.DuplicateMessageException
import org.signal.libsignal.protocol.message.CiphertextMessage

/** Tests the Kotlin side on a computer, with the desktop build of the same Signal library. */
class SignalDeviceTest {
  private val group = "6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7"

  private fun String.utf8() = toByteArray(Charsets.UTF_8)

  private fun chatting(): Pair<SignalDevice, SignalDevice> {
    val ali = SignalDevice("Ali", 1)
    val sara = SignalDevice("Sara", 1)
    ali.startSession("Sara", 1, sara.newBundle())
    return ali to sara
  }

  @Test
  fun oneToOneBothWays() {
    val (ali, sara) = chatting()
    val first = ali.encrypt("Sara", 1, "Assalam o Alaikum".utf8())
    assertEquals(CiphertextMessage.PREKEY_TYPE, first.type)
    assertArrayEquals("Assalam o Alaikum".utf8(), sara.decrypt("Ali", 1, first))

    val reply = sara.encrypt("Ali", 1, "Walaikum Assalam".utf8())
    assertEquals(CiphertextMessage.WHISPER_TYPE, reply.type)
    assertArrayEquals("Walaikum Assalam".utf8(), ali.decrypt("Sara", 1, reply))
  }

  @Test
  fun offlineCatchUpInOrderAndOutOfOrder() {
    val (ali, sara) = chatting()
    // Sara is offline: three messages pile up on the server.
    val waiting = (1..3).map { ali.encrypt("Sara", 1, "Message $it".utf8()) }
    // A weak network can deliver them out of order; Signal still opens all of them.
    for (i in listOf(0, 2, 1)) {
      assertArrayEquals("Message ${i + 1}".utf8(), sara.decrypt("Ali", 1, waiting[i]))
    }
  }

  @Test
  fun groupWithSenderKeys() {
    val ali = SignalDevice("Ali", 1)
    val sara = SignalDevice("Sara", 1)
    val bilal = SignalDevice("Bilal", 1)
    val aliKey = ali.createGroupKey(group)
    sara.acceptGroupKey("Ali", 1, aliKey)
    bilal.acceptGroupKey("Ali", 1, aliKey)

    val body = ali.groupEncrypt(group, "Exam on Monday".utf8())
    assertArrayEquals("Exam on Monday".utf8(), sara.groupDecrypt("Ali", 1, body))
    assertArrayEquals("Exam on Monday".utf8(), bilal.groupDecrypt("Ali", 1, body))
    assertThrows(DuplicateMessageException::class.java) { sara.groupDecrypt("Ali", 1, body) }
  }

  @Test
  fun changedAndRepeatedMessagesAreRefused() {
    val (ali, sara) = chatting()
    val sealed = ali.encrypt("Sara", 1, "Original".utf8())
    val changed = sealed.body.copyOf().also { it[it.size / 2] = (it[it.size / 2].toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) { sara.decrypt("Ali", 1, Sealed(sealed.type, changed)) }
    assertArrayEquals("Original".utf8(), sara.decrypt("Ali", 1, sealed))

    val next = ali.encrypt("Sara", 1, "Second".utf8())
    sara.decrypt("Ali", 1, next)
    assertThrows(DuplicateMessageException::class.java) { sara.decrypt("Ali", 1, next) }
  }

  @Test
  fun safetyNumbersMatch() {
    val (ali, sara) = chatting()
    sara.decrypt("Ali", 1, ali.encrypt("Sara", 1, "hi".utf8()))
    assertEquals(ali.safetyNumber("Sara", 1), sara.safetyNumber("Ali", 1))
    assertEquals(60, ali.safetyNumber("Sara", 1).length)

    val bilal = SignalDevice("Bilal", 1)
    ali.startSession("Bilal", 1, bilal.newBundle())
    assertNotEquals(ali.safetyNumber("Sara", 1), ali.safetyNumber("Bilal", 1))
  }

  @Test
  fun aWrongMessageTypeIsRefused() {
    val (_, sara) = chatting()
    assertThrows(IllegalArgumentException::class.java) { sara.decrypt("Ali", 1, Sealed(99, ByteArray(10))) }
  }
}
