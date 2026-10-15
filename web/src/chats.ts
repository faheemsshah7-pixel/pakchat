// chats.ts: everything about chats and messages in the database.
//
// How a chat is stored (open Firestore in the Firebase console to see it):
//   chats/<chatId>                  one document per conversation
//     members:     [uidA, uidB]     the two people in it
//     names:       { uidA: 'Ali', uidB: 'Sara' }
//     lastMessage: { text, senderId }   shown in the chat list
//     updatedAt:   time of the last message (newest chats go on top)
//   chats/<chatId>/messages/<id>    one document per message
//     text, senderId, sentAt
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

export type Person = { uid: string; name: string }

export type Chat = {
  id: string
  members: string[]
  names: Record<string, string>
  lastMessage?: { text: string; senderId: string }
  updatedAt?: Timestamp | null
}

export type Message = {
  id: string
  text: string
  senderId: string
  sentAt: Timestamp | null
}

// Two people always get the SAME chat id, no matter who starts it:
// both ids sorted and joined with "_", like "abc123_xyz789".
export function chatIdFor(a: string, b: string) {
  return [a, b].sort().join('_')
}

// Look up a PakChat user by phone number. Returns null if nobody has it.
export async function findUserByPhone(phone: string): Promise<Person | null> {
  const q = query(collection(db, 'users'), where('phone', '==', phone), limit(1))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const found = snap.docs[0]
  return { uid: found.id, name: found.data().name }
}

// Send one message. A "batch" saves two things together:
// the message itself, and the chat's "last message" for the chat list.
// Either both are saved or neither is.
export async function sendMessage(me: Person, other: Person, text: string) {
  const chatId = chatIdFor(me.uid, other.uid)
  const chatRef = doc(db, 'chats', chatId)
  const messageRef = doc(collection(chatRef, 'messages')) // new id, picked by Firestore

  const batch = writeBatch(db)
  batch.set(messageRef, {
    text,
    senderId: me.uid,
    sentAt: serverTimestamp(), // the server's clock, not your laptop's
  })
  // merge: true = create the chat if it's new, otherwise just update these fields.
  batch.set(
    chatRef,
    {
      members: chatId.split('_'),
      names: { [me.uid]: me.name, [other.uid]: other.name },
      lastMessage: { text, senderId: me.uid },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  await batch.commit()
}
