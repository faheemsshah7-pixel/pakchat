// callExtras.ts: the extras on the Calls tab, around the calls themselves (calls.ts):
//   - favourites: people you call a lot, at the top of the tab (saved in private.ts)
//   - missed calls: the red number on the Calls button, since you last looked
//   - call links: a link that calls you, like https://pakchat-f89d8.web.app/call/k3J9x...
//     Send it to someone, and when they open it and press Call, your phone rings.
//       callLinks/<code> = { owner, ownerName, video, createdAt }
//   - scheduled calls: a call planned for later. A card goes in your chat with them, and when
//     the time comes, PakChat reminds you both (if it's open).
//       scheduledCalls/<id> = { by, byName, to, toName, members, title, startsAt, video, chatId, messageId }
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import type { CallRecord } from './calls'
import { chatIdFor, sendMessage, type Person } from './chats'
import { newCode } from './invites'
import { setPrivate, type CallPrefs } from './private'
import type { Strings } from './strings'

// ---------- Favourites ----------

export const MAX_FAVOURITES = 20

export function addFavourite(myUid: string, prefs: CallPrefs, person: Person) {
  const others = (prefs.favourites ?? []).filter((p) => p.uid !== person.uid)
  return setPrivate(myUid, 'calls', { favourites: [...others, { uid: person.uid, name: person.name }].slice(-MAX_FAVOURITES) })
}

export function removeFavourite(myUid: string, prefs: CallPrefs, uid: string) {
  return setPrivate(myUid, 'calls', { favourites: (prefs.favourites ?? []).filter((p) => p.uid !== uid) })
}

// ---------- Missed calls ----------

// A call to you that nobody answered (missed, declined, or they gave up while it rang).
export function isMissed(call: Pick<CallRecord, 'state'>) {
  return !['ringing', 'accepted', 'ended'].includes(call.state)
}

// How many calls you missed since `since`, kept up to date live. (Only new calls are read.)
export function listenForMissed(uid: string, since: Timestamp, onCount: (n: number) => void) {
  const q = query(collection(db, 'calls'), where('to', '==', uid), where('startedAt', '>', since), orderBy('startedAt', 'desc'), limit(99))
  return onSnapshot(
    q,
    (snap) => onCount(snap.docs.filter((d) => isMissed(d.data() as CallRecord)).length),
    (err) => console.warn('Not counting missed calls:', err.code),
  )
}

// You opened the Calls tab: the count starts again from now.
export function markCallsSeen(uid: string) {
  return setPrivate(uid, 'calls', { seenAt: serverTimestamp() })
}

// ---------- The Recent list ----------

// Calls in a row with the same person, the same way (made, received, missed), on the same day.
export type CallGroup = { key: string; peer: Person; outgoing: boolean; missed: boolean; video: boolean; calls: CallRecord[] }

export function directionText(c: { outgoing: boolean; missed: boolean }, t: Strings) {
  return c.missed ? t.missed : c.outgoing ? t.outgoing : t.incoming
}

// Calls (newest first) in groups: the same person, the same way, the same day.
export function groupCalls(calls: CallRecord[], myUid: string): CallGroup[] {
  const groups: CallGroup[] = []
  for (const call of calls) {
    const outgoing = call.from === myUid
    const peer = outgoing ? { uid: call.to, name: call.toName } : { uid: call.from, name: call.fromName }
    const missed = !outgoing && isMissed(call)
    const day = call.startedAt?.toDate().toDateString()
    const last = groups[groups.length - 1]
    const lastDay = last?.calls[0].startedAt?.toDate().toDateString()
    if (last && last.peer.uid === peer.uid && last.outgoing === outgoing && last.missed === missed && lastDay === day) {
      last.calls.push(call)
      last.video ||= call.video
    } else groups.push({ key: call.id, peer, outgoing, missed, video: call.video, calls: [call] })
  }
  return groups
}

// ---------- Call links ----------

export type CallLink = { code: string; owner: Person; video: boolean; createdAt?: Timestamp | null }

