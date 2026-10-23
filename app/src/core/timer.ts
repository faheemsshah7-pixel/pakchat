// timer.ts: the default message timer (Settings › Privacy), as on WhatsApp.
// When it's on, every new chat I start, and every group I make, begins with
// disappearing messages at that time. Chats that already exist keep theirs.
import KV from 'expo-sqlite/kv-store';

/** Seconds, or 0 for off. Kept on this phone only. */
export function defaultTimer() {
  const n = Number(KV.getItemSync('defaultTimer') ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setDefaultTimer(seconds: number) {
  KV.setItemSync('defaultTimer', String(seconds));
}
