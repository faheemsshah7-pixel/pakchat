// private.ts: a few things only YOU can see, kept in users/<you>/private/<name>, so they
// follow you to any device (the rules let nobody else read them):
//   calls   { favourites, seenAt }          your favourite people to call, and when you last
//                                            looked at your calls (for the red count of missed ones)
//   status  { mode, except, only, muted }   who can see your status, and whose status you muted
import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc, type Timestamp } from 'firebase/firestore'
import type { Person } from './chats'
import { db } from './firebase'

export type CallPrefs = { favourites?: Person[]; seenAt?: Timestamp | null }

// Status privacy: everyone you chat with ("contacts"), all of them except some, or only some.
export type StatusMode = 'contacts' | 'except' | 'only'
export type StatusPrefs = { mode?: StatusMode; except?: string[]; only?: string[]; muted?: string[] }

type Names = { calls: CallPrefs; status: StatusPrefs }

// One of your private documents, kept up to date live. {} until it loads (or if it's new).
export function usePrivate<N extends keyof Names>(uid: string, name: N): Names[N] {
  const [data, setData] = useState<Names[N]>({})
  useEffect(() => {
    return onSnapshot(
      doc(db, 'users', uid, 'private', name),
      // 'estimate': a time you JUST set shows straight away, before the server confirms it.
      (snap) => setData((snap.data({ serverTimestamps: 'estimate' }) ?? {}) as Names[N]),
      (err) => console.warn(`No ${name} settings:`, err.code),
    )
  }, [uid, name])
  return data
}

// Change some of it. (merge: keep the parts you didn't mention.)
export function setPrivate(uid: string, name: keyof Names, fields: Record<string, unknown>) {
  return setDoc(doc(db, 'users', uid, 'private', name), fields, { merge: true })
}
