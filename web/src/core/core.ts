// core.ts: the website's engine. It holds the shared PakChat core (signing
// in by QR, locking messages, the outbox, the live connection), this
// browser's database, and the little things screens need: names, photos,
// files, who's online, and copying chats over from the phone.
//
// Screens read from it with the hooks in hooks.ts, and it tells them when
// something changed with `emit(topic)`.

import {
  browserName,
  HttpServer,
  LinkExpired,
  linkThisBrowser,
  OfflineError,
  parseHistory,
  newPairCode,
  PakChat,
  phoenixConnection,
  ServerError,
  type Chat,
  type FileUploader,
  type HistoryFile,
  type Me,
  type Message,
  type Provision,
  type Ref,
  SYNCED_PREFS,
  type SyncChange,
} from '@pakchat/shared';
import { lockFile, unlockFile } from '@pakchat/shared/web';

import { calls } from './calls';
import { IdbStorage, openIdb } from './idbStorage';
import { isAppLocked, startLock } from './lock';
import { workerSignal } from './workerSignal';

// ---- Where the server is ----

/**
 * The server's address: set when the website is built (VITE_SERVER_URL),
 * or the computer running `npm run dev` itself.
 */
export const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/+$/, '') ?? 'http://localhost:4000';
const WS = SERVER.replace(/^http/, 'ws');

export type Person = { id: string; name: string; about?: string | null; photo?: string | null };
export type Contact = { name: string; phone?: string; email?: string };
/** A chat's settings. Archive, pin, mute, favourite, unread, lock and delete are kept the same as the phone's, both ways (see takeSync); the draft stays here. */
export type ChatPrefs = {
  pinnedAt?: number;
  archived?: boolean;
  muted?: boolean;
  /** Muted for 8 hours or a week: when it unmutes. Missing while muted: Always. */
  mutedUntil?: number;
  favourite?: boolean;
  markedUnread?: boolean;
  draft?: string;
  draftAt?: number;
  /** The phone's chat lock: `folder` chats never show here, `list` ones show without their words. */
  lock?: 'folder' | 'list';
  /** Deleted from the list: hidden until a message comes. */
  deletedAt?: number;
};
/** How to reach someone (their number or Gmail), from the phone. */
export type Ways = { phone?: string; email?: string };
/** A list of chats, like "Family" (a chip above the chat list). */
export type ChatList = { id: string; name: string; chatIds: string[] };
export type Presence = { online: boolean; lastSeen: string | null };
export type Theme = 'light' | 'dark' | 'system';
export type Settings = { theme: Theme; enterSends: boolean; notifications: boolean; previews: boolean; sounds: boolean; wallpaper?: number };

/** Chat wallpapers (Settings › Chats › Chat wallpaper), like WhatsApp Web's solid colours: each in light and dark. */
export const WALLPAPERS: { light: string; dark: string }[] = [
  { light: '#DCEBF7', dark: '#16222C' },
  { light: '#D6EEDC', dark: '#14261B' },
  { light: '#F4E3C9', dark: '#2A2216' },
  { light: '#F2D7DE', dark: '#2B1A1F' },
  { light: '#E3DDF3', dark: '#1F1B2C' },
  { light: '#D3EDEB', dark: '#132625' },
  { light: '#ECECEC', dark: '#1E1F1F' },
  { light: '#C9D7E8', dark: '#0F1B29' },
];
const DEFAULT_SETTINGS: Settings = { theme: 'system', enterSends: true, notifications: true, previews: true, sounds: true };

/**
 * loading:   opening the database
 * signedOut: the QR page
 * syncing:   linked, waiting for the phone's chats ("Loading your chats")
 * ready:     the app
 */
export type Phase = 'loading' | 'signedOut' | 'syncing' | 'ready';

type Topic = 'phase' | 'qr' | 'chats' | 'people' | 'prefs' | 'settings' | 'presence' | 'typing' | 'connection' | 'sync' | 'files' | 'photos' | 'blocked' | 'lock' | `messages:${string}`;

/** Kept by the browser until the tab closes (for "Stay logged in" off). */
const TAB_MARK = 'pakchat-tab';

