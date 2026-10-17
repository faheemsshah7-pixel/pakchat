// exportChat.ts: "Export chat" (in the chat list's menu), like WhatsApp's "Export chat, without media".
// Every message since you last cleared the chat goes into a text file you can save or share:
//   17/10/2026, 8:52 pm - Ali: Salam!
//   17/10/2026, 8:53 pm - You: Walaikum salam
// Photos, videos, voice notes and other files say "<media not included>" (they'd make it too big).
// Messages you deleted for yourself, and ones that disappeared, are left out.
import { collection, getDocs, limit, orderBy, query, startAfter, where, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore'
import { chatTitle, shortText, systemText, type Chat, type Message } from './chats'
import { isExpired } from './disappearing'
import { db } from './firebase'
import type { ChatPrefs } from './prefs'
import { fill, type Strings } from './strings'

const PAGE = 500
const MOST = 20 * PAGE // (10,000 messages at most, to keep the free plan's reads low)

export async function exportChat(chat: Chat, myUid: string, prefs: ChatPrefs | undefined, t: Strings) {
  const clearedAt = prefs?.clearedAt?.toMillis() ?? 0
  const hidden = new Set(prefs?.hidden ?? [])
  const now = Date.now()
  const lines: string[] = []
  let after: QueryDocumentSnapshot | undefined
  // A page of 500 at a time, oldest first.
  for (let read = 0; read < MOST; read += PAGE) {
    const parts: QueryConstraint[] = [orderBy('sentAt'), limit(PAGE)]
    if (clearedAt) parts.unshift(where('sentAt', '>', new Date(clearedAt)))
    if (after) parts.push(startAfter(after))
    const snap = await getDocs(query(collection(db, 'chats', chat.id, 'messages'), ...parts))
    for (const d of snap.docs) {
      const m = { id: d.id, ...d.data() } as Message
      if (hidden.has(m.id) || isExpired(m, now) || !m.sentAt) continue
      lines.push(line(m, myUid, t))
    }
    if (snap.size < PAGE) break
    after = snap.docs[snap.size - 1]
  }
  const name = fill(t.exportedChat, { name: chatTitle(chat, myUid, t) })
  save(`${name}.txt`, lines.join('\n') + '\n')
}

// One message: "17/10/2026, 8:52 pm - Ali: Salam!" (a grey note like "Ali added Sara" has no name)
function line(m: Message, myUid: string, t: Strings) {
  const at = m.sentAt!.toDate()
  const when = `${at.toLocaleDateString('en-GB')}, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`
  if (m.kind === 'system') return `${when} - ${systemText(m, myUid, t)}`
  const who = m.senderId === myUid ? t.you : (m.senderName ?? '')
  return `${when} - ${who}: ${words(m, myUid, t)}`
}

// What it said. Media: "<media not included>", and its caption if it had one.
function words(m: Message, myUid: string, t: Strings) {
  if (m.deleted) return shortText(m, myUid, t)
  const media = ['photo', 'video', 'voice', 'sticker', 'gif'].includes(m.kind ?? 'text') && !m.once
  if (media) return [t.mediaOmitted, m.caption].filter(Boolean).join(' ')
  if (m.kind === 'file') return [`${m.fileName ?? ''} ${t.mediaOmitted}`, m.caption].filter(Boolean).join(' ')
  if (m.kind === 'location' && m.lat !== undefined) return `${shortText(m, myUid, t)}: https://maps.google.com/?q=${m.lat},${m.lng}`
  if (m.kind === 'poll') return [shortText(m, myUid, t), ...(m.options ?? []).map((o) => `- ${o}`)].join('\n')
  return shortText(m, myUid, t)
}

// Download it as a file.
function save(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
