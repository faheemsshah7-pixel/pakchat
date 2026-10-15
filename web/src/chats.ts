// chats.ts: everything about chats and messages in the database.
//
// How a chat is stored (open Firestore in the Firebase console to see it):
//   chats/<chatId>
//     type:        'direct' (two people) or 'group'
//     members:     [uidA, uidB, ...]    who is in it
//     names:       { uidA: 'Ali', ... } their names, for showing
//     lastMessage: { kind, text, senderId, senderName }   shown in the chat list
//     updatedAt:   time of the last message (newest chats go on top)
//     deliveredAt: { uidA: time }   when each person's app last RECEIVED messages
//     readAt:      { uidA: time }   when each person last OPENED the chat
//   Groups also have (see groups.ts):
//     title, description, photoId    the group's name, about text and photo
//     admin:   who made the group      admins: [uid, ...] anyone else they made admin
//     onlyAdmins: true = only admins can send messages
//     inviteCode: the code in the group's invite link (see invites.ts)
//   chats/<chatId>/messages/<id>    one document per message
//     kind: 'text' | 'photo' | 'voice' | 'system', senderId, sentAt, and the content
//     replyTo:   a small copy of the message it answers
//     reactions: { uidA: '👍' }
//     editedAt, deleted, forwarded
//   chats/<chatId>/media/<id>       the photo or voice note itself (see media.ts)
//   chats/<chatId>/typing/<uid>     when each person last pressed a key (see typing.ts)
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
import { saveMedia } from './media'
import { contactKey } from './phone'
import type { ChatPrefs } from './prefs'
import { fill, type Strings } from './strings'

export type Person = { uid: string; name: string }

export type Times = Record<string, Timestamp | null>

export type SystemEvent =
  | 'created'
  | 'added'
  | 'left'
  | 'removed'
  | 'joined'
  | 'renamed'
  | 'photo'
  | 'description'
  | 'onlyAdmins'
  | 'everyone'

export type LastMessage = {
  kind?: Message['kind']
  text?: string
  video?: boolean // calls
  missed?: boolean
  senderId: string
  senderName?: string
  event?: SystemEvent
  targetName?: string
  deleted?: boolean
}

export type Chat = {
  id: string
  type?: 'direct' | 'group' // chats from step 2 have no type: they're direct
  members: string[]
  names: Record<string, string>
  title?: string
  description?: string
  photoId?: string
  admin?: string
  admins?: string[]
  onlyAdmins?: boolean
  inviteCode?: string
  lastMessage?: LastMessage
  updatedAt?: Timestamp | null
  deliveredAt?: Times
  readAt?: Times
}

// A small copy of the message you're answering, so the reply can show it.
export type ReplyTo = { id: string; senderId: string; senderName: string; kind: string; text: string }

export type Message = {
  id: string
  kind?: 'text' | 'photo' | 'voice' | 'call' | 'system' // step 2 messages have no kind: they're text
  text?: string
  senderId: string
  senderName?: string
  sentAt: Timestamp | null
  pending: boolean // true = still on its way to the server
  fresh?: boolean // arrived while the chat was open, so it slides in (not saved, just for the screen)
  mediaId?: string
  width?: number // photos
  height?: number
  caption?: string
  seconds?: number // voice notes, and how long a call lasted
  video?: boolean // calls: a video call (or else a voice call)
  missed?: boolean // calls: nobody picked up
  event?: SystemEvent // system messages: "Ali added Sara"
  targetName?: string
  replyTo?: ReplyTo
  forwarded?: boolean
  reactions?: Record<string, string>
  editedAt?: Timestamp | null
  deleted?: boolean
}

// What you can send. Photos and voice notes arrive as text ("data URLs"), see media.ts.
export type Content =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; data: string; width: number; height: number; caption?: string }
  | { kind: 'voice'; data: string; seconds: number }
  | { kind: 'call'; video: boolean; seconds: number; missed: boolean } // written by calls.ts when a call ends

// Extra things a message can carry.
export type Extras = { replyTo?: ReplyTo; forwarded?: boolean }