/** How long to wait for the phone's chats before opening the app anyway (it keeps filling in). */
const SYNC_WAIT_MS = 45_000;
/** How many unlocked files stay in memory at once. */
const FILES_KEPT = 300;
/** How long "typing…" lasts without a new sign (the phone sends one every few seconds while typing). */
const TYPING_MS = 6000;

class WebCore {
  phase: Phase = 'loading';
  storage!: IdbStorage;
  client!: PakChat;
  server = new HttpServer(SERVER);
  private signal = workerSignal();

  people: Record<string, Person> = {};
  contacts: Record<string, Contact> = {};
  ways: Record<string, Ways> = {};
  lists: ChatList[] = [];
  prefs: Record<string, ChatPrefs> = {};
  starred: Record<string, true> = {};
  /** The phone's chat lock secret code, as a check (SHA-256), never the code itself. Null: none set. */
  lockCode: string | null = null;
  settings: Settings = DEFAULT_SETTINGS;
  presence: Record<string, Presence> = {};
  /** chatId → userId → when they started typing. */
  typing: Record<string, Record<string, number>> = {};
  /** Who's recording a voice note rather than typing ("chatId:userId"). */
  recordingAudio = new Set<string>();
  isRecordingAudio = (chatId: string, userId: string) => this.recordingAudio.has(`${chatId}:${userId}`);
  connected = false;
  /** The QR to show (and how long it lasts), while signed out. */
  qr: { text: string; seconds: number; at: number } | null = null;
  /** The QR ran out: "Click to reload QR code". */
  qrExpired = false;
  /** Copying chats from the phone: parts so far, and whether the last one came. */
  sync = { parts: 0, done: false };
  /** "Stay logged in on this browser" (the QR page's tick box). Off: closing the tab logs out. */
  stayLoggedIn = true;
  /** The chat open on screen. */
  viewing: string | null = null;
  /** Goes up each time a photo arrives, so pictures waiting for one draw again. */
  photosVersion = 0;

  private listeners = new Map<Topic, Set<() => void>>();
  private started: Promise<void> | null = null;

  // ---- Change notices ----

  on(topic: Topic, fn: () => void) {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => void set.delete(fn);
  }

  emit(topic: Topic) {
    for (const fn of this.listeners.get(topic) ?? []) fn();
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.emit('phase');
  }

  get myId(): string {
    return this.client.me?.userId ?? '';
  }

  // ---- Starting ----

  init() {
    this.started ??= this.start();
    return this.started;
  }

  private async start() {
    this.storage = new IdbStorage(await openIdb('pakchat'));
    this.client = new PakChat({
      signal: this.signal,
      storage: this.storage,
      server: this.server,
      connect: phoenixConnection(`${WS}/socket`),
      active: () => document.visibilityState === 'visible',
      deviceName: browserName(navigator.userAgent),
      files: this.uploader,
    });
    this.listen();
    await this.loadLocal();
    await startLock();
    if (await this.client.load()) {
      // "Stay logged in" was off and the tab was closed since: log out, like WhatsApp Web.
      if ((await this.storage.getValue<boolean>('web:sessionOnly')) && !sessionStorage.getItem(TAB_MARK)) return this.signOut();
      this.afterSignIn();
      this.setPhase((await this.storage.getValue<boolean>('web:synced')) ? 'ready' : 'syncing');
    } else {
      this.setPhase('signedOut');
      void this.showQr();
    }
  }

