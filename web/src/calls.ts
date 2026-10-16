// calls.ts: voice and video calls between two people, like WhatsApp.
//
// The sound and picture go STRAIGHT between the two browsers (a browser feature called WebRTC),
// so a call costs almost nothing on Firebase. Firestore is only the "telephone exchange":
//   calls/<id> = { chatId, from, fromName, to, toName, video, state, offer, answer, startedAt, answeredAt, endedAt }
//
// How a call goes:
//   1. Asad presses Call. His browser writes the call with state 'ringing' and an "offer":
//      a description of his connection (what sound and video it can send, and how to reach it).
//   2. Bushra's app is always listening for calls to her (listenForCalls), so it rings.
//   3. She presses Accept. Her browser writes an "answer" (her connection details): state 'accepted'.
//   4. The two browsers connect to each other and the call starts.
//   5. Either of them hangs up: state 'ended', and the connection details are wiped.
//   During the call, either of them can share their screen (rtc.ts).
//   Asad's app then writes the call into their chat: "Voice call 2:13", or "Missed voice call".
// Other endings: 'declined' (she said no), 'busy' (she's on another call),
// 'cancelled' (Asad gave up), 'missed' (nobody answered in 45 seconds).
import { useSyncExternalStore } from 'react'
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { chatIdFor, sendMessage, type Person } from './chats'
import {
  addPictureSlot,
  busyWhen,
  canShareScreen,
  describe,
  gathered,
  getMedia,
  getScreen,
  ICE_SERVERS,
  limitVideo,
  onACall,
  pictureSender,
  quality,
  sideChannel,
  stopTracks,
  takePictureSlot,
  type Signals,
} from './rtc'
import { startRinging } from './sound'

const RING_SECONDS = 45 // then it's a missed call
const CONNECT_SECONDS = 20 // accepted, but still not connected after this long: give up

export type CallEnd = 'ended' | 'declined' | 'busy' | 'noAnswer' | 'failed' | 'micBlocked' | 'cantCall'

// The call on screen right now (there's only ever one).
export type Call = {
  id: string
  chatId: string
  me: Person
  peer: Person // the other person
  video: boolean
  outgoing: boolean // true = I called them
  phase: 'calling' | 'ringing' | 'incoming' | 'connecting' | 'connected' | 'ended'
  connectedAt: number | null
  micOff: boolean
  cameraOff: boolean
  local: MediaStream | null // my microphone (and camera)
  remote: MediaStream | null // their sound (and picture)
  end: CallEnd | null // why it ended, shown for a moment before the screen closes
  canShare: boolean // I can share my screen (a computer, and their PakChat is new enough)
  screen: MediaStream | null // my screen, while I share it
  theirs: Signals // what the other side said: sharing their screen, camera off, microphone off
}

// A record from calls/<id>, for the Calls list.
export type CallRecord = {
  id: string
  from: string
  fromName: string
  to: string
  toName: string
  video: boolean
  state: 'ringing' | 'accepted' | 'declined' | 'busy' | 'cancelled' | 'missed' | 'ended'
  startedAt: Timestamp | null
  answeredAt?: Timestamp | null
  endedAt?: Timestamp | null
}

// ---------- The call on screen: a tiny store that screens can watch (useCall) ----------

let current: Call | null = null
const listeners = new Set<() => void>()

function show(changes: Partial<Call> | null) {
  current = changes && current ? { ...current, ...changes } : null
  listeners.forEach((listener) => listener())
}

export function useCall() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

// ---------- The parts of a call that aren't drawn on screen ----------

type Live = {
  ref: ReturnType<typeof doc>
  pc: RTCPeerConnection | null
  offer?: RTCSessionDescriptionInit // an incoming call's offer, until you answer
  state: CallRecord['state'] | 'new' // the call document's state, as far as we know
  accepted: boolean
  unwatch: () => void
  stopSound: () => void
  timers: number[]
  signal: (signals: Signals) => void // tell the other side (rtc.ts)
}
let live: Live | null = null
busyWhen(() => !!current && current.phase !== 'ended')

