// rtc.ts: the parts of a call's connection that one-to-one calls (calls.ts) and group calls
// (groupCalls.ts) share: the microphone and camera, sharing your screen, and the connection
// details (SDP) that go through Firestore.
import { getSetting } from './settings'

// STUN servers tell each browser its address on the internet, so the two can find each other.
// They're free.
const STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

// On some mobile networks and office Wi-Fi, two browsers can't reach each other directly. A relay
// (a "TURN" server) passes the sound and picture along for them. It's off until you set one up
// (see LEARN.md, Step 21): VITE_TURN_CREDENTIALS_URL in web/.env.local is an address that answers
// with a list of relay servers and a password for them, like Metered's free relay does.
// The list is asked for when a call starts, and kept for half an hour.
const TURN_URL: string = import.meta.env.VITE_TURN_CREDENTIALS_URL ?? ''
let relay: { at: number; servers: RTCIceServer[] } | null = null

export async function iceServers(): Promise<RTCIceServer[]> {
  // (Tests can try a relay without building PakChat again.)
  const url = (import.meta.env.DEV && (window as { pakchatTurnUrl?: string }).pakchatTurnUrl) || TURN_URL
  if (!url) return STUN
  if (!relay || Date.now() - relay.at > 30 * 60_000) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      const list: unknown = await res.json()
      const servers = (Array.isArray(list) ? list : []).filter((s) => typeof s?.urls === 'string' || Array.isArray(s?.urls))
      relay = { at: Date.now(), servers }
    } catch (err) {
      console.warn('No call relay this time:', err) // (the call still tries without one)
      return STUN
    }
  }
  return [...STUN, ...relay.servers]
}

// How much data the sound and picture may use, in kbit/s. "Use less data for calls" (Settings)
// picks the lower picture. A group call sends to everyone in it separately, so it uses less each.
export type Quality = { audio: number; video: number }
export function quality(group: boolean): Quality {
  const low = getSetting('lowDataCalls')
  // Sound: 64 kbit/s, about 3 times what WhatsApp uses. Clear, and about 1 MB a minute.
  if (!group) return { audio: 64, video: low ? 150 : 450 }
  return { audio: 40, video: low ? 100 : 250 }
}

// ---------- Only one call at a time ----------
// Each kind of call says here how to tell if it's on, so the other kind can say "busy".
const checks: (() => boolean)[] = []
export function busyWhen(check: () => boolean) {
  checks.push(check)
}
export const onACall = () => checks.some((check) => check())

// ---------- The microphone and camera ----------

// The browser asks "Allow PakChat to use your microphone?" the first time.
const AUDIO: MediaTrackConstraints = {
  echoCancellation: true, // so they don't hear themselves back from your speaker
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48_000,
}
// small: a group call's picture (each one is a small square on screen).
export async function getMedia(video: boolean, small = false) {
  if (!video) return navigator.mediaDevices.getUserMedia({ audio: AUDIO })
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: AUDIO,
      video: small
        ? { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 }, facingMode: 'user' }
        : { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 }, facingMode: 'user' },
    })
  } catch {
    // No camera, it's busy, or you said no to it: carry on with just the microphone.
    return navigator.mediaDevices.getUserMedia({ audio: AUDIO })
  }
}

export function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop()) // turns the microphone and camera light off
}

// ---------- Sharing your screen ----------
// Computers only: phone browsers can't share their screen.
export const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

// The browser asks which screen, window or tab to share. A few pictures a second is plenty for a
// screen, and "detail" keeps words sharp (the browser drops pictures, not sharpness, when it's slow).
export async function getScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 }, width: { max: 1920 }, height: { max: 1080 } }, audio: false })
  const track = stream.getVideoTracks()[0]
  track.contentHint = 'detail'
  return track
}

