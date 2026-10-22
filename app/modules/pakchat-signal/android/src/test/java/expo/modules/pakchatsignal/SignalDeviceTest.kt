package expo.modules.pakchatsignal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.signal.libsignal.protocol.DuplicateMessageException
import org.signal.libsignal.protocol.NoSessionException
import org.signal.libsignal.protocol.message.CiphertextMessage
import java.util.UUID

/**
 * Tests the Kotlin side on a computer, with the desktop build of the same Signal
 * library. Keys are saved in a MemoryKeyBackend, so "closing the app" is just
 * opening the device again from the same backend.
 */
class SignalDeviceTest {
  private val group = "6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7"

  private fun String.utf8() = toByteArray(Charsets.UTF_8)

  /** What the server would hand out for `d`: its keys plus one-time keys (or none, when they've run out). */
  private fun bundleOf(d: SignalDevice, withOneTime: Boolean = true): PublicBundle {
    val keys = d.deviceKeys()
    val (ec, kyber) = d.newPreKeys(1)
    return PublicBundle(
      registrationId = keys.registrationId,
      deviceId = d.deviceId,
      preKeyId = if (withOneTime) ec[0].keyId else null,
      preKey = if (withOneTime) ec[0].publicKey else null,
      signedPreKeyId = keys.signedPreKey.keyId,
      signedPreKey = keys.signedPreKey.publicKey,
      signedPreKeySignature = keys.signedPreKey.signature,
      identityKey = keys.identityKey,
      kyberPreKeyId = if (withOneTime) kyber[0].keyId else keys.kyberLastResort.keyId,
      kyberPreKey = if (withOneTime) kyber[0].publicKey else keys.kyberLastResort.publicKey,
      kyberPreKeySignature = if (withOneTime) kyber[0].signature else keys.kyberLastResort.signature,
    )
  }

  private fun chatting(backend: KeyBackend = MemoryKeyBackend()): Pair<SignalDevice, SignalDevice> {
    val ali = SignalDevice.create(backend, "ali", 1)
    val sara = SignalDevice.create(backend, "sara", 1)
    ali.startSession("sara", 1, bundleOf(sara))
    return ali to sara
  }

  @Test
  fun oneToOneBothWays() {
    val (ali, sara) = chatting()
    val first = ali.encrypt("sara", 1, "Assalam o Alaikum".utf8())
    assertEquals(CiphertextMessage.PREKEY_TYPE, first.type)
    assertArrayEquals("Assalam o Alaikum".utf8(), sara.decrypt("ali", 1, first))

    val reply = sara.encrypt("ali", 1, "Walaikum Assalam".utf8())
    assertEquals(CiphertextMessage.WHISPER_TYPE, reply.type)
    assertArrayEquals("Walaikum Assalam".utf8(), ali.decrypt("sara", 1, reply))
  }

  @Test
  fun keysSurviveClosingTheApp() {
    val backend = MemoryKeyBackend()
    val (ali, sara) = chatting(backend)
    sara.decrypt("ali", 1, ali.encrypt("sara", 1, "before".utf8()))

    // "Restart": open both devices again from what was saved.
    val ali2 = SignalDevice.open(backend, "ali", 1)!!
    val sara2 = SignalDevice.open(backend, "sara", 1)!!
    assertArrayEquals("after".utf8(), sara2.decrypt("ali", 1, ali2.encrypt("sara", 1, "after".utf8())))
    assertArrayEquals("reply".utf8(), ali2.decrypt("sara", 1, sara2.encrypt("ali", 1, "reply".utf8())))
    assertNull(SignalDevice.open(backend, "nobody", 1))
  }

  @Test
  fun newAddressAfterSigningIn() {
    val backend = MemoryKeyBackend()
    val d = SignalDevice.create(backend, "new-123", 1)
    val identity = d.deviceKeys().identityKey
    d.rename("user-7", 1)
    assertNull(SignalDevice.open(backend, "new-123", 1))
    assertArrayEquals(identity, SignalDevice.open(backend, "user-7", 1)!!.deviceKeys().identityKey)
  }

  @Test
  fun startsWithoutOneTimeKeys() {
    val ali = SignalDevice.create(MemoryKeyBackend(), "ali", 1)
    val sara = SignalDevice.create(MemoryKeyBackend(), "sara", 1)
    // Sara's one-time keys ran out: the last-resort Kyber key and no EC pre-key still work.
    ali.startSession("sara", 1, bundleOf(sara, withOneTime = false))
    assertArrayEquals("hi".utf8(), sara.decrypt("ali", 1, ali.encrypt("sara", 1, "hi".utf8())))
    // And the last-resort key is still there for the next person.
    val bilal = SignalDevice.create(MemoryKeyBackend(), "bilal", 1)
    bilal.startSession("sara", 1, bundleOf(sara, withOneTime = false))
    assertArrayEquals("salam".utf8(), sara.decrypt("bilal", 1, bilal.encrypt("sara", 1, "salam".utf8())))
  }

  @Test
  fun offlineCatchUpInOrderAndOutOfOrder() {
    val (ali, sara) = chatting()
    val waiting = (1..3).map { ali.encrypt("sara", 1, "Message $it".utf8()) }
    for (i in listOf(0, 2, 1)) {
      assertArrayEquals("Message ${i + 1}".utf8(), sara.decrypt("ali", 1, waiting[i]))
    }
  }

