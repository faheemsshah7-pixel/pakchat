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
//   Any chat can also have:
//     pins:  { messageId: a small copy of the message }   pinned messages, up to 3 (see pins.ts)
//     timer: seconds before new messages disappear (0 = off) (see disappearing.ts)
//   chats/<chatId>/messages/<id>    one document per message
//     kind: 'text' | 'photo' | 'video' | 'voice' | 'file' | 'location' | 'contact' | 'poll' | 'sticker' | 'call' | 'system',
//     senderId, sentAt, and the content
//     replyTo:   a small copy of the message it answers
//     mentions:  [uid, ...] the people it @mentions (groups)
//     reactions: { uidA: '👍' }
//     votes:     { uidA: [0, 2] } polls: which answers each person picked (see polls.ts)
//     editedAt, deleted, forwarded
//     expireAt:  when it disappears (only in chats with disappearing messages on)
//   chats/<chatId>/media/<id>       the photo, video, voice note or document itself (see media.ts)
//   chats/<chatId>/typing/<uid>     when each person last pressed a key (see typing.ts)
//
// Direct chat ids are the two people's ids sorted and joined: "uidA_uidB".
// "Message yourself" is a direct chat with you twice: "uidA_uidA".
// Group chat ids are random, picked by Firestore.
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { isExpired, timerLabel } from './disappearing'
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
  | 'pinned' // "Ali pinned a message"
  | 'timer' // "Ali turned on disappearing messages" (seconds says for how long, 0 = turned off)

export type LastMessage = {
  kind?: Message['kind']
  text?: string
  video?: boolean // calls
  missed?: boolean
  senderId: string
  senderName?: string
  event?: SystemEvent
  targetName?: string
  seconds?: number
  deleted?: boolean
  expireAt?: Timestamp | null
  fileName?: string
  live?: boolean
  mentions?: string[] // who it @mentions, so the chat list can show "@"
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
  pins?: Record<string, Pin>
  timer?: number
}

// A pinned message: a small copy of it, so the bar at the top can show it even when it isn't loaded.
// at = when it was pinned, until = when the pin runs out (both in milliseconds).
export type Pin = { senderId: string; senderName: string; kind: string; text: string; at: number; until: number }

// A small copy of the message you're answering, so the reply can show it.
// from: "Reply privately" answers a group's message in a chat with its sender; this is the group's name.
export type ReplyTo = { id: string; senderId: string; senderName: string; kind: string; text: string; from?: string }

// A contact card someone shared: a PakChat user (uid), or anyone with a phone number.
export type SharedContact = { name: string; uid?: string; phone?: string; email?: string }

export type Message = {
  id: string
  kind?: 'text' | 'photo' | 'video' | 'voice' | 'file' | 'location' | 'contact' | 'poll' | 'sticker' | 'call' | 'scheduledCall' | 'system' // step 2 messages have no kind: they're text
  text?: string
  senderId: string
  senderName?: string
  sentAt: Timestamp | null
  pending: boolean // true = still on its way to the server
  fresh?: boolean // arrived while the chat was open, so it slides in (not saved, just for the screen)
  mediaId?: string
  posterId?: string // videos: the picture shown before it plays
  width?: number // photos and videos
  height?: number
  caption?: string
  seconds?: number // voice notes, videos, and how long a call lasted
  fileName?: string // documents
  fileSize?: number // (bytes)
  mime?: string // what kind of file, like "application/pdf"
  lat?: number // locations
  lng?: number
  accuracy?: number // (metres)
  live?: boolean // live location: it moves until liveUntil
  liveUntil?: Timestamp | null
  movedAt?: Timestamp | null // when a live location last moved
  contact?: SharedContact
  options?: string[] // polls: the answers (the question is in text)
  multi?: boolean // polls: people may pick more than one answer
  votes?: Record<string, number[]> // polls: { uid: [answer numbers] }
  sticker?: string // stickers that come with PakChat, like "pk:salam" (stickers you make have a mediaId)
  mentions?: string[] // the people it @mentions
  video?: boolean // calls: a video call (or else a voice call)
  missed?: boolean // calls: nobody picked up
  startsAt?: Timestamp | null // a scheduled call: when (its name is in text)
  callId?: string // a scheduled call: its scheduledCalls/<id> (callExtras.ts)
  cancelled?: boolean // a scheduled call that was called off
  event?: SystemEvent // system messages: "Ali added Sara"
  targetName?: string
  replyTo?: ReplyTo
  forwarded?: boolean
  reactions?: Record<string, string>
  editedAt?: Timestamp | null
  deleted?: boolean
  expireAt?: Timestamp | null // disappearing messages: when it goes
}

