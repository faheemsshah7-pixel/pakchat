// prefs.ts: YOUR settings for each chat: pinned, muted, archived, marked unread, cleared,
// its notification sound, and the messages you starred.
// Saved in users/<you>/prefs/<chatId>. They're private: the rules only let you see your own,
// so the other person never knows you muted or archived them.
import { useEffect, useState } from 'react'
import { arrayRemove, arrayUnion, collection, doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore'
import type { Chat } from './chats'
import { db } from './firebase'
import type { Tone } from './sound'

export type ChatPrefs = {
  pinnedAt?: number | null // when you pinned it (pinned chats stay on top). null = not pinned
  mutedUntil?: number | null // no alerts or sounds until this time. null = not muted
  archived?: boolean // hidden in "Archived"
  unread?: boolean // you marked it unread
  readAt?: Timestamp | null // when you last read it (used when read receipts are off)
  clearedAt?: Timestamp | null // "Clear chat": messages before this are hidden for you
  deletedAt?: Timestamp | null // "Delete chat": hidden from your list until a new message comes
  hidden?: string[] // messages you deleted just for yourself
  starred?: string[] // messages you starred (only you see your stars)
  tone?: Tone | null // this chat's own notification sound (sound.ts). null = the usual one
}

export const MAX_PINNED = 3
export const MUTE_ALWAYS = Number.MAX_SAFE_INTEGER
export const HOUR = 3600_000

// All your chat prefs, kept up to date live. chatId -> prefs
export function usePrefs(uid: string) {
  const [prefs, setPrefsState] = useState<Map<string, ChatPrefs>>(new Map())
  useEffect(() => {
    return onSnapshot(collection(db, 'users', uid, 'prefs'), (snap) => {
      // 'estimate': a time you JUST set shows straight away, before the server confirms it.
      setPrefsState(new Map(snap.docs.map((d) => [d.id, d.data({ serverTimestamps: 'estimate' }) as ChatPrefs])))
    })
  }, [uid])
  return prefs
}

// Change some of your prefs for one chat. (merge: keep the ones you didn't mention.)
export function setPrefs(uid: string, chatId: string, fields: Record<string, unknown>) {
  return setDoc(doc(db, 'users', uid, 'prefs', chatId), fields, { merge: true })
}

export function isMuted(prefs: ChatPrefs | undefined, now = Date.now()) {
  return (prefs?.mutedUntil ?? 0) > now
}

// A chat you deleted stays hidden until someone sends a new message.
export function isHidden(chat: Chat, prefs?: ChatPrefs) {
  const deleted = prefs?.deletedAt?.toMillis()
  return !!deleted && (chat.updatedAt?.toMillis() ?? 0) <= deleted
}

// "Clear chat": hide every message so far (just for you).
export function clearChat(uid: string, chatId: string) {
  return setPrefs(uid, chatId, { clearedAt: serverTimestamp(), readAt: serverTimestamp(), unread: false })
}

// "Delete chat": clear it AND take it off your list until someone sends a new message.
export function deleteChat(uid: string, chatId: string) {
  return setPrefs(uid, chatId, {
    clearedAt: serverTimestamp(),
    deletedAt: serverTimestamp(),
    readAt: serverTimestamp(),
    unread: false,
    pinnedAt: null,
    archived: false,
  })
}

// "Delete for me": hide one message, just for you.
export function hideMessage(uid: string, chatId: string, messageId: string) {
  return setPrefs(uid, chatId, { hidden: arrayUnion(messageId) })
}

// Star a message, or take its star off. Starred messages are easy to find again
// (in the chat's info, or "Starred messages" in the chat list's menu). Only you see your stars.
export function starMessage(uid: string, chatId: string, messageId: string, on: boolean) {
  return setPrefs(uid, chatId, { starred: on ? arrayUnion(messageId) : arrayRemove(messageId) })
}
