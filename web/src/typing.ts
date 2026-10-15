// typing.ts: "typing…".
//
// Each person has their own little document per chat: chats/<chatId>/typing/<their uid>
//   members: who is in the chat (so the rules know who may see it)
//   at:      when they last pressed a key
// It used to be a field on the chat itself, but then every key press (every 3 seconds) was
// a change to the same document your messages and ticks change. Firestore handles about
// one change per second per document, so in a busy chat messages had to wait their turn.
// Now typing has documents of its own, and messages never wait for it.
//
// Home.tsx starts ONE listener for every chat you're in (a "collection group" query: all the
// typing documents, in all chats, that list you). Screens read it with useTypingVersion().
import { useSyncExternalStore } from 'react'
import { collectionGroup, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore'
import { isGroup, type Chat, type Times } from './chats'
import { db } from './firebase'
import { fill, type Strings } from './strings'

const typing = new Map<string, Times>() // chatId -> { uid: when they last pressed a key }
const listeners = new Set<() => void>()
let version = 0

export function listenForTyping(myUid: string) {
  // Only documents changed in the last hour, so opening the app doesn't load old ones.
  // (An hour, not a few seconds, in case this device's clock is a little wrong.)
  const recent = query(
    collectionGroup(db, 'typing'),
    where('members', 'array-contains', myUid),
    where('at', '>', Timestamp.fromMillis(Date.now() - 3600_000)),
  )
  return onSnapshot(
    recent,
    (snap) => {
      let fromOthers = false
      for (const change of snap.docChanges()) {
        const chatId = change.doc.ref.parent.parent!.id
        const at = change.doc.get('at', { serverTimestamps: 'estimate' }) as Timestamp | null
        typing.set(chatId, { ...typing.get(chatId), [change.doc.id]: at })
        if (change.doc.id !== myUid) fromOthers = true
      }
      if (!fromOthers) return // just your own key presses: nothing on screen changes
      version++
      listeners.forEach((listener) => listener())
    },
    // (Right after the first deploy, Firestore needs a few minutes to build this query's index.)
    (err) => console.warn('Not listening for typing:', err.code),
  )
}

// Screens that show "typing…" call this, so they re-draw when someone starts typing.
export function useTypingVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}

// You pressed a key. (ChatRoom.tsx calls this at most every 3 seconds.)
export function markTyping(chat: Chat, myUid: string) {
  return setDoc(doc(db, 'chats', chat.id, 'typing', myUid), { members: chat.members, at: serverTimestamp() })
}

// Who is typing right now? (pressed a key in the last 6 seconds, and hasn't sent it yet)
export function whoIsTyping(chat: Chat | undefined, myUid: string, now: number) {
  if (!chat) return []
  const last = chat.lastMessage
  return Object.entries(typing.get(chat.id) ?? {})
    .filter(([uid, at]) => {
      if (uid === myUid || !at || now - at.toMillis() >= 6000) return false
      // Their message arrived after their last key press: they sent it, so they're done typing.
      const sentSince = last?.senderId === uid && (chat.updatedAt?.toMillis() ?? 0) >= at.toMillis()
      return !sentSince
    })
    .map(([uid]) => uid)
}

export function typingText(chat: Chat | undefined, myUid: string, now: number, t: Strings) {
  const who = whoIsTyping(chat, myUid, now)
  if (who.length === 0 || !chat) return ''
  return isGroup(chat) ? fill(t.nameTyping, { name: chat.names[who[0]] ?? '' }) : t.typing
}
