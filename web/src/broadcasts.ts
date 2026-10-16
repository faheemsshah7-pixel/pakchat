// broadcasts.ts: broadcast lists. Send one message to many people at once. Each of them gets it
// in their own chat with you, as if you'd sent it just to them: they can't see who else got it,
// and when they answer, it comes to your chat with them (like WhatsApp).
//
// A list is a chat that only you are in:
//   chats/<random id>
//     type: 'broadcast', members: [you], admin: you
//     recipients: [uid, ...]       who gets your messages (up to 256 people)
//     names: { uid: 'Ali', ... }   their names (and yours)
//     title: the list's name ('' = no name: the chat list shows their names, "Ali, Sara, Bilal")
// What you send is kept in the list too, so you can see it there. Each message remembers its copies:
//   copies: { uid: the copy's id, in your chat with them }
// so editing it, or deleting it for everyone, does the same to every copy.
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { addMessage, chatIdFor, sendMessage, type Chat, type Content, type Message, type Person, type Times } from './chats'
import { db } from './firebase'
import { deleteMedia } from './media'
import { editMessage, unsendMessage } from './messages'

export const MAX_RECIPIENTS = 256
const AT_ONCE = 5 // copies sent at the same time (so a long list doesn't send hundreds at once)

// Make a new list. It starts with a small grey note: "You created this broadcast list".
export async function createBroadcast(me: Person, title: string, people: Person[]) {
  const chatRef = doc(collection(db, 'chats')) // a random id
  const batch = writeBatch(db)
  const fields = {
    type: 'broadcast',
    title,
    admin: me.uid,
    members: [me.uid],
    recipients: people.map((p) => p.uid),
    names: Object.fromEntries([me, ...people].map((p) => [p.uid, p.name])),
    createdAt: serverTimestamp(),
  }
  addMessage(batch, { chatId: chatRef.id }, { kind: 'system', event: 'listCreated', senderId: me.uid, senderName: me.name }, me, fields)
  await batch.commit()
  return chatRef.id
}

// Change who's on the list. (The names of people who were taken off are kept: they cost nothing.)
export function setRecipients(list: Chat, people: Person[]) {
  return updateDoc(doc(db, 'chats', list.id), {
    recipients: people.map((p) => p.uid),
    ...Object.fromEntries(people.map((p) => [`names.${p.uid}`, p.name])),
  })
}

export function renameList(list: Chat, title: string) {
  return updateDoc(doc(db, 'chats', list.id), { title })
}

// Delete the list for good: its messages, their photos and videos, then the list itself.
// (The copies everyone got stay in their chats with you.) A batch can only hold 500 changes,
// so it goes 40 messages at a time (each can have a few parts of a video, and its first picture).
export async function deleteList(list: Chat) {
  const listRef = doc(db, 'chats', list.id)
  const messages = await getDocs(collection(listRef, 'messages'))
  let batch = writeBatch(db)
  let count = 0
  for (const m of messages.docs) {
    for (const mediaId of [m.get('mediaId'), m.get('posterId')]) if (mediaId) await deleteMedia(batch, list.id, mediaId)
    batch.delete(m.ref)
    if (++count === 40) {
      await batch.commit()
      batch = writeBatch(db)
      count = 0
    }
  }
  batch.delete(listRef)
  await batch.commit()
}

// Send a copy of a list's message to everyone on it, each in your chat with them.
// listMessageId: the message as saved in the list. chats: all your chats (to know which already exist).
// skip: people not to send to (ones you blocked). Returns how many copies couldn't be sent
// (for example, someone who blocked you).
export async function sendToList(me: Person, list: Chat, chats: Chat[], listMessageId: string, content: Content, skip: Set<string>) {
  const people = (list.recipients ?? []).filter((uid) => !skip.has(uid))
  const copies: Record<string, string> = {}
  let failed = 0
  for (let i = 0; i < people.length; i += AT_ONCE) {
    await Promise.all(
      people.slice(i, i + AT_ONCE).map(async (uid) => {
        const chatId = chatIdFor(me.uid, uid)
        const chat = chats.find((c) => c.id === chatId)
        const other = { uid, name: list.names[uid] ?? '?' }
        try {
          // (timer: if your chat with them has disappearing messages on, their copy disappears too)
          copies[uid] = await sendMessage(me, { chatId, other, isNew: !chat, timer: chat?.timer }, content)
        } catch (err) {
          console.warn('Not sent to one person on the list:', err)
          failed++
        }
      }),
    )
  }
  await updateDoc(doc(db, 'chats', list.id, 'messages', listMessageId), { copies })
  return failed
}

// Each copy of a list's message, as it is now in your chat with that person.
// (Missing if it's gone, for example after disappearing messages deleted it.)
async function eachCopy(me: Person, m: Message, chats: Chat[], job: (chatId: string, copy: Message, chat: Chat | undefined) => Promise<unknown>) {
  await Promise.all(
    Object.entries(m.copies ?? {}).map(async ([uid, id]) => {
      const chatId = chatIdFor(me.uid, uid)
      const snap = await getDoc(doc(db, 'chats', chatId, 'messages', id))
      if (!snap.exists() || snap.get('deleted')) return
      await job(chatId, { ...snap.data(), id } as Message, chats.find((c) => c.id === chatId)).catch(console.warn)
    }),
  )
}

// You edited a list's message: edit every copy too. (If it's the newest message in that chat,
// the chat list's preview changes as well.)
export function editCopies(me: Person, m: Message, text: string, chats: Chat[]) {
  return eachCopy(me, m, chats, (chatId, copy, chat) => editMessage(chatId, me, copy, text, chat?.lastMessage?.id === copy.id))
}

// You deleted a list's message for everyone: delete every copy for everyone too.
export function unsendCopies(me: Person, m: Message, chats: Chat[]) {
  return eachCopy(me, m, chats, (chatId, copy, chat) => unsendMessage(chatId, me, copy, chat?.lastMessage?.id === copy.id, !!chat?.pins?.[copy.id]))
}

// The list as if it were one chat with everyone on it. Each person's ticks come from your chat
// with them (that's where their copy is), for the ✓✓ on your messages and "Message info".
export function listAsChat(list: Chat, chats: Chat[], myUid: string): Chat {
  const deliveredAt: Times = {}
  const readAt: Times = {}
  for (const uid of list.recipients ?? []) {
    const chat = chats.find((c) => c.id === chatIdFor(myUid, uid))
    deliveredAt[uid] = chat?.deliveredAt?.[uid] ?? null
    readAt[uid] = chat?.readAt?.[uid] ?? null
  }
  // ('direct': read receipts work as in your chats with each of them)
  return { ...list, type: 'direct', members: [myUid, ...(list.recipients ?? [])], deliveredAt, readAt }
}