export function callLinkAddress(code: string) {
  return `${location.origin}/call/${code}`
}

export async function makeCallLink(me: Person, video: boolean) {
  const code = newCode()
  await setDoc(doc(db, 'callLinks', code), { owner: me.uid, ownerName: me.name, video, createdAt: serverTimestamp() })
  return code
}

export async function myCallLinks(uid: string): Promise<CallLink[]> {
  const snap = await getDocs(query(collection(db, 'callLinks'), where('owner', '==', uid)))
  return snap.docs
    .map((d) => ({ code: d.id, owner: { uid, name: d.get('ownerName') }, video: !!d.get('video'), createdAt: d.get('createdAt') }))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
}

export function deleteCallLink(code: string) {
  return deleteDoc(doc(db, 'callLinks', code))
}

// What's behind a call link? null = it doesn't work (wrong, or deleted).
export async function lookupCallLink(code: string): Promise<CallLink | null> {
  const snap = await getDoc(doc(db, 'callLinks', code))
  if (!snap.exists()) return null
  return { code, owner: { uid: snap.get('owner'), name: snap.get('ownerName') }, video: !!snap.get('video') }
}

// The code from a link like /call/<code>, if the page was opened with one.
export function callCodeFromAddress() {
  const match = location.pathname.match(/^\/call\/([A-Za-z0-9]{16,})/)
  return match?.[1] ?? null
}

// ---------- Scheduled calls ----------

export type ScheduledCall = {
  id: string
  by: string
  byName: string
  to: string
  toName: string
  members: string[]
  title: string
  startsAt: Timestamp
  video: boolean
  chatId: string
  messageId: string
}

// The other person in a scheduled call.
export function scheduledWith(plan: ScheduledCall, myUid: string): Person {
  return plan.by === myUid ? { uid: plan.to, name: plan.toName } : { uid: plan.by, name: plan.byName }
}

// Plan a call: a card in your chat with them, and the plan itself (for the Calls tab and the reminder).
export async function scheduleCall(me: Person, other: Person, title: string, startsAt: Date, video: boolean, chatExists: boolean) {
  const planRef = doc(collection(db, 'scheduledCalls')) // a new random id
  const chatId = chatIdFor(me.uid, other.uid)
  const messageId = await sendMessage(me, { chatId, other, isNew: !chatExists }, { kind: 'scheduledCall', title, startsAt, video, callId: planRef.id })
  await setDoc(planRef, {
    by: me.uid,
    byName: me.name,
    to: other.uid,
    toName: other.name,
    members: [me.uid, other.uid],
    title,
    startsAt: Timestamp.fromDate(startsAt),
    video,
    chatId,
    messageId,
  })
}

// Call it off: it leaves the Calls tab, and the card in the chat says "Cancelled".
export async function cancelScheduledCall(plan: Pick<ScheduledCall, 'id' | 'chatId' | 'messageId'>) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'scheduledCalls', plan.id))
  batch.update(doc(db, 'chats', plan.chatId, 'messages', plan.messageId), { cancelled: true })
  await batch.commit()
}

// Your scheduled calls (made by you or with you), soonest first, kept up to date live.
export function listenForScheduled(uid: string, onList: (plans: ScheduledCall[]) => void) {
  const q = query(collection(db, 'scheduledCalls'), where('members', 'array-contains', uid))
  return onSnapshot(
    q,
    (snap) => {
      const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ScheduledCall).filter((p) => p.startsAt)
      plans.sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis())
      onList(plans)
      // Tidy away plans more than a day old.
      for (const plan of plans) {
        if (plan.startsAt.toMillis() < Date.now() - 25 * 3600_000) deleteDoc(doc(db, 'scheduledCalls', plan.id)).catch(console.warn)
      }
    },
    (err) => console.warn('No scheduled calls:', err.code),
  )
}

// Is a scheduled call coming up (or just started), so it belongs on the Calls tab?
export function isUpcoming(plan: ScheduledCall, now = Date.now()) {
  return plan.startsAt.toMillis() > now - 60 * 60_000 // (it stays an hour after it starts)
}
