// once.ts: "view once" photos, videos and voice notes, like WhatsApp's.
//
// The sender turns on ① before sending. The people it's sent to can open it ONE time:
//   1. Opening it loads it, then saves "openedBy.<you>: now" in the message.
//   2. From then on, the security rules stop you loading it again (firestore.rules: notOpenedYet).
//      The app also forgets its copy as soon as you close it.
//   3. When everyone it was sent to has opened it, the photo itself is deleted from the database.
// The bubble then just says "Opened". It can't be forwarded, starred, saved or downloaded.
//
// Honest limits: a website can't stop screenshots, or someone filming the screen with another phone.
// So, like WhatsApp says: only send view once to people you trust.
import { doc, getDocFromServer, serverTimestamp, updateDoc, writeBatch, type DocumentReference } from 'firebase/firestore'
import type { Chat, Message } from './chats'
import { db } from './firebase'
import { deleteMedia, forgetMedia, loadMedia, loadMediaUrl } from './media'

// Everyone it was sent to: the chat's members, except the sender.
function receivers(chat: Chat | undefined, m: Message) {
  return (chat?.members ?? []).filter((uid) => uid !== m.senderId)
}

// Has this person opened it?
export const openedBy = (m: Message, uid: string) => !!m.openedBy && uid in m.openedBy

// For the sender: has anyone it was sent to opened it? (In a chat with one person: have they?)
export function anyoneOpened(m: Message) {
  return Object.keys(m.openedBy ?? {}).length > 0
}

// Can I open it now? (Not my own, not opened yet, not deleted.)
export function canOpenOnce(m: Message, myUid: string) {
  return !!m.once && !m.deleted && !m.pending && m.senderId !== myUid && !openedBy(m, myUid)
}

// Open it: load it first (after step 1 the rules won't let us), then mark it opened.
// Returns what to show: a photo or voice note as a data URL, a video as a blob URL.
// If this was the last person who hadn't opened it, its media is deleted too.
export async function openOnce(chat: Chat | undefined, chatId: string, m: Message, myUid: string) {
  if (!m.mediaId) throw new Error('gone')
  const src = m.kind === 'video' ? await loadMediaUrl(chatId, m.mediaId) : await loadMedia(chatId, m.mediaId)
  // Get the deleting ready now, while we can still read it (it needs to know how many parts it has).
  const cleanUp = writeBatch(db)
  await deleteMedia(cleanUp, chatId, m.mediaId)
  const ref = doc(db, 'chats', chatId, 'messages', m.id)
  await updateDoc(ref, { [`openedBy.${myUid}`]: serverTimestamp() })
  // (Separate from marking it opened, and not waited for, so if it fails it still counts as opened.)
  lastOneOpened(chat, ref, m, myUid)
    .then((last) => (last ? cleanUp.commit() : undefined))
    .catch((err) => console.warn('View once photo kept for now:', err))
  return src
}

// Was I the last one to open it? In a chat with one person, yes. In a group, we ask the server
// who has opened it (not the copy on this device, which can be a moment behind).
async function lastOneOpened(chat: Chat | undefined, ref: DocumentReference, m: Message, myUid: string) {
  const others = receivers(chat, m).filter((uid) => uid !== myUid)
  if (others.length === 0) return true
  const now = (await getDocFromServer(ref)).get('openedBy') as Record<string, unknown> | undefined
  return others.every((uid) => !!now && uid in now)
}

// After it's closed: forget our copy, so it can't be shown again.
export function closeOnce(m: Message) {
  if (m.mediaId) forgetMedia(m.mediaId)
}
