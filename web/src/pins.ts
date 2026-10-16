// pins.ts: pinned messages, like WhatsApp's. A pinned message shows in a bar at the top of
// the chat, for everyone in it. Up to 3 at a time: pinning a 4th takes the oldest pin off.
// Each pin lasts 24 hours, 7 days or 30 days, then it goes by itself.
//
// They're saved in the chat document, as a small copy of each message:
//   chats/<chatId>.pins = { messageId: { senderId, senderName, kind, text, at, until } }
// so the bar can show a pinned message even if it's too old to be loaded.
import { deleteField, doc, updateDoc, writeBatch } from 'firebase/firestore'
import { addMessage, type Chat, type Message, type Person, type Pin } from './chats'
import { db } from './firebase'

export const MAX_PINS = 3
const DAY = 24 * 3600_000
export const PIN_CHOICES = [DAY, 7 * DAY, 30 * DAY] // how long a pin lasts, in milliseconds

// The pins still going, newest first.
export function activePins(chat: Chat | undefined, now = Date.now()) {
  return Object.entries(chat?.pins ?? {})
    .filter(([, pin]) => pin.until > now)
    .map(([id, pin]) => ({ id, ...pin }))
    .sort((a, b) => b.at - a.at)
}

// Pin a message for everyone, and add a grey note: "Ali pinned a message".
export async function pinMessage(me: Person, chat: Chat, m: Message, lasts: number) {
  const now = Date.now()
  // A disappearing message's pin goes when the message does.
  const until = Math.min(now + lasts, m.expireAt?.toMillis() ?? Infinity)
  const pin: Pin = {
    senderId: m.senderId,
    senderName: m.senderName ?? '',
    kind: m.kind ?? 'text',
    text: (m.text ?? m.caption ?? '').slice(0, 200),
    at: now,
    until,
  }
  const pins: Record<string, unknown> = { [m.id]: pin }
  // Take off pins that ran out, and the oldest ones if there would be more than 3.
  const keep = activePins(chat, now).filter((p) => p.id !== m.id)
  for (const old of Object.keys(chat.pins ?? {})) {
    if (old !== m.id && !keep.slice(0, MAX_PINS - 1).some((p) => p.id === old)) pins[old] = deleteField()
  }
  const batch = writeBatch(db)
  const note = { kind: 'system', event: 'pinned', senderId: me.uid, senderName: me.name }
  addMessage(batch, { chatId: chat.id }, note, me, { pins })
  await batch.commit()
}

export function unpinMessage(chatId: string, messageId: string) {
  return updateDoc(doc(db, 'chats', chatId), { [`pins.${messageId}`]: deleteField() })
}