// Which chat to send to. `other` is set for direct chats, so a new chat can be created.
// isNew: the chat doesn't exist yet, so this message creates it.
export type Target = { chatId: string; other?: Person; isNew?: boolean }

// Your "read receipts" setting (Settings > Privacy). Home.tsx keeps it up to date.
// Off = the other person doesn't see blue ticks from you, and you don't see theirs.
// (Groups always show them, like WhatsApp.)
export const myPrivacy = { readReceipts: true }

// Two people always get the SAME chat id, no matter who starts it.
export function chatIdFor(a: string, b: string) {
  return [a, b].sort().join('_')
}

export const isGroup = (chat: Chat | undefined) => chat?.type === 'group'
const isDirectId = (chatId: string) => chatId.split('_').length === 2

// Group admins: whoever made it, plus anyone they made admin.
export function isAdmin(chat: Chat | undefined, uid: string) {
  return isGroup(chat) && (chat?.admin === uid || !!chat?.admins?.includes(uid))
}

// The other person in a direct chat.
export function otherPerson(chat: Chat, myUid: string): Person {
  const uid = chat.members.find((m) => m !== myUid) ?? myUid
  return { uid, name: chat.names[uid] ?? '?' }
}

export function chatTitle(chat: Chat, myUid: string) {
  return isGroup(chat) ? (chat.title ?? '') : otherPerson(chat, myUid).name
}

// Look up a PakChat user by phone number or Gmail. Returns null if nobody has it.
export async function findUser(input: string): Promise<Person | null> {
  const { field, value } = contactKey(input)
  const q = query(collection(db, 'users'), where(field, '==', value), limit(1))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const found = snap.docs[0]
  return { uid: found.id, name: found.data().name }
}

