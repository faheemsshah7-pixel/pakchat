// profiles.ts: other people's profiles (name, about line, photo), and changing your own.
//
// Profiles change rarely, so each one is loaded ONCE and kept in memory, instead of
// listening to it live. That keeps the number of database reads (and the bill) low.
// Profile photos live in avatars/<uid>, apart from the profile, so the profile stays small.
// users/<uid>.photo says which version of the photo is current (a time), so we know
// when a photo changed and the old copy in memory is out of date.
import { useEffect, useSyncExternalStore } from 'react'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

export type Profile = {
  name: string
  phone?: string | null // set if they logged in by SMS
  email?: string | null // set if they logged in with Google
  about?: string
  photo?: number // version of their profile photo (none = no photo)
  hideLastSeen?: boolean
  readReceipts?: boolean
  lastSeen?: Timestamp | null
}

// ---------- A tiny "store": a Map, plus a list of screens to tell when it changes ----------
const profiles = new Map<string, Profile>()
const avatars = new Map<string, string | null>() // "uid:version" -> photo (or null = none)
const asked = new Set<string>() // what we already started loading
const listeners = new Set<() => void>()

function changed() {
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Put a profile we already have (for example from a live listener) into memory.
export function rememberProfile(uid: string, profile: Profile) {
  profiles.set(uid, profile)
  changed()
}

// Someone's profile, or undefined while it loads.
export function useProfile(uid: string | undefined) {
  const profile = useSyncExternalStore(subscribe, () => (uid ? profiles.get(uid) : undefined))
  useEffect(() => {
    if (!uid || asked.has(uid)) return
    asked.add(uid)
    getDoc(doc(db, 'users', uid))
      .then((snap) => snap.exists() && rememberProfile(uid, snap.data() as Profile))
      .catch(console.error)
  }, [uid])
  return profile
}

// Someone's profile photo, or null if they have none (or it's still loading).
export function useAvatar(uid: string | undefined, version: number | undefined) {
  const key = `${uid}:${version}`
  const photo = useSyncExternalStore(subscribe, () => (uid && version ? (avatars.get(key) ?? null) : null))
  useEffect(() => {
    if (!uid || !version || asked.has(key)) return
    asked.add(key)
    getDoc(doc(db, 'avatars', uid))
      .then((snap) => {
        avatars.set(key, (snap.get('data') as string | undefined) ?? null)
        changed()
      })
      .catch(console.error)
  }, [uid, version, key])
  return photo
}

// ---------- Changing your own profile ----------

// Save a new profile photo (already shrunk by shrinkAvatar in media.ts).
export async function setMyPhoto(uid: string, data: string) {
  const version = Date.now()
  avatars.set(`${uid}:${version}`, data) // show it straight away
  await setDoc(doc(db, 'avatars', uid), { data })
  await updateDoc(doc(db, 'users', uid), { photo: version })
}

export async function removeMyPhoto(uid: string) {
  await updateDoc(doc(db, 'users', uid), { photo: deleteField() })
  await deleteDoc(doc(db, 'avatars', uid))
}

export function setAbout(uid: string, about: string) {
  return updateDoc(doc(db, 'users', uid), { about })
}

// A new name goes in your profile AND in every chat you're in (chats keep a copy of names).
export async function setMyName(uid: string, name: string) {
  await updateDoc(doc(db, 'users', uid), { name })
  const chats = await getDocs(query(collection(db, 'chats'), where('members', 'array-contains', uid)))
  // A batch can hold 500 changes, so do them 400 at a time.
  for (let i = 0; i < chats.docs.length; i += 400) {
    const batch = writeBatch(db)
    chats.docs.slice(i, i + 400).forEach((chat) => batch.update(chat.ref, { [`names.${uid}`]: name }))
    await batch.commit()
  }
}

// Privacy settings. Hiding "last seen" also deletes the last one we saved.
export function setPrivacy(uid: string, fields: { hideLastSeen?: boolean; readReceipts?: boolean }) {
  return updateDoc(doc(db, 'users', uid), {
    ...fields,
    ...(fields.hideLastSeen ? { lastSeen: deleteField() } : {}),
  })
}
