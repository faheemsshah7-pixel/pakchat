// albums.ts: photos and videos sent together show as one album in the chat,
// like WhatsApp: four or more in a row from the same person, a moment apart,
// make a square of four with "+N" on the last (Album.tsx). One with a caption,
// a reply, View once, a GIF or a round video stays on its own.
import type { Message } from '@pakchat/shared';

/** The fewest that make an album. */
export const ALBUM_MIN = 4;
/** The most time between two of an album (they're sent one after another). */
const GAP_MS = 2 * 60_000;

const key = (m: Pick<Message, 'author' | 'id'>) => `${m.author}/${m.id}`;

/** May this message be part of an album? */
export function albumable(m: Message) {
  const f = m.file;
  return m.kind === 'file' && !!f && (f.kind === 'image' || f.kind === 'video') && !f.once && !f.round && !f.gif && !m.deleted && !m.text && !m.replyTo && !m.statusReply && !m.quote && !m.forwarded;
}

/**
 * The albums in a chat's messages (oldest first): each album's messages, oldest
 * first, by the key of every message in it.
 */
export function albumsIn(ms: Message[]): Map<string, Message[]> {
  const out = new Map<string, Message[]>();
  let run: Message[] = [];
  const close = () => {
    if (run.length >= ALBUM_MIN) for (const m of run) out.set(key(m), run);
    run = [];
  };
  for (const m of ms) {
    const last = run.at(-1);
    const fits = albumable(m) && (!last || (last.author === m.author && m.sentAt - last.sentAt <= GAP_MS && new Date(m.sentAt).toDateString() === new Date(last.sentAt).toDateString()));
    if (!fits) close();
    if (albumable(m)) run.push(m);
  }
  close();
  return out;
}