  private async loadLocal() {
    const s = this.storage;
    this.people = (await s.getValue<Record<string, Person>>('app:people')) ?? {};
    this.contacts = (await s.getValue<Record<string, Contact>>('app:contacts')) ?? {};
    this.ways = (await s.getValue<Record<string, Ways>>('app:ways')) ?? {};
    this.lists = (await s.getValue<ChatList[]>('app:lists')) ?? [];
    this.prefs = (await s.getValue<Record<string, ChatPrefs>>('app:prefs')) ?? {};
    this.starred = (await s.getValue<Record<string, true>>('app:starred')) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...((await s.getValue<Partial<Settings>>('web:settings')) ?? {}) };
    this.lockCode = (await s.getValue<string | null>('app:lockCode')) ?? null;
  }

  private listen() {
    const c = this.client;
    c.on('message', (m) => {
      this.emit(`messages:${m.chatId}`);
      this.emit('chats');
    });
    c.on('arrived', (m) => void this.notify(m));
    c.on('chat', () => {
      this.emit('chats');
      this.namesSoon();
    });
    c.on('connection', (on) => {
      this.connected = on;
      this.emit('connection');
      if (on) {
        void this.loadPeople();
        void this.refreshMe();
      }
    });
    c.on('typing', ({ chatId, userId, typing, audio }) => {
      const now = { ...(this.typing[chatId] ?? {}) };
      if (typing) now[userId] = Date.now();
      else delete now[userId];
      // "recording audio…" instead of "typing…".
      if (typing && audio) this.recordingAudio.add(`${chatId}:${userId}`);
      else this.recordingAudio.delete(`${chatId}:${userId}`);
      this.typing = { ...this.typing, [chatId]: now };
      this.emit('typing');
      // If no "stopped" comes (they closed the app), "typing…" goes by itself after 6 seconds.
      if (typing) setTimeout(() => this.typingGone(chatId, userId), TYPING_MS + 100);
    });
    c.on('presence', (p) => {
      const id = String(p.user_id ?? '');
      if (!id) return;
      this.presence = { ...this.presence, [id]: { online: p.online === true, lastSeen: (p.last_seen as string | null) ?? null } };
      this.emit('presence');
    });
    // Calls (calls.ts): rung, answered, connected and hung up through these.
    c.on('call', (e) => calls.onSignal(e));
    c.on('sync', (e) => void this.takeSync(e).catch((err: unknown) => console.warn('[pakchat] sync', err)));
    c.on('history', (e) => void this.takeHistory(e.part, e.last, e.file).catch((err: unknown) => console.warn('[pakchat] history', err)));
    c.on('error', (err) => console.warn('[pakchat]', err));
  }

  /** Drops someone's "typing…" once it's older than TYPING_MS (a newer one keeps it). */
  private typingGone(chatId: string, userId: string) {
    const at = this.typing[chatId]?.[userId];
    if (at == null || Date.now() - at < TYPING_MS) return;
    const now = { ...this.typing[chatId] };
    delete now[userId];
    this.recordingAudio.delete(`${chatId}:${userId}`);
    this.typing = { ...this.typing, [chatId]: now };
    this.emit('typing');
  }

  private afterSignIn() {
    this.client.start();
    void this.loadPeople();
    // Once, however many times this runs (signing out and in again in the same tab).
    if (this.watchingVisibility) return;
    this.watchingVisibility = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.client?.me) return;
      this.client.setActive(document.visibilityState === 'visible');
      if (document.visibilityState === 'visible') void this.refreshMe();
    });
  }

  private watchingVisibility = false;

  // ---- My profile ----

  private meCheckedAt = 0;

  /** Picks up a name, about or photo changed on the phone (at most once a minute). */
  async refreshMe(force = false) {
    if (!this.client.me || (!force && Date.now() - this.meCheckedAt < 60_000)) return;
    this.meCheckedAt = Date.now();
    try {
      const me = await this.server.me();
      const was = this.client.me?.me;
      if (was && was.name === me.name && was.about === me.about && was.photo === me.photo && was.phone === me.phone) return;
      await this.saveMe(me);
    } catch {
      // Offline: next time.
    }
  }

  /** Changes my name or about here; the phone picks it up too. */
  async updateMe(change: { name?: string; about?: string; photo?: string | null }) {
    await this.saveMe(await this.server.updateMe(change));
  }

  /** A new profile photo: `square` is already cropped to 640 pixels (see Profile). */
  async setMyPhoto(square: Blob) {
    await this.updateMe({ photo: await this.uploadPhoto(square) });
  }

  /** Locks and uploads a profile photo (mine, or a group's with `chatId`), and gives what to save as its photo. */
  async uploadPhoto(square: Blob, chatId?: string) {
    const { locked, key, digest } = await lockFile(new Uint8Array(await square.arrayBuffer()));
    const { id, uploadUrl } = await this.server.startPhoto(locked.length, chatId);
    const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: locked as BodyInit }).catch(() => null);
    if (!res || !res.ok) throw new OfflineError('The upload stopped');
    // It shows at once, without fetching it back.
    this.keepFileUrl(id, URL.createObjectURL(square));
    return `pk1:${id}:${key}:${digest}`;
  }

  private async saveMe(me: Me) {
    await this.client.updateMe(me);
    const id = this.myId;
    this.people = { ...this.people, [id]: { id, name: me.name, about: me.about ?? null, photo: me.photo ?? null } };
    await this.storage.setValue('app:people', this.people);
    this.photosVersion++;
    this.emit('people');
    this.emit('photos');
  }

  // ---- Linking by QR ----

  private linking: AbortController | null = null;

  /** Shows a QR and waits for the phone. Called again by "Click to reload QR code". */
  async showQr(retry = 0) {
    this.linking?.abort();
    const stop = (this.linking = new AbortController());
    this.qr = null;
    this.qrExpired = false;
    this.emit('qr');
    let shown = false;
    try {
      const { provision } = await linkThisBrowser({
        client: this.client,
        server: this.server,
        socketUrl: `${WS}/link`,
        signal: stop.signal,
        onQr: (text, seconds) => {
          shown = true;
          this.qr = { text, seconds, at: Date.now() };
          this.emit('qr');
        },
      });
      await this.linked(provision);
    } catch (err) {
      if (stop.signal.aborted) return;
      console.warn('[pakchat] linking', err);
      // The server couldn't be reached before any QR showed (it's starting, or the
      // connection dropped): keep the spinner and try again, like WhatsApp Web.
      if (!shown && !(err instanceof LinkExpired)) {
        setTimeout(() => {
          if (this.linking === stop) void this.showQr(retry + 1);
        }, Math.min(2000 * 2 ** retry, 15_000));
        return;
      }
      this.qr = null;
      this.qrExpired = true;
      this.emit('qr');
    }
  }

  /**
   * "Log in with phone number": the 8-letter code to type on the phone,
   * instead of a QR (see shared/src/link.ts). `phone` is the number tidied.
   */
  pair: { typed: string; code: string; phone: string | null; ready: boolean; error: 'bad_phone' | 'expired' | 'offline' | null } | null = null;

  async linkWithPhone(typed: string) {
    this.linking?.abort();
    const stop = (this.linking = new AbortController());
    this.pair = { typed, code: newPairCode(), phone: null, ready: false, error: null };
    this.emit('qr');
    const code = this.pair.code;
    try {
      const { provision } = await linkThisBrowser({
        client: this.client,
        server: this.server,
        socketUrl: `${WS}/link`,
        signal: stop.signal,
        onQr: () => {},
        pair: {
          phone: typed,
          code,
          onPhone: (phone) => {
            if (this.linking !== stop || !this.pair) return;
            this.pair = { ...this.pair, phone };
            this.emit('qr');
          },
          onReady: () => {
            if (this.linking !== stop || !this.pair || this.pair.ready) return;
            this.pair = { ...this.pair, ready: true };
            this.emit('qr');
          },
        },
      });
      await this.linked(provision);
    } catch (err) {
      if (stop.signal.aborted || !this.pair) return;
      console.warn('[pakchat] linking by phone number', err);
      const error = err instanceof ServerError && err.reason === 'bad_phone' ? 'bad_phone' : err instanceof LinkExpired ? 'expired' : 'offline';
      this.pair = { ...this.pair, error };
      this.emit('qr');
    }
  }

  /** "(edit)": back to typing the number; the code stops. */
  editPhone() {
    this.linking?.abort();
    this.linking = null;
    this.pair = null;
    this.emit('qr');
  }

  /** "Log in with QR code": back from the phone number. */
  backToQr() {
    this.pair = null;
    void this.showQr();
  }

  private async linked(provision: Provision) {
    this.pair = null;
    await this.storage.setValue('web:provision', provision);
    await this.storage.setValue('web:sessionOnly', !this.stayLoggedIn);
    sessionStorage.setItem(TAB_MARK, '1');
    this.sync = { parts: 0, done: false };
    this.setPhase('syncing');
    this.afterSignIn();
    // If the phone's chats are slow (or it's offline), open anyway: they fill in when they come.
    setTimeout(() => {
      if (this.phase === 'syncing') void this.synced();
    }, SYNC_WAIT_MS);
  }

  private async synced() {
    await this.storage.setValue('web:synced', true);
    this.setPhase('ready');
  }

  /** One part of the phone's chats: fetched, checked, unlocked and added. */
  private async takeHistory(part: number, last: boolean, file: HistoryFile) {
    // Only from the phone that linked us: its identity key must be the one it sent in the QR's reply.
    const provision = await this.storage.getValue<Provision>('web:provision');
    const me = this.client.me;
    if (!provision || !me) return;
    const phoneKey = await this.signal.identityKey(me.handle, me.userId, 1);
    if (phoneKey !== provision.identityKey) {
      console.warn('[pakchat] history from a phone that did not link us: ignored');
      return;
    }
    const locked = new Uint8Array(await (await fetch(await this.server.fileLink(file.id))).arrayBuffer());
    const plain = await unlockFile(locked, file.key, file.digest);
    const bundle = parseHistory(new TextDecoder().decode(plain));
    if (!bundle) return;
    await this.client.importHistory(bundle);
    await this.loadLocal();
    this.sync = { parts: this.sync.parts + 1, done: last || this.sync.done };
    for (const t of ['sync', 'chats', 'people', 'prefs'] as const) this.emit(t);
    if (part === 1 && this.phase === 'syncing') await this.synced();
    void this.loadPeople();
  }

  async signOut() {
    this.linking?.abort();
    await calls.hangUp().catch(() => {});
    await this.client.signOut().catch(() => {});
    await this.storage.clear();
    await this.signal.wipe().catch(() => {});
    location.reload();
  }

  // ---- The server's other doors (blocking, reporting) ----

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = this.client.me?.token;
    const res = await fetch(`${SERVER}/api${path}`, {
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
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(String(json.error ?? res.status));
    return json as T;
  }

  /** The people I've blocked (null until asked). The server stops passing on anything from them. */
  blocked: Set<string> | null = null;

  async loadBlocked() {
    const r = await this.api<{ blocked: { id: string }[] }>('GET', '/blocks');
    this.blocked = new Set(r.blocked.map((p) => p.id));
    this.emit('blocked');
  }

  async block(userId: string, on: boolean) {
    await this.api(on ? 'PUT' : 'DELETE', `/blocks/${encodeURIComponent(userId)}`);
    await this.loadBlocked().catch(() => {});
  }

  async setLists(lists: ChatList[]) {
    this.lists = lists;
    await this.storage.setValue('app:lists', lists);
    this.emit('prefs');
    this.share({ key: 'app:lists', value: lists });
  }

  // ---- People ----

  /** The name to show: mine as I saved them, then their own, then a short form of the id. */
  nameOf(userId: string): string {
    if (userId === this.myId) return this.client.me?.me.name ?? 'You';
    return this.contacts[userId]?.name ?? this.people[userId]?.name ?? '';
  }

  /** "~ Name" for people I haven't saved, like WhatsApp. */
  isContact(userId: string) {
    return !!this.contacts[userId];
  }

  private asking = new Set<string>();
  private namesTimer: ReturnType<typeof setTimeout> | null = null;

  private namesSoon() {
    if (this.namesTimer) clearTimeout(this.namesTimer);
    this.namesTimer = setTimeout(() => void this.loadPeople(), 300);
  }

  /** Fetches the names of everyone in my chats this computer doesn't know yet. */
  async loadPeople(force = false) {
    if (!this.client.me) return;
    const chats = await this.storage.listChats();
    const ids = new Set<string>();
    for (const c of chats) for (const m of c.members) if ((force || !this.people[m.userId]) && !this.asking.has(m.userId)) ids.add(m.userId);
    for (const id of ids) {
      this.asking.add(id);
      try {
        const p = await this.server.person(id);
        this.people = { ...this.people, [id]: { id, name: p.name, about: p.about ?? null, photo: p.photo ?? null } };
      } catch {
        // Offline: next time.
      } finally {
        this.asking.delete(id);
      }
    }
    if (ids.size) {
      await this.storage.setValue('app:people', this.people);
      this.emit('people');
    }
  }

  async refreshPresence(userId: string) {
    try {
      const p = await this.server.presence(userId);
      this.presence = { ...this.presence, [userId]: { online: p.online, lastSeen: p.last_seen } };
      this.emit('presence');
    } catch {
      // Offline.
    }
  }

  // ---- Chat settings ----

  async setPrefs(chatId: string, change: Partial<ChatPrefs>) {
    const next = { ...(this.prefs[chatId] ?? {}), ...change };
    for (const k of Object.keys(next) as (keyof ChatPrefs)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    this.prefs = { ...this.prefs, [chatId]: next };
    await this.storage.setValue('app:prefs', this.prefs);
    this.emit('prefs');
    this.emit('chats');
    // Archive, pin, mute, favourite, unread, lock and delete go to the phone too (drafts stay here).
    if (Object.keys(change).some((k) => (SYNCED_PREFS as readonly string[]).includes(k))) this.share({ key: 'app:prefs', set: { [chatId]: syncedPrefs(next) } });
  }

  // ---- The same on the phone and here (two ways, like WhatsApp) ----

  /** Tells my phone (and other linked computers) about a change made here. */
  private share(change: SyncChange) {
    if (!this.client?.me) return;
    void this.client.sendSync(change).catch((err: unknown) => console.warn('[pakchat] sync', err));
  }

  /** A change made on my phone (or another linked computer): the same here, without sending it back. */
  private async takeSync(e: SyncChange) {
    const s = this.storage;
    if (e.key === 'app:prefs') {
      const next = { ...this.prefs };
      for (const [chatId, theirs] of Object.entries(e.set ?? {})) {
        if (!theirs || typeof theirs !== 'object') continue;
        next[chatId] = { ...withoutSynced(next[chatId]), ...syncedPrefs(theirs as ChatPrefs) };
      }
      for (const chatId of e.del ?? []) if (next[chatId]) next[chatId] = withoutSynced(next[chatId]);
      this.prefs = next;
      await s.setValue('app:prefs', next);
      this.emit('prefs');
      this.emit('chats');
    } else if (e.key === 'app:starred') {
      const next = { ...this.starred };
      for (const k of Object.keys(e.set ?? {})) next[k] = true;
      for (const k of e.del ?? []) delete next[k];
      this.starred = next;
      await s.setValue('app:starred', next);
      for (const chatId of new Set([...Object.keys(e.set ?? {}), ...(e.del ?? [])].map((k) => k.split('/')[0]))) this.emit(`messages:${chatId}`);
    } else if (e.key === 'app:contacts') {
      const next = { ...this.contacts };
      for (const [userId, c] of Object.entries(e.set ?? {})) {
        const name = (c as Contact | null)?.name;
        if (typeof name === 'string' && name) next[userId] = { name, phone: (c as Contact).phone, email: (c as Contact).email };
      }
      for (const userId of e.del ?? []) delete next[userId];
      this.contacts = next;
      await s.setValue('app:contacts', next);
      this.emit('people');
      this.emit('chats');
    } else if (e.key === 'app:lists') {
      if (!Array.isArray(e.value)) return;
      this.lists = (e.value as ChatList[]).filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string' && Array.isArray(l.chatIds));
      await s.setValue('app:lists', this.lists);
      this.emit('prefs');
    } else if (e.key === 'app:lockCode') {
      this.lockCode = typeof e.value === 'string' ? e.value : null;
      await s.setValue('app:lockCode', this.lockCode);
      this.emit('prefs');
    }
  }

  async setSettings(change: Partial<Settings>) {
    this.settings = { ...this.settings, ...change };
    await this.storage.setValue('web:settings', this.settings);
    this.emit('settings');
  }

  async toggleStar(m: Message) {
    const k = `${m.chatId}/${m.author}/${m.id}`;
    const next = { ...this.starred };
    const on = !next[k];
    if (on) next[k] = true;
    else delete next[k];
    this.starred = next;
    await this.storage.setValue('app:starred', next);
    this.emit(`messages:${m.chatId}`);
    this.share(on ? { key: 'app:starred', set: { [k]: true } } : { key: 'app:starred', del: [k] });
  }

  // ---- Files ----

  /** Plain files kept while the page is open, by server id, as blob: addresses. */
  private fileUrls = new Map<string, string>();
  private fetching = new Map<string, Promise<string>>();
  /** What a file I just sent was, before it had a server id (blob address by message). */
  private sentFiles = new Map<string, File>();

  /**
   * Keeps a file's blob: address, and lets the oldest go past FILES_KEPT, so a long day
   * of photos doesn't fill the computer's memory (one scrolled back to is fetched again).
   */
  private keepFileUrl(id: string, url: string) {
    this.fileUrls.delete(id);
    this.fileUrls.set(id, url);
    while (this.fileUrls.size > FILES_KEPT) {
      const [oldId, oldUrl] = this.fileUrls.entries().next().value!;
      this.fileUrls.delete(oldId);
      URL.revokeObjectURL(oldUrl);
    }
  }

  /** A file's address to show it (fetched, checked and unlocked the first time). */
  fileUrl(f: { id: string; key: string; digest: string; mime: string }): Promise<string> {
    const known = this.fileUrls.get(f.id);
    if (known) return Promise.resolve(known);
    let p = this.fetching.get(f.id);
    if (!p) {
      p = (async () => {
        const locked = new Uint8Array(await (await fetch(await this.server.fileLink(f.id))).arrayBuffer());
        const plain = await unlockFile(locked, f.key, f.digest);
        const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: f.mime }));
        this.keepFileUrl(f.id, url);
        return url;
      })().finally(() => this.fetching.delete(f.id));
      this.fetching.set(f.id, p);
    }
    return p;
  }

  /** A file's address if it's already here (no download). */
  knownFile(id: string) {
    return this.fileUrls.get(id) ?? null;
  }

  /** A file still being sent from this computer: its own copy, to show at once. */
  localFile(local?: string) {
    return local ? (this.sentFiles.get(local) ?? null) : null;
  }

  /** Profile, group and community photos (`pk1:<id>:<key>:<digest>`, or a web address). */
  photoUrl(value?: string | null): string | null {
    if (!value) return null;
    if (value.startsWith('https://')) return value;
    const [tag, id, key, digest] = value.split(':');
    if (tag !== 'pk1' || !id || !key || !digest) return null;
    const known = this.fileUrls.get(id);
    if (known) return known;
    void this.fileUrl({ id, key, digest, mime: 'image/jpeg' })
      .then(() => {
        this.photosVersion++;
        this.emit('photos');
      })
      .catch(() => {});
    return null;
  }

  /** Locks and uploads a file for the outbox (see sendFiles). */
  private uploader: FileUploader = {
    upload: async (chatId, local) => {
      const file = this.sentFiles.get(local);
      if (!file) throw new Error('The file to send is gone');
      const { locked, key, digest } = await lockFile(new Uint8Array(await file.arrayBuffer()));
      const { id, uploadUrl } = await this.server.startUpload(chatId, locked.length);
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: locked as BodyInit }).catch(() => null);
      if (!res || !res.ok) throw new OfflineError('The upload stopped');
      // The sender sees their own copy straight away.
      this.keepFileUrl(id, URL.createObjectURL(file));
      return { id, key, digest };
    },
  };

  /** Sends photos, videos and documents (from Attach, drag and drop, or paste). */
  /** `forwarded`: how many times it will have been forwarded (0: not forwarded). */
  async sendFiles(chatId: string, files: File[], caption?: string, replyTo?: Ref, forwarded = 0) {
    for (const [i, file] of files.entries()) {
      const local = `web-file:${crypto.randomUUID()}`;
      this.sentFiles.set(local, file);
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'doc';
      const size = await imageSize(file);
      await this.client.sendFile(
        chatId,
        { local, size: file.size, mime: file.type || 'application/octet-stream', kind, name: file.name, ...size },
        { ...(i === 0 ? { caption, replyTo } : {}), ...(forwarded ? { forwarded: true, hops: forwarded } : {}) },
      );
    }
  }

  /** A voice message recorded here: its length (ms) and loudness bars (one byte each, base64). */
  async sendVoice(chatId: string, blob: Blob, durationMs: number, waveform: string, replyTo?: Ref) {
    const local = `web-file:${crypto.randomUUID()}`;
    const type = blob.type || 'audio/webm';
    this.sentFiles.set(local, new File([blob], 'voice', { type }));
    await this.client.sendFile(chatId, { local, size: blob.size, mime: type, kind: 'voice', duration: Math.round(durationMs), waveform }, { replyTo });
  }

  // ---- Alerts ----

  /** A new message from someone else: the sound and the computer's notification, like WhatsApp Web. */
  private async notify(m: Message) {
    if (m.author === this.myId || m.kind === 'system' || m.deleted) return;
    // Old ones caught up after being offline just show in the list, as on the phone.
    if (Date.now() - m.sentAt > 120_000) return;
    const prefs = this.prefs[m.chatId];
    const looking = m.chatId === this.viewing && document.visibilityState === 'visible' && document.hasFocus();
    if (looking) return;
    const chat = await this.storage.getChat(m.chatId);
    // Statuses never alert, like WhatsApp's (nor communities or call links, which have no messages to show).
    if (!chat || chat.kind === 'status' || chat.kind === 'community' || chat.callLink) return;
    // A muted group still alerts for a message for me: an @mention, or a reply to me (like WhatsApp's).
    const forMe = chat.kind === 'group' && (!!m.mentions?.includes(this.myId) || m.replyTo?.author === this.myId);
    if (prefs?.muted && (!prefs.mutedUntil || prefs.mutedUntil > Date.now()) && !forMe) return;
    if (this.settings.sounds) ping();
    if (!this.settings.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const { bodyLine, chatTitle } = await import('../ui/format');
    // A locked chat's alert says only "New message": no name, no words (the phone's chat lock). So does every alert while App lock is locked.
    const locked = !!prefs?.lock || isAppLocked();
    const group = chat.kind === 'group';
    const who = this.nameOf(m.author) || 'PakChat';
    const words = this.settings.previews && !locked ? bodyLine(m) : 'New message';
    const n = new Notification(locked ? 'PakChat' : group ? chatTitle(chat) : who, {
      body: group && !locked ? `${who}: ${words}` : words,
      tag: m.chatId,
      icon: '/icon-192.png',
    });
    n.onclick = () => {
      window.focus();
      openChat(m.chatId);
      n.close();
    };
  }
}