type Fresh = 'connectedAt' | 'micOff' | 'cameraOff' | 'local' | 'remote' | 'end' | 'canShare' | 'screen' | 'theirs'
function begin(call: Omit<Call, Fresh>, ref: Live['ref']) {
  const theirs = { sharing: false, cameraOff: false, micOff: false }
  current = { ...call, connectedAt: null, micOff: false, cameraOff: false, local: null, remote: null, end: null, canShare: false, screen: null, theirs }
  live = { ref, pc: null, state: 'new', accepted: false, unwatch: () => {}, stopSound: () => {}, timers: [], signal: () => {} }
  listeners.forEach((listener) => listener())
  return live
}

// ---------- Calling someone ----------

export async function startCall(me: Person, peer: Person, video: boolean) {
  if (onACall()) return // already in a call
  const ref = doc(collection(db, 'calls'))
  const session = begin({ id: ref.id, chatId: chatIdFor(me.uid, peer.uid), me, peer, video, outgoing: true, phase: 'calling' }, ref)
  try {
    const local = await getMedia(video)
    if (live !== session) return stopTracks(local) // you hung up while the browser was asking
    show({ local })
    const pc = connect(session, local)
    addPictureSlot(pc, local) // (for sharing your screen in a voice call)
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    if (live !== session) return
    await setDoc(ref, {
      chatId: current!.chatId,
      from: me.uid,
      fromName: me.name,
      to: peer.uid,
      toName: peer.name,
      video,
      state: 'ringing',
      offer: describe(pc, quality(false)),
      startedAt: serverTimestamp(),
    })
    if (live !== session) return
    session.state = 'ringing'
    show({ phase: 'ringing' })
    session.stopSound = startRinging('outgoing')
    session.timers.push(window.setTimeout(() => hangUp('noAnswer'), RING_SECONDS * 1000))
    session.unwatch = onSnapshot(ref, (snap) => {
      const data = snap.data()
      if (!data || live !== session) return
      session.state = data.state
      if (data.state === 'accepted' && data.answer && pc.signalingState === 'have-local-offer') {
        session.accepted = true
        session.stopSound()
        show({ phase: 'connecting' })
        session.timers.forEach(clearTimeout) // no more "no answer" timer
        watchConnecting(session)
        pc.setRemoteDescription(data.answer).catch((err) => {
          console.error(err)
          hangUp('failed')
        })
      } else if (data.state === 'declined') finish('declined')
      else if (data.state === 'busy') finish('busy')
      else if (data.state === 'missed') finish('noAnswer')
      else if (data.state === 'ended') finish('ended') // they hung up
    })
  } catch (err) {
    giveUp(err)
  }
}

// ---------- Being called ----------

// Home.tsx runs this while you're logged in. onRing: show an alert (if PakChat isn't on screen).
export function listenForCalls(me: Person, onRing: (call: Call) => void) {
  const q = query(collection(db, 'calls'), where('to', '==', me.uid), where('state', '==', 'ringing'))
  return onSnapshot(
    q,
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue
        const data = change.doc.data({ serverTimestamps: 'estimate' })
        const age = Date.now() - ((data.startedAt as Timestamp | null)?.toMillis() ?? 0)
        // Still "ringing" after 2 minutes: the caller's app closed before it gave up. Tidy it away.
        if (age > 120_000) {
          updateDoc(change.doc.ref, { state: 'missed', endedAt: serverTimestamp(), offer: deleteField() }).catch(console.error)
          continue
        }
        // Already on a call (this kind or a group call): tell them you're busy.
        if (onACall()) {
          if (current?.id !== change.doc.id) updateDoc(change.doc.ref, { state: 'busy', endedAt: serverTimestamp(), offer: deleteField() }).catch(console.error)
          continue
        }
        const peer = { uid: data.from as string, name: data.fromName as string }
        const session = begin({ id: change.doc.id, chatId: data.chatId, me, peer, video: !!data.video, outgoing: false, phase: 'incoming' }, change.doc.ref)
        session.offer = data.offer
        session.state = 'ringing'
        session.stopSound = startRinging('incoming')
        session.unwatch = onSnapshot(change.doc.ref, (callSnap) => {
          const now = callSnap.data()
          if (!now || live !== session) return
          session.state = now.state
          if (now.state === 'ringing') return
          if (current?.phase === 'incoming') finish(null) // they gave up, or you answered on another device
          else if (now.state !== 'accepted') finish('ended') // they hung up
        })
        onRing(current!)
      }
    },
    (err) => console.warn('Not listening for calls:', err.code),
  )
}

