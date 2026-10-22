// core.ts: the one place the app talks to PakChat's shared core (../shared).
//
// It opens the phone's database, makes the PakChat client with our Signal
// module, and keeps a few things only this phone knows: people's names,
// which chats are pinned, archived, muted or favourite, drafts, and starred
// messages. Screens read from here (through hooks.ts) and never wait for the
// network: the database answers first, and the network only updates it.
import {
  HttpServer,
  OfflineError,
  PakChat,
  phoenixConnection,
  type Chat,
  type Me,
  type Message,
  type Session,
} from '@pakchat/shared';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import KV from 'expo-sqlite/kv-store';

import { loadSignal } from '../../modules/pakchat-signal';
import type { SqliteStorage } from '../data/sqliteStorage';
import { openStorage } from './db';

export type Person = { id: string; name: string; about?: string | null; photo?: string | null };

/** Things about a chat that only this phone knows. */
export type ChatPrefs = {
  pinnedAt?: number;
  archived?: boolean;
  muted?: boolean;
  favourite?: boolean;
  markedUnread?: boolean;
  draft?: string;
};

/** A list you made yourself (like "Family" or "Work"), shown as a chip above the chats. */
export type ChatList = { id: string; name: string; chatIds: string[] };

export type Presence = { online: boolean; lastSeen: string | null };

type Topic = 'auth' | 'chats' | 'people' | 'prefs' | 'connection' | 'typing' | 'presence' | 'blocked' | `messages:${string}`;

// ---- Where the server is ----

const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; googleWebClientId?: string };
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId ?? '';

/** How an Android emulator reaches the Mac it runs on. */
const EMULATOR_SERVER = 'http://10.0.2.2:4000';

/**
 * The server's address. On a phone that's the Mac's address on the Wi-Fi, set on the sign-in screen.
 * On an emulator it starts as the Mac itself, so the emulator tests never have to type it in.
 */
export function serverUrl(): string {
  const saved = KV.getItemSync('serverUrl');
  if (saved) return saved;
  if (!Device.isDevice) return EMULATOR_SERVER;
  return extra.serverUrl ?? 'http://localhost:4000';
}

export function setServerUrl(url: string) {
  KV.setItemSync('serverUrl', url.trim().replace(/\/+$/, ''));
}

const socketUrl = (http: string) => `${http.replace(/^http/, 'ws')}/socket`;

// Older phones' JavaScript may not have AbortSignal.timeout, which the core uses.
if (typeof AbortSignal !== 'undefined' && !(AbortSignal as { timeout?: unknown }).timeout) {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  };
}

// ---- The core ----

class Core {
  storage!: SqliteStorage;
  client!: PakChat;
  private server!: HttpServer;
  private listeners = new Map<Topic, Set<() => void>>();
  private ready: Promise<void> | null = null;

  state: 'loading' | 'signedOut' | 'signedIn' = 'loading';
  connected = false;
  people: Record<string, Person> = {};
  prefs: Record<string, ChatPrefs> = {};
  starred: Record<string, true> = {};
  lists: ChatList[] = [];
  /** chatId → userId → when they started typing. */
  typing: Record<string, Record<string, number>> = {};
  presence: Record<string, Presence> = {};

  // ---- Change notices for the screens ----