/** Only the chat settings that are the same on all my devices. */
function syncedPrefs(p: ChatPrefs): Partial<ChatPrefs> {
  const out: Record<string, unknown> = {};
  for (const k of SYNCED_PREFS) if (p[k] !== undefined && p[k] !== false) out[k] = p[k];
  return out as Partial<ChatPrefs>;
}

/** A chat's settings with the shared ones taken out (its draft stays). */
function withoutSynced(p: ChatPrefs | undefined): ChatPrefs {
  const out: Record<string, unknown> = { ...(p ?? {}) };
  for (const k of SYNCED_PREFS) delete out[k];
  return out as ChatPrefs;
}

/** A short soft two-note sound for a new message, made on the spot (no sound file to download). */
let sound: AudioContext | null = null;
let lastPing = 0;
function ping() {
  // Many messages at once make one sound.
  if (Date.now() - lastPing < 1500) return;
  lastPing = Date.now();
  try {
    sound ??= new AudioContext();
    const at = sound.currentTime;
    for (const [freq, from] of [[880, 0], [1320, 0.09]] as const) {
      const osc = sound.createOscillator();
      const vol = sound.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(0.0001, at + from);
      vol.gain.exponentialRampToValueAtTime(0.18, at + from + 0.015);
      vol.gain.exponentialRampToValueAtTime(0.0001, at + from + 0.22);
      osc.connect(vol).connect(sound.destination);
      osc.start(at + from);
      osc.stop(at + from + 0.25);
    }
  } catch {
    // No sound on this computer: nothing to do.
  }
}

/** A photo's width and height, to keep its space while it loads. */
async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith('image/')) return {};
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return {};
  }
}

export const core = new WebCore();

// ---- Which chat is open (kept in the address, so Back works) ----

export function openChat(chatId: string | null) {
  core.viewing = chatId;
  core.emit('chats');
  window.dispatchEvent(new CustomEvent('pakchat:open', { detail: chatId }));
}

export type { Chat, Message };