export async function acceptCall() {
  const session = live
  const call = current
  if (!session || !call || call.phase !== 'incoming' || !session.offer) return
  session.stopSound()
  show({ phase: 'connecting' })
  try {
    const local = await getMedia(call.video)
    if (live !== session) return stopTracks(local)
    show({ local })
    const pc = connect(session, local)
    await pc.setRemoteDescription(session.offer)
    takePictureSlot(pc, local)
    await pc.setLocalDescription(await pc.createAnswer())
    await gathered(pc)
    if (live !== session) return
    await updateDoc(session.ref, { state: 'accepted', answer: describe(pc, quality(false)), answeredAt: serverTimestamp() })
    session.state = 'accepted'
    session.accepted = true
    watchConnecting(session)
  } catch (err) {
    giveUp(err)
  }
}

export function declineCall() {
  hangUp(null)
}

// ---------- During a call ----------

export function toggleMic() {
  if (!current) return
  const micOff = !current.micOff
  current.local?.getAudioTracks().forEach((track) => (track.enabled = !micOff))
  show({ micOff })
  tellThem()
}

export function toggleCamera() {
  if (!current) return
  const cameraOff = !current.cameraOff
  current.local?.getVideoTracks().forEach((track) => (track.enabled = !cameraOff)) // they'd see black, so they show your photo
  show({ cameraOff })
  tellThem()
}

// Share your screen, or stop. Your screen takes the place of your camera; stopping puts it back.
// (The browser's own "Stop sharing" button works too.)
export async function toggleShare() {
  const session = live
  const sender = session?.pc && pictureSender(session.pc)
  if (!session || !sender || !current) return
  if (current.screen) return stopSharing()
  try {
    const track = await getScreen()
    if (live !== session) return track.stop() // the call ended while you were picking a screen
    await sender.replaceTrack(track)
    track.addEventListener('ended', stopSharing)
    show({ screen: new MediaStream([track]) })
    tellThem()
  } catch (err) {
    // You pressed Cancel: nothing to do. Anything else: say so in the console.
    if ((err as Error).name !== 'NotAllowedError') console.error(err)
  }
}

function stopSharing() {
  const sender = live?.pc && pictureSender(live.pc)
  if (!current?.screen) return
  stopTracks(current.screen)
  sender?.replaceTrack(current.local?.getVideoTracks()[0] ?? null).catch(console.error)
  show({ screen: null })
  tellThem()
}

// (No camera at all counts as "camera off", so they show your photo.)
function tellThem() {
  if (!current) return
  const cameraOff = current.cameraOff || !current.local?.getVideoTracks().length
  live?.signal({ sharing: !!current.screen, cameraOff, micOff: current.micOff })
}

// Hang up (or decline, or give up). end: what to show for a moment ("Call ended", "No answer"...).
export function hangUp(end: CallEnd | null = 'ended') {
  const session = live
  if (!session) return show(null)
  // Tell the other side, and wipe the connection details (they include your internet address).
  const ended = { endedAt: serverTimestamp(), offer: deleteField() }
  const outgoing = current?.outgoing
  if (session.state === 'accepted') updateDoc(session.ref, { ...ended, state: 'ended', answer: deleteField() }).catch(console.error)
  else if (session.state === 'ringing') {
    const state = outgoing ? (end === 'noAnswer' ? 'missed' : 'cancelled') : 'declined'
    updateDoc(session.ref, { ...ended, state }).catch(console.error)
  }
  finish(end)
}

