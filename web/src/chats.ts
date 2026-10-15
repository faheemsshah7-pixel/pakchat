// chats.ts: everything about chats and messages in the database.
//
// How a chat is stored (open Firestore in the Firebase console to see it):
//   chats/<chatId>
//     type:        'direct' (two people) or 'group'
//     members:     [uidA, uidB, ...]    who is in it
//     names:       { uidA: 'Ali', ... } their names, for showing
//     title, admin                      groups only: the group name, and who made it
//     lastMessage: { kind, text, senderId, senderName }   shown in the chat list
//     updatedAt:   time of the last message (newest chats go on top)
//     deliveredAt: { uidA: time }   when each person's app last RECEIVED messages
//     readAt:      { uidA: time }   when each person last OPENED the chat
//     typing:      { uidA: time }   when each person last pressed a key
//   chats/<chatId>/messages/<id>    one document per message
//     kind: 'text' | 'photo' | 'voice' | 'system', senderId, sentAt, and the content
//   chats/<chatId>/media/<id>       the photo or voice note itself (see media.ts)
//
// Direct chat ids are the two people's ids sorted and joined: "uidA_uidB".
// Group chat ids are random, picked by Firestore.
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
  type WriteBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { rememberMedia } from './media'
import { fill, type Strings } from './strings'

export type Person = { uid: string; name: string }

type Times = Record<string, Timestamp | null>

export type SystemEvent = 'created' | 'added' | 'left'

export type LastMessage = {
  kind?: Message['kind']
  text?: string
  senderId: string
  senderName?: string
  event?: SystemEvent
  targetName?: string
}

export type Chat = {
  id: string
  type?: 'direct' | 'group' // chats from step 2 have no type: they're direct
  members: string[]
  names: Record<string, string>
  title?: string
  admin?: string
  lastMessage?: LastMessage
  updatedAt?: Timestamp | null
  deliveredAt?: Times
  readAt?: Times
  typing?: Times
}

export type Message = {
  id: string
  kind?: 'text' | 'photo' | 'voice' | 'system' // step 2 messages have no kind: they're text
  text?: string
  senderId: string
  senderName?: string
  sentAt: Timestamp | null
  pending: boolean // true = still on its way to the server
  mediaId?: string
  width?: number // photos
  height?: number
  seconds?: number // voice notes
  event?: SystemEvent // system messages: "Ali added Sara"
  targetName?: string
}

// What you can send. Photos and voice notes arrive as text ("data URLs"), see media.ts.
export type Content =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; data: string; width: number; height: number }
  | { kind: 'voice'; data: string; seconds: number }

// Which chat to send to. `other` is set for direct chats, so a new chat can be created.
// isNew: the chat doesn't exist yet, so this message creates it.
export type Target = { chatId: string; other?: Person; isNew?: boolean }

// Two people always get the SAME chat id, no matter who starts it.
export function chatIdFor(a: string, b: string) {
  return [a, b].sort().join('_')
}

export const isGroup = (chat: Chat | undefined) => chat?.type === 'group'

// The other person in a direct chat.
export function otherPerson(chat: Chat, myUid: string): Person {
  const uid = chat.members.find((m) => m !== myUid) ?? myUid
  return { uid, name: chat.names[uid] ?? '?' }
}

export function chatTitle(chat: Chat, myUid: string) {
  return isGroup(chat) ? (chat.title ?? '') : otherPerson(chat, myUid).name
}

// Look up a PakChat user by phone number. Returns null if nobody has it.
export async function findUserByPhone(phone: string): Promise<Person | null> {
  const q = query(collection(db, 'users'), where('phone', '==', phone), limit(1))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const found = snap.docs[0]
  return { uid: found.id, name: found.data().name }
}

// Send one message. A "batch" saves several things together: the message,
// the photo or voice note (if any), and the chat's "last message" for the chat list.
// Either all of them are saved or none are.
export async function sendMessage(me: Person, target: Target, content: Content) {
  const chatRef = doc(db, 'chats', target.chatId)
  const batch = writeBatch(db)
  const message: Record<string, unknown> = { kind: content.kind, senderId: me.uid, senderName: me.name }

  if (content.kind === 'text') {
    message.text = content.text
  } else {
    // The photo or voice note goes in its own document, so the message list stays small.
    const mediaRef = doc(collection(chatRef, 'media'))
    batch.set(mediaRef, { data: content.data, senderId: me.uid })
    rememberMedia(mediaRef.id, content.data) // so YOUR bubble shows it straight away
    message.mediaId = mediaRef.id
    if (content.kind === 'photo') Object.assign(message, { width: content.width, height: content.height })
    else message.seconds = content.seconds
  }

  addMessage(batch, target, message, me, target.other ? directChatFields(me, target.other, !!target.isNew) : {})
  await batch.commit()
}

