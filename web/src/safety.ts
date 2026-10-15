// safety.ts: blocking and reporting.
//
// Blocking: users/<you>/blocked/<their uid>. The security rules check this list,
// so someone you blocked can't send you messages, even with a hacked app.
// Reporting: a document in reports/. Only you can create it, and nobody can read
// it from the app. You read reports in the Firebase console (Firestore > reports).
import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from './firebase'

export function block(myUid: string, theirUid: string) {
  return setDoc(doc(db, 'users', myUid, 'blocked', theirUid), { at: serverTimestamp() })
}

export function unblock(myUid: string, theirUid: string) {
  return deleteDoc(doc(db, 'users', myUid, 'blocked', theirUid))
}

// The set of people I blocked, kept up to date live.
export function useBlocked(myUid: string) {
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  useEffect(() => {
    return onSnapshot(collection(db, 'users', myUid, 'blocked'), (snap) => {
      setBlocked(new Set(snap.docs.map((d) => d.id)))
    })
  }, [myUid])
  return blocked
}

// Sends a report with the last 5 messages (like WhatsApp), so someone can check it.
export async function report(myUid: string, chatId: string, reportedUid: string | null) {
  const last = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('sentAt'), limitToLast(5)))
  const messages = last.docs.map((d) => {
    const m = d.data()
    return { senderId: m.senderId, kind: m.kind ?? 'text', text: m.text ?? '' }
  })
  await addDoc(collection(db, 'reports'), {
    reporterId: myUid,
    reportedId: reportedUid,
    chatId,
    messages,
    createdAt: serverTimestamp(),
  })
}
