// core.ts: the one place the app talks to PakChat's shared core (../shared).
//
// It opens the phone's database, makes the PakChat client with our Signal
// module, and keeps a few things only this phone knows: people's names,
// which chats are pinned, archived, muted or favourite, drafts, and starred
// messages. Screens read from here (through hooks.ts) and never wait for the
// network: the database answers first, and the network only updates it.
import {
  hashContacts,
  HttpServer,
  meFromWire,
  normalizePhone,
  OfflineError,
  PakChat,
  phoenixConnection,
  ServerError,
  type Chat,
  type ContactCard,
  type Me,
  type Message,
  type Session,
} from '@pakchat/shared';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import KV from 'expo-sqlite/kv-store';
import { AppState, type AppStateStatus } from 'react-native';

import { fileModule, loadSignal } from '../../modules/pakchat-signal';
import type { SqliteStorage } from '../data/sqliteStorage';
import { openStorage } from './db';
import { backUpIfDue } from './backup';
import { calls } from './calls';
import { forgetFile, maybeDownload, uploader } from './files';
import { alertFor, alertReaction, startPush, words } from './push';
import { startLock } from './lock';
import { receivedTone, sentTone } from './tones';

export type Person = { id: string; name: string; about?: string | null; photo?: string | null };

/** How to reach someone: what I typed to find them, or what they showed me by messaging first. */
export type Ways = { phone?: string; email?: string };

/** Behind a chat's messages: PakChat's doodles (the default), nothing, a colour, a gradient or a photo. */
export type Wallpaper = {
  kind: 'doodles' | 'none' | 'colour' | 'gradient' | 'photo';
  value?: number | string;
  /** Darker in dark mode, 0 to 0.8. */
  dim?: number;
  /** A plain colour with PakChat's doodles over it. */
  doodles?: boolean;
};

const HOUR = 3_600_000;

/** Muted right now: Always, or its 8 hours or week isn't up yet (even before the timer unmutes it, say in the background). */
export function isMuted(p?: ChatPrefs) {
  return !!p?.muted && (!p.mutedUntil || p.mutedUntil > Date.now());
}

/** Things about a chat that only this phone knows. */
export type ChatPrefs = {
  pinnedAt?: number;
  archived?: boolean;
  muted?: boolean;
  /** Muted for 8 hours or a week (like WhatsApp): when it unmutes. Missing while muted: Always. */
  mutedUntil?: number;
  favourite?: boolean;
  markedUnread?: boolean;
  draft?: string;
  /** When the draft was last typed: a chat with a draft goes to the top of the list, like WhatsApp. */
  draftAt?: number;
  /** Its own alert tone (ChatAlerts.TONES), or "silent". Missing: the default. */
  tone?: string;
  wallpaper?: Wallpaper;
  /**
   * Chat lock. `folder`: WhatsApp's way, moved to the hidden Locked chats folder.
   * `list`: ours, stays in the list with a lock, and never shows its words.
   */
  lock?: 'folder' | 'list';
  /** Deleted from the list (WhatsApp's Delete chat): hidden until a message comes. */
  deletedAt?: number;
};