  @Test
  fun groupWithSenderKeys() {
    val backend = MemoryKeyBackend()
    val ali = SignalDevice.create(backend, "ali", 1)
    val sara = SignalDevice.create(backend, "sara", 1)
    val bilal = SignalDevice.create(backend, "bilal", 1)
    val aliKey = ali.createGroupKey(group)
    // Before Ali's key arrives, Sara can't read his group messages.
    val early = ali.groupEncrypt(group, "too early".utf8())
    assertThrows(NoSessionException::class.java) { sara.groupDecrypt("ali", 1, early) }

    sara.acceptGroupKey("ali", 1, aliKey)
    bilal.acceptGroupKey("ali", 1, aliKey)

    val body = ali.groupEncrypt(group, "Exam on Monday".utf8())
    assertArrayEquals("Exam on Monday".utf8(), sara.groupDecrypt("ali", 1, body))
    assertArrayEquals("Exam on Monday".utf8(), bilal.groupDecrypt("ali", 1, body))
    assertThrows(DuplicateMessageException::class.java) { sara.groupDecrypt("ali", 1, body) }

    // A new distribution id is a new key (after someone leaves).
    val next = UUID.randomUUID().toString()
    sara.acceptGroupKey("ali", 1, ali.createGroupKey(next))
    assertArrayEquals("new key".utf8(), sara.groupDecrypt("ali", 1, ali.groupEncrypt(next, "new key".utf8())))
  }

  @Test
  fun changedAndRepeatedMessagesAreRefused() {
    val (ali, sara) = chatting()
    val sealed = ali.encrypt("sara", 1, "Original".utf8())
    val changed = sealed.body.copyOf().also { it[it.size / 2] = (it[it.size / 2].toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) { sara.decrypt("ali", 1, Sealed(sealed.type, changed)) }
    assertArrayEquals("Original".utf8(), sara.decrypt("ali", 1, sealed))

    val next = ali.encrypt("sara", 1, "Second".utf8())
    sara.decrypt("ali", 1, next)
    assertThrows(DuplicateMessageException::class.java) { sara.decrypt("ali", 1, next) }
  }

  @Test
  fun reinstallIsTrustedAndSessionsCanBeDropped() {
    val (ali, sara) = chatting()
    sara.decrypt("ali", 1, ali.encrypt("sara", 1, "hi".utf8()))
    val before = ali.identityKey("sara", 1)
    assertNotNull(before)

    // Sara reinstalls: new keys, same address. Ali starts again and it's trusted.
    val sara2 = SignalDevice.create(MemoryKeyBackend(), "sara", 1)
    ali.deleteSession("sara", 1)
    assertTrue(!ali.hasSession("sara", 1))
    ali.startSession("sara", 1, bundleOf(sara2))
    assertArrayEquals("again".utf8(), sara2.decrypt("ali", 1, ali.encrypt("sara", 1, "again".utf8())))
    assertTrue(!before!!.contentEquals(ali.identityKey("sara", 1)!!))
  }

  @Test
  fun safetyNumbersMatch() {
    val (ali, sara) = chatting()
    sara.decrypt("ali", 1, ali.encrypt("sara", 1, "hi".utf8()))
    assertEquals(ali.safetyNumber("sara", 1), sara.safetyNumber("ali", 1))
    assertEquals(60, ali.safetyNumber("sara", 1).length)
  }

  @Test
  fun oneTimeKeyNumbersKeepCounting() {
    val backend = MemoryKeyBackend()
    val d = SignalDevice.create(backend, "ali", 1)
    assertEquals(listOf(1, 2, 3), d.newPreKeys(3).first.map { it.keyId })
    val again = SignalDevice.open(backend, "ali", 1)!!
    assertEquals(listOf(4, 5), again.newPreKeys(2).first.map { it.keyId })
  }

  @Test
  fun keptTextSurvivesBeingKilledBeforeSaving() {
    val backend = MemoryKeyBackend()
    val (ali, sara) = chatting(backend)
    val first = ali.encrypt("sara", 1, "one".utf8())
    assertArrayEquals("one".utf8(), sara.decrypt("ali", 1, first, keep = 41))

    // Killed before the app saved it: the server sends envelope 41 again.
    val sara2 = SignalDevice.open(backend, "sara", 1)!!
    assertArrayEquals("one".utf8(), sara2.decrypt("ali", 1, first, keep = 41))
    // Another sender can't get it back under the same number.
    assertThrows(Exception::class.java) { sara2.decrypt("bob", 1, first, keep = 41) }

    // Once saved and forgotten, it's an ordinary repeat again.
    sara2.forgetOpened(listOf(41))
    assertThrows(DuplicateMessageException::class.java) { sara2.decrypt("ali", 1, first, keep = 41) }

    // Groups too.
    sara2.acceptGroupKey("ali", 1, ali.createGroupKey(group))
    val g = ali.groupEncrypt(group, "group".utf8())
    assertArrayEquals("group".utf8(), sara2.groupDecrypt("ali", 1, g, keep = 42))
    assertArrayEquals("group".utf8(), sara2.groupDecrypt("ali", 1, g, keep = 42))
    sara2.forgetOpened(listOf(42))
    assertThrows(DuplicateMessageException::class.java) { sara2.groupDecrypt("ali", 1, g, keep = 42) }
  }
}