// Close everything down. The caller's app writes the call into the chat.
function finish(end: CallEnd | null) {
  const session = live
  const call = current
  if (!session || !call) return
  live = null
  session.timers.forEach(clearTimeout)
  session.stopSound()
  session.unwatch()
  session.pc?.close()
  stopTracks(call.local)
  stopTracks(call.screen)
  if (call.outgoing && session.state !== 'new') logCall(call, session.accepted).catch(console.error)
  if (!end) return show(null)
  show({ phase: 'ended', end, local: null, remote: null, screen: null })
  // Show "Call ended" (or why it ended) for a moment, then close the call screen.
  setTimeout(() => current?.id === call.id && current.phase === 'ended' && show(null), end === 'ended' ? 2000 : 5000)
}

// The Close button on "Call ended" (or "No answer"...), for when you don't want to wait.
export function closeCallScreen() {
  if (current?.phase === 'ended') show(null)
}

// "Voice call 2:13" or "Missed voice call", in the chat. Written by the caller only, so it's there once.
async function logCall(call: Call, accepted: boolean) {
  const seconds = call.connectedAt ? Math.round((Date.now() - call.connectedAt) / 1000) : 0
  const chat = await getDoc(doc(db, 'chats', call.chatId))
  await sendMessage(call.me, { chatId: call.chatId, other: call.peer, isNew: !chat.exists() }, { kind: 'call', video: call.video, seconds, missed: !accepted })
}

// Leaving the page during a call: try to tell the other side.
window.addEventListener('pagehide', () => {
  if (live) hangUp(null)
})

// ---------- The Calls list ----------

// Your last calls, made and received, newest first.
export async function recentCalls(uid: string) {
  const mine = (field: 'from' | 'to') =>
    getDocs(query(collection(db, 'calls'), where(field, '==', uid), orderBy('startedAt', 'desc'), limit(40)))
  const [made, received] = await Promise.all([mine('from'), mine('to')])
  return [...made.docs, ...received.docs]
    .map((d) => ({ id: d.id, ...d.data() }) as CallRecord)
    .sort((a, b) => (b.startedAt?.toMillis() ?? 0) - (a.startedAt?.toMillis() ?? 0))
    .slice(0, 50)
}

// ---------- The connection itself (WebRTC) ----------

function connect(session: Live, local: MediaStream) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  session.pc = pc
  if (import.meta.env.DEV) Object.assign(window, { pakchatCall: pc }) // (only while testing: lets tests measure the sound)
  local.getTracks().forEach((track) => pc.addTrack(track, local))
  pc.ontrack = (e) => live === session && show({ remote: e.streams[0] })
  session.signal = sideChannel(pc, (theirs) => live === session && show({ theirs }))
  pc.onconnectionstatechange = () => {
    if (live !== session) return
    if (pc.connectionState === 'connected' && !current?.connectedAt) {
      show({ phase: 'connected', connectedAt: Date.now(), canShare: canShareScreen && !!pictureSender(pc) })
      tellThem()
      limitVideo(pc, quality(false)).catch(console.error)
    } else if (pc.connectionState === 'failed') hangUp('failed')
    else if (pc.connectionState === 'disconnected') {
      // A short drop (a train tunnel, Wi-Fi to mobile data) often comes back by itself. Wait a bit.
      session.timers.push(window.setTimeout(() => live === session && pc.connectionState !== 'connected' && hangUp('failed'), 10_000))
    }
  }
  return pc
}

function watchConnecting(session: Live) {
  session.timers.push(window.setTimeout(() => live === session && current?.phase === 'connecting' && hangUp('failed'), CONNECT_SECONDS * 1000))
}

// A call couldn't start: say why, in words the call screen can show.
function giveUp(err: unknown) {
  const { name, code } = (err ?? {}) as { name?: string; code?: string }
  if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError') return hangUp('micBlocked')
  if (code === 'permission-denied') return hangUp('cantCall') // they blocked you, or you blocked them
  console.error(err)
  hangUp('failed')
}