/** Settings only this phone has (phase 7). */
export type AppSettings = {
  /** A few seconds to take back a message just sent. */
  /** Little sounds as messages go and come while a chat is open, and how loud (0 to 1). */
  conversationTones: boolean;
  toneVolume: number;
  /** The alert tone for chats without their own ('' is PakChat's own). */
  defaultTone: string;
  /** Groups' tone (Settings › Notifications › Groups), like WhatsApp. Missing: the same as messages. */
  groupTone?: string;
  /** Cards for web addresses in what I write. */
  linkPreviews: boolean;
  /** App lock (fingerprint or face only), and when: 0 at once, 30 or 60 seconds, -1 when the phone locks. */
  appLock: boolean;
  appLockAfter: 0 | 30 | 60 | -1;
  /** A locked chat locks again this long after you leave it (seconds). */
  chatRelock: 0 | 30 | 60;
  /** The Locked chats folder only opens by typing the secret code in search (it's hidden from the list). */
  lockedHidden: boolean;
  /** The secret code's SHA-256 (never the code itself). */
  secretCode?: string;
  /** Behind chats without their own. */
  wallpaper?: Wallpaper;
  /** Archived chats stay archived when someone writes (and don't alert, unless I'm mentioned or replied to), like WhatsApp. */
  keepArchived: boolean;
  /** "Use less data for calls" (Settings › Storage and data), like WhatsApp. */
  lessDataCalls?: boolean;
  /** When I last looked at Calls: missed calls since then are the number on its tab. */
  callsSeenAt?: number;
  /** Settings › Privacy › Calls: people not in my contacts don't ring (a missed call instead), like WhatsApp. */
  silenceUnknown?: boolean;
  /** Settings › Privacy › Calls: calls only through PakChat's relay, so others never see my address. */
  protectIp?: boolean;
  /** Settings › Notifications: buzz with message alerts (default on). */
  vibrate?: boolean;
  /** Settings › Notifications: an alert when someone reacts to my message (default on). */
  reactionAlerts?: boolean;
  /** Settings › Notifications: the ringtone for calls ('' is the phone's own). */
  callTone?: string;
  /** Settings › Chats › Font size: how big messages' words are in chats (default medium), like WhatsApp. */
  fontSize?: FontSize;
};

export type FontSize = 'small' | 'medium' | 'large';

/** Messages' words at each font size (Bubble.tsx). Medium is what it always was. */
export const MESSAGE_TEXT: Record<FontSize, number> = { small: 14, medium: 15.5, large: 18 };

export const DEFAULT_SETTINGS: AppSettings = {
  conversationTones: true,
  toneVolume: 0.5,
  defaultTone: '',
  linkPreviews: true,
  appLock: false,
  appLockAfter: 0,
  chatRelock: 0,
  lockedHidden: false,
  keepArchived: true,
};

/** A list you made yourself (like "Family" or "Work"), shown as a chip above the chats. */
export type ChatList = { id: string; name: string; chatIds: string[] };

export type Presence = { online: boolean; lastSeen: string | null };

/** Someone I saved under my own name, with the number or Gmail I know them by. Only on this phone. */
export type Contact = { name: string; phone?: string; email?: string; fromPhoneBook?: boolean };

