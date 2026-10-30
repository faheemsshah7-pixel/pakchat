// hooks.ts: how screens read the engine (core.ts). Each hook names the
// topics it cares about, and draws again only when one of them changes.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { chatTitle, otherPerson } from '../ui/format';
import { type Chat, type ChatPrefs, core, type Message, type Phase } from './core';

type Topic = Parameters<typeof core.on>[0];

/** A value kept on the core (replaced, never changed in place), read again when a topic fires. */
export function useTopic<T>(topics: Topic[], read: () => T): T {
  const key = topics.join(',');
  const sub = useRef<{ key: string; fn: (cb: () => void) => () => void } | null>(null);
  if (sub.current?.key !== key) {
    sub.current = {
      key,
      fn: (cb) => {
        const offs = topics.map((t) => core.on(t, cb));
        return () => offs.forEach((off) => off());
      },
    };
  }
  return useSyncExternalStore(sub.current.fn, read);
}

export const usePhase = (): Phase => useTopic(['phase'], () => core.phase);
export const useSettings = () => useTopic(['settings'], () => core.settings);
export const useConnected = () => useTopic(['connection'], () => core.connected);
export const usePrefs = () => useTopic(['prefs'], () => core.prefs);
export const usePeople = () => useTopic(['people'], () => core.people);
export const usePresence = (userId: string | null) => useTopic(['presence'], () => (userId ? core.presence[userId] : undefined));
export const useTyping = (chatId: string | null) => useTopic(['typing'], () => (chatId ? core.typing[chatId] : undefined));
export const useViewing = () => useTopic(['chats'], () => core.viewing);
export const useSync = () => useTopic(['sync'], () => core.sync);
export const useQr = () => ({ qr: useTopic(['qr'], () => core.qr), expired: useTopic(['qr'], () => core.qrExpired) });
/** Redraws when a photo finishes downloading. */
export const usePhotos = () => useTopic(['photos'], () => core.photosVersion);

/**
 * Something read from the database. Loads again when a topic fires; changes
 * that come close together make one read, and a slow read never overwrites a
 * newer one.
 */
export function useLoaded<T>(topics: Topic[], load: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let run = 0;
    let queued = false;
    let alive = true;
    const go = () => {
      if (queued) return;
      queued = true;
      // Everything that changes in one go becomes one read.
      queueMicrotask(() => {
        queued = false;
        const mine = ++run;
        loadRef
          .current()
          .then((v) => {
            if (alive && mine === run) setValue(v);
          })
          .catch((err: unknown) => console.warn('[pakchat] read', err));
      });
    };
    go();
    const offs = topics.map((t) => core.on(t, go));
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.join(','), ...deps]);
  return value;
}

// ---- The chat list ----

export type ChatRow = {
  chat: Chat;
  title: string;
  other: string | null;
  last: Message | null;
  prefs: ChatPrefs;
  /** For sorting: the newest of its last message, activity and draft. */
  at: number;
};

/** Every chat for the list, pinned first, then newest. Statuses, communities and call links aren't in it. */
export function useChatRows(): ChatRow[] | null {
  return useLoaded<ChatRow[] | null>(['chats', 'prefs', 'people', 'phase'], chatRows, [], null);
}

/** The chat list as it is now, read once (for shortcuts like Next chat). */
export const chatRowsNow = () => chatRows();

async function chatRows(): Promise<ChatRow[]> {
  if (!core.client?.me) return [];
  const [chats, newest] = await Promise.all([core.storage.listChats(), core.storage.newestOfEach()]);
  const now = Date.now();
  const rows: ChatRow[] = [];
  for (const chat of chats) {
    if (chat.kind === 'status' || chat.kind === 'community' || chat.callLink) continue;
    const prefs = core.prefs[chat.id] ?? {};
    if (prefs.lock === 'folder') continue;
    let last = newest.get(chat.id) ?? null;
    if (last?.expiresAt && last.expiresAt <= now) {
      last = (await core.storage.listMessages(chat.id, { limit: 20 })).filter((m) => !m.expiresAt || m.expiresAt > now).at(-1) ?? null;
    }
    if (!last && chat.kind === 'direct' && !prefs.draft) continue;
    if (prefs.deletedAt && (!last || last.sentAt <= prefs.deletedAt)) continue;
    const at = Math.max(chat.lastActivity, last?.sentAt ?? 0, prefs.draft ? (prefs.draftAt ?? 0) : 0);
    rows.push({ chat, title: chatTitle(chat), other: otherPerson(chat), last, prefs, at });
  }
  rows.sort((a, b) => (b.prefs.pinnedAt ?? 0) - (a.prefs.pinnedAt ?? 0) || b.at - a.at);
  return rows;
}

export function useChat(chatId: string | null): Chat | null {
  return useLoaded<Chat | null>(['chats'], async () => (chatId ? core.storage.getChat(chatId) : null), [chatId], null);
}

// ---- Messages ----

const PAGE = 60;

/**
 * A chat's messages, oldest first: the newest page, and older ones as
 * `more()` asks for them (scrolling up). `all` is true once the start is reached.
 */
export function useMessages(chatId: string) {
  const [limit, setLimit] = useState(PAGE);
  // A different chat starts again from its newest page.
  const [forChat, setForChat] = useState(chatId);
  if (forChat !== chatId) {
    setForChat(chatId);
    setLimit(PAGE);
  }
  const list = useLoaded<{ chatId: string; messages: Message[]; all: boolean } | null>(
    [`messages:${chatId}`],
    async () => {
      const got = await core.storage.listMessages(chatId, { limit });
      const now = Date.now();
      return { chatId, messages: got.filter((m) => !m.expiresAt || m.expiresAt > now), all: got.length < limit };
    },
    [chatId, limit],
    null,
  );
  const mine = list?.chatId === chatId ? list : null;
  return {
    messages: mine?.messages ?? null,
    all: mine?.all ?? false,
    more: () => {
      if (mine && !mine.all) setLimit((n) => Math.max(n, mine.messages.length) + PAGE);
    },
  };
}

/** Ticks every so often, for times like "last seen today at…" that age. */
export function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
