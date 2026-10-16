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
    text: (m.text ?? m.caption ?? m.fileName ?? m.contact?.name ?? '').slice(0, 200),
  }
}

// Messages whose words you can edit: a text, or the caption of a photo, video or document.
const EDITABLE = ['text', 'photo', 'video', 'file']
export const captionKind = (m: Message) => (m.kind ?? 'text') !== 'text'

// You can edit your own text (or a caption) for 15 minutes.
// (We stop 30 seconds early, in case your computer's clock is a little off.)
export function canEdit(m: Message, myUid: string) {
  return m.senderId === myUid && !m.deleted && !m.pending && EDITABLE.includes(m.kind ?? 'text')
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
  const field = captionKind(m) ? 'caption' : 'text'
  batch.update(doc(db, 'chats', chatId, 'messages', m.id), { [field]: text, editedAt: serverTimestamp() })
  if (isLast) {
    batch.update(doc(db, 'chats', chatId), {
      lastMessage: { kind: m.kind ?? 'text', text, senderId: me.uid, senderName: me.name, ...expiry(m) },
    })
  }
  await batch.commit()
}

// Delete for everyone: the words, photo, video, voice note or document are wiped from the database.
// Everyone sees "This message was deleted" instead. If it was pinned, the pin goes too.
export async function unsendMessage(chatId: string, me: Person, m: Message, isLast: boolean, pinned = false) {
  const batch = writeBatch(db)
  const wipe = Object.fromEntries(
    [
      ...['text', 'caption', 'mediaId', 'posterId', 'width', 'height', 'seconds', 'replyTo', 'forwarded', 'reactions', 'editedAt'],
      ...['fileName', 'fileSize', 'mime', 'lat', 'lng', 'accuracy', 'live', 'liveUntil', 'movedAt', 'contact'],
    ].map((key) => [
      key,
      deleteField(),
    ]),
  )
  batch.update(doc(db, 'chats', chatId, 'messages', m.id), { ...wipe, deleted: true })
  if (m.mediaId) await deleteMedia(batch, chatId, m.mediaId)
  if (m.posterId) await deleteMedia(batch, chatId, m.posterId)
  const chatFields: Record<string, unknown> = {}
  if (isLast) chatFields.lastMessage = { kind: m.kind ?? 'text', deleted: true, senderId: me.uid, senderName: me.name, ...expiry(m) }
  if (pinned) chatFields[`pins.${m.id}`] = deleteField()
  if (isLast || pinned) batch.update(doc(db, 'chats', chatId), chatFields)
  await batch.commit()
}

// Forward a message to other chats. Photos, videos, voice notes and documents are copied into each chat.
// (A live location is forwarded as a plain location: where it was.)
export async function forwardMessage(me: Person, fromChatId: string, m: Message, targets: Target[]) {
  const content = await contentOf(fromChatId, m)
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

// What to send to make a copy of a message.
async function contentOf(chatId: string, m: Message): Promise<Content> {
  const media = () => loadMedia(chatId, m.mediaId ?? '')
  switch (m.kind ?? 'text') {
    case 'photo':
      return { kind: 'photo', data: await media(), width: m.width ?? 4, height: m.height ?? 3, caption: m.caption }
    case 'video':
      return {
        kind: 'video',
        data: await media(),
        poster: await loadMedia(chatId, m.posterId ?? ''),
        width: m.width ?? 16,
        height: m.height ?? 9,
        seconds: m.seconds ?? 0,
        caption: m.caption,
      }
    case 'voice':
      return { kind: 'voice', data: await media(), seconds: m.seconds ?? 0 }
    case 'file':
      return { kind: 'file', data: await media(), fileName: m.fileName ?? 'file', fileSize: m.fileSize ?? 0, mime: m.mime ?? '', caption: m.caption }
    case 'location':
      return { kind: 'location', lat: m.lat ?? 0, lng: m.lng ?? 0, accuracy: m.accuracy ?? 0 }
    case 'contact':
      return { kind: 'contact', contact: m.contact ?? { name: '?' } }
  }
  return { kind: 'text', text: m.text ?? '' }
}