type Topic =
  | 'calls'
  | 'stickers'
  | 'auth'
  | 'chats'
  | 'people'
  | 'prefs'
  | 'connection'
  | 'typing'
  | 'presence'
  | 'blocked'
  | 'files'
  | 'backup'
  | 'settings'
  | 'scheduled'
  | 'broadcasts'
  | 'lock'
  | 'photos'
  | `messages:${string}`
  // Someone asked to join a group, or suggested a group for a community (admins' lists).
  | `notice:${string}`;

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
  server!: HttpServer;
  private listeners = new Map<Topic, Set<() => void>>();
  private ready: Promise<void> | null = null;

  state: 'loading' | 'signedOut' | 'signedIn' = 'loading';
  connected = false;
  people: Record<string, Person> = {};
  /** Each group's and community's photo value, for Avatar (see photos.ts). */
  chatPhotos: Record<string, string> = {};
  /** A one-to-one chat → the other person (me, for messaging myself): its photo is theirs. */
  directWith: Record<string, string> = {};
  /** userId → how I saved them. People not here show as "~ Name". */
  contacts: Record<string, Contact> = {};
  prefs: Record<string, ChatPrefs> = {};
  settings: AppSettings = DEFAULT_SETTINGS;
  starred: Record<string, true> = {};
  lists: ChatList[] = [];
  /** chatId → userId → when they started typing. */
  typing: Record<string, Record<string, number>> = {};
  presence: Record<string, Presence> = {};
  /** The chat open on screen, if any: its messages don't alert while you're looking. */
  viewing: string | null = null;

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
    // All asked for at once, so the start doesn't wait on each in turn.
    const s = this.storage;
    const [people, contacts, ways, prefs, settings, starred, lists] = await Promise.all([
      s.getValue<Record<string, Person>>('app:people'),
      s.getValue<Record<string, Contact>>('app:contacts'),
      s.getValue<Record<string, Ways>>('app:ways'),
      s.getValue<Record<string, ChatPrefs>>('app:prefs'),
      s.getValue<Partial<AppSettings>>('app:settings'),
      s.getValue<Record<string, true>>('app:starred'),
      s.getValue<ChatList[]>('app:lists'),
    ]);
    this.people = people ?? {};
    this.contacts = contacts ?? {};
    this.ways = ways ?? {};
    this.prefs = prefs ?? {};
    this.unmuteDue();
    this.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    // First time with the missed-calls number: start from now, not from every old missed call.
    if (this.settings.callsSeenAt === undefined) this.setSettings({ callsSeenAt: Date.now() });
    startLock();
    this.starred = starred ?? {};
    this.lists = lists ?? [];
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
      // Woken in the background to collect a message: not "online" (only on screen).
      active: () => AppState.currentState === 'active',
      deviceName: Device.modelName ?? 'Android phone',
      newId: () => Crypto.randomUUID(),
      files: uploader,
    });
    this.client.on('message', (m) => {
      this.emit(`messages:${m.chatId}`);
      this.emit('chats');
      if (m.file) void maybeDownload(m);
      // My message just went, in the chat that's open: its little sound.
      if (m.author === this.myId && m.status === 'sent' && m.chatId === this.viewing && Date.now() - m.sentAt < 30_000) sentTone(`${m.chatId}:${m.id}`);
      if (m.kind === 'event' && m.plan) void import('./plans').then((p) => p.notePlan(m)).catch(() => {});
    });
    this.client.on('arrived', (m) => {
      // "Keep chats archived" off: someone writing brings the chat back to the list.
      if (this.prefs[m.chatId]?.archived && !this.settings.keepArchived && m.kind !== 'system' && m.author !== this.myId) this.setPrefs(m.chatId, { archived: false });
      alertFor(m);
      if (m.chatId === this.viewing && m.kind !== 'system' && !m.deleted) receivedTone(`${m.chatId}:${m.author}:${m.id}`);
    });
    this.client.on('reacted', (e) => alertReaction(e));
    this.client.on('notice', ({ chatId }) => this.emit(`notice:${chatId}`));
    this.client.on('chat', (c) => {
      this.notePhoto(c);
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
    // Calls: ringing, answering, connecting (calls.ts).
    this.client.on('call', (e) => calls.onSignal(e));
  }

  /** Keeps a group's or community's photo value where Avatar finds it. */
  private notePhoto(c: Chat) {
    // A one-to-one chat shows the other person's photo (or mine, messaging myself).
    if (c.kind === 'direct') {
      // (Not before its people are known: no one else in it would look like messaging myself.)
      const other = c.members.length ? this.otherPerson(c) : null;
      if (other && this.directWith[c.id] !== other) {
        this.directWith = { ...this.directWith, [c.id]: other };
        this.emit('photos');
      }
      return;
    }
    if ((c.photo ?? '') === (this.chatPhotos[c.id] ?? '')) return;
    this.chatPhotos = { ...this.chatPhotos, [c.id]: c.photo ?? '' };
    this.emit('photos');
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
    void this.client
      .chats()
      .then((all) => all.forEach((c) => this.notePhoto(c)))
      .catch(() => {});
    void startPush();
    if (!this.watchingApp) {
      this.watchingApp = true;
      AppState.addEventListener('change', (s) => this.appMoved(s));
    }
    // The daily backup, a little after starting so it doesn't slow the start.
    setTimeout(() => void backUpIfDue(), 30_000);
    // Fill in anything missed while signed out, and everyone's names.
    void this.client
      .syncChats()
      .then(() => this.loadPeople())
      .catch(() => {});
    void this.loadPeople();
    void import('./scheduled').then((m) => (void m.watchPlans(), m.sendDue())).catch(() => {});
    void import('./live').then((m) => m.resumeLive()).catch(() => {});
  }

  private watchingApp = false;
  /** Counts moves in and out of PakChat, so a late "let go" can tell it's out of date. */
  private moves = 0;

  /**
   * Leaving PakChat lets go of the connection straight away, so the server
   * sees the phone as away and wakes it for the next message (it never wakes a
   * phone that's connected). Only a message still being sent is let finish
   * first, for at most two seconds. Coming back connects again and collects
   * what came in.
   *
   * No timers here: phones pause them while the app is in the background, so
   * the waiting is done by the phone itself (fileModule().wait).
   */
  private appMoved(s: AppStateStatus) {
    const move = ++this.moves;
    if (this.state !== 'signedIn') return;
    if (s === 'active') {
      this.client.start();
      // Already connected (woken in the background): "online" from now.
      this.client.setActive(true);
      // Anything scheduled that should have gone while PakChat was away.
      void import('./scheduled').then((m) => m.sendDue()).catch(() => {});
      this.unmuteDue();
      return;
    }
    if (s !== 'background') return;
    this.client.setActive(false);
    void Promise.race([this.client.settled(), fileModule().wait(2_000)])
      .catch(() => {})
      .then(() => {
        if (move === this.moves && this.awake === 0 && AppState.currentState !== 'active' && !calls.live) this.client.stop();
      });
  }

  private collecting: Promise<boolean> | null = null;
  /** Background jobs holding the connection open right now (wake-ups, alert buttons). */
  private awake = 0;

  /**
   * A wake-up from the server (background.ts): connect, take in what's waiting
   * (which sends the grey "delivered" ticks and shows the alerts), and let go
   * again if PakChat isn't open. Returns false only if PakChat is closed and
   * the server couldn't be reached, so the caller can still say "New message".
   */
  collect(): Promise<boolean> {
    this.collecting ??= this.briefly(true, async (wait) => {
      // The server sends what's waiting as soon as we're in. Let it come, and let it be handled.
      await wait(1_200);
    }).finally(() => {
      this.collecting = null;
    });
    return this.collecting;
  }

  /** Reply, Mark as read or Mute, pressed on a message alert (background.ts). */
  async onAlert(action: 'reply' | 'read' | 'mute', chatId: string, text: string) {
    await this.init();
    if (this.state !== 'signedIn') return;
    if (action === 'mute') return this.mute(chatId, 8 * HOUR);
    // Replying reads the chat too, as in WhatsApp. If the server can't be reached
    // the reply waits in the outbox and goes next time.
    if (action === 'reply' && text) await this.client.sendText(chatId, text);
    await this.briefly(false, async () => {
      await this.client.markRead(chatId);
    });
    this.emit(`messages:${chatId}`);
    this.emit('chats');
  }

  /**
   * Connects for a moment from the background, does `work` once connected,
   * lets everything finish (never more than 5 seconds a step, so a stuck step
   * can't hold the phone awake), and lets go again if PakChat isn't open.
   * The waiting uses the phone's own clock: JavaScript timers stop in the background.
   */
  async briefly(fresh: boolean, work: (wait: (ms: number) => Promise<void>) => Promise<void>): Promise<boolean> {
    await this.init();
    if (this.state !== 'signedIn') return true;
    const wait = (ms: number) => fileModule().wait(ms);
    const settled = () => Promise.race([this.client.settled(), wait(5_000)]);
    this.awake++;
    try {
      // While PakChat is open the server only wakes it when a message wasn't picked
      // up in time: the connection may have died without noticing, so make a new one.
      if (fresh && AppState.currentState === 'active') this.client.stop();
      this.client.start();
      // Up to 10 seconds to get through.
      for (let i = 0; i < 40 && !this.client.isConnected; i++) await wait(250);
      const reached = this.client.isConnected;
      if (reached) {
        await work(wait);
        await settled();
        await wait(300);
        await settled();
      }
      return reached || AppState.currentState === 'active';
    } finally {
      this.awake--;
      this.letGoIfAway();
    }
  }

  /** Out of PakChat with nothing to do (no call, no background job): let go of the connection. */
  letGoIfAway() {
    if (this.awake === 0 && AppState.currentState !== 'active' && !calls.live && this.state === 'signedIn') this.client.stop();
  }

  newId() {
    return Crypto.randomUUID();
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

  /** Sends a sign-in code to a number. Answers the number as the server tidied it. */
  async sendPhoneCode(phone: string) {
    await this.init();
    return new HttpServer(serverUrl()).sendSignInCode(phone);
  }

  /**
   * Emulator tests only: the code the Mac's server printed. A real phone always
   * types it from the Terminal, the way it will type a real SMS code.
   */
  async testCode(phone: string) {
    if (Device.isDevice) throw new Error('Only on an emulator');
    return new HttpServer(serverUrl(), 3_000).testCode(phone);
  }

  /** Signs in with a number and its code. True when the account is new (ask for a name). */
  async signInWithPhone(phone: string, code: string) {
    const session = await this.signInWith(() => this.client.signInWithPhone(phone, code));
    return session.newAccount === true;
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
      this.contacts = {};
      this.prefs = {};
      this.chatPhotos = {};
      this.directWith = {};
      this.settings = DEFAULT_SETTINGS;
      this.starred = {};
      this.lists = [];
      this.ways = {};
      this.blocked = null;
      this.presence = {};
      this.typing = {};
    }
    // Signing in on a phone that didn't have this account: offer its backup (index.tsx).
    if (previous !== session.userId) KV.setItemSync(`offerRestore:${session.userId}`, '1');
    await this.storage.setValue('app:lastUser', session.userId);
    this.remember({ id: session.userId, name: session.me.name, about: session.me.about, photo: session.me.photo });
    this.state = 'signedIn';
    this.afterSignIn();
    this.emit('auth');
    this.emit('chats');
    return session;
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
    await import('./scheduled').then((m) => m.forgetPlans()).catch(() => {});
    await import('./broadcasts').then((m) => m.forgetBroadcasts()).catch(() => {});
    await import('./plans').then((m) => m.forgetPlansOfCalls()).catch(() => {});
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
  async updateMe(change: { name?: string; about?: string; photo?: string; privacy?: { last_seen?: string; online?: string; photo?: string; about?: string; groups?: string; read_receipts?: boolean } }) {
    await this.saveMe(meFromWire(await this.call<Parameters<typeof meFromWire>[0]>('PATCH', '/me', change)));
  }

  private async saveMe(me: Me) {
    await this.client.updateMe(me);
    this.remember({ id: me.id, name: me.name, about: me.about, photo: me.photo });
    this.emit('auth');
  }

  /** Where to send alerts for this phone (Google's push token). */
  async savePushToken(token: string) {
    await this.call('PUT', '/me/push', { token, platform: 'fcm' });
  }

  // ---- Ways to sign in: Gmail and phone number on one account ----

  /** Adds a Gmail to my account (Google's token proves it's mine). Fails with "taken" if it has its own account. */
  async linkGoogle(idToken: string) {
    await this.saveMe(await this.server.linkGoogle(idToken));
  }

  sendLinkCode(phone: string) {
    return this.server.sendLinkCode(phone);
  }

  async linkPhone(phone: string, code: string) {
    await this.saveMe(await this.server.linkPhone(phone, code));
  }

  /** Takes the Gmail or number off my account. The server refuses if it's the last way in. */
  async unlink(what: 'google' | 'phone') {
    await this.saveMe(await this.server.unlink(what));
  }

  // ---- People ----

  private remember(p: Person) {
    this.people = { ...this.people, [p.id]: p };
    void this.storage.setValue('app:people', this.people);
    this.emit('people');
  }

  /** The name to show: how I saved them, or "~ their own name" when they aren't in my contacts. */
  name(userId: string): string {
    if (userId === this.myId) return this.me?.name ?? '';
    const saved = this.contacts[userId]?.name;
    if (saved) return saved;
    const own = this.people[userId]?.name;
    return own ? `~ ${own}` : '';
  }

  /** The name without the "~" (for @mentions). */
  plainName(userId: string): string {
    if (userId === this.myId) return this.me?.name ?? '';
    return this.contacts[userId]?.name || this.people[userId]?.name || '';
  }

  isContact(userId: string) {
    return userId === this.myId || !!this.contacts[userId];
  }

  // ---- Contacts (only on this phone) ----

  saveContact(userId: string, contact: Contact) {
    this.contacts = { ...this.contacts, [userId]: contact };
    void this.storage.setValue('app:contacts', this.contacts);
    this.emit('people');
    this.emit('chats');
  }

  removeContact(userId: string) {
    const next = { ...this.contacts };
    delete next[userId];
    this.contacts = next;
    void this.storage.setValue('app:contacts', this.contacts);
    this.emit('people');
    this.emit('chats');
  }

  /**
   * Finds who is on PakChat among my phone's contacts. Numbers and Gmails are
   * hashed on the phone first, so the address book never leaves it as it is.
   * Saves each match under the name in my phone's contacts. Answers how many.
   */
  async matchPhoneBook(cards: ContactCard[]) {
    const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.BASE64 });
    const { phones, emails } = await hashContacts(cards, sha256);
    const all = [...[...phones.keys()].map((h) => ['p', h] as const), ...[...emails.keys()].map((h) => ['e', h] as const)];
    const found = new Set<string>();
    const next = { ...this.contacts };
    for (let i = 0; i < all.length; i += 2000) {
      const part = all.slice(i, i + 2000);
      const matches = await this.server.matchContacts(
        part.filter(([k]) => k === 'p').map(([, h]) => h),
        part.filter(([k]) => k === 'e').map(([, h]) => h),
      );
      for (const m of matches) {
        const card = cards[phones.get(m.hash) ?? emails.get(m.hash) ?? -1];
        if (!card) continue;
        found.add(m.user.id);
        this.people = { ...this.people, [m.user.id]: m.user };
        // A name I typed in PakChat myself wins over the phone book.
        if (next[m.user.id] && !next[m.user.id].fromPhoneBook) continue;
        const phone = card.phones.map((p) => normalizePhone(p)).find(Boolean) ?? undefined;
        next[m.user.id] = { name: card.name || m.user.name, phone, email: card.emails[0]?.toLowerCase(), fromPhoneBook: true };
      }
    }
    this.contacts = next;
    await this.storage.setValue('app:contacts', next);
    await this.storage.setValue('app:people', this.people);
    this.emit('people');
    this.emit('chats');
    return found.size;
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
    // Someone who messaged me first comes with their number and Gmail.
    const { phone, email, ...p } = await this.call<Person & { phone?: string | null; email?: string | null }>('GET', `/users/${encodeURIComponent(userId)}`);
    this.remember(p);
    this.noteWays(p.id, { phone: phone ?? undefined, email: email ?? undefined });
    return p;
  }

  /** Numbers and Gmails I know for people, kept only on this phone (see `Ways`). */
  ways: Record<string, Ways> = {};

  private noteWays(userId: string, found: Ways) {
    const was = this.ways[userId] ?? {};
    const next = { phone: found.phone ?? was.phone, email: found.email ?? was.email };
    if (next.phone === was.phone && next.email === was.email) return;
    this.ways = { ...this.ways, [userId]: next };
    void this.storage.setValue('app:ways', this.ways);
  }

  /** How to reach someone, for "Add to contacts": asks the server again in case they messaged me first. */
  async waysOf(userId: string): Promise<Ways> {
    await this.person(userId, true).catch(() => {});
    return this.ways[userId] ?? {};
  }

  /**
   * Finds someone by Gmail ("ali" means ali@gmail.com) or phone number ("0300 1234567").
   * Null if they haven't joined.
   */
  async lookup(typed: string) {
    const q = typed.trim().toLowerCase();
    if (!q) return null;
    // Only digits (and + - ( ) spaces): a number. Anything else: a Gmail.
    const looksLikeNumber = /^[+0-9][0-9\s\-()]{6,}$/.test(q);
    const phone = looksLikeNumber ? normalizePhone(q) : null;
    if (looksLikeNumber && !phone) return null;
    const email = q.includes('@') ? q : `${q}@gmail.com`;
    const found = phone ? await this.server.lookup(phone, 'phone') : await this.server.lookup(email);
    if (found) {
      this.rememberQuietly(found);
      this.noteWays(found.id, phone ? { phone } : { email });
    }
    return found;
  }

  /** Learns someone's own name without saving them as a contact. */
  private rememberQuietly(p: Person) {
    if (this.people[p.id]?.name === p.name) return;
    this.remember({ ...this.people[p.id], ...p });
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
    if (change.muted) this.unmuteDue();
  }

  /** Mutes a chat for `ms` (8 hours, a week), or Always (null), like WhatsApp. */
  mute(chatId: string, ms: number | null) {
    this.setPrefs(chatId, { muted: true, mutedUntil: ms === null ? undefined : Date.now() + ms });
  }

  unmute(chatId: string) {
    this.setPrefs(chatId, { muted: false, mutedUntil: undefined });
  }

  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;

  /** Chats whose 8 hours or week is up unmute; and a timer waits for the next one. */
  private unmuteDue() {
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    this.unmuteTimer = null;
    const now = Date.now();
    let next = Infinity;
    for (const [id, p] of Object.entries(this.prefs)) {
      if (!p.mutedUntil) continue;
      if (p.mutedUntil <= now) this.unmute(id);
      else next = Math.min(next, p.mutedUntil);
    }
    // Timers can't wait more than about 24 days; a week is fine.
    if (next !== Infinity) this.unmuteTimer = setTimeout(() => this.unmuteDue(), Math.min(next - now + 500, 2 ** 31 - 1));
  }

  setSettings(change: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...change };
    void this.storage.setValue('app:settings', this.settings);
    this.emit('settings');
  }

  /** Is this chat locked (either way)? */
  isLocked(chatId: string) {
    return !!this.prefs[chatId]?.lock;
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
  async deleteForMe(list: Pick<Message, 'chatId' | 'author' | 'id'>[], keepFiles = false) {
    // Their photos, videos and documents go from the phone too (each message has its own copy).
    if (!keepFiles) for (const m of list) await forgetFile(await this.storage.getMessage(m.chatId, m.author, m.id));
    const byChat = new Map<string, { author: string; id: string }[]>();
    for (const m of list) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), { author: m.author, id: m.id }]);
    for (const [chatId, refs] of byChat) {
      await this.client.deleteHere(chatId, refs);
      this.emit(`messages:${chatId}`);
    }
    this.emit('chats');
  }

  /** Clear chat: every message goes from this phone, and the chat stays in the list. */
  async clearChat(chatId: string) {
    const all = await this.storage.listMessages(chatId, { limit: 100_000 });
    for (const m of all) await forgetFile(m);
    await this.client.deleteHere(chatId, all);
    if (this.prefs[chatId]?.deletedAt) this.setPrefs(chatId, { deletedAt: undefined });
    this.emit(`messages:${chatId}`);
    this.emit('chats');
  }

  /** Delete chat: its messages go from this phone and it leaves the list, until someone writes again (like WhatsApp). */
  async deleteChatHere(chatId: string) {
    await this.clearChat(chatId);
    this.setPrefs(chatId, { archived: false, pinnedAt: undefined, markedUnread: false, deletedAt: Date.now() });
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

  /** The chat's name: the group's title, or the other person's name ("Ali (You)" messaging myself, like WhatsApp). */
  chatTitle(chat: Chat): string {
    if (chat.kind === 'group' || chat.kind === 'community') return chat.title ?? '';
    if (this.isSelfChat(chat)) return `${this.me?.name ?? ''} (${words().youWord})`;
    const other = chat.members.find((m) => m.userId !== this.myId)?.userId ?? this.myId;
    return this.name(other) || '…';
  }

  /** The photo for an Avatar: a person's (mine too), a group's or community's, or for a one-to-one chat the other person's. */
  photoOf(id: string): string | null | undefined {
    if (id === this.myId) return this.me?.photo || this.people[id]?.photo;
    const direct = this.directWith[id];
    if (direct) return this.photoOf(direct);
    return this.people[id]?.photo ?? this.chatPhotos[id];
  }

  /** Messaging myself: notes, links and files to keep, on all my devices. */
  isSelfChat(chat: Chat) {
    return chat.kind === 'direct' && chat.members.length > 0 && chat.members.every((m) => m.userId === this.myId);
  }

  otherPerson(chat: Chat): string | null {
    if (chat.kind === 'group' || chat.kind === 'community') return null;
    return chat.members.find((m) => m.userId !== this.myId)?.userId ?? this.myId;
  }
}

export const core = new Core();
export { isOffline };

function isOffline(err: unknown) {
  return err instanceof OfflineError;
}

/** Why the server said no ("wrong_code", "taken"…), "offline", or "unknown". */
export function reasonOf(err: unknown): string {
  if (err instanceof OfflineError) return 'offline';
  if (err instanceof ServerError) return err.reason;
  return 'unknown';
}
