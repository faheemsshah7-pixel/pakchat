// shared.ts: what's been shared in a chat, for "Media, links and docs" (MediaPage.tsx), like WhatsApp's.
//   Media   photos, videos and GIFs
//   Links   messages with a web address in them
//   Docs    documents
// It asks the database for just those messages, newest first, a page at a time (more as you scroll),
// so it finds them all, not only the ones the chat has loaded.
//
// Links: a message with a web address in it says so (link: true, chats.ts), so they can be found the
// same way. Messages sent before that (Batch 10) don't say so; the ones the chat has loaded are added.
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type { Message } from './chats'
import { isExpired } from './disappearing'
import { db } from './firebase'
import { firstLink } from './links'

export type SharedTab = 'media' | 'links' | 'docs'
export const PAGE = 48 // messages per page

// One page of a tab's messages. `after`: the last one of the page before.
export async function loadShared(chatId: string, tab: SharedTab, clearedAt: number, after?: QueryDocumentSnapshot) {
  const which: Record<SharedTab, QueryConstraint> = {
    media: where('kind', 'in', ['photo', 'video', 'gif']),
    links: where('link', '==', true),
    docs: where('kind', '==', 'file'),
  }
  const parts = [which[tab], orderBy('sentAt', 'desc'), limit(PAGE)]
  if (clearedAt) parts.splice(1, 0, where('sentAt', '>', new Date(clearedAt))) // after "Clear chat", only newer ones
  if (after) parts.push(startAfter(after))
  const snap = await getDocs(query(collection(db, 'chats', chatId, 'messages'), ...parts))
  return {
    messages: snap.docs.map((d) => ({ id: d.id, ...d.data(), pending: false }) as Message),
    last: snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot | undefined,
    more: snap.size === PAGE,
  }
}

// Is it shown in this tab? Not deleted (for everyone, or by you), not gone (disappearing),
// and not "view once" or round video messages (like the info panel, MediaGrid.tsx).
export function belongs(m: Message, tab: SharedTab, hidden: string[] | undefined, now: number) {
  if (m.deleted || m.once || m.round || hidden?.includes(m.id) || isExpired(m, now)) return false
  if (tab === 'media') return m.kind === 'gif' ? !!m.gif : (m.kind === 'photo' || m.kind === 'video') && !!m.mediaId
  if (tab === 'docs') return m.kind === 'file' && !!m.mediaId
  return !!linkIn(m)
}

// The web address in a message (its words, or a photo's caption).
export function linkIn(m: Message) {
  return firstLink(m.text ?? m.caption ?? '')
}

// Photos and videos you can look at full screen, one after another (MediaViewer.tsx).
export const viewable = (m: Message) => (m.kind === 'photo' || m.kind === 'video') && !!m.mediaId && !m.once && !m.round && !m.deleted

// Newest first, in months: "This month", "September", "August 2025".
export function byMonth(list: Message[], locale: string[], thisMonth: string) {
  const now = new Date()
  const groups: { label: string; items: Message[] }[] = []
  for (const m of list) {
    const d = m.sentAt?.toDate() ?? now
    const label =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
        ? thisMonth
        : d.toLocaleDateString(locale, d.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(m)
    else groups.push({ label, items: [m] })
  }
  return groups
}
