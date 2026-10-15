// sound.ts: the little "ping" when a message arrives, and the ringing for calls.
// No sound files needed: the browser makes the sounds itself (the Web Audio API),
// from short musical notes that fade out.
import { getSetting } from './settings'

let audio: AudioContext | null = null

function context() {
  audio ??= new AudioContext()
  if (audio.state === 'suspended') audio.resume().catch(() => {})
  return audio
}

// One soft note: [pitch in Hz, when it starts (seconds from now), how long, how loud].
function note(ctx: AudioContext, out: AudioNode, frequency: number, at: number, length: number, loudness: number) {
  const osc = ctx.createOscillator()
  const volume = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  const start = ctx.currentTime + at
  volume.gain.setValueAtTime(0.0001, start)
  volume.gain.exponentialRampToValueAtTime(loudness, start + 0.02)
  volume.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(volume).connect(out)
  osc.start(start)
  osc.stop(start + length + 0.05)
}

export function playPing() {
  if (!getSetting('sounds')) return
  try {
    const ctx = context()
    note(ctx, ctx.destination, 880, 0, 0.22, 0.18)
    note(ctx, ctx.destination, 1318, 0.09, 0.22, 0.18)
  } catch {
    // Some browsers block sound until you've clicked on the page. That's fine.
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
