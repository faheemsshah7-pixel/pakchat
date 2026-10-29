// zoom.ts: a photo or video growing out of its spot in the chat into the
// viewer, and shrinking back into it when the viewer closes, like WhatsApp
// (SwipeToClose.tsx does the moving).
//
// The tap notes where the picture is on the screen (its "spot") and hands the
// viewer the message itself, so the viewer can show it at once, before it has
// read the chat's other photos.
import type { Message } from '@pakchat/shared';
import { router } from 'expo-router';
import type { HostInstance } from 'react-native';

/** Where something is on the screen. */
export type Spot = { x: number; y: number; w: number; h: number };

/** Where `view` is on the screen now (null if it can't be told). */
export function spotOf(view: HostInstance | null | undefined): Promise<Spot | null> {
  return new Promise((done) => {
    if (!view) return done(null);
    try {
      view.measureInWindow((x, y, w, h) => done(w > 0 && h > 0 ? { x, y, w, h } : null));
    } catch {
      done(null);
    }
  });
}

/** A spot as a screen's parameter ("x,y,w,h"), and back. */
export const spotParam = (s: Spot) => [s.x, s.y, s.w, s.h].map((n) => Math.round(n)).join(',');
export function parseSpot(p: string | undefined): Spot | null {
  const n = (p ?? '').split(',').map(Number);
  return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? { x: n[0], y: n[1], w: n[2], h: n[3] } : null;
}

let handed: Message | null = null;

/** Opens a photo or video in the viewer, growing out of `from` (the picture tapped) when given. */
export async function openViewer(m: Message, from?: HostInstance | null) {
  const spot = await spotOf(from);
  handed = m;
  router.push({ pathname: '/viewer', params: { chat: m.chatId, author: m.author, id: m.id, ...(spot ? { spot: spotParam(spot) } : {}) } });
}

/** Takes the handed message, if it's this one. */
export function takeHanded(chatId: string, author: string, id: string): Message | null {
  const m = handed;
  handed = null;
  return m && m.chatId === chatId && m.author === author && m.id === id ? m : null;
}
