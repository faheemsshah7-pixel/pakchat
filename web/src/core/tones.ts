// tones.ts: a call's sounds, made on the spot with the browser's own sound
// maker (no sound files to download): the ringtone for a call coming in,
// "ringing" while calling out, "busy", and the short note when a call ends.

let ctx: AudioContext | null = null;
let playing: { stop: () => void } | null = null;

function audio() {
  ctx ??= new AudioContext();
  // Browsers start it paused until the page has been clicked once; try anyway.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** One soft note: `freq` Hz from `from` seconds for `len` seconds. */
function note(a: AudioContext, freq: number, from: number, len: number, loud = 0.16) {
  const osc = a.createOscillator();
  const vol = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0.0001, from);
  vol.gain.exponentialRampToValueAtTime(loud, from + 0.02);
  vol.gain.setValueAtTime(loud, from + len - 0.05);
  vol.gain.exponentialRampToValueAtTime(0.0001, from + len);
  osc.connect(vol).connect(a.destination);
  osc.start(from);
  osc.stop(from + len + 0.02);
}

/** Plays `pattern` (notes from the start of each round) every `every` seconds until stopped. */
function loop(pattern: [number, number, number][], every: number) {
  stopTone();
  let a: AudioContext;
  try {
    a = audio();
  } catch {
    return;
  }
  let round = a.currentTime + 0.05;
  const plan = () => {
    // Keeps a couple of rounds ahead, so the sound never stutters.
    while (round < a.currentTime + every * 2) {
      for (const [freq, at, len] of pattern) note(a, freq, round + at, len);
      round += every;
    }
  };
  plan();
  const id = setInterval(plan, every * 500);
  playing = { stop: () => clearInterval(id) };
}

export type Tone = 'ring' | 'ringing' | 'busy' | 'ended';

/** Starts a call's sound (`ring` and `ringing` repeat until stopTone). */
export function playTone(t: Tone) {
  if (t === 'ring') return loop([[784, 0, 0.18], [988, 0.2, 0.18], [1175, 0.4, 0.3], [784, 1.0, 0.18], [988, 1.2, 0.18], [1175, 1.4, 0.3]], 3);
  if (t === 'ringing') return loop([[440, 0, 1], [480, 0, 1]], 4);
  stopTone();
  try {
    const a = audio();
    const at = a.currentTime + 0.02;
    if (t === 'busy') for (let i = 0; i < 3; i++) note(a, 480, at + i * 0.5, 0.25);
    else {
      note(a, 660, at, 0.15, 0.12);
      note(a, 440, at + 0.17, 0.25, 0.12);
    }
  } catch {
    // No sound on this computer.
  }
}

export function stopTone() {
  playing?.stop();
  playing = null;
  // Notes already planned fade out within a second; a fresh context cuts them now.
  if (ctx) {
    void ctx.close().catch(() => {});
    ctx = null;
  }
}
