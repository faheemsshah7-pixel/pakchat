// status.ts: Status, WhatsApp's 24-hour updates (words on a colour, a photo or a video).
//
// My status is a special chat (kind "status") with me as its owner and the
// people allowed to see it as members (Settings › Status privacy). A status
// is a message in it, locked like any message, gone after a day. Everyone
// else's status is their status chat, where the server shows me only the
// owner and myself, so nobody can see who else watches.
//
// Watching one sends a read receipt to its owner (their "seen by" list), a ❤️
// is a reaction (to the owner only), and a reply goes to the owner's ordinary
// chat with me, carrying a little copy of the status (shared/src/content.ts,
// StatusQuote).
import { statusOwner, type Chat, type Message, type StatusQuote } from '@pakchat/shared';
import KV from 'expo-sqlite/kv-store';

import { core } from './core';

/** The colours a status in words can have (the message carries the number). */
export const STATUS_BG = ['#2F6BF0', '#7C3AED', '#DB2777', '#E11D48', '#EA580C', '#B45309', '#16A34A', '#0D9488', '#0891B2', '#4F46E5', '#334155', '#9333EA'];

/** How long a photo or words show before moving on (videos play to their end, up to 30 s). */
export const STATUS_SHOW_MS = 5_000;
export const STATUS_VIDEO_MAX_MS = 30_000;

/** Who sees my status: all my contacts, my contacts except some, or only some. */
export type StatusPrivacy = { mode: 'contacts' | 'except' | 'only'; ids: string[] };

export function statusPrivacy(): StatusPrivacy {
  try {
    const p = JSON.parse(KV.getItemSync('statusPrivacy') ?? 'null') as StatusPrivacy | null;
    if (p && ['contacts', 'except', 'only'].includes(p.mode) && Array.isArray(p.ids)) return p;
  } catch {
    // Not set yet.
  }
  return { mode: 'contacts', ids: [] };
}

/** Saves who may see my status, and tells the server (if I have a status chat already). */
export async function setStatusPrivacy(p: StatusPrivacy) {
  KV.setItemSync('statusPrivacy', JSON.stringify(p));
  if (await core.client.myStatus()) await core.client.setStatusAudience(audience(p));
}

/** The people who may see my status now (contacts can change, so it's worked out each time). */
export function audience(p = statusPrivacy()) {
  const contacts = Object.keys(core.contacts).filter((id) => id !== core.myId);
  if (p.mode === 'only') return p.ids.filter((id) => id !== core.myId);
  if (p.mode === 'except') return contacts.filter((id) => !p.ids.includes(id));
  return contacts;
}

/** My status chat, made (or brought up to date with my contacts) before posting. */
export async function readyMyStatus(): Promise<Chat> {
  const want = audience();
  const mine = await core.client.myStatus();
  const have = new Set((mine?.members ?? []).map((m) => m.userId).filter((id) => id !== core.myId));
  if (mine && want.length === have.size && want.every((id) => have.has(id))) return mine;
  return core.client.setStatusAudience(want);
}

/** One person's statuses for the Status tab. */
export type StatusPerson = { chat: Chat; owner: string; items: Message[]; latest: number; seen: boolean; muted: boolean };

/** Everyone's live statuses (mine separately), newest first. */
export async function loadStatuses(): Promise<{ mine: StatusPerson | null; others: StatusPerson[] }> {
  const chats = (await core.client.chats()).filter((c) => c.kind === 'status');
  let mine: StatusPerson | null = null;
  const others: StatusPerson[] = [];
  for (const chat of chats) {
    const owner = statusOwner(chat);
    if (!owner) continue;
    const all = core.forgetExpired(await core.client.messages(chat.id, { limit: 100 }));
    const items = all.filter((m) => m.kind !== 'system' && !m.deleted && m.author === owner);
    const person: StatusPerson = {
      chat,
      owner,
      items,
      latest: items.at(-1)?.sentAt ?? 0,
      seen: items.every((m) => m.seq !== null && m.seq <= chat.readUpTo),
      muted: !!core.prefs[chat.id]?.muted,
    };
    if (owner === core.myId) mine = person;
    else if (items.length) others.push(person);
  }
  others.sort((a, b) => b.latest - a.latest);
  return { mine, others };
}

/** A little copy of a status, for a reply to it. */
export function quoteOf(m: Message): StatusQuote {
  const kind = m.file ? (m.file.kind === 'video' ? 'video' : 'image') : 'text';
  return {
    author: m.author,
    id: m.id,
    kind,
    ...(m.text ? { text: m.text.slice(0, 700) } : {}),
    ...(m.file?.thumb ? { thumb: m.file.thumb } : {}),
  };
}

/** Replies to someone's status in my chat with them. */
export async function replyToStatus(m: Message, text: string) {
  const chat = await core.client.openDirect(m.author);
  await core.client.sendText(chat.id, text, { status: quoteOf(m) });
}
