// broadcasts.ts: broadcast lists, like WhatsApp's. A list is some people I
// picked; a message to it goes to each of them in our own one-to-one chat, so
// it looks to them like any message from me, and their replies come there.
// Nobody on the list sees who else is on it.
//
// Lists, and what went to each, are kept only on this phone. The list's page
// shows each message I sent, with how many have read it ("12 of 20 read").
import type { Message, Ref } from '@pakchat/shared';

import { core } from './core';
import { copyFileTo, sendPicked, type Picked } from './files';
import { defaultTimer } from './timer';

export type Broadcast = { id: string; name: string; members: string[]; made: number };

/** One message sent to a list: what it was, and where each copy went. */
export type BroadcastSent = { id: string; list: string; at: number; to: { chatId: string; userId: string; ref: Ref }[] };

/** At most this many people on a list (WhatsApp's limit is 256). */
export const MAX_BROADCAST = 256;
/** How many sent messages a list's page remembers. */
const KEEP = 200;

const LISTS = 'app:broadcasts';
const SENT = 'app:broadcastSent';
let lists: Broadcast[] | null = null;
let sent: BroadcastSent[] | null = null;

async function loadLists() {
  lists ??= (await core.storage.getValue<Broadcast[]>(LISTS)) ?? [];
  return lists;
}

async function loadSent() {
  sent ??= (await core.storage.getValue<BroadcastSent[]>(SENT)) ?? [];
  return sent;
}

async function saveLists(next: Broadcast[]) {
  lists = next;
  await core.storage.setValue(LISTS, next);
  core.emit('broadcasts');
}

async function saveSent(next: BroadcastSent[]) {
  sent = next;
  await core.storage.setValue(SENT, next);
  core.emit('broadcasts');
}

/** My lists, newest first. */
export async function broadcasts() {
  return [...(await loadLists())].sort((a, b) => b.made - a.made);
}

export async function broadcast(id: string) {
  return (await loadLists()).find((b) => b.id === id) ?? null;
}

/** Makes a list, or changes one (`id`). */
export async function saveBroadcast(name: string, members: string[], id?: string) {
  const all = await loadLists();
  const old = id ? all.find((b) => b.id === id) : undefined;
  const b: Broadcast = { id: old?.id ?? core.newId(), name: name.trim(), members: [...new Set(members)].slice(0, MAX_BROADCAST), made: old?.made ?? Date.now() };
  await saveLists([...all.filter((x) => x.id !== b.id), b]);
  return b;
}

/** Deletes a list (the messages it sent stay in each chat). */
export async function dropBroadcast(id: string) {
  await saveLists((await loadLists()).filter((b) => b.id !== id));
  await saveSent((await loadSent()).filter((s) => s.list !== id));
}

/** Signing out: this phone's lists go. */
export async function forgetBroadcasts() {
  lists = [];
  sent = [];
  await core.storage.setValue(LISTS, []);
  await core.storage.setValue(SENT, []);
}

/** What went to a list, oldest first. */
export async function sentTo(listId: string) {
  return (await loadSent()).filter((s) => s.list === listId).sort((a, b) => a.at - b.at);
}

/** The chat with each person on the list (made if there isn't one). */
async function chatsFor(b: Broadcast) {
  const out: { chatId: string; userId: string }[] = [];
  for (const userId of b.members) {
    try {
      out.push({ chatId: (await core.client.openDirect(userId, defaultTimer())).id, userId });
    } catch (err) {
      // Blocked, or gone: skip them, unless nobody gets it.
      if (!out.length && userId === b.members.at(-1)) throw err;
    }
  }
  return out;
}

async function remember(listId: string, sentList: { m: Message; userId: string }[]) {
  if (!sentList.length) return;
  const s: BroadcastSent = { id: core.newId(), list: listId, at: Date.now(), to: sentList.map(({ m, userId }) => ({ chatId: m.chatId, userId, ref: { author: m.author, id: m.id } })) };
  const others = (await loadSent()).filter((x) => x.list !== listId);
  const mine = (await loadSent()).filter((x) => x.list === listId);
  await saveSent([...others, ...[...mine, s].slice(-KEEP)]);
}

/** Sends words to everyone on a list. */
export async function sendBroadcastText(listId: string, text: string) {
  const b = await broadcast(listId);
  if (!b || !text.trim()) return;
  const out: { m: Message; userId: string }[] = [];
  for (const { chatId, userId } of await chatsFor(b)) out.push({ m: await core.client.sendText(chatId, text), userId });
  await remember(listId, out);
}

/**
 * Sends photos, videos or files to everyone on a list. Each is made smaller
 * once, for the first chat; the others get a copy of that (each locked with its
 * own key).
 */
export async function sendBroadcastFiles(listId: string, items: (Picked & { caption?: string })[]) {
  const b = await broadcast(listId);
  if (!b) return;
  const chats = await chatsFor(b);
  if (!chats.length) return;
  for (const { caption, ...p } of items) {
    const first = await sendPicked(chats[0].chatId, p, caption);
    const out = [{ m: first, userId: chats[0].userId }];
    for (const { chatId, userId } of chats.slice(1)) {
      const m = await copyFileTo(chatId, first, { caption });
      if (m) out.push({ m, userId });
    }
    await remember(listId, out);
  }
}

/** Does `work` on every copy of a sent message; fails only if none could be done. */
async function eachCopy(s: BroadcastSent, work: (chatId: string, ref: Ref) => Promise<unknown>) {
  let done = 0;
  let last: unknown = null;
  for (const { chatId, ref } of s.to) {
    try {
      await work(chatId, ref);
      done++;
    } catch (err) {
      // Deleted on their side already, or blocked: the others still change.
      last = err;
    }
  }
  if (!done && last) throw last;
}

/** Changes the words of a message sent to a list, in every chat it went to (within 15 minutes, like WhatsApp). */
export async function editBroadcast(s: BroadcastSent, text: string) {
  if (!text.trim()) return;
  await eachCopy(s, (chatId, ref) => core.client.edit(chatId, ref.id, text.trim()));
}

/** Delete for everyone: every copy goes, in every chat it went to. The list's page shows it as deleted. */
export async function unsendBroadcast(s: BroadcastSent) {
  await eachCopy(s, (chatId, ref) => core.client.deleteForEveryone(chatId, ref));
}

/** Delete for me: gone from the list's page only (the copies stay in each chat). */
export async function forgetBroadcastSent(s: BroadcastSent) {
  await saveSent((await loadSent()).filter((x) => x.id !== s.id));
}

/** How a sent message is doing: how many have it, and how many have read it. */
export async function summaryOf(s: BroadcastSent) {
  let read = 0;
  let delivered = 0;
  let first: Message | null = null;
  const who: { userId: string; status: Message['status'] | 'gone' }[] = [];
  for (const { chatId, userId, ref } of s.to) {
    const m = await core.storage.getMessage(chatId, ref.author, ref.id);
    who.push({ userId, status: m && !m.deleted ? m.status : 'gone' });
    if (!m) continue;
    first ??= m;
    if (m.status === 'read') read++;
    if (m.status === 'read' || m.status === 'delivered') delivered++;
  }
  return { message: first, read, delivered, total: s.to.length, who };
}
