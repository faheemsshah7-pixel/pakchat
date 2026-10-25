// player.ts: one player for every voice note and audio file in the chats.
//
// Only one plays at a time, like WhatsApp: starting another stops the first.
// Bubbles ask useVoicePlayer() whether they're the one playing, and where.
// When a voice note ends, the next voice note under it plays by itself.
//
// Held to your ear, like WhatsApp: the screen goes dark and it carries on from
// the earpiece (VoiceEar.kt plays it there, from the same spot); taken away
// from your ear, it pauses. Not in a call, nor with headphones in.
import type { EventSubscription } from 'expo';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useEffect, useState } from 'react';

import { fileModule } from '../../modules/pakchat-signal';

/** Which file is loaded, where it is, and how fast it plays. */
export type PlayerState = { key: string | null; playing: boolean; position: number; duration: number; speed: number };

const SPEEDS = [1, 1.5, 2];

let player: AudioPlayer | null = null;
let state: PlayerState = { key: null, playing: false, position: 0, duration: 0, speed: 1 };
const listeners = new Set<(s: PlayerState) => void>();
/** What to play when the current one finishes (set by the chat screen). */
let after: ((key: string) => { key: string; uri: string } | null) | null = null;
/** The file loaded, for handing over to the earpiece. */
let uri: string | null = null;
// At the ear: the earpiece player has it (`ear`), and the phone is held there (`near`).
let ear = false;
let near = false;
let earClock: ReturnType<typeof setInterval> | null = null;
let earEvents: EventSubscription | null = null;

function set(next: Partial<PlayerState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

function load() {
  if (player) return player;
  const p = createAudioPlayer(null, { updateInterval: 100 });
  p.addListener('playbackStatusUpdate', (s: AudioStatus) => {
    // While the earpiece has it, this one is paused and has nothing to say.
    if (!state.key || ear) return;
    if (s.didJustFinish) {
      p.pause();
      void p.seekTo(0);
      finished();
      return;
    }
    set({ playing: s.playing, position: Math.round(s.currentTime * 1000), duration: s.duration ? Math.round(s.duration * 1000) : state.duration });
  });
  player = p;
  return p;
}

/** One finished: the next voice note under it plays, or it all stops. */
function finished() {
  const done = state.key;
  set({ playing: false, position: 0 });
  const next = done ? after?.(done) : null;
  if (next) play(next.key, next.uri);
  else watchEar(false);
}

/** Plays (or carries on with) a file; `key` names the bubble. Tapping the one playing pauses it. */
export function play(key: string, file: string, from?: number) {
  const p = load();
  void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'doNotMix' }).catch(() => {});
  leaveEar();
  if (state.key !== key) {
    p.replace({ uri: file });
    uri = file;
    set({ key, playing: true, position: from ?? 0, duration: 0 });
    if (from) void p.seekTo(from / 1000);
  } else if (from !== undefined) {
    void p.seekTo(from / 1000);
    set({ position: from });
  }
  p.setPlaybackRate(state.speed);
  set({ playing: true });
  watchEar(true);
  // Still at the ear (the next one after the last): straight to the earpiece.
  if (near) toEar();
  else p.play();
}

export function pause() {
  leaveEar();
  player?.pause();
  set({ playing: false });
  watchEar(false);
}

/** Moves to `ms` in the file (dragging the dot along the bars). */
export function seek(key: string, file: string, ms: number) {
  if (state.key !== key) return play(key, file, ms);
  const atEar = ear;
  leaveEar();
  void player?.seekTo(ms / 1000);
  set({ position: ms });
  if (atEar) toEar();
}

/** 1× → 1.5× → 2×. */
export function nextSpeed() {
  const speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
  player?.setPlaybackRate(speed);
  set({ speed });
  if (ear) {
    leaveEar();
    toEar();
  }
}

// ---- At the ear ----

function native() {
  try {
    return fileModule();
  } catch {
    return null;
  }
}

/** Watch the ear sensor only while something plays: never otherwise (the screen mustn't go dark near your hand). */
function watchEar(on: boolean) {
  const fm = native();
  if (!fm) return;
  if (on && !earEvents) earEvents = fm.addListener('voiceEar', onEar);
  if (!on) near = false;
  try {
    fm.voiceWatch(on);
  } catch {
    // An older app without the ear player: it just plays out loud.
  }
}

function onEar(e: { near?: boolean; done?: boolean }) {
  if (e.done) {
    if (!ear) return;
    ear = false;
    stopEarClock();
    void player?.seekTo(0);
    finished();
    return;
  }
  if (e.near === undefined) return;
  near = e.near;
  if (near && state.playing && !ear) toEar();
  else if (!near && ear) {
    // Taken away from the ear: it pauses there, like WhatsApp.
    leaveEar();
    set({ playing: false });
    watchEar(false);
  }
}

/** The earpiece takes over from where the loudspeaker was. */
function toEar() {
  const fm = native();
  if (!fm || !uri) return player?.play();
  player?.pause();
  try {
    fm.voiceEarPlay(uri, state.position, state.speed);
  } catch {
    return player?.play();
  }
  ear = true;
  stopEarClock();
  earClock = setInterval(() => {
    const at = native()?.voiceEarPosition() ?? -1;
    if (at >= 0) set({ position: at });
  }, 250);
}

/** The earpiece stops (if it had it); the chat's player is left paused where it got to. */
function leaveEar() {
  if (!ear) return;
  ear = false;
  stopEarClock();
  let at = -1;
  try {
    at = native()?.voiceEarStop() ?? -1;
  } catch {
    // Already gone.
  }
  if (at >= 0) {
    void player?.seekTo(at / 1000);
    set({ position: at });
  }
}

function stopEarClock() {
  if (earClock) clearInterval(earClock);
  earClock = null;
}

/** Stops everything (a call started, a recording started, the chat closed). */
export function stopAll() {
  leaveEar();
  watchEar(false);
  if (!player) return;
  player.pause();
  set({ key: null, playing: false, position: 0, duration: 0 });
}

export function playNextWith(fn: typeof after) {
  after = fn;
}

export const playerState = () => state;

/** The player's state, for one bubble: only re-renders while it's the one playing. */
export function useVoicePlayer(key: string) {
  const [mine, setMine] = useState<PlayerState | null>(() => (state.key === key ? state : null));
  useEffect(() => {
    const fn = (s: PlayerState) => setMine((old) => (s.key === key ? s : old === null ? old : null));
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [key]);
  return mine;
}