function directChatFields(me: Person, other: Person, isNew: boolean) {
  return {
    type: 'direct',
    members: chatIdFor(me.uid, other.uid).split('_'),
    // The rules only let you write your OWN name, except when the chat is brand new.
    names: isNew ? { [me.uid]: me.name, [other.uid]: other.name } : { [me.uid]: me.name },
  }
}

// Adds a message to a batch, and updates the chat's lastMessage to match.
// Used for normal messages and for "Ali added Sara" system messages (groups.ts).
export function addMessage(batch: WriteBatch, target: Target, message: Record<string, unknown>, me: Person, chatFields: object) {
  const chatRef = doc(db, 'chats', target.chatId)
  batch.set(doc(collection(chatRef, 'messages')), { ...message, sentAt: serverTimestamp() }) // the server's clock
  const { kind, text, senderId, senderName, event, targetName } = message
  const lastMessage = Object.fromEntries(
    Object.entries({ kind, text, senderId, senderName, event, targetName }).filter(([, v]) => v !== undefined),
  )
  // merge: true = create the chat if it's new, otherwise just update these fields.
  batch.set(
    chatRef,
    { ...chatFields, lastMessage, updatedAt: serverTimestamp(), typing: { [me.uid]: null } },
    { merge: true },
  )
}

// "Ali added Sara", "You left", ... in the chosen language.
export function systemText(m: { event?: SystemEvent; senderId: string; senderName?: string; targetName?: string }, myUid: string, t: Strings) {
  const name = m.senderId === myUid ? t.you : (m.senderName ?? '')
  if (m.event === 'created') return fill(t.created, { name })
  if (m.event === 'added') return fill(t.added, { name, other: m.targetName ?? '' })
  return fill(t.left, { name })
}

// The grey line under a chat's name in the chat list.
export function previewText(chat: Chat, myUid: string, t: Strings) {
  const last = chat.lastMessage
  if (!last) return ''
  if (last.kind === 'system') return systemText(last, myUid, t)
  const body = last.kind === 'photo' ? t.photo : last.kind === 'voice' ? t.voice : (last.text ?? '')
  // In groups, say who sent it: "Ali: salam"
  if (isGroup(chat) && last.senderId !== myUid && last.senderName) return last.senderName + ': ' + body
  return body
}

// ---------- Ticks ----------
//   🕓  pending    still on its way to the server
//   ✓   sent       the server has it
//   ✓✓  delivered  everyone else's app has received it
//   ✓✓  read       (blue) everyone else opened the chat after it arrived

export type Tick = 'pending' | 'sent' | 'delivered' | 'read'

export function tickFor(chat: Chat | undefined, myUid: string, sentAt: Timestamp | null | undefined, pending = false): Tick {
  if (pending || !sentAt) return 'pending'
  const others = (chat?.members ?? []).filter((uid) => uid !== myUid)
  if (others.length === 0) return 'sent'
  const sent = sentAt.toMillis()
  const everyone = (times?: Times) => others.every((uid) => (times?.[uid]?.toMillis() ?? 0) >= sent)
  if (everyone(chat?.readAt)) return 'read'
  if (everyone(chat?.deliveredAt)) return 'delivered'
  return 'sent'
}

// "deliveredAt.<uid>" changes just one person's time inside the map.
export function markDelivered(chatId: string, uid: string) {
  return updateDoc(doc(db, 'chats', chatId), { [`deliveredAt.${uid}`]: serverTimestamp() })
}

export function markRead(chatId: string, uid: string) {
  return updateDoc(doc(db, 'chats', chatId), {
    [`readAt.${uid}`]: serverTimestamp(),
    [`deliveredAt.${uid}`]: serverTimestamp(), // read means delivered too
  })
}

// Unread = the last message is from someone else, and I haven't opened the chat since.
export function isUnread(chat: Chat, myUid: string) {
  const last = chat.lastMessage
  if (!last || last.senderId === myUid || !chat.updatedAt) return false
  return (chat.readAt?.[myUid]?.toMillis() ?? 0) < chat.updatedAt.toMillis()
}

// ---------- Typing ----------

export function markTyping(chatId: string, uid: string) {
  return updateDoc(doc(db, 'chats', chatId), { [`typing.${uid}`]: serverTimestamp() })
}

// Who is typing right now? (pressed a key in the last 6 seconds)
export function whoIsTyping(chat: Chat | undefined, myUid: string, now: number) {
  return Object.entries(chat?.typing ?? {})
    .filter(([uid, at]) => uid !== myUid && at && now - at.toMillis() < 6000)
    .map(([uid]) => uid)
}

export function typingText(chat: Chat | undefined, myUid: string, now: number, t: Strings) {
  const typing = whoIsTyping(chat, myUid, now)
  if (typing.length === 0 || !chat) return ''
  return isGroup(chat) ? fill(t.nameTyping, { name: chat.names[typing[0]] ?? '' }) : t.typing
}
