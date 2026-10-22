// hooks.ts: how screens read from the core.
//
// Each hook reads from the phone's database straight away and reads again
// whenever the core says something changed (core.emit). So a screen never
// waits for the network: what's on the phone shows at once, and new things
// slide in as they arrive.
import type { Chat, Message } from '@pakchat/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Found } from '../data/sqliteStorage';
import { core, type ChatPrefs, type Person, type Presence } from './core';

type Topic = Parameters<typeof core.on>[0];

/** Re-renders when any of `topics` changes, and returns `read()`. `read` must return the same object when nothing changed. */
function useCore<T>(topics: Topic[], read: () => T): T {
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
};

/** Every chat with its newest message, pinned first, then newest. */
export function useChatList(): ChatRow[] | null {
  // Names and prefs change the rows too, so listen to those as well.
  return useLoaded<ChatRow[] | null>(
    ['chats', 'prefs', 'people', 'auth'],
    async () => {
      if (core.state !== 'signedIn') return [];
      const chats = await core.client.chats();
      const rows: ChatRow[] = [];
      for (const chat of chats) {
        // The newest few, in case the very newest is a disappearing message whose time is up.
        const last = core.forgetExpired(await core.client.messages(chat.id, { limit: 5 })).at(-1);
        const prefs = core.prefs[chat.id] ?? {};
        // A chat with nothing in it yet (just made, or deleted here) only shows once it has something,
        // unless it's a group: groups always show.
        if (!last && chat.kind === 'direct' && !prefs.draft) continue;
        rows.push({ chat, title: core.chatTitle(chat), other: core.otherPerson(chat), last: last ?? null, prefs });
      }
      rows.sort((a, b) => (b.prefs.pinnedAt ?? 0) - (a.prefs.pinnedAt ?? 0) || activity(b) - activity(a));
      return rows;
    },
    null,
    [],
  );
}

const activity = (r: ChatRow) => Math.max(r.chat.lastActivity, r.last?.sentAt ?? 0);

export function useChat(chatId: string): Chat | null | undefined {
  return useLoaded<Chat | null | undefined>(['chats', 'auth'], () => core.storage.getChat(chatId), undefined, [chatId]);
}

// ---- One chat's messages ----

const PAGE = 60;

/** The newest messages of a chat, oldest first. `more()` reaches further back. */
export function useMessages(chatId: string) {
  const [limit, setLimit] = useState(PAGE);
  const loaded = useLoaded<{ list: Message[]; read: number } | null>(
    [`messages:${chatId}`, 'auth'],
    async () => {
      const all = await core.client.messages(chatId, { limit });
      // Disappearing messages: the ones whose time is up are hidden and removed from the phone.
      return { list: core.forgetExpired(all), read: all.length };
    },
    null,
    [chatId, limit],
  );
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
        .then((r) => {
          if (seq.current === mine) setFound(r);
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
