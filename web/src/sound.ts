// sound.ts: the little sound when a message arrives (you pick which: a "tone"), the "conversation tones"
// while a chat is open, and the ringing for calls.
// No sound files needed: the browser makes the sounds itself (the Web Audio API),
// from short musical notes that fade out.
// Which tone plays: the chat's own (Chat info > Notification tone, saved in prefs.ts), or else
// the one for all chats or all groups (Settings > Notifications, saved on this device in settings.ts).
import { getSetting } from './settings'

export const TONES = ['ping', 'chime', 'pop', 'bell', 'drops', 'marimba', 'none'] as const
export type Tone = (typeof TONES)[number]

let audio: AudioContext | null = null

function context() {
  audio ??= new AudioContext()
  if (audio.state === 'suspended') audio.resume().catch(() => {})
  return audio
}

// One soft note: [pitch in Hz, when it starts (seconds from now), how long, how loud].
// shape: 'sine' is smooth and pure; 'triangle' sounds a little like wood (a marimba).
// slideTo: the pitch slides down (or up) to this during the note, for a "pop".
function note(ctx: AudioContext, out: AudioNode, frequency: number, at: number, length: number, loudness: number, shape: OscillatorType = 'sine', slideTo?: number) {
  const osc = ctx.createOscillator()
  const volume = ctx.createGain()
  osc.type = shape
  const start = ctx.currentTime + at
  osc.frequency.setValueAtTime(frequency, start)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + length)
  volume.gain.setValueAtTime(0.0001, start)
  volume.gain.exponentialRampToValueAtTime(loudness, start + 0.02)
  volume.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(volume).connect(out)
  osc.start(start)
  osc.stop(start + length + 0.05)
}

// Each tone is a few notes. (The numbers are pitches: 880 is the A above "middle A", 1760 an octave higher.)
const MELODIES: Record<Exclude<Tone, 'none'>, (ctx: AudioContext, out: AudioNode) => void> = {
  ping: (ctx, out) => {
    note(ctx, out, 880, 0, 0.22, 0.18)
    note(ctx, out, 1318, 0.09, 0.22, 0.18)
  },
  chime: (ctx, out) => [1046, 1318, 1568].forEach((pitch, i) => note(ctx, out, pitch, i * 0.08, 0.35, 0.14)),
  pop: (ctx, out) => note(ctx, out, 900, 0, 0.12, 0.25, 'triangle', 280),
  bell: (ctx, out) => {
    note(ctx, out, 1568, 0, 0.9, 0.16)
    note(ctx, out, 3136, 0, 0.5, 0.04) // a quiet higher note makes it ring like a bell
  },
  drops: (ctx, out) => {
    note(ctx, out, 1760, 0, 0.1, 0.16, 'sine', 1100)
    note(ctx, out, 1320, 0.13, 0.12, 0.16, 'sine', 800)
  },
  marimba: (ctx, out) => [523, 784, 659].forEach((pitch, i) => note(ctx, out, pitch, i * 0.1, 0.3, 0.22, 'triangle')),
}

function play(tone: Tone) {
  if (tone === 'none') return
  try {
    const ctx = context()
    ;(MELODIES[tone] ?? MELODIES.ping)(ctx, ctx.destination)
  } catch {
    // Some browsers block sound until you've clicked on the page. That's fine.
  }
}

// A message arrived. tone: the chat's own tone, if it has one (else the one for all chats).
export function playPing(tone?: Tone | null) {
  if (getSetting('sounds')) play(tone ?? getSetting('messageTone'))
}

// Picking a tone: play it so you can hear it (even with message sounds off).
export const previewTone = play

// Conversation tones: while a chat is open, a soft "whoosh" when your message reaches the server,
// and a soft "pop" when someone else's arrives. (Instead of the usual sound: that one is for chats
// you're not looking at.) Settings > Chats switches them on or off and sets how loud they are.
// preview: play it even if they're switched off (when you move the loudness slider).
export function playConversationTone(kind: 'sent' | 'received', preview = false) {
  if (!preview && !getSetting('conversationTones')) return
  try {
    const ctx = context()
    const out = ctx.createGain()
    out.gain.value = Math.min(1, Math.max(0, getSetting('toneVolume')))
    out.connect(ctx.destination)
    if (kind === 'sent') note(ctx, out, 520, 0, 0.14, 0.2, 'sine', 1040) // a quick slide up
    else {
      note(ctx, out, 587, 0, 0.12, 0.22, 'triangle')
      note(ctx, out, 880, 0.07, 0.14, 0.18, 'triangle')
    }
  } catch {
    // (no sound until you've clicked on the page)
  }
}

// Ringing, until the returned stop() is called. (Calls ring even with message sounds off.)
//   incoming: a little tune every 2.5 seconds, so you notice the call
//   outgoing: the soft "tuu... tuu..." you hear while their phone rings
export function startRinging(kind: 'incoming' | 'outgoing') {
  try {
    const ctx = context()
    const out = ctx.createGain()
    out.connect(ctx.destination)
    const ring =
      kind === 'incoming'
        ? () => [659, 784, 988, 784, 659, 784, 988, 784].forEach((pitch, i) => note(ctx, out, pitch, i * 0.13, 0.25, 0.22))
        : () => note(ctx, out, 400, 0, 1.2, 0.07)
    ring()
    const timer = setInterval(ring, kind === 'incoming' ? 2500 : 3000)
    return () => {
      clearInterval(timer)
      out.disconnect() // silence straight away, even mid-note
    }
  } catch {
    return () => {}
  }
}
