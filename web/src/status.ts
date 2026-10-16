// status.ts: status updates, like WhatsApp's. Words on a colour, a photo, or a short video,
// that the people you chat with can see for 24 hours.
//
//   statuses/<id>             { owner, ownerName, kind, text, bg, font, mediaId, posterId, width,
//                               height, seconds, caption, thumb, postedAt, audience }
//   statuses/<id>/media/...   its photo or video, in parts like a chat's (media.ts)
//   statuses/<id>/views/<uid> who saw it: { name, at, liked }
//
// "audience" is everyone who may see it. It's worked out when you post, from the people you
// chat with and your status privacy (Settings > Privacy > Status), and the rules let nobody
// else read it. "thumb" is a tiny copy of the photo, for the cards in the Status list.
// After 24 hours a status is hidden, and your own app deletes it the next time you open PakChat.
import { useSyncExternalStore } from 'react'
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { isDirect, otherPerson, type Chat, type Person } from './chats'
import { deleteParts, saveParts } from './media'
import { isHidden, type ChatPrefs } from './prefs'
import { setPrivate, type StatusPrefs } from './private'

const DAY = 24 * 3600_000
export const MAX_STATUS_TEXT = 700
export const MAX_STATUS_VIDEO = 60 // seconds, like WhatsApp
export const PHOTO_SECONDS = 6 // how long a photo shows before the next one

// The backgrounds for words-only statuses, and the letters ("fonts").
export const STATUS_COLOURS = [
  '#128c7e',
  'linear-gradient(135deg, #01411c, #1fae5b)',
  '#7e57c2',
  '#ef5350',
  '#f4a72a',
  '#5c6bc0',
  '#ec407a',
  'linear-gradient(135deg, #f97316, #db2777)',
  '#26a69a',
  '#8d6e63',
  '#546e7a',
  'linear-gradient(135deg, #2563eb, #7c3aed)',
]
const URDU = "'Noto Nastaliq Urdu'"
export const STATUS_FONTS = [
  `'Inter', system-ui, ${URDU}, sans-serif`,
  `Georgia, 'Times New Roman', ${URDU}, serif`,
  `'Brush Script MT', 'Segoe Script', 'Snell Roundhand', ${URDU}, cursive`,
  `'Courier New', ui-monospace, ${URDU}, monospace`,
  `Impact, 'Arial Narrow', 'Haettenschweiler', ${URDU}, sans-serif`,
]

// Bigger letters for fewer words (in the viewer and while you write one).
export const statusTextSize = (text = '') => (text.length < 40 ? 38 : text.length < 100 ? 30 : text.length < 250 ? 24 : 19)

export type Status = {
  id: string
  owner: string
  ownerName: string
  kind: 'text' | 'photo' | 'video'
  text?: string
  bg?: number
  font?: number
  mediaId?: string
  posterId?: string
  width?: number
  height?: number
  seconds?: number
  caption?: string
  thumb?: string
  postedAt: Timestamp | null
  audience?: string[]
  pending?: boolean // (yours, still on its way to the database: nobody can have seen it yet)
}

export type StatusView = { uid: string; name: string; at: Timestamp | null; liked?: boolean }

// One person's statuses, oldest first, for the list and the viewer.
export type StatusGroup = { owner: Person; items: Status[]; unseen: number }

// Still within its 24 hours? (A status you just posted has no server time yet: it's new.)
export const isLive = (s: Status, now = Date.now()) => (s.postedAt?.toMillis() ?? now) > now - DAY

// Where its photo or video parts are kept (media.ts).
export const statusPlace = (id: string) => `statuses/${id}`

// ---------- Posting ----------

// Who can see a status you post now: the people you chat with one to one (not just groups),
// minus anyone you blocked, then your privacy setting.
export function audienceFor(myUid: string, chats: Chat[], prefs: Map<string, ChatPrefs>, blocked: Set<string>, privacy: StatusPrefs) {
  if (privacy.mode === 'only') return (privacy.only ?? []).filter((uid) => !blocked.has(uid)).slice(0, 1000)
  const contacts = new Set<string>()
  for (const chat of chats) {
    if (!isDirect(chat) || isHidden(chat, prefs.get(chat.id))) continue
    const other = otherPerson(chat, myUid).uid
    if (other !== myUid && !blocked.has(other)) contacts.add(other)
  }
  if (privacy.mode === 'except') for (const uid of privacy.except ?? []) contacts.delete(uid)
  return [...contacts].slice(0, 1000)
}

