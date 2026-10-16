// disappearing.ts: disappearing messages, like WhatsApp's.
// Turn it on for a chat (24 hours, 7 days or 90 days), and every NEW message gets an
// "expireAt" time. When that time comes:
//   1. the app hides the message straight away (on everyone's screen), and
//   2. the next person to open the chat deletes it from the database for good.
//      (The free plan has no server of our own to do it, so the app does it.
//      The security rules let anyone in the chat delete a message once its time is up.)
// In a chat with one person, either of you can change it. In a group, only admins.
import { useEffect, useState } from 'react'
import { collection, getDocs, limit, query, Timestamp, where, writeBatch } from 'firebase/firestore'
import { addMessage, type Chat, type Person } from './chats'
import { db } from './firebase'
import { deleteMedia } from './media'
import type { Strings } from './strings'

const HOUR = 3600
const DAY = 24 * HOUR
// The choices, in seconds. 0 = off. (The same list is in firestore.rules.)
export const TIMER_CHOICES = [DAY, 7 * DAY, 90 * DAY, 0]

// "24 hours", "7 days", "90 days" or "Off"
export function timerLabel(seconds: number, t: Strings) {
  if (!seconds) return t.off
  if (seconds < DAY) return `${Math.round(seconds / HOUR)} ${t.hours}`
  return seconds === DAY ? t.hours24 : `${Math.round(seconds / DAY)} ${t.days}`
}

// Has this message's time run out?
export function isExpired(m: { expireAt?: Timestamp | null }, now = Date.now()) {
  return !!m.expireAt && m.expireAt.toMillis() <= now
}

// Turn disappearing messages on (seconds) or off (0). Everyone sees a grey note about it.
export async function setTimer(me: Person, chat: Chat, seconds: number) {
  const batch = writeBatch(db)
  const note = { kind: 'system', event: 'timer', seconds, senderId: me.uid, senderName: me.name }
  addMessage(batch, { chatId: chat.id }, note, me, { timer: seconds })
  await batch.commit()
}

// Delete this chat's messages whose time is up (and their photos, videos, voice notes and documents).
// One message at a time, so if someone else is deleting the same ones, we don't get in each other's way.
export async function deleteExpired(chatId: string) {
  const due = query(collection(db, 'chats', chatId, 'messages'), where('expireAt', '<=', Timestamp.now()), limit(50))
  const snap = await getDocs(due)
  for (const message of snap.docs) {
    const batch = writeBatch(db)
    batch.delete(message.ref)
    try {
      for (const field of ['mediaId', 'posterId']) {
        const mediaId = message.get(field) as string | undefined
        if (mediaId) await deleteMedia(batch, chatId, mediaId)
      }
      await batch.commit()
    } catch (err) {
      console.warn('Could not delete an old message yet:', err) // someone else got there first
    }
  }
}

// The time now, moved on when the next of these times comes (milliseconds).
// So a disappearing message vanishes from the screen right on time, without the
// screen having to check every second.
export function useClockAt(times: number[]) {
  const [now, setNow] = useState(() => Date.now())
  const next = Math.min(...times.filter((at) => at > now))
  useEffect(() => {
    if (!Number.isFinite(next)) return
    // (Browsers can't wait more than about 24 days, so check again every few hours.)
    const wait = Math.min(next - Date.now(), 6 * 3600_000) + 50
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, wait))
    return () => clearTimeout(timer)
  }, [next])
  return now
}