// What you can send. Photos, videos, voice notes and documents arrive as text ("data URLs"), see media.ts.
export type Content =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; data: string; width: number; height: number; caption?: string }
  | { kind: 'video'; data: string; poster: string; width: number; height: number; seconds: number; caption?: string }
  | { kind: 'voice'; data: string; seconds: number }
  | { kind: 'file'; data: string; fileName: string; fileSize: number; mime: string; caption?: string }
  | { kind: 'location'; lat: number; lng: number; accuracy: number; liveMinutes?: number } // see location.ts
  | { kind: 'contact'; contact: SharedContact }
  | { kind: 'poll'; question: string; options: string[]; multi: boolean } // polls.ts
  | { kind: 'sticker'; sticker?: string; data?: string } // a PakChat sticker by name, or one you made (a picture)
  | { kind: 'call'; video: boolean; seconds: number; missed: boolean } // written by calls.ts when a call ends
  | { kind: 'scheduledCall'; title: string; startsAt: Date; video: boolean; callId: string } // callExtras.ts

// Extra things a message can carry.
export type Extras = { replyTo?: ReplyTo; forwarded?: boolean; mentions?: string[] }

// Which chat to send to. `other` is set for direct chats, so a new chat can be created.
// isNew: the chat doesn't exist yet, so this message creates it.
// timer: the chat has disappearing messages on, so the message goes after this many seconds.
export type Target = { chatId: string; other?: Person; isNew?: boolean; timer?: number }

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

// "Message yourself": a chat where both members are you. For notes, links and photos you want to keep.
export const isSelfChat = (chat: Chat | undefined) => !!chat && !isGroup(chat) && chat.members.length > 0 && chat.members.every((m) => m === chat.members[0])

// Group admins: whoever made it, plus anyone they made admin.
export function isAdmin(chat: Chat | undefined, uid: string) {
  return isGroup(chat) && (chat?.admin === uid || !!chat?.admins?.includes(uid))
}

// The other person in a direct chat.
export function otherPerson(chat: Chat, myUid: string): Person {
  const uid = chat.members.find((m) => m !== myUid) ?? myUid
  return { uid, name: chat.names[uid] ?? '?' }
}

export function chatTitle(chat: Chat, myUid: string, t?: Strings) {
  if (isGroup(chat)) return chat.title ?? ''
  const name = otherPerson(chat, myUid).name
  return t && isSelfChat(chat) ? fill(t.youName, { name }) : name // "Sheharyar (You)"
}

