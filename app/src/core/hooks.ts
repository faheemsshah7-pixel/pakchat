// hooks.ts: how screens read from the core.
//
// Each hook reads from the phone's database straight away and reads again
// whenever the core says something changed (core.emit). So a screen never
// waits for the network: what's on the phone shows at once, and new things
// slide in as they arrive.
import type { Chat, Message } from '@pakchat/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Found } from '../data/sqliteStorage';
import { broadcast, broadcasts, sentTo, summaryOf, type Broadcast, type BroadcastSent } from './broadcasts';
import { core, type AppSettings, type ChatPrefs, type Person, type Presence } from './core';
import { calls, callLog, onCallLog, type CallLogEntry, type CallView } from './calls';
import { moving } from './files';
import { loadStatuses, type StatusPerson } from './status';
import { isAppLocked } from './lock';
import { upcomingPlans, type PlanNote } from './plans';
import { scheduled, type Planned } from './scheduled';
import { recentStickers, savedAs, savedStickers, type SavedSticker } from './stickers';

type Topic = Parameters<typeof core.on>[0];

/** Re-renders when any of `topics` changes, and returns `read()`. `read` must return the same object when nothing changed. */
export function useCore<T>(topics: Topic[], read: () => T): T {
  const key = topics.join('|');
  const subscribe = useCallback(
    (changed: () => void) => {
      const offs = key.split('|').map((t) => core.on(t as Topic, changed));
      return () => offs.forEach((off) => off());
    },
    [key],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/** Calls `load` now and again on every change to `topics`, keeping the newest answer. */
function useLoaded<T>(topics: Topic[], load: () => Promise<T>, initial: T, deps: unknown[]): T {
  const [value, setValue] = useState<T>(initial);
  const key = topics.join('|');
  useEffect(() => {
    let alive = true;
    let running = false;
    let again = false;
    // If changes come quickly, run once more after the current read instead of many at once.
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        try {
          const v = await load();
          if (alive) setValue(v);
        } catch {
          // The database is closed while signing out; the next change reads again.
        }
      } while (again && alive);
      running = false;
    };
    void run();
    const offs = key.split('|').map((t) => core.on(t as Topic, () => void run()));
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
  return value;
}

// ---- Signing in ----

export function useAuth() {
  const state = useCore(['auth'], () => core.state);
  const me = useCore(['auth'], () => core.me);
  return { state, me, myId: core.myId };
}

export function useConnected() {
  return useCore(['connection'], () => core.connected);
}

// ---- The chat list ----

export type ChatRow = {
  chat: Chat;
  title: string;
  /** The other person, in a one-to-one chat. */
  other: string | null;
  last: Message | null;
  prefs: ChatPrefs;
  /** Something unread @mentions me or replies to me: an "@" on the row, like WhatsApp. */
  mentioned: boolean;
};

/**
 * Every chat as last read, kept in memory, so a chat opens with its name, picture
 * and message box already there (not a "?" for a moment). Filled by the chat
 * list and by each chat read; the database is still read straight after.
 */
const chatCache = new Map<string, Chat>();
core.on('auth', () => chatCache.clear());

/** Every chat with its newest message, pinned first, then newest. */
export function useChatList(): ChatRow[] | null {
  // Chats in the Locked chats folder only show there (useLockedChats).
  return useLoaded<ChatRow[] | null>(['chats', 'prefs', 'people', 'auth'], () => chatRows((c) => core.prefs[c.id]?.lock !== 'folder'), null, []);
}

/** The chats in the Locked chats folder (only once it's opened). */
export function useLockedChats(): ChatRow[] | null {
  return useLoaded<ChatRow[] | null>(['chats', 'prefs', 'people', 'auth'], () => chatRows((c) => core.prefs[c.id]?.lock === 'folder'), null, []);
}

async function chatRows(keep: (chat: Chat) => boolean): Promise<ChatRow[]> {
  if (core.state !== 'signedIn') return [];
  const chats = await core.client.chats();
  for (const chat of chats) chatCache.set(chat.id, chat);
  const rows: ChatRow[] = [];
  for (const chat of chats) {
    // Statuses have their own tab, communities theirs, and call links are in Calls.
    if (chat.kind === 'status' || chat.kind === 'community' || chat.callLink || !keep(chat)) continue;
    // The newest few, in case the very newest is a disappearing message whose time is up.
    // In a group, the unread ones too (up to 50), to see if any is for me.
    const unread = chat.kind === 'group' ? Math.min(chat.unread, 50) : 0;
    const recent = core.forgetExpired(await core.client.messages(chat.id, { limit: Math.max(5, unread) }));
    const last = recent.at(-1);
    const mentioned = unread > 0 && recent.slice(-unread).some((m) => m.author !== core.myId && !m.deleted && (m.mentions?.includes(core.myId) || m.replyTo?.author === core.myId));
    const prefs = core.prefs[chat.id] ?? {};
    // A chat with nothing in it yet (just made, or deleted here) only shows once it has something,
    // unless it's a group: groups always show.
    if (!last && chat.kind === 'direct' && !prefs.draft) continue;
    // Deleted here: gone from the list until something new comes in.
    if (!last && prefs.deletedAt) continue;
    rows.push({ chat, title: core.chatTitle(chat), other: core.otherPerson(chat), last: last ?? null, prefs, mentioned });
  }
  rows.sort((a, b) => (b.prefs.pinnedAt ?? 0) - (a.prefs.pinnedAt ?? 0) || activity(b) - activity(a));
  return rows;
}

/** My communities, each with its groups on this phone (announcements first), for the Communities tab. */
export type CommunityRow = { community: Chat; groups: ChatRow[] };

export function useCommunities(): CommunityRow[] | null {
  const rows = useChatList();
  const all = useLoaded<Chat[] | null>(
    ['chats', 'auth'],
    async () => (core.state === 'signedIn' ? (await core.client.chats()).filter((c) => c.kind === 'community' && !c.left) : []),
    null,
    [],
  );
  if (!all || !rows) return null;
  return all
    .map((community) => ({
      community,
      groups: rows.filter((r) => r.chat.communityId === community.id && !r.chat.left).sort((a, b) => Number(!!b.chat.announcements) - Number(!!a.chat.announcements)),
    }))
    .sort((a, b) => Math.max(0, ...b.groups.map(activity)) - Math.max(0, ...a.groups.map(activity)));
}

const activity = (r: ChatRow) => Math.max(r.chat.lastActivity, r.last?.sentAt ?? 0, r.prefs.draft ? (r.prefs.draftAt ?? 0) : 0);

export function useChat(chatId: string): Chat | null | undefined {
  return useLoaded<Chat | null | undefined>(
    ['chats', 'auth'],
    async () => {
      const chat = await core.storage.getChat(chatId);
      if (chat) chatCache.set(chatId, chat);
      else chatCache.delete(chatId);
      return chat;
    },
    chatCache.get(chatId),
    [chatId],
  );
}

// ---- One chat's messages ----

const PAGE = 60;

/** The newest messages of a chat, oldest first. `more()` reaches further back. */
type Page = { list: Message[]; read: number };

/**
 * The newest page of each chat opened (or warmed) lately, kept in memory, so
 * a chat opens with its messages already drawn instead of empty for a moment.
 * The database is still read straight after, so nothing stale stays.
 */
const pages = new Map<string, Page>();
// Signing out (or in as someone else) forgets them.
core.on('auth', () => pages.clear());

async function readPage(chatId: string, limit: number): Promise<Page> {
  const all = await core.client.messages(chatId, { limit });
  // Disappearing messages: the ones whose time is up are hidden and removed from the phone.
  const page = { list: core.forgetExpired(all), read: all.length };
  if (limit === PAGE) {
    pages.set(chatId, page);
    // Only the last few dozen chats are kept.
    if (pages.size > 40) pages.delete(pages.keys().next().value!);
  }
  return page;
}

/** Reads the newest messages of some chats ahead of time (the top of the chat list). */
export function warmChats(chatIds: string[]) {
  void (async () => {
    for (const id of chatIds) {
      if (pages.has(id)) continue;
      try {
        await readPage(id, PAGE);
      } catch {
        return;
      }
    }
  })();
}

export function useMessages(chatId: string) {
  const [limit, setLimit] = useState(PAGE);
  const loaded = useLoaded<Page | null>([`messages:${chatId}`, 'auth'], () => readPage(chatId, limit), pages.get(chatId) ?? null, [chatId, limit]);
  // A full page means there may be older ones (counted before hiding any, so paging never stops early).
  const hasMore = (loaded?.read ?? 0) >= limit;
  const more = useCallback(() => {
    if (hasMore) setLimit((l) => l + PAGE);
  }, [hasMore]);
  return { list: loaded?.list ?? null, more, hasMore };
}

// ---- People ----

export function usePerson(userId: string | null | undefined): Person | null {
  const p = useCore(['people', 'auth'], () => (userId ? (userId === core.myId && core.me ? meAsPerson() : (core.people[userId] ?? null)) : null));
  useEffect(() => {
    if (userId && !core.people[userId] && userId !== core.myId) void core.person(userId).catch(() => {});
  }, [userId]);
  return p;
}

let meCache: { me: unknown; person: Person } | null = null;
function meAsPerson(): Person {
  const me = core.me!;
  if (meCache?.me !== me) meCache = { me, person: { id: me.id, name: me.name, about: me.about, photo: me.photo } };
  return meCache.person;
}

/** Re-renders when names change. For lists that show many names. */
export function usePeople() {
  return useCore(['people'], () => core.people);
}

/** Online and last seen, while the screen is open. */
export function usePresence(userId: string | null | undefined): Presence | null {
  useEffect(() => {
    if (!userId || userId === core.myId) return;
    core.watch(userId);
    return () => core.unwatch(userId);
  }, [userId]);
  return useCore(['presence'], () => (userId ? (core.presence[userId] ?? null) : null));
}

/** Everyone's online dots, for the chat list (which follows the people on screen). */
export function useAllPresence() {
  return useCore(['presence'], () => core.presence);
}

/** Who is typing in a chat right now (not me). */
export function useTyping(chatId: string | null): string[] {
  const now = useCore(['typing'], () => (chatId ? core.typing[chatId] : undefined));
  return now ? Object.keys(now).filter((id) => id !== core.myId) : [];
}

/** Typing in every chat, for the chat list. */
export function useAllTyping() {
  return useCore(['typing'], () => core.typing);
}

/** The people I've blocked, fetched when first asked for. */
export function useBlocked() {
  useEffect(() => {
    void core.loadBlocked().catch(() => {});
  }, []);
  return useCore(['blocked'], () => core.blocked);
}

const NO_PREFS: ChatPrefs = {};

/** One chat's own settings on this phone (muted, pinned…), kept up to date. */
/** This phone's own settings (phase 7). */
export function useSettings(): AppSettings {
  return useCore(['settings'], () => core.settings);
}

export function useChatPrefs(chatId: string): ChatPrefs {
  return useCore(['prefs'], () => core.prefs[chatId] ?? NO_PREFS);
}

export function useStarred() {
  return useCore(['prefs'], () => core.starred);
}

/** Your own chat lists (the chips after Groups). */
export function useLists() {
  return useCore(['prefs'], () => core.lists);
}

// ---- Search ----

/** Searches the messages on this phone as you type (a short wait so every key isn't a search). */
export function useSearch(query: string): Found[] {
  const [found, setFound] = useState<Found[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (!query.trim()) return;
    const t = setTimeout(() => {
      core.storage
        .search(query, 60)
        .then(async (r) => {
          // Statuses aren't chats you can open, and a locked chat's words never show here: leave them out.
          const status = new Set((await core.client.chats()).filter((c) => c.kind === 'status' || !!core.prefs[c.id]?.lock).map((c) => c.id));
          if (seq.current === mine) setFound(r.filter((f) => !status.has(f.chatId)));
        })
        .catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [query]);
  return query.trim() ? found : [];
}

/** A clock that ticks every `ms`, for "last seen 5 minutes ago" and disappearing messages. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---- Files ----

/** How far a file has moved (0 to 1) while it uploads or downloads, else undefined. */
export function useFileProgress(tag: string): number | undefined {
  return useCore(['files'], () => moving[tag]);
}

// ---- Calls ----

let lastView: CallView | null = null;
let viewStale = true;
calls.on(() => {
  viewStale = true;
});
const readCall = () => {
  if (viewStale) {
    lastView = calls.view();
    viewStale = false;
  }
  return lastView;
};

/** The call going on now (or ringing), or null. */
export function useCall(): CallView | null {
  return useSyncExternalStore(
    (changed) => calls.on(changed),
    readCall,
    readCall,
  );
}

/** Every call, newest first, for the Calls tab. */
export function useCallLog(): CallLogEntry[] | null {
  const [list, setList] = useState<CallLogEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void callLog()
        .then((l) => alive && setList(l))
        .catch(() => {});
    load();
    const off = onCallLog(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}

/** My favourite chats (Calls tab, and New call's "Add favourite"), even one with nothing in it yet. */
export function useFavouriteChats(): Chat[] {
  return useLoaded<Chat[]>(
    ['chats', 'prefs', 'people', 'auth'],
    async () => (core.state === 'signedIn' ? (await core.client.chats()).filter((c) => core.prefs[c.id]?.favourite && c.kind !== 'status' && c.kind !== 'community' && !c.callLink) : []),
    [],
    [],
  );
}

/** Missed calls since I last looked at Calls: the number on its tab, like WhatsApp. */
export function useMissedCalls(): number {
  const list = useCallLog();
  const seen = useSettings().callsSeenAt ?? 0;
  return (list ?? []).filter((e) => e.missed && e.direction === 'in' && e.at > seen).length;
}

// ---- Status ----

/** My status and everyone else's, newest first (statuses older than a day are gone). */
export function useStatuses(): { mine: StatusPerson | null; others: StatusPerson[] } | null {
  return useLoaded<{ mine: StatusPerson | null; others: StatusPerson[] } | null>(
    ['chats', 'prefs', 'people', 'auth'],
    async () => (core.state === 'signedIn' ? loadStatuses() : { mine: null, others: [] }),
    null,
    [],
  );
}

// ---- Stickers ----

/** My saved stickers, newest first. */
export function useSavedStickers(): SavedSticker[] {
  return useLoaded(['stickers'], async () => savedStickers(), [], []);
}

/** The stickers I sent lately, newest first (see recentStickers). */
export function useRecentStickers(): (string | number)[] {
  return useLoaded(['stickers'], async () => recentStickers(), [], []);
}

/** Whether this sticker picture is one of my saved ones (null while checking, or with no file). */
export function useStickerSaved(uri: string | null | undefined): boolean | null {
  return useLoaded(['stickers'], async () => (uri ? !!(await savedAs(uri)) : null), null, [uri]);
}

/** Messages scheduled for later in a chat (scheduled.ts), soonest first. */
export function useScheduled(chatId: string): Planned[] {
  return useLoaded(['scheduled'], async () => scheduled(chatId), [], [chatId]);
}

/** My broadcast lists, newest first. */
export function useBroadcasts(): Broadcast[] | null {
  return useLoaded<Broadcast[] | null>(['broadcasts', 'auth'], () => broadcasts(), null, []);
}

export function useBroadcast(id: string): Broadcast | null | undefined {
  return useLoaded<Broadcast | null | undefined>(['broadcasts'], () => broadcast(id), undefined, [id]);
}

/** What went to a list, each with how it's doing ("12 of 20 read"), kept fresh as the ticks change. */
export function useBroadcastSent(listId: string) {
  const sent = useLoaded<BroadcastSent[]>(['broadcasts'], () => sentTo(listId), [], [listId]);
  const chats = [...new Set(sent.flatMap((s) => s.to.map((x) => x.chatId)))];
  return useLoaded(
    ['broadcasts', ...chats.map((c) => `messages:${c}` as const)],
    () => Promise.all(sent.map(async (s) => ({ sent: s, ...(await summaryOf(s)) }))),
    [],
    [sent],
  );
}

/** Scheduled calls coming up (Calls tab). */
export function useUpcomingPlans(): PlanNote[] {
  return useLoaded<PlanNote[]>(['calls', 'auth'], () => upcomingPlans(), [], []);
}

/** Who's in a call link's call now (Calls tab, and the link's page). */
export function useLinkCall(chatId: string | null) {
  return useLoaded(['calls'], async () => (chatId ? calls.linkCall(chatId) : null), null, [chatId]);
}

/** My call links (chats of their own, kept out of the chat list), newest first. */
export function useCallLinks(): Chat[] {
  return useLoaded<Chat[]>(
    ['chats', 'auth'],
    async () => (core.state === 'signedIn' ? (await core.client.chats()).filter((c) => c.callLink && !c.left).sort((a, b) => b.lastActivity - a.lastActivity) : []),
    [],
    [],
  );
}

/** App lock is showing. */
export function useAppLocked(): boolean {
  return useCore(['lock', 'settings'], () => isAppLocked());
}

