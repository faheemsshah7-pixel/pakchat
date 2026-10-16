// messages.ts: things you can do to a message after it's sent:
// react, reply, edit, forward, delete. The security rules (firestore.rules) check each one,
// for example that you only edit your OWN messages, and only for 15 minutes.
import { deleteField, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { sendMessage, type Content, type Message, type Person, type ReplyTo, type Target } from './chats'
import { deleteMedia, loadMedia } from './media'

export const EDIT_MINUTES = 15
export const UNSEND_HOURS = 60
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

const sentMillis = (m: Message) => m.sentAt?.toMillis() ?? Date.now()
// A disappearing message's time, so the chat list's preview still disappears with it.
const expiry = (m: Message) => (m.expireAt ? { expireAt: m.expireAt } : {})

// The little bar of emojis: tap one to react, tap the same one again to take it back.
// emoji = null removes your reaction.
export function react(chatId: string, messageId: string, uid: string, emoji: string | null) {
  return updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
    [`reactions.${uid}`]: emoji ?? deleteField(),
  })
}

// A short copy of a message, to show above your reply.
export function replySnapshot(m: Message): ReplyTo {
  return {
    id: m.id,
    senderId: m.senderId,
    senderName: m.senderName ?? '',
    kind: m.kind ?? 'text',
    text: (m.text ?? m.caption ?? '').slice(0, 200),
  }
}

// You can edit your own text (or a photo's caption) for 15 minutes.
// (We stop 30 seconds early, in case your computer's clock is a little off.)
export function canEdit(m: Message, myUid: string) {
  const kind = m.kind ?? 'text'
  return m.senderId === myUid && !m.deleted && !m.pending && (kind === 'text' || kind === 'photo')
    && Date.now() - sentMillis(m) < EDIT_MINUTES * 60_000 - 30_000
}

// You can delete your own message for everyone for 60 hours.
export function canUnsend(m: Message, myUid: string) {
  return m.senderId === myUid && !m.deleted && !m.pending && m.kind !== 'system' && m.kind !== 'call'
    && Date.now() - sentMillis(m) < UNSEND_HOURS * 3600_000 - 30_000
}

// isLast: it's the newest message, so the chat list's preview changes too.
// (A pinned message's copy in the pin bar is kept up to date in ChatRoom.tsx, from the message itself.)
export async function editMessage(chatId: string, me: Person, m: Message, text: string, isLast: boolean) {
  const batch = writeBatch(db)
  const field = (m.kind ?? 'text') === 'photo' ? 'caption' : 'text'
  batch.update(doc(db, 'chats', chatId, 'messages', m.id), { [field]: text, editedAt: serverTimestamp() })
  if (isLast) {
    batch.update(doc(db, 'chats', chatId), {
      lastMessage: { kind: m.kind ?? 'text', text, senderId: me.uid, senderName: me.name, ...expiry(m) },
    })
  }
  await batch.commit()
}

// Delete for everyone: the words, photo or voice note are wiped from the database.
// Everyone sees "This message was deleted" instead. If it was pinned, the pin goes too.
export async function unsendMessage(chatId: string, me: Person, m: Message, isLast: boolean, pinned = false) {
  const batch = writeBatch(db)
  const wipe = Object.fromEntries(
    ['text', 'caption', 'mediaId', 'width', 'height', 'seconds', 'replyTo', 'forwarded', 'reactions', 'editedAt'].map((key) => [
      key,
      deleteField(),
    ]),
  )
  batch.update(doc(db, 'chats', chatId, 'messages', m.id), { ...wipe, deleted: true })
  if (m.mediaId) await deleteMedia(batch, chatId, m.mediaId)
  const chatFields: Record<string, unknown> = {}
  if (isLast) chatFields.lastMessage = { kind: m.kind ?? 'text', deleted: true, senderId: me.uid, senderName: me.name, ...expiry(m) }
  if (pinned) chatFields[`pins.${m.id}`] = deleteField()
  if (isLast || pinned) batch.update(doc(db, 'chats', chatId), chatFields)
  await batch.commit()
}

// Forward a message to other chats. Photos and voice notes are copied into each chat.
export async function forwardMessage(me: Person, fromChatId: string, m: Message, targets: Target[]) {
  let content: Content
  const kind = m.kind ?? 'text'
  if (kind === 'text') content = { kind: 'text', text: m.text ?? '' }
  else {
    const data = await loadMedia(fromChatId, m.mediaId ?? '')
    content =
      kind === 'photo'
        ? { kind: 'photo', data, width: m.width ?? 4, height: m.height ?? 3, caption: m.caption }
        : { kind: 'voice', data, seconds: m.seconds ?? 0 }
  }
  // One chat at a time, so a problem with one doesn't stop the others.
  const failed: string[] = []
  for (const target of targets) {
    await sendMessage(me, target, content, { forwarded: true }).catch((err) => {
      console.error(err)
      failed.push(target.chatId)
    })
  }
  return failed
}
