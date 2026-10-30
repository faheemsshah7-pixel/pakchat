// History sync: the phone copies its chats to a website it has just linked,
// like WhatsApp's "Syncing messages".
//
// The phone sends it in parts, newest first, so the website's chat list
// fills in within seconds and older messages follow:
//   part 1: every chat, with its newest messages
//   part 2: older messages, up to a limit per chat
// Each part is a JSON file, locked like any attachment and uploaded to the
// phone's own "Message yourself" chat. Its key goes to the website alone,
// inside a Signal message (see `PakChat.sendHistory`), so the server can't
// open it.

import type { Chat, Message, Storage } from './storage';
import { restoredChat } from './storage';

export type HistoryBundle = {
  v: 1;
  part: number;
  /** Only in part 1. */
  chats: Chat[];
  messages: Message[];
  /** The app's own lists (names of people, contacts, chat settings), by key. */
  values: Record<string, unknown>;
};

export type HistoryOptions = {
  /** How many of each chat's newest messages go in part 1. */
  recent?: number;
  /** The most messages per chat, both parts together. */
  max?: number;
  /** Values to copy (the app's, never the core's own: group keys belong to one device). */
  valueKeys?: string[];
  now?: number;
};

/** Which messages a website may have. */
function shareable(m: Message, now: number): boolean {
  // Not sent yet, or gone.
  if (m.seq == null || (m.expiresAt && m.expiresAt <= now)) return false;
  // View once stays on the phone, as on WhatsApp.
  return !m.file?.once;
}

/** A copy without what only means something on the phone (where its files are). */
function clean(m: Message): Message {
  if (!m.file) return m;
  const { local: _local, poster: _poster, ...file } = m.file;
  return { ...m, file };
}

/** Builds the parts to send, from this phone's storage. */
export async function exportHistory(storage: Storage, options: HistoryOptions = {}): Promise<HistoryBundle[]> {
  const recent = options.recent ?? 30;
  const max = options.max ?? 2000;
  const now = options.now ?? Date.now();
  const chats = (await storage.listChats()).filter((c) => c.kind !== 'status');

  const first: Message[] = [];
  const older: Message[] = [];
  for (const chat of chats) {
    const latest = (await storage.listMessages(chat.id, { limit: recent })).filter((m) => shareable(m, now));
    first.push(...latest.map(clean));
    if (latest.length < recent || max <= recent) continue;
    const before = latest[0].order;
    const rest = (await storage.listMessages(chat.id, { beforeOrder: before, limit: max - recent })).filter((m) => shareable(m, now));
    older.push(...rest.map(clean));
  }

  const values: Record<string, unknown> = {};
  for (const key of options.valueKeys ?? []) {
    const v = await storage.getValue(key);
    if (v !== null && v !== undefined) values[key] = v;
  }

  const parts: HistoryBundle[] = [{ v: 1, part: 1, chats, messages: first, values }];
  if (older.length) parts.push({ v: 1, part: 2, chats: [], messages: older, values: {} });
  return parts;
}

/** Reads a part. Null if it isn't one. */
export function parseHistory(text: string): HistoryBundle | null {
  try {
    const x = JSON.parse(text) as Partial<HistoryBundle>;
    if (x.v !== 1 || typeof x.part !== 'number' || !Array.isArray(x.chats) || !Array.isArray(x.messages)) return null;
    if (typeof x.values !== 'object' || x.values === null) return null;
    return x as HistoryBundle;
  } catch {
    return null;
  }
}

/**
 * Adds a part to the website's storage. Anything the website already has
 * (it arrived live after linking) wins over the phone's older copy.
 * Returns the chats it touched. Call inside a storage transaction.
 */
export async function importHistory(storage: Storage, bundle: HistoryBundle): Promise<string[]> {
  const touched = new Set<string>();
  const newest = new Map<string, number>();
  for (const m of bundle.messages) {
    if (typeof m?.chatId !== 'string' || typeof m.id !== 'string' || typeof m.author !== 'string') continue;
    if (!(await storage.getMessage(m.chatId, m.author, m.id))) await storage.putMessage(m);
    touched.add(m.chatId);
    newest.set(m.chatId, Math.max(newest.get(m.chatId) ?? 0, m.sentAt));
  }
  for (const chat of bundle.chats) {
    if (typeof chat?.id !== 'string') continue;
    const here = await storage.getChat(chat.id);
    // Unread counts from the phone, plus anything that came here since linking.
    await storage.putChat(restoredChat(chat, here, newest.get(chat.id) ?? null));
    touched.add(chat.id);
  }
  for (const [key, value] of Object.entries(bundle.values)) {
    if (!key.startsWith('app:')) continue;
    const here = await storage.getValue<unknown>(key);
    // Lists of things by id: what this website learned itself wins.
    const merged = isPlain(value) && isPlain(here) ? { ...value, ...here } : (here ?? value);
    await storage.setValue(key, merged);
  }
  return [...touched];
}

const isPlain = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
