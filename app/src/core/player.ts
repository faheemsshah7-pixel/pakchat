// player.ts: one player for every voice note and audio file in the chats.
//
// Only one plays at a time, like WhatsApp: starting another stops the first.
// Bubbles ask useVoicePlayer() whether they're the one playing, and where.
// When a voice note ends, the next voice note under it plays by itself.
// Holding the phone to your ear isn't handled yet: it always plays out loud.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useEffect, useState } from 'react';

/** Which file is loaded, where it is, and how fast it plays. */
export type PlayerState = { key: string | null; playing: boolean; position: number; duration: number; speed: number };

const SPEEDS = [1, 1.5, 2];

let player: AudioPlayer | null = null;
let state: PlayerState = { key: null, playing: false, position: 0, duration: 0, speed: 1 };
const listeners = new Set<(s: PlayerState) => void>();
/** What to play when the current one finishes (set by the chat screen). */
let after: ((key: string) => { key: string; uri: string } | null) | null = null;

function set(next: Partial<PlayerState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

function load() {
  if (player) return player;
  const p = createAudioPlayer(null, { updateInterval: 100 });
  p.addListener('playbackStatusUpdate', (s: AudioStatus) => {
    if (!state.key) return;
    if (s.didJustFinish) {
      const done = state.key;
      p.pause();
      void p.seekTo(0);
      set({ playing: false, position: 0 });
      const next = after?.(done);
      if (next) play(next.key, next.uri);
      return;
    }
    set({ playing: s.playing, position: Math.round(s.currentTime * 1000), duration: s.duration ? Math.round(s.duration * 1000) : state.duration });
  });
  player = p;
  return p;
}

/** Plays (or carries on with) a file; `key` names the bubble. Tapping the one playing pauses it. */
export function play(key: string, uri: string, from?: number) {
  const p = load();
  void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'doNotMix' }).catch(() => {});
  if (state.key !== key) {
    p.replace({ uri });
    set({ key, playing: true, position: from ?? 0, duration: 0 });
    if (from) void p.seekTo(from / 1000);
  } else if (from !== undefined) {
    void p.seekTo(from / 1000);
    set({ position: from });
  }
  p.setPlaybackRate(state.speed);
  p.play();
  set({ playing: true });
}

export function pause() {
  player?.pause();
  set({ playing: false });
}

/** Moves to `ms` in the file (dragging the dot along the bars). */
export function seek(key: string, uri: string, ms: number) {
  if (state.key !== key) return play(key, uri, ms);
  void player?.seekTo(ms / 1000);
  set({ position: ms });
}

/** 1× → 1.5× → 2×. */
export function nextSpeed() {
  const speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
  player?.setPlaybackRate(speed);
  set({ speed });
}

/** Stops everything (a call started, a recording started, the chat closed). */
export function stopAll() {
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