// Send one message. A "batch" saves several things together: the message,
// the photo or voice note (if any), and the chat's "last message" for the chat list.
// Either all of them are saved or none are.
export async function sendMessage(me: Person, target: Target, content: Content, extras: Extras = {}) {
  const chatRef = doc(db, 'chats', target.chatId)
  const batch = writeBatch(db)
  const message: Record<string, unknown> = { kind: content.kind, senderId: me.uid, senderName: me.name }
  if (extras.replyTo) message.replyTo = extras.replyTo
  if (extras.forwarded) message.forwarded = true

  if (content.kind === 'text') {
    message.text = content.text
  } else if (content.kind === 'call') {
    Object.assign(message, { video: content.video, seconds: content.seconds, missed: content.missed })
  } else {
    // The photo or voice note goes in its own document(s), so the message list stays small.
    message.mediaId = saveMedia(batch, chatRef, content.data, me.uid)
    if (content.kind === 'photo') {
      Object.assign(message, { width: content.width, height: content.height })
      if (content.caption) message.caption = content.caption
    } else message.seconds = content.seconds
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
  const { kind, senderId, senderName, event, targetName, video, missed } = message
  // The chat list shows a photo's caption as its text.
  const text = message.text ?? message.caption
  const lastMessage = Object.fromEntries(
    Object.entries({ kind, text, senderId, senderName, event, targetName, video, missed }).filter(([, v]) => v !== undefined),
  )
  // Sending a message means you've read the chat, so it isn't "unread" for you.
  const receipts = myPrivacy.readReceipts || !isDirectId(target.chatId)
  const read = receipts ? { readAt: { [me.uid]: serverTimestamp() } } : {}
  if (!receipts) batch.set(doc(db, 'users', me.uid, 'prefs', target.chatId), { readAt: serverTimestamp() }, { merge: true })
  // merge: true = create the chat if it's new, otherwise just update these fields.
  batch.set(
    chatRef,
    { ...chatFields, ...read, lastMessage, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// "Ali added Sara", "You left", ... in the chosen language.
export function systemText(m: { event?: SystemEvent; senderId: string; senderName?: string; targetName?: string }, myUid: string, t: Strings) {
  const name = m.senderId === myUid ? t.you : (m.senderName ?? '')
  const values = { name, other: m.targetName ?? '' }
  const templates: Record<SystemEvent, string> = {
    created: t.created,
    added: t.added,
    left: t.left,
    removed: t.removed,
    joined: t.joined,
    renamed: t.renamed,
    photo: t.changedPhoto,
    description: t.changedDescription,
    onlyAdmins: t.setOnlyAdmins,
    everyone: t.setEveryone,
  }
  return fill(templates[m.event ?? 'left'] ?? '', values)
}

// What a message says, in one short line (for the chat list, replies and alerts).
export function shortText(
  m: { kind?: string; text?: string; caption?: string; deleted?: boolean; senderId: string; video?: boolean; missed?: boolean },
  myUid: string,
  t: Strings,
) {
  if (m.deleted) return m.senderId === myUid ? t.youDeleted : t.wasDeleted
  if (m.kind === 'call') return (m.video ? '📹 ' : '📞 ') + callTitle(m, myUid, t)
  if (m.kind === 'photo') return m.caption || m.text ? `📷 ${m.caption ?? m.text}` : t.photo
  if (m.kind === 'voice') return t.voice
  return m.text ?? ''
}

// "Voice call", "Video call", or (for the person who was called) "Missed voice call".
export function callTitle(m: { senderId: string; video?: boolean; missed?: boolean }, myUid: string, t: Strings) {
  if (m.missed && m.senderId !== myUid) return m.video ? t.missedVideoCall : t.missedVoiceCall
  return m.video ? t.videoCall : t.voiceCall
}

// The grey line under a chat's name in the chat list.
export function previewText(chat: Chat, myUid: string, t: Strings) {
  const last = chat.lastMessage
  if (!last) return ''
  if (last.kind === 'system') return systemText(last, myUid, t)
  const body = shortText(last, myUid, t)
  // In groups, say who sent it: "Ali: salam"
  if (isGroup(chat) && last.senderId !== myUid && last.senderName && !last.deleted) return last.senderName + ': ' + body
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
  // Read receipts off: you don't see blue ticks either (except in groups).
  const canSeeRead = myPrivacy.readReceipts || isGroup(chat)
  if (canSeeRead && everyone(chat?.readAt)) return 'read'
  if (everyone(chat?.deliveredAt) || everyone(chat?.readAt)) return 'delivered'
  return 'sent'
}

// "deliveredAt.<uid>" changes just one person's time inside the map.
export function markDelivered(chatId: string, uid: string) {
  return updateDoc(doc(db, 'chats', chatId), { [`deliveredAt.${uid}`]: serverTimestamp() })
}

// You opened the chat. With read receipts on, everyone sees blue ticks.
// With them off, only YOUR private prefs remember it (so the chat stops being "unread").
// clearUnread: you had marked the chat "unread" yourself, so take that off too.
export function markRead(chatId: string, uid: string, clearUnread = false) {
  const batch = writeBatch(db)
  const receipts = myPrivacy.readReceipts || !isDirectId(chatId)
  batch.update(doc(db, 'chats', chatId), {
    ...(receipts ? { [`readAt.${uid}`]: serverTimestamp() } : {}),
    [`deliveredAt.${uid}`]: serverTimestamp(), // read means delivered too
  })
  if (!receipts || clearUnread) {
    batch.set(doc(db, 'users', uid, 'prefs', chatId), { readAt: serverTimestamp(), unread: false }, { merge: true })
  }
  return batch.commit()
}

// When did I last read this chat? (The later of the shared time and my private one.)
export function lastRead(chat: Chat, myUid: string, prefs?: ChatPrefs) {
  return Math.max(chat.readAt?.[myUid]?.toMillis() ?? 0, prefs?.readAt?.toMillis() ?? 0)
}

// Unread = you marked it unread, or the last message is from someone else and you haven't opened the chat since.
export function isUnread(chat: Chat, myUid: string, prefs?: ChatPrefs) {
  if (prefs?.unread) return true
  const last = chat.lastMessage
  if (!last || last.senderId === myUid || !chat.updatedAt) return false
  return lastRead(chat, myUid, prefs) < chat.updatedAt.toMillis()
}