export type NewStatus =
  | { kind: 'text'; text: string; bg: number; font: number }
  | { kind: 'photo'; data: string; width: number; height: number; thumb: string; caption?: string }
  | { kind: 'video'; data: string; poster: string; width: number; height: number; seconds: number; thumb: string; caption?: string }

// Post a status: the status, and its photo or video, saved together (all or nothing).
export async function postStatus(me: Person, content: NewStatus, audience: string[]) {
  const ref = doc(collection(db, 'statuses')) // a new random id
  const batch = writeBatch(db)
  const fields: Record<string, unknown> = { owner: me.uid, ownerName: me.name, kind: content.kind, postedAt: serverTimestamp(), audience }
  if (content.kind === 'text') {
    Object.assign(fields, { text: content.text, bg: content.bg, font: content.font })
  } else {
    const owner = { owner: me.uid }
    fields.mediaId = saveParts(batch, ref, content.data, owner)
    Object.assign(fields, { width: content.width, height: content.height, thumb: content.thumb })
    if (content.kind === 'video') {
      fields.posterId = saveParts(batch, ref, content.poster, owner)
      fields.seconds = Math.min(MAX_STATUS_VIDEO, Math.round(content.seconds))
    }
    if (content.caption) fields.caption = content.caption
  }
  batch.set(ref, fields)
  await batch.commit()
}

// A tiny copy of a picture (a data URL), about 4 KB, for the cards in the Status list.
export async function makeThumb(picture: string) {
  const image = new Image()
  image.src = picture
  await image.decode()
  const scale = Math.min(1, 200 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.6)
}

// Delete one of your statuses: its photo or video, who saw it, and the status itself.
export async function deleteStatus(s: Status) {
  const batch = writeBatch(db)
  const place = statusPlace(s.id)
  if (s.mediaId) await deleteParts(batch, place, s.mediaId)
  if (s.posterId) await deleteParts(batch, place, s.posterId)
  const views = await getDocs(collection(db, 'statuses', s.id, 'views'))
  views.forEach((view) => batch.delete(view.ref))
  batch.delete(doc(db, 'statuses', s.id))
  await batch.commit()
}

// ---------- Listening ----------

const toStatus = (d: { id: string; data: (o: { serverTimestamps: 'estimate' }) => unknown }) =>
  ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as object) }) as Status

// Other people's statuses that you may see, from the last 24 hours, kept up to date live.
// Right after a deploy, Firebase may still be building this list's index ("failed-precondition"):
// then we try again every minute, so Status starts working without a reload.
export function listenToStatuses(uid: string, onList: (list: Status[]) => void) {
  let stop = () => {}
  let retry = 0
  const start = () => {
    const since = Timestamp.fromMillis(Date.now() - DAY)
    const q = query(collection(db, 'statuses'), where('audience', 'array-contains', uid), where('postedAt', '>', since))
    stop = onSnapshot(
      q,
      (snap) => onList(snap.docs.map(toStatus)),
      (err) => {
        console.warn('No statuses:', err.code)
        if (err.code === 'failed-precondition') retry = window.setTimeout(start, 60_000)
      },
    )
  }
  start()
  return () => {
    clearTimeout(retry)
    stop()
  }
}

// Your own statuses, kept up to date live. Ones older than 24 hours are deleted.
export function listenToMine(uid: string, onList: (list: Status[]) => void) {
  const tidied = new Set<string>()
  return onSnapshot(
    query(collection(db, 'statuses'), where('owner', '==', uid)),
    { includeMetadataChanges: true }, // (so we hear when a new one has reached the database)
    (snap) => {
      const all = snap.docs.map((d) => ({ ...toStatus(d), pending: d.metadata.hasPendingWrites }))
      onList(all.filter((s) => isLive(s)))
      for (const s of all) {
        if (isLive(s) || tidied.has(s.id)) continue
        tidied.add(s.id)
        deleteStatus(s).catch(console.warn)
      }
    },
    (err) => console.warn('No statuses of mine:', err.code),
  )
}