// Everyone you know: the people in your chats and groups, A to Z. (Not you: "Message yourself" has its own row.)
// direct: you have a chat with just them (not only a group together).
export function peopleYouKnow(chats: Chat[], myUid: string): (Person & { direct: boolean })[] {
  const people = new Map<string, Person & { direct: boolean }>()
  for (const chat of chats) {
    for (const uid of chat.members) {
      if (uid === myUid) continue
      const known = people.get(uid)
      const direct = !isGroup(chat) || !!known?.direct
      people.set(uid, { uid, name: (!isGroup(chat) && chat.names[uid]) || known?.name || chat.names[uid] || '?', direct })
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
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
// the photo, video, voice note or document (if any), and the chat's "last message" for the chat list.
// Either all of them are saved or none are. Returns the new message's id.
export async function sendMessage(me: Person, target: Target, content: Content, extras: Extras = {}) {
  const chatRef = doc(db, 'chats', target.chatId)
  const batch = writeBatch(db)
  const message: Record<string, unknown> = { kind: content.kind, senderId: me.uid, senderName: me.name }
  if (extras.replyTo) message.replyTo = extras.replyTo
  if (extras.forwarded) message.forwarded = true
  if (extras.mentions?.length) message.mentions = extras.mentions
  // Disappearing messages: it says when it goes. (Your clock, which is close enough.)
  const expireAt = target.timer && content.kind !== 'call' ? Timestamp.fromMillis(Date.now() + target.timer * 1000) : undefined
  if (expireAt) message.expireAt = expireAt

  if (content.kind === 'text') {
    message.text = content.text
  } else if (content.kind === 'call') {
    Object.assign(message, { video: content.video, seconds: content.seconds, missed: content.missed })
  } else if (content.kind === 'location') {
    Object.assign(message, { lat: content.lat, lng: content.lng, accuracy: Math.round(content.accuracy) })
    if (content.liveMinutes) Object.assign(message, { live: true, liveUntil: Timestamp.fromMillis(Date.now() + content.liveMinutes * 60_000) })
  } else if (content.kind === 'contact') {
    message.contact = content.contact
  } else if (content.kind === 'scheduledCall') {
    Object.assign(message, { text: content.title, startsAt: Timestamp.fromDate(content.startsAt), video: content.video, callId: content.callId })
  } else if (content.kind === 'poll') {
    Object.assign(message, { text: content.question, options: content.options, multi: content.multi })
  } else if (content.kind === 'sticker' && content.sticker) {
    message.sticker = content.sticker
  } else if (content.kind === 'sticker') {
    message.mediaId = saveMedia(batch, chatRef, content.data ?? '', me.uid, expireAt) // a sticker you made: a small picture
  } else {
    // The photo, video, voice note or document goes in its own document(s), so the message list stays small.
    message.mediaId = saveMedia(batch, chatRef, content.data, me.uid, expireAt)
    if (content.kind === 'photo') {
      Object.assign(message, { width: content.width, height: content.height })
    } else if (content.kind === 'video') {
      message.posterId = saveMedia(batch, chatRef, content.poster, me.uid, expireAt)
      Object.assign(message, { width: content.width, height: content.height, seconds: Math.round(content.seconds) })
    } else if (content.kind === 'file') {
      Object.assign(message, { fileName: content.fileName, fileSize: content.fileSize, mime: content.mime })
    } else message.seconds = content.seconds
    if ('caption' in content && content.caption) message.caption = content.caption
  }

  const id = addMessage(batch, target, message, me, target.other ? directChatFields(me, target.other, !!target.isNew) : {})
  await batch.commit()
  return id
}

function directChatFields(me: Person, other: Person, isNew: boolean) {
  return {
    type: 'direct',
    members: chatIdFor(me.uid, other.uid).split('_'),
    // The rules only let you write your OWN name, except when the chat is brand new.
    names: isNew ? { [me.uid]: me.name, [other.uid]: other.name } : { [me.uid]: me.name },
  }
}

// Adds a message to a batch, and updates the chat's lastMessage to match. Returns the message's id.
// Used for normal messages and for "Ali added Sara" system messages (groups.ts).
export function addMessage(batch: WriteBatch, target: Target, message: Record<string, unknown>, me: Person, chatFields: object) {
  const chatRef = doc(db, 'chats', target.chatId)
  const messageRef = doc(collection(chatRef, 'messages')) // a new random id
  batch.set(messageRef, { ...message, sentAt: serverTimestamp() }) // the server's clock
  const { kind, senderId, senderName, event, targetName, video, missed, expireAt, fileName, live, mentions } = message
  // The chat list shows a photo's caption as its text, and a contact card's name.
  const text = message.text ?? message.caption ?? (message.contact as SharedContact | undefined)?.name
  const seconds = kind === 'system' ? message.seconds : undefined // "turned on disappearing messages for 7 days"
  const lastMessage = Object.fromEntries(
    Object.entries({ kind, text, senderId, senderName, event, targetName, video, missed, seconds, expireAt, fileName, live, mentions }).filter(([, v]) => v !== undefined),
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
  return messageRef.id
}

// "Ali added Sara", "You left", ... in the chosen language.
export function systemText(m: { event?: SystemEvent; senderId: string; senderName?: string; targetName?: string; seconds?: number }, myUid: string, t: Strings) {
  const name = m.senderId === myUid ? t.you : (m.senderName ?? '')
  const values = { name, other: m.targetName ?? '', time: timerLabel(m.seconds ?? 0, t) }
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
    pinned: t.pinnedNote,
    timer: m.seconds ? t.timerOn : t.timerOff,
  }
  return fill(templates[m.event ?? 'left'] ?? '', values)
}

// What a message says, in one short line (for the chat list, replies and alerts).
type Short = {
  kind?: string
  text?: string
  caption?: string
  deleted?: boolean
  senderId: string
  video?: boolean
  missed?: boolean
  fileName?: string
  live?: boolean
  contact?: SharedContact
}
export function shortText(m: Short, myUid: string, t: Strings) {
  if (m.deleted) return m.senderId === myUid ? t.youDeleted : t.wasDeleted
  const words = m.caption ?? m.text
  switch (m.kind) {
    case 'call':
      return (m.video ? '📹 ' : '📞 ') + callTitle(m, myUid, t)
    case 'photo':
      return words ? `📷 ${words}` : t.photo
    case 'video':
      return words ? `🎥 ${words}` : t.videoMessage
    case 'voice':
      return t.voice
    case 'file':
      return `📄 ${m.fileName ?? words ?? ''}`
    case 'location':
      return m.live ? t.liveLocationLabel : t.locationLabel
    case 'contact':
      return `👤 ${m.contact?.name ?? m.text ?? ''}`
    case 'scheduledCall':
      return `📅 ${m.text ?? ''}`
    case 'poll':
      return `📊 ${m.text ?? ''}`
    case 'sticker':
      return t.stickerLabel
    case 'status': // a reply to someone's status (status.ts)
      return `${t.statusWord} · ${words ?? ''}`
  }
  return m.text ?? ''
}

// All the words in a message, for searching: its text, caption, file name or contact's name.
export function searchText(m: Message) {
  return [m.text, m.caption, m.fileName, m.contact?.name, ...(m.options ?? [])].filter(Boolean).join(' ')
}

// "Voice call", "Video call", or (for the person who was called) "Missed voice call".
export function callTitle(m: { senderId: string; video?: boolean; missed?: boolean }, myUid: string, t: Strings) {
  if (m.missed && m.senderId !== myUid) return m.video ? t.missedVideoCall : t.missedVoiceCall
  return m.video ? t.videoCall : t.voiceCall
}

// The grey line under a chat's name in the chat list.
export function previewText(chat: Chat, myUid: string, t: Strings) {
  const last = chat.lastMessage
  if (!last || isExpired(last)) return '' // it disappeared
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
  if (isSelfChat(chat)) return 'read' // you've read your own notes (WhatsApp shows blue ticks too)
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
