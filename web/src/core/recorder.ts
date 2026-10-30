// recorder.ts: recording a voice message. It lives here, outside the
// composer, so a recording carries on when you open another chat, like
// WhatsApp Web's "out of chat" recorder: the chat list shows a small
// recorder to pause, send or delete it, or go back to its chat.

import type { Ref } from '@pakchat/shared';
import { useSyncExternalStore } from 'react';

import { core } from './core';

export type Recording = {
  chatId: string;
  replyTo: Ref | null;
  /** How long it is so far (paused time doesn't count). */
  ms: number;
  /** The newest loudness peaks (0 to 128), for the moving bars. */
  level: number[];
  paused: boolean;
  /** Listening back while paused. */
  playing: boolean;
};

type Live = {
  stop: (send: boolean) => void;
  pause: () => void;
  resume: () => void;
  play: () => void;
};

let now: Recording | null = null;
let live: Live | null = null;
const subs = new Set<() => void>();

function set(change: Partial<Recording> | null) {
  if (change === null) now = null;
  else if (now) now = { ...now, ...change };
  subs.forEach((f) => f());
}

export function useRecording(): Recording | null {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => now,
  );
}

export const recording = () => now;

/** "recording audio…" for the people in the chat, said again every few seconds while it records. */
let saying: ReturnType<typeof setInterval> | null = null;
function sayRecording(chatId: string | null) {
  if (saying) clearInterval(saying);
  saying = null;
  if (!chatId) return;
  core.client.typing(chatId, true, true);
  saying = setInterval(() => core.client.typing(chatId, true, true), 4000);
}
function stopSaying(chatId: string) {
  sayRecording(null);
  core.client.typing(chatId, false);
}

/** Starts recording in a chat. False if the microphone isn't allowed (or a recording is going already). */
export async function startRecording(chatId: string, replyTo: Ref | null, on: { error: (why: 'mic' | 'send') => void; sent?: () => void }): Promise<boolean> {
  if (now) return false;
  now = { chatId, replyTo, ms: 0, level: [], paused: false, playing: false };
  set({});
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    set(null);
    on.error('mic');
    return false;
  }
  if (!now || now.chatId !== chatId) {
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
  const chunks: Blob[] = [];
  const bars: number[] = [];
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  let player: HTMLAudioElement | null = null;
  // The length counts only the time spent recording, not paused.
  let recorded = 0;
  let since = Date.now();
  let running = true;
  const length = () => recorded + (running ? Date.now() - since : 0);
  const hold = () => {
    if (running) recorded += Date.now() - since;
    running = false;
  };
  const tick = setInterval(() => {
    if (mr.state !== 'recording') return;
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    bars.push(peak);
    set({ level: bars.slice(-48), ms: length() });
  }, 100);
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let send = false;
  mr.onstop = () => {
    clearInterval(tick);
    player?.pause();
    if (player) URL.revokeObjectURL(player.src);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    stopSaying(chatId);
    const total = length();
    const r = now;
    live = null;
    set(null);
    if (send && total > 700 && r) {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const wave = btoa(String.fromCharCode(...loudness(squeeze(bars, 64))));
      void core.sendVoice(chatId, blob, total, wave, r.replyTo ?? undefined).catch(() => on.error('send'));
      on.sent?.();
    }
  };
  mr.start(250);
  sayRecording(chatId);
  live = {
    stop: (s) => {
      send = s;
      hold();
      if (mr.state !== 'inactive') mr.stop();
    },
    pause: () => {
      if (mr.state !== 'recording') return;
      hold();
      mr.pause();
      mr.requestData();
      stopSaying(chatId);
      set({ paused: true, ms: length() });
    },
    resume: () => {
      if (mr.state !== 'paused') return;
      player?.pause();
      since = Date.now();
      running = true;
      mr.resume();
      sayRecording(chatId);
      set({ paused: false, playing: false });
    },
    play: () => {
      if (player && !player.paused) {
        player.pause();
        return set({ playing: false });
      }
      if (player) URL.revokeObjectURL(player.src);
      player = new Audio(URL.createObjectURL(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })));
      player.onended = () => set({ playing: false });
      void player.play().then(() => set({ playing: true }));
    },
  };
  return true;
}

/** Sends it (`true`) or throws it away. */
export function stopRecording(send: boolean) {
  if (live) live.stop(send);
  // Still asking for the microphone: nothing recorded yet.
  else if (now) set(null);
}

export const pauseRecording = () => live?.pause();
export const resumeRecording = () => live?.resume();
export const playRecording = () => live?.play();

/** Peaks (0 to 128) as bar heights (0 to 255), the loudest moment full height, like WhatsApp. Quiet hiss stays low. */
export function loudness(peaks: number[]) {
  const top = Math.max(QUIET, ...peaks);
  return peaks.map((p) => Math.round((Math.min(p, top) / top) * 255));
}
const QUIET = 6;

/** Fewer bars: the loudest of each stretch. */
function squeeze(bars: number[], n: number) {
  if (bars.length <= n) return bars;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * bars.length) / n);
    const to = Math.floor(((i + 1) * bars.length) / n);
    out.push(Math.max(...bars.slice(from, Math.max(to, from + 1))));
  }
  return out;
}