// Group statuses by person: newest updates first. Muted people are left out (they're listed apart).
export function groupStatuses(list: Status[], seen: Set<string>, now = Date.now()): StatusGroup[] {
  const groups = new Map<string, StatusGroup>()
  for (const s of list) {
    if (!isLive(s, now)) continue
    const group = groups.get(s.owner) ?? { owner: { uid: s.owner, name: s.ownerName }, items: [], unseen: 0 }
    group.items.push(s)
    if (!seen.has(s.id)) group.unseen++
    groups.set(s.owner, group)
  }
  const time = (s: Status) => s.postedAt?.toMillis() ?? now
  for (const group of groups.values()) group.items.sort((a, b) => time(a) - time(b))
  return [...groups.values()].sort((a, b) => time(b.items[b.items.length - 1]) - time(a.items[a.items.length - 1]))
}

// ---------- Seen and liked ----------
// Which statuses you've seen and liked, remembered on this device (so the green ring turns grey).

type Marks = { seen: Set<string>; liked: Set<string> }
let marks: Marks = loadMarks()
const listeners = new Set<() => void>()

function loadMarks(): Marks {
  try {
    const saved = JSON.parse(localStorage.getItem('statusMarks') ?? '{}')
    return { seen: new Set(saved.seen ?? []), liked: new Set(saved.liked ?? []) }
  } catch {
    return { seen: new Set(), liked: new Set() } // private windows can block storage
  }
}
function saveMarks(next: Marks) {
  marks = next // a new object, so screens see the change
  try {
    // (Only the last 500 of each: old statuses are gone anyway.)
    localStorage.setItem('statusMarks', JSON.stringify({ seen: [...next.seen].slice(-500), liked: [...next.liked].slice(-500) }))
  } catch {
    // not saved, but still works until you close the tab
  }
  listeners.forEach((listener) => listener())
}

export function useStatusMarks() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => marks,
  )
}

// You looked at someone's status: it's seen, and they can see you saw it.
export function markSeen(me: Person, s: Status) {
  if (s.owner === me.uid || marks.seen.has(s.id)) return
  saveMarks({ ...marks, seen: new Set(marks.seen).add(s.id) })
  setDoc(doc(db, 'statuses', s.id, 'views', me.uid), { name: me.name, at: serverTimestamp() }, { merge: true }).catch(console.warn)
}

// The ♥ on someone's status. They see it next to your name in "Viewed by".
export function likeStatus(me: Person, s: Status, liked: boolean) {
  const next = new Set(marks.liked)
  if (liked) next.add(s.id)
  else next.delete(s.id)
  saveMarks({ ...marks, liked: next })
  return setDoc(doc(db, 'statuses', s.id, 'views', me.uid), { name: me.name, at: serverTimestamp(), liked }, { merge: true })
}

// ---------- Who saw yours ----------

export function listenToViews(statusId: string, onList: (views: StatusView[]) => void) {
  return onSnapshot(
    collection(db, 'statuses', statusId, 'views'),
    (snap) => {
      const views = snap.docs.map((d) => ({ uid: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as StatusView)
      views.sort((a, b) => (b.at?.toMillis() ?? 0) - (a.at?.toMillis() ?? 0))
      onList(views)
    },
    (err) => console.warn('No views:', err.code),
  )
}

// Just how many (one cheap read, for the list of your statuses).
export async function countViews(statusId: string) {
  return (await getCountFromServer(collection(db, 'statuses', statusId, 'views'))).data().count
}

// Mute or unmute someone's status updates (they go to "Muted updates", and don't light up the tab).
export function muteStatus(myUid: string, theirUid: string, mute: boolean) {
  return setPrivate(myUid, 'status', { muted: mute ? arrayUnion(theirUid) : arrayRemove(theirUid) })
}
