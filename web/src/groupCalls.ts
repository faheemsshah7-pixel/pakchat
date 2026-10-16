// groupCalls.ts: voice and video calls with a group, like WhatsApp's (up to 8 people).
//
// As in a one-to-one call (calls.ts), the sound and picture go STRAIGHT between the browsers.
// With more people, every two of them have their own connection (a "mesh"): in a call of 4,
// each browser is connected to the 3 others, and sends its sound and picture to each of them.
// That's why there's a limit of 8: each extra person means sending everything once more.
//
//   groupCalls/<id>
//     chatId, title           the group, and its name
//     by, byName              who started the call
//     video                   a video call (or voice)
//     members                 everyone in the group when it started (they're the ones who can join)
//     names                   { uid: 'Ali' }
//     joined                  { uid: when they joined }   who's in the call right now
//     state                   'active', then 'ended'
//     startedAt, aliveAt, endedAt
//   groupCalls/<id>/links/<from>_<to>   the connection between two of them:
//     from, to, round, offer, answer, answerRound
//
// How it goes:
//   1. Ali presses Call in the group. His app writes the call (with him in "joined"), and a grey
//      note in the chat: "Ali started a voice call".
//   2. Everyone in the group is listening (listenForGroupCalls). In groups of up to 32 people their
//      phones ring; in all groups, the chat shows "Voice call in progress" with a Join button.
//   3. Sara joins: she adds herself to "joined". For every two people in the call, the one whose id
//      comes first (A to Z) writes an "offer" in their link, and the other writes the "answer".
//      Then those two are connected.
//   4. Leaving: you take yourself out of "joined" and delete your links (they include your
//      internet address). The last one to leave ends the call.
// If everyone's app closes suddenly, nobody can say the call ended. So one of the people in it
// says "still on" every 2 minutes (aliveAt); a call that's been quiet for 5 minutes is over.
import { useSyncExternalStore } from 'react'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Timestamp,
} from 'firebase/firestore'
import { addMessage, type Chat, type Person } from './chats'
import { db } from './firebase'
import {
  addPictureSlot,
  busyWhen,
  canShareScreen,
  describe,
  gathered,
  getMedia,
  getScreen,
  iceServers,
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

export const MAX_IN_CALL = 8
const RING_SECONDS = 45
const RING_UP_TO = 32 // bigger groups don't ring (like WhatsApp): they see "call in progress" in the chat
const ALIVE_EVERY = 2 * 60_000 // "still on"
const QUIET_FOR = 5 * 60_000 // then it's over
const CONNECT_SECONDS = 25 // someone in the call we still can't reach after this: stop showing them

// A call in one of your groups, as saved in Firestore.
export type GroupCallDoc = {
  id: string
  chatId: string
  title: string
  by: string
  byName: string
  video: boolean
  members: string[]
  names: Record<string, string>
  joined: Record<string, Timestamp | null>
  state: 'active' | 'ended'
  startedAt: Timestamp | null
  aliveAt?: Timestamp | null
}

// Is it still on? (Not ended, and someone in it said so in the last 5 minutes.)
export function isOn(call: GroupCallDoc, now: number) {
  const said = (call.aliveAt ?? call.startedAt)?.toMillis() ?? now
  return call.state === 'active' && now - said < QUIET_FOR && Object.keys(call.joined).length > 0
}

// Someone else in the call, as you see them.
export type Peer = {
  uid: string
  name: string
  stream: MediaStream | null // their sound and picture
  connected: boolean
  theirs: Signals // sharing their screen, camera off, microphone off
}

export type GroupCallEnd = 'ended' | 'full' | 'failed' | 'micBlocked'

// The group call on screen (there's only ever one).
export type GroupCall = {
  id: string
  chatId: string
  title: string
  video: boolean
  me: Person
  by: Person // who started it
  phase: 'incoming' | 'joining' | 'in' | 'ended'
  joinedAt: number | null // when you joined (for the timer)
  micOff: boolean
  cameraOff: boolean
  local: MediaStream | null // your microphone (and camera)
  screen: MediaStream | null // your screen, while you share it
  canShare: boolean
  peers: Peer[]
  end: GroupCallEnd | null
}

// ---------- The call on screen: a tiny store that screens can watch (useGroupCall) ----------

let current: GroupCall | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function show(changes: Partial<GroupCall> | null) {
  current = changes && current ? { ...current, ...changes } : null
  listeners.forEach((listener) => listener())
}

export function useGroupCall() {
  return useSyncExternalStore(subscribe, () => current)
}
busyWhen(() => !!current && current.phase !== 'ended' && current.phase !== 'incoming')

// ---------- Calls going on in your groups (for "Voice call in progress · Join") ----------

let calls: GroupCallDoc[] = []
const callListeners = new Set<() => void>()
export function useGroupCallIn(chatId: string | undefined) {
  const all = useSyncExternalStore(
    (listener) => {
      callListeners.add(listener)
      return () => callListeners.delete(listener)
    },
    () => calls,
  )
  return chatId ? all.find((c) => c.chatId === chatId) : undefined
}

// ---------- The parts of a call that aren't drawn on screen ----------

// The connection with one other person in the call.
type Link = {
  uid: string
  pc: RTCPeerConnection
  round: string // a new one each time the two of you connect again
  offerer: boolean // I made the offer
  stream: MediaStream | null
  connected: boolean
  theirs: Signals
  signal: (signals: Signals) => void
  timers: number[]
}

type Session = {
  ref: DocumentReference
  links: Map<string, Link> // by their uid
  firstSeen: Map<string, number> // when I first saw each of them in the call (to give up on ones I can't reach)
  doc: GroupCallDoc | null
  servers: RTCIceServer[] // the STUN servers, and the relay if there is one (rtc.ts)
  unwatch: (() => void)[]
  timers: number[]
  stopSound: () => void
}
let live: Session | null = null
const declined = new Set<string>() // calls you said no to (so they don't ring again)

function begin(call: Omit<GroupCall, 'joinedAt' | 'micOff' | 'cameraOff' | 'local' | 'screen' | 'canShare' | 'peers' | 'end'>, ref: DocumentReference) {
  current = { ...call, joinedAt: null, micOff: false, cameraOff: false, local: null, screen: null, canShare: false, peers: [], end: null }
  live = { ref, links: new Map(), firstSeen: new Map(), doc: null, servers: [], unwatch: [], timers: [], stopSound: () => {} }
  if (import.meta.env.DEV) Object.assign(window, { pakchatGroupLinks: live.links }) // (only while testing)
  listeners.forEach((listener) => listener())
  return live
}

const callRef = (id: string) => doc(db, 'groupCalls', id)
const linksOf = (session: Session) => collection(session.ref, 'links')
const linkId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`) // the first one (A to Z) offers
const newRound = () => Math.random().toString(36).slice(2, 10)
const fromDoc = (id: string, data: Record<string, unknown>) => ({ id, ...data }) as GroupCallDoc

// ---------- Starting and joining ----------

// The call buttons in a group: join its call if one is on, or start one.
export async function startGroupCall(me: Person, chat: Chat, video: boolean) {
  if (onACall()) return
  const going = calls.find((c) => c.chatId === chat.id && isOn(c, Date.now()))
  if (going) return joinGroupCall(me, going)
  const ref = doc(collection(db, 'groupCalls'))
  const session = begin({ id: ref.id, chatId: chat.id, title: chat.title ?? '', video, me, by: me, phase: 'joining' }, ref)
  try {
    const local = await getMedia(video, true)
    session.servers = await iceServers()
    if (live !== session) return stopTracks(local)
    show({ local })
    await setDoc(ref, {
      chatId: chat.id,
      title: chat.title ?? '',
      by: me.uid,
      byName: me.name,
      video,
      members: chat.members,
      names: chat.names,
      joined: { [me.uid]: serverTimestamp() },
      state: 'active',
      startedAt: serverTimestamp(),
      aliveAt: serverTimestamp(),
    })
    // "Ali started a voice call", in the group
    const batch = writeBatch(db)
    addMessage(batch, { chatId: chat.id }, { kind: 'system', event: video ? 'videoCall' : 'voiceCall', senderId: me.uid, senderName: me.name }, me, {})
    batch.commit().catch(console.error)
    if (live === session) enter(session)
  } catch (err) {
    giveUp(err)
  }
}

// Join a call that's on (from the Join button, or when it rings).
export async function joinGroupCall(me: Person, call: GroupCallDoc) {
  const ringing = current?.id === call.id && current.phase === 'incoming'
  if (onACall() || (current && !ringing)) return
  let session = live
  if (!ringing || !session) {
    const by = { uid: call.by, name: call.byName }
    session = begin({ id: call.id, chatId: call.chatId, title: call.title, video: call.video, me, by, phase: 'joining' }, callRef(call.id))
  }
  session.stopSound()
  session.timers.forEach(clearTimeout)
  session.unwatch.forEach((stop) => stop())
  session.unwatch = []
  show({ phase: 'joining' })
  try {
    if (Object.keys(call.joined).filter((uid) => uid !== me.uid).length >= MAX_IN_CALL) return finish('full')
    const local = await getMedia(call.video, true)
    session.servers = await iceServers()
    if (live !== session) return stopTracks(local)
    show({ local })
    await updateDoc(session.ref, { [`joined.${me.uid}`]: serverTimestamp() })
    if (live === session) enter(session)
  } catch (err) {
    giveUp(err)
  }
}

// You're in: watch the call and the connections to you, and connect to everyone in it.
function enter(session: Session) {
  const me = current!.me
  show({ phase: 'in', joinedAt: Date.now() })
  session.unwatch.push(
    onSnapshot(session.ref, (snap) => {
      if (live !== session || !snap.exists()) return
      session.doc = fromDoc(snap.id, snap.data({ serverTimestamps: 'estimate' }))
      update(session)
    }),
    // Offers to me (from people whose id comes first)
    onSnapshot(query(linksOf(session), where('to', '==', me.uid)), (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'removed' || live !== session) continue
        answer(session, change.doc.ref, change.doc.data()).catch(console.error)
      }
    }),
    // Answers to my offers
    onSnapshot(query(linksOf(session), where('from', '==', me.uid)), (snap) => {
      for (const change of snap.docChanges()) {
        if (live !== session) return
        const data = change.doc.data()
        const link = session.links.get(data.to)
        if (change.type === 'removed') {
          // They deleted it: they want to connect again (or they left). update() sorts it out.
          if (link?.offerer && !link.connected) drop(session, data.to)
          update(session)
        } else if (link && data.answer && data.answerRound === link.round && link.pc.signalingState === 'have-local-offer') {
          link.pc.setRemoteDescription(data.answer).catch((err) => {
            console.error(err)
            drop(session, link.uid)
          })
        }
      }
    }),
  )
  // Every few seconds: give up on people we can't reach, and now and then say "still on".
  let saidAt = Date.now()
  session.timers.push(
    window.setInterval(() => {
      if (live !== session) return
      update(session)
      const connected = [...session.links.values()].filter((l) => l.connected).map((l) => l.uid)
      // (Only one of the people in the call needs to say it: the first one, A to Z.)
      const leader = [me.uid, ...connected].sort()[0] === me.uid
      if (leader && Date.now() - saidAt > ALIVE_EVERY) {
        saidAt = Date.now()
        updateDoc(session.ref, { [`joined.${me.uid}`]: serverTimestamp(), aliveAt: serverTimestamp() }).catch(console.error)
      }
    }, 5000),
  )
}

// The call changed (someone joined or left), or time passed: connect to newcomers, let go of
// people who left, and redraw the people on screen.
function update(session: Session) {
  const call = session.doc
  const me = current?.me
  if (!call || !me) return
  const others = Object.keys(call.joined).filter((uid) => uid !== me.uid)
  for (const uid of others) {
    if (!session.firstSeen.has(uid)) session.firstSeen.set(uid, Date.now())
    // My id comes first: I make the offer. (Otherwise they will.)
    if (me.uid < uid && !session.links.has(uid)) offer(session, uid).catch(console.error)
  }
  for (const uid of session.links.keys()) if (!others.includes(uid)) drop(session, uid, true)
  for (const uid of session.firstSeen.keys()) if (!others.includes(uid)) session.firstSeen.delete(uid)
  // The people on screen: everyone in the call I'm connected to, or still trying to reach.
  const peers = others
    .filter((uid) => session.links.get(uid)?.connected || Date.now() - (session.firstSeen.get(uid) ?? 0) < CONNECT_SECONDS * 1000)
    .map((uid) => {
      const link = session.links.get(uid)
      const theirs = link?.theirs ?? { sharing: false, cameraOff: !call.video, micOff: false }
      return { uid, name: call.names[uid] ?? '?', stream: link?.stream ?? null, connected: !!link?.connected, theirs }
    })
  const canShare = canShareScreen && [...session.links.values()].some((l) => l.connected && pictureSender(l.pc))
  show({ peers, canShare })
}

// A connection to one person. (offerer: I make the offer; round: which try this is.)
function newLink(session: Session, uid: string, offerer: boolean, round: string) {
  const call = current!
  const local = call.local!
  const pc = new RTCPeerConnection({ iceServers: session.servers })
  const link: Link = { uid, pc, round, offerer, stream: null, connected: false, theirs: { sharing: false, cameraOff: !call.video, micOff: false }, signal: () => {}, timers: [] }
  session.links.get(uid)?.pc.close()
  session.links.set(uid, link)
  local.getTracks().forEach((track) => pc.addTrack(track, local))
  if (offerer) addPictureSlot(pc, local) // (for sharing your screen in a voice call)
  link.signal = sideChannel(pc, (theirs) => {
    link.theirs = theirs
    if (live === session) update(session)
  })
  pc.ontrack = (e) => {
    link.stream = e.streams[0]
    if (live === session) update(session)
  }
  pc.onconnectionstatechange = () => {
    if (live !== session || session.links.get(uid) !== link) return
    if (pc.connectionState === 'connected') {
      link.connected = true
      link.timers.forEach(clearTimeout)
      sendPicture(link)
      tell(link)
      limitVideo(pc, quality(true)).catch(console.error)
      update(session)
    } else if (pc.connectionState === 'failed') lost(session, link)
    else if (pc.connectionState === 'disconnected') {
      // A short drop often comes back by itself. Wait a bit.
      link.timers.push(window.setTimeout(() => session.links.get(uid) === link && pc.connectionState !== 'connected' && lost(session, link), 10_000))
    }
  }
  // Still not connected after a while: start again.
  link.timers.push(window.setTimeout(() => session.links.get(uid) === link && !link.connected && lost(session, link), CONNECT_SECONDS * 1000))
  return link
}

// I make the offer to someone in the call.
async function offer(session: Session, uid: string) {
  const me = current!.me
  const link = newLink(session, uid, true, newRound())
  await link.pc.setLocalDescription(await link.pc.createOffer())
  await gathered(link.pc)
  if (session.links.get(uid) !== link || live !== session) return
  await setDoc(doc(linksOf(session), linkId(me.uid, uid)), { from: me.uid, to: uid, round: link.round, offer: describe(link.pc, quality(true)) })
}

// Someone made me an offer: answer it.
async function answer(session: Session, ref: DocumentReference, data: Record<string, unknown>) {
  const from = data.from as string
  const round = data.round as string
  if (!data.offer || session.links.get(from)?.round === round) return // (already answered)
  const link = newLink(session, from, false, round)
  await link.pc.setRemoteDescription(data.offer as RTCSessionDescriptionInit)
  takePictureSlot(link.pc, current!.local!)
  await link.pc.setLocalDescription(await link.pc.createAnswer())
  await gathered(link.pc)
  if (session.links.get(from) !== link || live !== session) return
  // (answerRound: the rules turn it away if they've made a newer offer since)
  await updateDoc(ref, { answer: describe(link.pc, quality(true)), answerRound: round })
}

// A connection broke, or never worked. Whoever offered tries again (if they're still in the call);
// the other side deletes the link, so the one who offers knows to.
function lost(session: Session, link: Link) {
  const me = current?.me
  if (!me) return
  drop(session, link.uid)
  if (link.offerer) {
    session.timers.push(window.setTimeout(() => live === session && update(session), 2000))
  } else {
    deleteDoc(doc(linksOf(session), linkId(me.uid, link.uid))).catch(() => {})
  }
}

// Stop the connection to someone. (left: they left the call, so their tile goes and the link is tidied.)
function drop(session: Session, uid: string, left = false) {
  const link = session.links.get(uid)
  if (!link) return
  link.timers.forEach(clearTimeout)
  link.pc.close()
  session.links.delete(uid)
  if (left && link.offerer && current) deleteDoc(doc(linksOf(session), linkId(current.me.uid, uid))).catch(() => {})
}

// ---------- Being called ----------

// Home.tsx runs this while you're logged in. It keeps the list of calls going on in your groups,
// and rings for a new one. onRing: show an alert (if PakChat isn't on screen).
export function listenForGroupCalls(me: Person, onRing: (call: GroupCall) => void) {
  const q = query(collection(db, 'groupCalls'), where('members', 'array-contains', me.uid), where('state', '==', 'active'))
  return onSnapshot(
    q,
    (snap) => {
      calls = snap.docs.map((d) => fromDoc(d.id, d.data({ serverTimestamps: 'estimate' })))
      callListeners.forEach((listener) => listener())
      for (const change of snap.docChanges()) {
        const call = fromDoc(change.doc.id, change.doc.data({ serverTimestamps: 'estimate' }))
        const ringingThis = current?.id === call.id && current.phase === 'incoming'
        // It ended, or you joined it on another device: stop ringing.
        if (ringingThis && (change.type === 'removed' || me.uid in call.joined || !isOn(call, Date.now()))) {
          finish(null)
          continue
        }
        if (change.type !== 'added') continue
        const age = Date.now() - (call.startedAt?.toMillis() ?? 0)
        const ring = call.by !== me.uid && !(me.uid in call.joined) && age < RING_SECONDS * 1000 && call.members.length <= RING_UP_TO
        if (!ring || current || onACall() || declined.has(call.id)) continue
        const session = begin({ id: call.id, chatId: call.chatId, title: call.title, video: call.video, me, by: { uid: call.by, name: call.byName }, phase: 'incoming' }, change.doc.ref)
        session.stopSound = startRinging('incoming')
        session.timers.push(window.setTimeout(() => live === session && current?.phase === 'incoming' && finish(null), RING_SECONDS * 1000 - age))
        onRing(current!)
      }
    },
    (err) => console.warn('Not listening for group calls:', err.code),
  )
}

// "Join" on a call that's ringing.
export function answerGroupCall() {
  const ringing = current?.phase === 'incoming' ? current : null
  const call = ringing && calls.find((c) => c.id === ringing.id)
  if (ringing && call) joinGroupCall(ringing.me, call).catch(console.error)
}

// "Decline" on a call that's ringing. (You can still join from the chat.)
export function declineGroupCall() {
  if (current?.phase !== 'incoming') return
  declined.add(current.id)
  finish(null)
}

// ---------- During a call ----------

export function toggleGroupMic() {
  if (!current) return
  const micOff = !current.micOff
  current.local?.getAudioTracks().forEach((track) => (track.enabled = !micOff))
  show({ micOff })
  tellEveryone()
}

export function toggleGroupCamera() {
  if (!current) return
  const cameraOff = !current.cameraOff
  current.local?.getVideoTracks().forEach((track) => (track.enabled = !cameraOff))
  show({ cameraOff })
  tellEveryone()
}

// Share your screen with everyone in the call, or stop. It takes the place of your camera.
export async function toggleGroupShare() {
  const session = live
  if (!session || !current) return
  if (current.screen) return stopSharing()
  try {
    const track = await getScreen()
    if (live !== session) return track.stop()
    track.addEventListener('ended', stopSharing) // (the browser's own "Stop sharing" button)
    show({ screen: new MediaStream([track]) })
    session.links.forEach(sendPicture)
    tellEveryone()
  } catch (err) {
    if ((err as Error).name !== 'NotAllowedError') console.error(err)
  }
}

function stopSharing() {
  if (!current?.screen) return
  stopTracks(current.screen)
  show({ screen: null })
  live?.links.forEach(sendPicture)
  tellEveryone()
}

// Put the right picture in a connection: your screen while you share it, otherwise your camera.
function sendPicture(link: Link) {
  const sender = pictureSender(link.pc)
  const track = current?.screen?.getVideoTracks()[0] ?? current?.local?.getVideoTracks()[0] ?? null
  if (sender && sender.track !== track) sender.replaceTrack(track).catch(console.error)
}

function tell(link: Link) {
  if (!current) return
  const cameraOff = current.cameraOff || !current.local?.getVideoTracks().length
  link.signal({ sharing: !!current.screen, cameraOff, micOff: current.micOff })
}
const tellEveryone = () => live?.links.forEach(tell)

// Leave the call. The last one out ends it.
export function leaveGroupCall() {
  const session = live
  const me = current?.me
  if (!session || !me) return show(null)
  if (current?.phase === 'in') {
    const others = Object.keys(session.doc?.joined ?? {}).filter((uid) => uid !== me.uid)
    const last = others.length === 0 ? { state: 'ended', endedAt: serverTimestamp() } : {}
    updateDoc(session.ref, { [`joined.${me.uid}`]: deleteField(), ...last }).catch(console.error)
    // Wipe my connection details (they include my internet address).
    for (const uid of session.links.keys()) deleteDoc(doc(linksOf(session), linkId(me.uid, uid))).catch(() => {})
  }
  finish('ended')
}

// Close everything down.
function finish(end: GroupCallEnd | null) {
  const session = live
  const call = current
  if (!session || !call) return
  live = null
  session.timers.forEach((timer) => (clearTimeout(timer), clearInterval(timer)))
  session.stopSound()
  session.unwatch.forEach((stop) => stop())
  for (const link of session.links.values()) {
    link.timers.forEach(clearTimeout)
    link.pc.close()
  }
  stopTracks(call.local)
  stopTracks(call.screen)
  if (!end) return show(null)
  show({ phase: 'ended', end, local: null, screen: null, peers: [] })
  setTimeout(() => current?.id === call.id && current.phase === 'ended' && show(null), end === 'ended' ? 1500 : 5000)
}

export function closeGroupCallScreen() {
  if (current?.phase === 'ended') show(null)
}

// Leaving the page during a call: try to tell the others.
window.addEventListener('pagehide', () => {
  if (live && current?.phase === 'in') leaveGroupCall()
})

// A call couldn't start: say why.
function giveUp(err: unknown) {
  const { name } = (err ?? {}) as { name?: string }
  if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError') return finish('micBlocked')
  console.error(err)
  finish('failed')
}