  on(topic: Topic, fn: () => void) {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  emit(topic: Topic) {
    for (const fn of this.listeners.get(topic) ?? []) fn();
  }

  // ---- Starting up ----

  /** Opens everything once. Safe to call many times. */
  init() {
    this.ready ??= this.start();
    return this.ready;
  }

  /** What starting up is doing right now, so a stuck start can say where it stuck. */
  step = 'starting';

  // Each step also goes to the phone's log (adb logcat, tag ReactNativeJS), so a
  // stuck start can be traced even when nothing shows on screen.
  private at(step: string) {
    this.step = step;
    console.log(`[pakchat] start: ${step}`);
  }

  /** Starting up failed: forget it, so init() tries again from the beginning. */
  retry() {
    this.ready = null;
    this.step = 'starting';
    return this.init();
  }

  private async start() {
    this.at('opening the database');
    this.storage = await openStorage();
    this.at('reading saved names and settings');
    this.people = (await this.storage.getValue<Record<string, Person>>('app:people')) ?? {};
    this.prefs = (await this.storage.getValue<Record<string, ChatPrefs>>('app:prefs')) ?? {};
    this.starred = (await this.storage.getValue<Record<string, true>>('app:starred')) ?? {};
    this.lists = (await this.storage.getValue<ChatList[]>('app:lists')) ?? [];
    this.at('loading the encryption');
    this.makeClient();
    this.at('opening your keys');
    const signedIn = await this.client.load();
    this.at('ready');
    if (signedIn) {
      this.state = 'signedIn';
      this.afterSignIn();
    } else {
      this.state = 'signedOut';
    }
    this.emit('auth');
  }

  private makeClient() {
    this.server = new HttpServer(serverUrl());
    this.client = new PakChat({
      signal: loadSignal(),
      storage: this.storage,
      server: this.server,
      connect: phoenixConnection(socketUrl(serverUrl())),
      deviceName: Device.modelName ?? 'Android phone',
      newId: () => Crypto.randomUUID(),
    });
    this.client.on('message', (m) => {
      this.emit(`messages:${m.chatId}`);
      this.emit('chats');
    });
    this.client.on('chat', () => {
      this.emit('chats');
      // Someone new may have started a chat with me, or joined a group: get their name.
      this.namesSoon();
    });
    this.client.on('connection', (c) => {
      this.connected = c;
      this.emit('connection');
      if (c) this.rewatch();
    });
    this.client.on('typing', ({ chatId, userId, typing }) => {
      const now = { ...(this.typing[chatId] ?? {}) };
      if (typing) now[userId] = Date.now();
      else delete now[userId];
      this.typing = { ...this.typing, [chatId]: now };
      this.emit('typing');
      // "typing…" goes away by itself if the "stopped" note never comes.
      if (typing) setTimeout(() => this.clearTyping(chatId, userId), 6_000);
    });
    this.client.on('presence', (p) => this.setPresence(p));
  }

  private clearTyping(chatId: string, userId: string) {
    const at = this.typing[chatId]?.[userId];
    if (at && Date.now() - at >= 5_500) {
      const now = { ...this.typing[chatId] };
      delete now[userId];
      this.typing = { ...this.typing, [chatId]: now };
      this.emit('typing');
    }
  }

  private afterSignIn() {
    this.client.start();
    // Fill in anything missed while signed out, and everyone's names.
    void this.client
      .syncChats()
      .then(() => this.loadPeople())
      .catch(() => {});
    void this.loadPeople();
  }

  get me(): Me | null {
    return this.client?.me?.me ?? null;
  }

  get myId(): string {
    return this.client?.me?.userId ?? '';
  }

  /** Signs in with the token Google gave us. */
  signIn(googleIdToken: string) {
    return this.signInWith(() => this.client.signIn(googleIdToken));
  }

  /** Emulator tests only: a pretend account, when the Mac's server allows it. */
  signInForTest(name: string) {
    const email = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.')}@test.pakchat`;
    return this.signInWith(() => this.client.signInWith((device, keys) => this.server.signInForTest(email, name.trim(), device, keys)));
  }

  /** Does the server offer pretend accounts? (Only a Mac started for the emulator tests.) */
  async testSignInOn() {
    await this.init();
    return new HttpServer(serverUrl(), 3_000).testSignInOn();
  }

  private async signInWith(signIn: () => Promise<Session>) {
    await this.init();
    // A different server address may have been typed in on the sign-in screen.
    this.client.stop();
    this.makeClient();
    const previous = await this.storage.getValue<string>('app:lastUser');
    const session = await signIn();
    // Someone else on this phone: start with a clean slate.
    if (previous && previous !== session.userId) {
      await this.storage.wipe();
      await this.storage.setValue('session', session);
      this.people = {};
      this.prefs = {};
      this.starred = {};
      this.lists = [];
      this.blocked = null;
      this.presence = {};
      this.typing = {};
    }
    await this.storage.setValue('app:lastUser', session.userId);
    this.remember({ id: session.userId, name: session.me.name, about: session.me.about, photo: session.me.photo });
    this.state = 'signedIn';
    this.afterSignIn();
    this.emit('auth');
    this.emit('chats');
  }

  /** The server moved (the Mac's Wi-Fi address changed): save the new address and reconnect there, still signed in. */
  async changeServer(url: string) {
    setServerUrl(url);
    if (this.state !== 'signedIn') return;
    this.client.stop();
    this.makeClient();
    if (await this.client.load()) this.afterSignIn();
  }

  async signOut() {
    await this.client.signOut();
    this.state = 'signedOut';
    this.connected = false;
    this.emit('auth');
    this.emit('connection');
  }

  // ---- My own profile and privacy ----

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = this.client.me?.token;
    const res = await fetch(`${serverUrl()}/api${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new OfflineError('offline');
    });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((json as { error?: string }).error ?? res.status));
    return json as T;
  }

  /** Changes my name, about, or privacy. The server answers with the new me. */
  async updateMe(change: { name?: string; about?: string; privacy?: { last_seen?: string; online?: string; read_receipts?: boolean } }) {
    const wire = await this.call<{ id: string; email: string; name: string; about: string | null; photo: string | null; privacy: { last_seen: string; online: string; read_receipts: boolean } }>(
      'PATCH',
      '/me',
      change,
    );
    const s = this.client.me;
    if (s) {
      s.me = {
        id: wire.id,
        email: wire.email,
        name: wire.name,
        about: wire.about,
        photo: wire.photo,
        privacy: { lastSeen: wire.privacy.last_seen, online: wire.privacy.online, readReceipts: wire.privacy.read_receipts },
      };
      await this.storage.setValue('session', s);
      this.remember({ id: wire.id, name: wire.name, about: wire.about, photo: wire.photo });
    }
    this.emit('auth');
  }

  // ---- People ----

  private remember(p: Person) {
    this.people = { ...this.people, [p.id]: p };
    void this.storage.setValue('app:people', this.people);
    this.emit('people');
  }

  name(userId: string): string {
    if (userId === this.myId) return this.me?.name ?? '';
    return this.people[userId]?.name ?? '';
  }

  /** Fetches the names of everyone in my chats that this phone doesn't know yet. */
  async loadPeople(force = false) {
    const chats = await this.storage.listChats();
    const ids = new Set<string>();
    for (const c of chats) for (const m of c.members) if ((force || !this.people[m.userId]) && !this.asking.has(m.userId)) ids.add(m.userId);
    for (const id of ids) {
      this.asking.add(id);
      await this.person(id, true)
        .catch(() => {})
        .finally(() => this.asking.delete(id));
    }
  }

  /** People whose names are being fetched right now (so two screens don't ask twice). */
  private asking = new Set<string>();
  private namesTimer: ReturnType<typeof setTimeout> | null = null;

  /** Looks up new names shortly (many chat changes in a row make one lookup). */
  private namesSoon() {
    if (this.namesTimer) clearTimeout(this.namesTimer);
    this.namesTimer = setTimeout(() => {
      this.namesTimer = null;
      if (this.state === 'signedIn') void this.loadPeople().catch(() => {});
    }, 300);
  }

  async person(userId: string, refresh = false): Promise<Person | null> {
    if (!refresh && this.people[userId]) return this.people[userId];
    const p = await this.call<Person>('GET', `/users/${encodeURIComponent(userId)}`);
    this.remember(p);
    return p;
  }

  /** Finds someone by their Gmail address ("ali" means ali@gmail.com). Null if they haven't joined. */
  async lookup(email: string) {
    const q = email.trim().toLowerCase();
    if (!q) return null;
    const found = await this.server.lookup(q.includes('@') ? q : `${q}@gmail.com`);
    if (found) this.remember({ id: found.id, name: found.name });
    return found;
  }

  // ---- Blocking ----

  /** The people I've blocked (null until asked). The server stops passing on anything from them. */
  blocked: Person[] | null = null;

  async loadBlocked() {
    const r = await this.call<{ blocked: Person[] }>('GET', '/blocks');
    this.blocked = r.blocked;
    this.emit('blocked');
  }

  async block(userId: string, on: boolean) {
    await this.call(on ? 'PUT' : 'DELETE', `/blocks/${encodeURIComponent(userId)}`);
    await this.loadBlocked().catch(() => {});
  }

  // ---- Online and last seen ----

  /** Who we follow, and how many screens want them (the chat list and a chat can both ask). */
  private watching = new Map<string, number>();

  private setPresence(p: Record<string, unknown>) {
    const id = String(p.user_id ?? '');
    if (!id) return;
    this.presence = { ...this.presence, [id]: { online: p.online === true, lastSeen: (p.last_seen as string | null) ?? null } };
    this.emit('presence');
  }

  watch(userId: string) {
    const n = this.watching.get(userId) ?? 0;
    this.watching.set(userId, n + 1);
    if (n === 0) this.follow(userId);
  }

  unwatch(userId: string) {
    const n = this.watching.get(userId) ?? 0;
    if (n > 1) return void this.watching.set(userId, n - 1);
    this.watching.delete(userId);
    this.client.unwatch(userId).catch(() => {});
  }

  private follow(userId: string) {
    this.client
      .watch(userId)
      .then((p) => this.setPresence(p))
      .catch(() => {});
  }

  private rewatch() {
    for (const id of this.watching.keys()) this.follow(id);
  }

  // ---- This phone's own notes about chats ----

  setPrefs(chatId: string, change: Partial<ChatPrefs>) {
    const next = { ...this.prefs[chatId], ...change };
    for (const k of Object.keys(next) as (keyof ChatPrefs)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    this.prefs = { ...this.prefs, [chatId]: next };
    void this.storage.setValue('app:prefs', this.prefs);
    this.emit('prefs');
  }

  /** Adds a new list, or changes one (same id). Lists are only on this phone. */
  saveList(list: ChatList) {
    const others = this.lists.filter((l) => l.id !== list.id);
    const at = this.lists.findIndex((l) => l.id === list.id);
    this.lists = at === -1 ? [...others, list] : [...others.slice(0, at), list, ...others.slice(at)];
    void this.storage.setValue('app:lists', this.lists);
    this.emit('prefs');
  }

  deleteList(id: string) {
    this.lists = this.lists.filter((l) => l.id !== id);
    void this.storage.setValue('app:lists', this.lists);
    this.emit('prefs');
  }

  isStarred(m: Pick<Message, 'chatId' | 'author' | 'id'>) {
    return !!this.starred[`${m.chatId}/${m.author}/${m.id}`];
  }

  setStarred(list: Pick<Message, 'chatId' | 'author' | 'id'>[], on: boolean) {
    const next = { ...this.starred };
    for (const m of list) {
      const k = `${m.chatId}/${m.author}/${m.id}`;
      if (on) next[k] = true;
      else delete next[k];
    }
    this.starred = next;
    void this.storage.setValue('app:starred', next);
    for (const chatId of new Set(list.map((m) => m.chatId))) this.emit(`messages:${chatId}`);
  }

  /** "Delete for me": only from this phone. */
  async deleteForMe(list: Pick<Message, 'chatId' | 'author' | 'id'>[]) {
    const byChat = new Map<string, { author: string; id: string }[]>();
    for (const m of list) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), { author: m.author, id: m.id }]);
    for (const [chatId, refs] of byChat) {
      await this.client.deleteHere(chatId, refs);
      this.emit(`messages:${chatId}`);
    }
    this.emit('chats');
  }

  /** Deletes a whole chat from this phone (it comes back if someone writes again). */
  async deleteChatHere(chatId: string) {
    const all = await this.storage.listMessages(chatId, { limit: 100_000 });
    await this.client.deleteHere(chatId, all);
    this.setPrefs(chatId, { archived: false, pinnedAt: undefined });
    this.emit(`messages:${chatId}`);
    this.emit('chats');
  }

  /** Disappearing messages whose time is up are removed from the phone, not just hidden. */
  forgetExpired(list: Message[]) {
    const now = Date.now();
    const gone = list.filter((m) => m.expiresAt && m.expiresAt <= now);
    if (!gone.length) return list;
    // Each one is removed once, even if a screen reads it again while that's happening.
    const fresh = gone.filter((m) => !this.forgetting.has(`${m.chatId}/${m.author}/${m.id}`));
    for (const m of fresh) this.forgetting.add(`${m.chatId}/${m.author}/${m.id}`);
    if (fresh.length) void this.deleteForMe(fresh).catch(() => {});
    return list.filter((m) => !gone.includes(m));
  }

  private forgetting = new Set<string>();

  /** The chat's name: the group's title, or the other person's name. */
  chatTitle(chat: Chat): string {
    if (chat.kind === 'group') return chat.title ?? '';
    const other = chat.members.find((m) => m.userId !== this.myId)?.userId ?? this.myId;
    return this.name(other) || '…';
  }

  otherPerson(chat: Chat): string | null {
    if (chat.kind === 'group') return null;
    return chat.members.find((m) => m.userId !== this.myId)?.userId ?? this.myId;
  }
}

export const core = new Core();
export { isOffline };

function isOffline(err: unknown) {
  return err instanceof OfflineError;
}