// Every call has a picture "slot" from the start, even a voice call, with nothing in it until you
// share your screen. Then sharing just puts the screen in the slot (replaceTrack), with no need to
// connect again. The caller makes the slot; the one answering says they'll use it too.
export function addPictureSlot(pc: RTCPeerConnection, local: MediaStream) {
  if (!local.getVideoTracks().length) pc.addTransceiver('video', { direction: 'sendrecv', streams: [local] })
}
export function takePictureSlot(pc: RTCPeerConnection, local: MediaStream) {
  for (const tr of pc.getTransceivers()) {
    if (tr.receiver.track.kind === 'video' && !tr.sender.track && tr.direction === 'recvonly') {
      tr.direction = 'sendrecv'
      tr.sender.setStreams(local)
    }
  }
}
// The picture's sender. (None when the other side has an older PakChat that made no slot.)
export function pictureSender(pc: RTCPeerConnection) {
  return pc.getTransceivers().find((tr) => tr.receiver.track.kind === 'video' && (tr.currentDirection === 'sendrecv' || tr.currentDirection === 'sendonly'))?.sender
}

// ---------- A small side channel ----------
// Besides sound and picture, the two browsers keep a little text channel open between them,
// to say "I'm sharing my screen" or "my camera is off" (so the other side shows your photo, not black).
export type Signals = { sharing: boolean; cameraOff: boolean; micOff: boolean }
export function sideChannel(pc: RTCPeerConnection, onSignals: (signals: Signals) => void) {
  // (negotiated + id 0: both sides make it the same way, so it's ready without asking the other.)
  const channel = pc.createDataChannel('pakchat', { negotiated: true, id: 0 })
  let latest: Signals | null = null
  channel.onopen = () => latest && channel.send(JSON.stringify(latest))
  channel.onmessage = (e) => {
    try {
      const s = JSON.parse(e.data)
      onSignals({ sharing: !!s.sharing, cameraOff: !!s.cameraOff, micOff: !!s.micOff })
    } catch {
      // (not something we understand: ignore it)
    }
  }
  return (signals: Signals) => {
    latest = signals
    if (channel.readyState === 'open') channel.send(JSON.stringify(signals))
  }
}

// ---------- The connection details ----------

// Wait until the browser has found its addresses (or 3 seconds), so they all go in one write.
export function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, 3000)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

// My connection details, to save in Firestore.
export function describe(pc: RTCPeerConnection, q: Quality) {
  const description = pc.localDescription!
  return { type: description.type, sdp: tune(description.sdp, q) }
}

// The details are plain text (called SDP). Two lines in it decide the quality the OTHER side sends me:
//   a=fmtp:111 ...maxaveragebitrate=64000   sound at 64 kbit/s (browsers normally use about 32)
//   b=AS:450                                  picture at most 450 kbit/s
function tune(sdp: string, q: Quality) {
  const opus = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1]
  let section = ''
  const lines: string[] = []
  for (const line of sdp.split('\r\n')) {
    if (line.startsWith('m=')) section = line.slice(2).split(' ')[0] // 'audio' or 'video'
    if (opus && line.startsWith(`a=fmtp:${opus} `)) {
      const params = new Map(line.slice(`a=fmtp:${opus} `.length).split(';').map((p) => p.trim().split('=') as [string, string]))
      params.set('maxaveragebitrate', String(q.audio * 1000))
      params.set('maxplaybackrate', '48000') // full range of the voice, not "telephone" sound
      params.set('useinbandfec', '1') // repairs sound when a packet gets lost
      lines.push(`a=fmtp:${opus} ` + [...params].map(([key, value]) => `${key}=${value}`).join(';'))
      continue
    }
    if (section === 'video' && line.startsWith('b=AS:')) continue // we add our own below
    lines.push(line)
    if (section === 'video' && line.startsWith('c=')) lines.push(`b=AS:${q.video}`)
  }
  return lines.join('\r\n')
}

// And what I send: at most my own picture limit too.
export async function limitVideo(pc: RTCPeerConnection, q: Quality) {
  for (const tr of pc.getTransceivers()) {
    if (tr.receiver.track.kind !== 'video' || tr.currentDirection === 'stopped') continue
    const params = tr.sender.getParameters()
    if (!params.encodings?.length) continue // (not connected yet)
    params.encodings[0].maxBitrate = q.video * 1000
    await tr.sender.setParameters(params).catch(() => {})
  }
}

// Connect a sound or video stream to an <audio>/<video> on the page (only when it changed).
export function play(el: HTMLMediaElement | null, stream: MediaStream | null) {
  if (el && el.srcObject !== stream) el.srcObject = stream
}
