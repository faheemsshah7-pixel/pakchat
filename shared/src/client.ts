// The heart of PakChat on a device. The app and the website both use this.
//
// Sending: a message is saved on the device first (so it shows at once),
// then put in the "outbox". The outbox locks it with Signal for every device
// that should get it and hands it to the server, one at a time, in order. If
// the network is down, it waits and tries again.
//
// Receiving: envelopes from the server are opened one at a time, in order.
// Each one is saved, then confirmed ("ack"), and only then does the server
// delete it. One that arrives twice is skipped.
//
// Groups use Signal's "sender keys": each device has its own group key, sends
// it (locked) once to every other device in the group, then locks each group
// message just once. When someone leaves, everyone makes a new group key, so
// the person who left can't read what comes next.

import type { Connection, ConnectionFactory, WireEnvelope } from './connection';
import type { Attachment, Body, Change, Content, Payload, Ref } from './content';
import { isBody, isChange, parseContent, writeContent } from './content';
import { randomId } from './ids';
import { changeAllowed, maySend } from './rules';
import type { Me, ServerApi, ServerChat, SignedIn } from './server';
import { OfflineError, ServerError } from './server';
import type { DeviceKeys, PreKeys, SignalApi } from './signal';
import { errorCode, SEALED, SignalError } from './signal';
import type { Chat, Message, OutboxItem, Storage, SystemEvent } from './storage';

/** Who is signed in on this device. Saved, so the app stays signed in. */
export type Session = {
  token: string;
  userId: string;
  deviceId: number;
  deviceUuid: string;
  /** This device's name inside the Signal module. */
  handle: string;
  me: Me;
  /** Only straight after signing in: the account was made just now. */
  newAccount?: boolean;
};

/**
 * Uploading files, which the app does itself (locking big files needs native
 * code). The outbox calls it for a file message that hasn't been uploaded
 * yet, so a file sent while offline goes when the network comes back.
 */
export type FileUploader = {
  /** Locks the file at `local`, uploads it for `chatId`, and says where it went and its key. */
  upload(chatId: string, local: string, message: Ref): Promise<Pick<Attachment, 'id' | 'key' | 'digest'>>;
};

/** A file on this device, about to be sent. */
export type OutgoingFile = Omit<Attachment, 'id' | 'key' | 'digest'> & { local: string };

export type ClientOptions = {
  signal: SignalApi;
  storage: Storage;
  server: ServerApi;
  connect: ConnectionFactory;
  /** Shown in "Linked devices", like "Pixel 7". */
  deviceName?: string;
  files?: FileUploader;
  now?: () => number;
  newId?: () => string;
};

export type Events = {
  /** A message was added or changed. */
  message: (m: Message) => void;
  /** A new message from someone else just arrived (once per message): for alerts. */
  arrived: (m: Message) => void;
  chat: (c: Chat) => void;
  typing: (e: { chatId: string; userId: string; typing: boolean }) => void;
  presence: (p: Record<string, unknown>) => void;
  connection: (connected: boolean) => void;
  /** Someone's security code changed (they reinstalled, or a new device). */
  securityCodeChanged: (e: { userId: string }) => void;
  /** Something went wrong that the app might want to log. */
  error: (err: Error) => void;
};

type Device = { userId: string; deviceId: number };
type GroupKey = { distributionId: string; sharedWith: string[] };
type Waiting = { from: string; at: number; change: Change };
type SentRecord = { chatId: string; seq: number; kind: OutboxItem['kind']; content: string; at: number };
type Prepared = { payload: Record<string, unknown>; shared: string[]; groupKey?: GroupKey };

// A file message's id before its file is uploaded.
const PENDING = 'pending';
// Messages waiting to be sent go after every numbered one.
const QUEUED = 1e15;
// How many recent sends we remember, to send again if someone asks.
const KEEP_SENT = 300;
// Envelopes waiting for a group key: how many, and for how long.
const MAX_HELD = 500;
const HOLD_MS = 7 * 24 * 3600_000;

const deviceKey = (d: Device) => `${d.userId}:${d.deviceId}`;
const kindFor = (p: Payload): OutboxItem['kind'] => (p.t === 'react' || p.t === 'vote' ? 'reaction' : 'message');
// Retry notes go unlocked (the other side can't open anything from us), and are plain ASCII.
const toB64 = (text: string) => btoa(text);
const fromB64 = (b64: string) => atob(b64);

export class PakChat {
  private session: Session | null = null;
  private conn: Connection | null = null;
  private connected = false;
  /** Everything that touches Signal or storage runs here, one thing at a time. */
  private lane: Promise<unknown> = Promise.resolve();
  private incoming: WireEnvelope[] = [];
  private draining: Promise<void> | null = null;
  private flushing = false;
  /** The send run going on now, if any. */
  private flushRun: Promise<void> | null = null;
  private flushAgain = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private acks: number[] = [];
  /** "Delivered" ticks to send: `chat|author` to message numbers. */
  private delivered = new Map<string, Set<number>>();
  /** Messages taken back before they went (cancelSend): the outbox lets them go. */
  private unsent = new Set<string>();
  /** Group envelopes that arrived before their key, from this batch. */
  private heldNow: WireEnvelope[] = [];
  private keysUsed = 0;
  private listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private o: ClientOptions) {
    this.now = o.now ?? Date.now;
    this.newId = o.newId ?? randomId;
  }

  // ---- Events ----

  on<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as unknown as (...a: Parameters<Events[K]>) => void)(...args);
      } catch (err) {
        if (event !== 'error') this.emit('error', err as Error);
      }
    }
  }

  // ---- Signing in ----

  get me(): Session | null {
    return this.session;
  }

  get isConnected() {
    return this.connected;
  }

  /** Picks up the saved session, if any. Returns true when signed in. */
  async load(): Promise<boolean> {
    const s = await this.o.storage.getValue<Session>('session');
    if (!s) return false;
    const handle = await this.o.signal.openDevice(s.userId, s.deviceId);
    if (!handle) {
      // The keys are gone (the app's data was cleared): sign in again.
      await this.o.storage.deleteValue('session');
      return false;
    }
    this.session = { ...s, handle };
    this.o.server.useToken(s.token);
    return true;
  }

  /** Signs in with a Google ID token, making this device's keys first. */
  signIn(idToken: string): Promise<Session> {
    return this.signInWith((device, keys) => this.o.server.signIn(idToken, device, keys));
  }

  /** Signs in with a phone number and the code sent to it by SMS. */
  signInWithPhone(phone: string, code: string): Promise<Session> {
    return this.signInWith((device, keys) => this.o.server.signInWithPhone(phone, code, device, keys));
  }

  /**
   * Makes this device's keys and registers them through `register`. Google
   * sign-in uses it, and so will linking the website with a QR code (phase 8).
   */
  async signInWith(register: (device: DeviceKeys & { name: string }, keys: PreKeys) => Promise<SignedIn>): Promise<Session> {
    const { signal, storage, server } = this.o;
    // We don't know our user id until the server tells us, so start with a temporary name.
    let handle = await signal.createDevice(`new-${this.newId()}`, 1);
    const device = { ...(await signal.deviceKeys(handle)), name: this.o.deviceName ?? 'Phone' };
    const signedIn = await register(device, await signal.newPreKeys(handle, 100));
    handle = await signal.setAddress(handle, signedIn.user.id, signedIn.deviceId);
    this.session = {
      token: signedIn.token,
      userId: signedIn.user.id,
      deviceId: signedIn.deviceId,
      deviceUuid: signedIn.deviceUuid,
      handle,
      me: signedIn.user,
    };
    await storage.setValue('session', this.session);
    server.useToken(signedIn.token);
    return signedIn.newAccount ? { ...this.session, newAccount: true } : this.session;
  }

  async signOut() {
    await this.o.server.signOut().catch(() => {});
    this.stop();
    this.o.server.useToken(null);
    await this.o.storage.deleteValue('session');
    this.session = null;
  }

  private get s(): Session {
    if (!this.session) throw new Error('Not signed in');
    return this.session;
  }

  // ---- The live connection ----

  /** Connects, and keeps connecting whenever the network comes back. */
  start() {
    if (this.conn) return;
    // Held group messages opened just before the app was killed: finish them.
    void this.inLane(() => this.releaseAll()).catch((err) => this.emit('error', err as Error));
    this.conn = this.o.connect({ token: this.s.token, deviceUuid: this.s.deviceUuid });
    this.conn.open({
      envelopes: (list) => this.receive(list),
      typing: (e) => this.emit('typing', { chatId: e.chat_id, userId: e.user_id, typing: e.typing }),
      presence: (p) => this.emit('presence', p),
      status: (connected) => {
        this.connected = connected;
        this.emit('connection', connected);
        if (connected) {
          void this.flush();
          void this.checkKeys();
        }
      },
    });
  }

  stop() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.conn?.close();
    this.conn = null;
    if (this.connected) this.emit('connection', false);
    this.connected = false;
  }

  /** Resolves once everything that has arrived is handled and everything sendable is sent. */
  async idle() {
    for (let i = 0; i < 50; i++) {
      await this.draining;
      await this.lane;
      while (this.flushing) await new Promise((r) => setTimeout(r, 5));
      if (!this.draining && !this.flushing && this.incoming.length === 0) return;
    }
  }

  /**
   * Like idle(), but without timers: phones pause timers while the app is in
   * the background, and this is what the app waits on there before it lets go.
   */
  async settled() {
    for (let i = 0; i < 50; i++) {
      await this.draining;
      await this.lane;
      await this.flushRun?.catch(() => {});
      if (!this.draining && !this.flushRun && this.incoming.length === 0) return;
    }
  }

  /** Runs `work` in the lane, after everything before it. */
  private inLane<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lane.then(work, work);
    this.lane = run.catch(() => {});
    return run;
  }

  private push(event: string, payload: Record<string, unknown>, timeoutMs?: number) {
    if (!this.conn || !this.connected) return Promise.reject(new OfflineError('Not connected'));
    return this.conn.push(event, payload, timeoutMs);
  }

  // ---- Chats ----

  chats() {
    return this.o.storage.listChats();
  }

  messages(chatId: string, options?: { beforeOrder?: number; limit?: number }) {
    return this.o.storage.listMessages(chatId, options);
  }

  /**
   * Removes messages from this device only ("delete for me", clearing a chat, or
   * disappearing messages whose time is up). It waits its turn in the lane, so it
   * never runs in the middle of a message being saved.
   */
  deleteHere(chatId: string, refs: Ref[]) {
    const { storage } = this.o;
    return this.inLane(() =>
      storage.transaction(async () => {
        for (const r of refs) await storage.deleteMessage(chatId, r.author, r.id);
      }),
    );
  }

  /**
   * Takes back one of my messages that hasn't gone yet (a file still uploading,
   * say): out of the outbox and off this device. False if it already went.
   * Stopping the upload itself is the app's job (it knows the transfer).
   */
  cancelSend(chatId: string, ref: Ref): Promise<boolean> {
    const { storage } = this.o;
    return this.inLane(async () => {
      if (ref.author !== this.s.userId) return false;
      const m = await storage.getMessage(chatId, ref.author, ref.id);
      if (!m || m.seq != null) return false;
      this.unsent.add(ref.id);
      await storage.transaction(async () => {
        await storage.deleteOutbox(ref.id);
        await storage.deleteMessage(chatId, ref.author, ref.id);
      });
      return true;
    });
  }

  /** Saves a new copy of my profile (after changing my name, or linking a Gmail or number). */
  async updateMe(me: Me) {
    if (!this.session) return;
    this.session = { ...this.session, me };
    await this.inLane(() => this.o.storage.setValue('session', this.session));
  }

  /**
   * Changes a message on this device only, in the lane: for example, where a
   * downloaded file now is. Returns the changed message, or null if it's gone.
   */
  changeHere(chatId: string, ref: Ref, change: (m: Message) => void) {
    return this.inLane(async () => {
      const m = await this.o.storage.getMessage(chatId, ref.author, ref.id);
      if (!m) return null;
      change(m);
      await this.o.storage.putMessage(m);
      this.emit('message', m);
      return m;
    });
  }

  /** Saves the server's view of a chat, keeping what only this device knows. */
  private async saveChat(sc: ServerChat, old?: Chat | null): Promise<Chat> {
    old ??= await this.o.storage.getChat(sc.id);
    const chat: Chat = {
      readUpTo: 0,
      unread: 0,
      lastActivity: this.now(),
      ...old,
      id: sc.id,
      kind: sc.kind,
      members: sc.members,
      left: false,
    };
    for (const k of ['title', 'description', 'photo', 'onlyAdminsSend', 'inviteCode'] as const) {
      if (sc[k] !== undefined) (chat as Record<string, unknown>)[k] = sc[k];
    }
    await this.o.storage.putChat(chat);
    this.emit('chat', chat);
    return chat;
  }

  /** The chat from this device, or from the server the first time. */
  private async chatFor(chatId: string): Promise<Chat | null> {
    const chat = await this.o.storage.getChat(chatId);
    if (chat) return chat;
    try {
      return await this.saveChat(await this.o.server.chat(chatId), null);
    } catch (err) {
      if (err instanceof ServerError) return null;
      throw err;
    }
  }

  private async refreshChat(chatId: string): Promise<Chat | null> {
    const old = await this.o.storage.getChat(chatId);
    try {
      return await this.saveChat(await this.o.server.chat(chatId), old);
    } catch (err) {
      if (!(err instanceof ServerError) || !old) throw err;
      // Not in it any more.
      const chat = { ...old, left: true, members: old.members.filter((m) => m.userId !== this.s.userId) };
      await this.o.storage.putChat(chat);
      this.emit('chat', chat);
      return chat;
    }
  }

  /** Gets every chat from the server (after signing in on a new phone, say). */
  async syncChats() {
    for (const sc of await this.o.server.chats()) await this.inLane(() => this.saveChat(sc));
  }

  async openDirect(userId: string) {
    const sc = await this.o.server.openDirect(userId);
    return this.inLane(() => this.saveChat(sc));
  }

  async createGroup(title: string, memberIds: string[], options?: { onlyAdminsSend?: boolean }) {
    const sc = await this.o.server.createGroup(title, memberIds, options);
    return this.inLane(() => this.saveChat(sc));
  }

  async addMembers(chatId: string, userIds: string[]) {
    const sc = await this.o.server.addMembers(chatId, userIds);
    return this.inLane(() => this.saveChat(sc));
  }

  /** Removes someone from a group (admins), or leaves it (your own id). */
  async removeMember(chatId: string, userId: string) {
    await this.o.server.removeMember(chatId, userId);
    return this.inLane(() => this.refreshChat(chatId));
  }

  async setAdmin(chatId: string, userId: string, admin: boolean) {
    const sc = await this.o.server.setAdmin(chatId, userId, admin);
    return this.inLane(() => this.saveChat(sc));
  }

  async updateGroup(chatId: string, changes: { title?: string; description?: string; onlyAdminsSend?: boolean }) {
    const sc = await this.o.server.updateGroup(chatId, changes);
    return this.inLane(() => this.saveChat(sc));
  }

  // ---- Sending ----

  sendText(chatId: string, text: string, extra: { replyTo?: Ref; mentions?: string[]; forwarded?: boolean } = {}) {
    if (text.trim() === '') throw new Error('Nothing to send');
    const body: Body = { t: 'text', text };
    if (extra.mentions?.length) body.mentions = extra.mentions;
    if (extra.replyTo) body.replyTo = extra.replyTo;
    if (extra.forwarded) body.forwarded = true;
    return this.sendBody(chatId, body);
  }

  /**
   * Sends a photo, video, voice note or document. It shows at once; the file is
   * locked and uploaded by the outbox (through `files.upload`), then the message goes.
   */
  sendFile(chatId: string, file: OutgoingFile, extra: { caption?: string; replyTo?: Ref; mentions?: string[]; forwarded?: boolean } = {}) {
    if (!this.o.files) throw new Error('This device cannot send files');
    const { local, ...meta } = file;
    const body: Body = { t: 'file', file: { ...meta, id: PENDING, key: '', digest: '' } };
    if (extra.caption?.trim()) body.caption = extra.caption;
    if (extra.mentions?.length) body.mentions = extra.mentions;
    if (extra.replyTo) body.replyTo = extra.replyTo;
    if (extra.forwarded) body.forwarded = true;
    return this.sendBody(chatId, body, local);
  }

  sendPoll(chatId: string, question: string, options: string[], multi = false) {
    return this.sendBody(chatId, { t: 'poll', question, options, multi });
  }

  edit(chatId: string, messageId: string, text: string, mentions?: string[]) {
    const change: Change = mentions ? { t: 'edit', target: messageId, text, mentions } : { t: 'edit', target: messageId, text };
    return this.sendChange(chatId, change);
  }

  deleteForEveryone(chatId: string, target: Ref) {
    return this.sendChange(chatId, { t: 'delete', target });
  }

  /** An emoji, or null to take my reaction back. */
  react(chatId: string, target: Ref, emoji: string | null) {
    return this.sendChange(chatId, { t: 'react', target, emoji });
  }

  vote(chatId: string, target: Ref, options: number[]) {
    return this.sendChange(chatId, { t: 'vote', target, options: [...new Set(options)].sort((a, b) => a - b) });
  }

  /** Pins until a time (ms), or unpins with null. */
  pin(chatId: string, target: Ref, until: number | null) {
    return this.sendChange(chatId, { t: 'pin', target, until });
  }

  /** Disappearing messages, in seconds (0 turns them off). */
  setTimer(chatId: string, seconds: number) {
    return this.sendChange(chatId, { t: 'timer', seconds });
  }

  private content(chatId: string, payload: Payload): Content {
    return { ...payload, v: 1, id: this.newId(), chat: chatId, at: this.now() } as Content;
  }

  private async sendBody(chatId: string, body: Body, local?: string): Promise<Message> {
    const content = this.content(chatId, body);
    const parsed = parseContent(writeContent(content));
    if (!parsed) throw new Error('That message is not allowed (too long, or empty)');
    const message = await this.inLane(async () => {
      const chat = await this.mustChat(chatId);
      const now = this.now();
      const m = this.toMessage(chat, parsed as Content & Body, this.s.userId, this.s.deviceId, null, now);
      m.status = 'queued';
      if (m.file && local) m.file.local = local;
      await this.o.storage.transaction(async () => {
        await this.o.storage.putMessage(m);
        await this.queue(content, kindFor(content), { author: m.author, id: m.id });
        await this.o.storage.putChat({ ...chat, lastActivity: now });
      });
      return m;
    });
    this.emit('message', message);
    void this.flush();
    return message;
  }

  private async sendChange(chatId: string, change: Change): Promise<void> {
    const content = this.content(chatId, change);
    if (!parseContent(writeContent(content))) throw new Error('That change is not allowed');
    await this.inLane(async () => {
      const chat = await this.mustChat(chatId);
      if (!maySend(chat, this.s.userId, change.t)) throw new ServerError('admins_only');
      await this.o.storage.transaction(async () => {
        // Change it here at once; the others get it through the outbox.
        const ok = await this.applyChange(chat, this.s.userId, this.now(), content as Content & Change, true);
        if (!ok) throw new Error(`Can't ${change.t} that message`);
        await this.queue(content, kindFor(content));
      });
    });
    void this.flush();
  }

  private async mustChat(chatId: string) {
    const chat = await this.chatFor(chatId);
    if (!chat) throw new ServerError('not_found');
    if (chat.left) throw new ServerError('not_found');
    return chat;
  }

  private async queue(content: Content, kind: OutboxItem['kind'], message?: Ref, to?: Device[], id = content.id) {
    const item: OutboxItem = { id, chatId: content.chat, kind, content: writeContent(content), tries: 0, notBefore: 0, added: this.now() };
    if (message) item.message = message;
    if (to) item.to = to;
    await this.o.storage.putOutbox(item);
  }

  /** Sends what's in the outbox, oldest first, while connected. */
  private async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    const run = this.sendAll();
    this.flushRun = run;
    try {
      await run;
    } finally {
      if (this.flushRun === run) this.flushRun = null;
    }
  }

  private async sendAll(): Promise<void> {
    try {
      do {
        this.flushAgain = false;
        while (this.connected) {
          const [item] = await this.o.storage.listOutbox();
          if (!item) break;
          const wait = item.notBefore - this.now();
          if (wait > 0) {
            this.later(wait);
            break;
          }
          if (!(await this.sendOne(item))) break;
        }
      } while (this.flushAgain && this.connected);
    } finally {
      this.flushing = false;
    }
  }

  private later(ms: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, ms);
  }

  /** Tries one item. Returns false to stop for now (offline). */
  private async sendOne(item: OutboxItem): Promise<boolean> {
    let prepared: Prepared;
    try {
      item = await this.uploadFirst(item);
      if (this.unsent.has(item.id)) return true;
      prepared = await this.inLane(() => this.prepare(item));
      const reply = await this.push('send', prepared.payload);
      await this.inLane(() => this.sent(item, prepared, reply));
      return true;
    } catch (err) {
      // Taken back while it was on its way (cancelSend): nothing more to do.
      if (this.unsent.has(item.id)) return true;
      if (err instanceof ServerError && err.reason === 'stale_devices') {
        // Someone linked or removed a device. Learn the new list and go again.
        await this.inLane(() => this.applyStale(item.chatId, err.details));
        return this.tryLater(item, item.tries < 5 ? 0 : 5_000);
      }
      if (err instanceof ServerError && err.reason === 'rate_limited') return this.tryLater(item, 5_000);
      if (err instanceof OfflineError) {
        const wait = Math.min(60_000, 1_000 * 2 ** item.tries);
        await this.tryLater(item, wait);
        // Still connected but no answer: try again later. Otherwise reconnecting restarts it.
        if (this.connected) this.later(wait);
        return false;
      }
      // Anything else won't work by trying again (not in the chat, too big…).
      await this.inLane(() => this.failed(item, err as Error));
      return true;
    }
  }

  /**
   * A file message whose file isn't uploaded yet: upload it, then put its id
   * and key in the message, so what's sent (and any resend) has them.
   */
  private async uploadFirst(item: OutboxItem): Promise<OutboxItem> {
    const c = parseContent(item.content);
    if (c?.t !== 'file' || c.file.id !== PENDING || !item.message) return item;
    const ref = item.message;
    const m = await this.o.storage.getMessage(item.chatId, ref.author, ref.id);
    if (!m?.file?.local || !this.o.files) throw new Error('The file to send is gone');
    const done = await this.o.files.upload(item.chatId, m.file.local, ref);
    const content = writeContent({ ...c, file: { ...c.file, ...done } });
    const next = { ...item, content };
    await this.inLane(async () => {
      // Taken back while it uploaded: don't bring it back.
      if (this.unsent.has(item.id)) return;
      await this.o.storage.transaction(async () => {
        await this.o.storage.putOutbox(next);
        const fresh = await this.o.storage.getMessage(item.chatId, ref.author, ref.id);
        if (fresh?.file) {
          fresh.file = { ...fresh.file, ...done };
          await this.o.storage.putMessage(fresh);
        }
      });
    });
    return next;
  }

  private async tryLater(item: OutboxItem, ms: number) {
    await this.inLane(() => this.o.storage.putOutbox({ ...item, tries: item.tries + 1, notBefore: this.now() + ms }));
    return true;
  }

  private async failed(item: OutboxItem, err: Error) {
    await this.o.storage.deleteOutbox(item.id);
    if (!item.message) return this.emit('error', err);
    const m = await this.o.storage.getMessage(item.chatId, item.message.author, item.message.id);
    if (m) {
      m.status = 'failed';
      await this.o.storage.putMessage(m);
      this.emit('message', m);
    }
  }

  /** Locks the item for everyone who should get it. */
  private async prepare(item: OutboxItem): Promise<Prepared> {
    const chat = await this.mustChat(item.chatId);
    const base = { chat_id: chat.id, kind: item.kind };

    if (item.kind === 'control') {
      return { payload: { ...base, envelopes: await this.lockFor(item.to ?? [], item.content) }, shared: [] };
    }

    const targets = await this.targetsFor(chat);
    if (chat.kind === 'direct') {
      return { payload: { ...base, envelopes: await this.lockFor(targets, item.content) }, shared: [] };
    }

    // A group: my group key goes to every device that doesn't have it yet,
    // then the message is locked once.
    const key = await this.groupKey(chat.id);
    const need = targets.filter((t) => !key.sharedWith.includes(deviceKey(t)));
    let envelopes: Record<string, unknown>[] = [];
    if (need.length) {
      const groupKey = await this.o.signal.createGroupKey(this.s.handle, key.distributionId);
      const keyContent = this.content(chat.id, { t: 'key', distributionId: key.distributionId, key: groupKey });
      envelopes = await this.lockFor(need, writeContent(keyContent));
    }
    const body = await this.o.signal.groupEncrypt(this.s.handle, key.distributionId, item.content);
    return {
      payload: {
        ...base,
        envelopes,
        group: { type: SEALED.group, body },
        // So the server can tell us if we've missed a new device.
        devices: targets.map((t) => ({ user_id: t.userId, device_id: t.deviceId })),
      },
      shared: need.map(deviceKey),
      groupKey: key,
    };
  }

  /** The server took it: it has a number now. */
  private async sent(item: OutboxItem, prepared: Prepared, reply: Record<string, unknown>) {
    const seq = Number(reply.seq);
    const sentAt = Date.parse(String(reply.sent_at)) || this.now();
    const { storage } = this.o;
    let changed: Message | null = null;
    await storage.transaction(async () => {
      if (prepared.groupKey && prepared.shared.length) {
        const key = await this.groupKey(item.chatId);
        // Only if it's still the same key (it may have changed meanwhile).
        if (key.distributionId === prepared.groupKey.distributionId) {
          key.sharedWith = [...new Set([...key.sharedWith, ...prepared.shared])];
          await storage.setValue(`groupKey:${item.chatId}`, key);
        }
      }
      if (item.message) {
        const m = await storage.getMessage(item.chatId, item.message.author, item.message.id);
        if (m) {
          const chat = await storage.getChat(item.chatId);
          m.seq = seq;
          m.order = seq;
          m.sentAt = sentAt;
          if (m.status === 'queued' || m.status === 'failed') m.status = 'sent';
          if (chat?.timer) m.expiresAt = sentAt + chat.timer * 1000;
          await storage.putMessage(m);
          changed = m;
        }
      }
      if (item.kind !== 'control') await this.rememberSent({ chatId: item.chatId, seq, kind: item.kind, content: item.content, at: this.now() });
      const chat = await storage.getChat(item.chatId);
      if (chat) await storage.putChat({ ...chat, lastActivity: Math.max(chat.lastActivity, sentAt) });
      await storage.deleteOutbox(item.id);
    });
    if (changed) this.emit('message', changed);
  }

  private async rememberSent(record: SentRecord) {
    const list = (await this.o.storage.getValue<SentRecord[]>('sent')) ?? [];
    list.push(record);
    await this.o.storage.setValue('sent', list.slice(-KEEP_SENT));
  }

  // ---- Devices and sessions ----

  /** Someone's device numbers, from this device or the server. */
  private async devicesOf(userId: string): Promise<number[]> {
    const known = await this.o.storage.getValue<number[]>(`devices:${userId}`);
    if (known) return known;
    const list = await this.o.server.devices(userId);
    await this.o.storage.setValue(`devices:${userId}`, list);
    return list;
  }

  /** Every device in the chat, except this one. */
  private async targetsFor(chat: Chat): Promise<Device[]> {
    const out: Device[] = [];
    for (const { userId } of chat.members) {
      for (const deviceId of await this.devicesOf(userId)) {
        if (userId === this.s.userId && deviceId === this.s.deviceId) continue;
        out.push({ userId, deviceId });
      }
    }
    return out;
  }

  /** The server said our device list is out of date. */
  private async applyStale(chatId: string, details: Record<string, unknown>) {
    const list = (x: unknown) => (Array.isArray(x) ? (x as { user_id: string; device_id: number }[]) : []);
    const missing = list(details.missing);
    const extra = list(details.extra);
    const chat = await this.o.storage.getChat(chatId);
    const member = (userId: string) => !!chat?.members.some((m) => m.userId === userId);
    for (const d of missing) {
      const have = await this.devicesOf(d.user_id);
      await this.o.storage.setValue(`devices:${d.user_id}`, [...new Set([...have, d.device_id])].sort((a, b) => a - b));
    }
    for (const d of extra) {
      const have = await this.devicesOf(d.user_id);
      await this.o.storage.setValue(`devices:${d.user_id}`, have.filter((x) => x !== d.device_id));
      await this.o.signal.deleteSession(this.s.handle, d.user_id, d.device_id);
    }
    // Someone joined or left that we hadn't heard about yet.
    if ([...missing, ...extra].some((d) => member(d.user_id) !== missing.includes(d))) await this.refreshChat(chatId);
  }

  /** Makes sure we have a Signal session with each device, fetching keys from the server if not. */
  private async ensureSessions(targets: Device[]): Promise<Device[]> {
    const { signal, server, storage } = this.o;
    const need = new Map<string, number[]>();
    for (const t of targets) {
      if (await signal.hasSession(this.s.handle, t.userId, t.deviceId)) continue;
      need.set(t.userId, [...(need.get(t.userId) ?? []), t.deviceId]);
    }
    const gone = new Set<string>();
    for (const [userId, ids] of need) {
      const bundles = await server.bundles(userId, ids);
      for (const b of bundles) {
        const before = await signal.identityKey(this.s.handle, userId, b.deviceId);
        await signal.startSession(this.s.handle, userId, b.deviceId, b);
        const after = await signal.identityKey(this.s.handle, userId, b.deviceId);
        if (before && before !== after && userId !== this.s.userId) this.emit('securityCodeChanged', { userId });
      }
      // Devices the server doesn't have any more.
      const returned = new Set(bundles.map((b) => b.deviceId));
      const missing = ids.filter((id) => !returned.has(id));
      if (missing.length) {
        const have = await this.devicesOf(userId);
        await storage.setValue(`devices:${userId}`, have.filter((id) => !missing.includes(id)));
        for (const id of missing) gone.add(`${userId}:${id}`);
      }
    }
    return targets.filter((t) => !gone.has(deviceKey(t)));
  }

  /** Locks the same text separately for each device. */
  private async lockFor(targets: Device[], text: string) {
    const out: Record<string, unknown>[] = [];
    for (const t of await this.ensureSessions(targets)) {
      const sealed = await this.o.signal.encrypt(this.s.handle, t.userId, t.deviceId, text);
      out.push({ user_id: t.userId, device_id: t.deviceId, type: sealed.type, body: sealed.body });
    }
    return out;
  }

  /** My group key for a chat: made the first time, and again after someone leaves. */
  private async groupKey(chatId: string): Promise<GroupKey> {
    const key = await this.o.storage.getValue<GroupKey>(`groupKey:${chatId}`);
    if (key) return key;
    const fresh = { distributionId: this.newId(), sharedWith: [] };
    await this.o.storage.setValue(`groupKey:${chatId}`, fresh);
    return fresh;
  }

  /** Keeps enough one-time keys on the server for others to start chats with us. */
  private async checkKeys() {
    try {
      const counts = await this.o.server.keyCounts();
      if (Math.min(counts.ec, counts.kyber) >= 30) return;
      const keys = await this.inLane(() => this.o.signal.newPreKeys(this.s.handle, 50));
      await this.o.server.uploadKeys(keys);
    } catch (err) {
      if (!(err instanceof OfflineError)) this.emit('error', err as Error);
    }
  }

  // ---- Receiving ----

  private receive(list: WireEnvelope[]) {
    this.incoming.push(...list);
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
  }

  private async drain() {
    while (this.incoming.length) {
      while (this.incoming.length) {
        const e = this.incoming.shift()!;
        await this.inLane(() => this.handle(e)).catch((err) => this.emit('error', err as Error));
      }
      await this.afterBatch();
    }
  }

  /** Confirms what we got, sends "delivered" ticks, and asks again for anything we couldn't open. */
  private async afterBatch() {
    const ids = this.acks.splice(0);
    if (ids.length) {
      // Saved and marked seen: Signal can let go of the opened texts, then the server of the envelopes.
      await this.inLane(() => this.o.signal.forgetOpened(this.s.handle, ids)).catch(() => {});
      await this.push('ack', { ids }).catch(() => {});
    }

    const ticks = [...this.delivered];
    this.delivered.clear();
    for (const [key, seqs] of ticks) {
      const [chatId, to] = key.split('|');
      await this.push('receipt', { chat_id: chatId, to, status: 'delivered', seqs: [...seqs] }).catch(() => {});
    }

    // Group messages whose key still hasn't come: ask the sender to send them again.
    const held = this.heldNow.splice(0);
    await this.inLane(async () => {
      const still = new Set(((await this.o.storage.getValue<WireEnvelope[]>('held')) ?? []).map((e) => e.id));
      for (const e of held) if (still.has(e.id)) await this.askAgain(e, 'groupKey');
    });

    if (this.keysUsed >= 10) {
      this.keysUsed = 0;
      void this.checkKeys();
    }
  }

  private async handle(e: WireEnvelope) {
    const { storage } = this.o;
    if (!(await storage.hasSeen(e.id))) {
      try {
        if (e.kind === 'receipt') await this.applyReceipt(e);
        else if (e.kind === 'system') await this.applySystem(e);
        else await this.open(e);
      } catch (err) {
        // Don't get stuck on one bad envelope: note it and move on.
        this.emit('error', err as Error);
      }
      await storage.markSeen(e.id);
    }
    this.acks.push(e.id);
  }

  /** Opens a locked envelope and applies what's inside. */
  private async open(e: WireEnvelope) {
    if (e.from_device == null || e.type == null || e.body == null) return;
    const { signal } = this.o;
    const handle = this.s.handle;

    // "Please send it again", sent unlocked.
    if (e.type === SEALED.plain) {
      const c = parseContent(fromB64(e.body));
      if (c?.t === 'retry' && c.chat === e.chat_id) await this.onRetry(e, c);
      return;
    }

    let text: string;
    try {
      if (e.type === SEALED.group) {
        text = await signal.groupDecrypt(handle, e.from, e.from_device, e.body, e.id);
      } else {
        const before = e.type === SEALED.first ? await signal.identityKey(handle, e.from, e.from_device) : null;
        text = await signal.decrypt(handle, e.from, e.from_device, { type: e.type, body: e.body }, e.id);
        if (e.type === SEALED.first) {
          this.keysUsed++;
          const after = await signal.identityKey(handle, e.from, e.from_device);
          if (before && before !== after && e.from !== this.s.userId) this.emit('securityCodeChanged', { userId: e.from });
        }
      }
    } catch (err) {
      const code = errorCode(err);
      if (code === SignalError.duplicate) return;
      if (e.type === SEALED.group && code === SignalError.noGroupKey) {
        // The key may just be behind it: keep it, and open it when the key comes.
        await this.hold(e);
        return;
      }
      await this.askAgain(e, e.type === SEALED.group ? 'groupKey' : 'session');
      return;
    }
    await this.applyContent(e, text);
  }

  /** Applies an opened message, if it's well-formed and allowed. */
  private async applyContent(e: WireEnvelope, text: string) {
    const c = parseContent(text);
    // The chat id inside must match: the server can't move a message to another chat.
    if (!c || c.chat !== e.chat_id || e.from_device == null) return;

    if (c.t === 'key') {
      await this.o.signal.acceptGroupKey(this.s.handle, e.from, e.from_device, c.key);
      await this.release(e.from, e.from_device);
      return;
    }
    if (c.t === 'retry') return;

    let chat = await this.chatFor(e.chat_id);
    if (!chat) return;
    if (!chat.members.some((m) => m.userId === e.from)) {
      // Maybe they just joined and we haven't heard yet.
      chat = await this.refreshChat(e.chat_id);
      if (!chat || !chat.members.some((m) => m.userId === e.from)) return;
    }
    if (!maySend(chat, e.from, c.t)) return;

    const at = Date.parse(e.sent_at) || this.now();
    const { storage } = this.o;
    if (isBody(c)) {
      // A file that was never uploaded can't be shown (a broken or odd sender).
      if (c.t === 'file' && (c.file.id === PENDING || !c.file.key || !c.file.digest)) return;
      if (await storage.getMessage(chat.id, e.from, c.id)) return; // sent again: already have it
      const m = this.toMessage(chat, c, e.from, e.from_device, e.seq, at);
      await storage.transaction(async () => {
        await storage.putMessage(m);
        const fresh = (await storage.getChat(chat.id)) ?? chat;
        fresh.lastActivity = Math.max(fresh.lastActivity, at);
        if (e.from !== this.s.userId && (e.seq ?? 0) > fresh.readUpTo) fresh.unread++;
        await storage.putChat(fresh);
        await this.applyWaiting(fresh, m);
      });
      const saved = (await storage.getMessage(chat.id, e.from, c.id)) ?? m;
      this.emit('message', saved);
      if (e.from !== this.s.userId) this.emit('arrived', saved);
      if (e.from !== this.s.userId && e.seq != null) {
        const key = `${chat.id}|${e.from}`;
        this.delivered.set(key, (this.delivered.get(key) ?? new Set()).add(e.seq));
      }
    } else if (isChange(c)) {
      await storage.transaction(() => this.applyChange(chat, e.from, at, c, false));
    }
  }

  private toMessage(chat: Chat, c: Content & Body, author: string, device: number, seq: number | null, at: number): Message {
    const m: Message = {
      chatId: chat.id,
      id: c.id,
      author,
      authorDevice: device,
      seq,
      order: seq ?? QUEUED + at,
      sentAt: at,
      kind: c.t,
    };
    if (c.t === 'text') {
      m.text = c.text;
      if (c.mentions) m.mentions = c.mentions;
      if (c.replyTo) m.replyTo = c.replyTo;
      if (c.forwarded) m.forwarded = true;
    } else if (c.t === 'file') {
      m.file = { ...c.file };
      if (c.caption) m.text = c.caption;
      if (c.mentions) m.mentions = c.mentions;
      if (c.replyTo) m.replyTo = c.replyTo;
      if (c.forwarded) m.forwarded = true;
    } else {
      m.poll = { question: c.question, options: c.options, multi: c.multi };
    }
    if (author === this.s.userId) m.status = 'sent';
    if (chat.timer) m.expiresAt = at + chat.timer * 1000;
    return m;
  }

  /** Applies a change. If its message hasn't arrived yet, it waits for it. Returns false if not allowed. */
  private async applyChange(chat: Chat, from: string, at: number, c: Content & Change, mine: boolean): Promise<boolean> {
    const { storage } = this.o;
    if (c.t === 'timer') {
      const fresh = (await storage.getChat(chat.id)) ?? chat;
      fresh.timer = c.seconds;
      await storage.putChat(fresh);
      this.emit('chat', fresh);
      await this.note(fresh, `timer-${c.id}`, { event: 'timer', by: from, seconds: c.seconds }, at);
      return true;
    }
    const target = c.t === 'edit' ? { author: from, id: c.target } : c.target;
    const m = await storage.getMessage(chat.id, target.author, target.id);
    if (!m) {
      if (mine) return false;
      // It came before the message itself (out of order): keep it for later.
      const key = `waiting:${chat.id}:${target.author}:${target.id}`;
      const list = (await storage.getValue<Waiting[]>(key)) ?? [];
      if (list.length < 50) await storage.setValue(key, [...list, { from, at, change: c }]);
      return true;
    }
    if (!changeAllowed(chat, m, c, from, at)) return false;
    switch (c.t) {
      case 'edit':
        m.text = c.text;
        if (c.mentions) m.mentions = c.mentions;
        else delete m.mentions;
        m.editedAt = at;
        break;
      case 'delete':
        m.deleted = true;
        for (const k of ['text', 'mentions', 'replyTo', 'poll', 'votes', 'reactions', 'pinnedUntil'] as const) delete m[k];
        break;
      case 'react':
        m.reactions ??= {};
        if (c.emoji) m.reactions[from] = c.emoji;
        else delete m.reactions[from];
        break;
      case 'vote':
        m.votes ??= {};
        if (c.options.length) m.votes[from] = c.options;
        else delete m.votes[from];
        break;
      case 'pin':
        if (c.until) m.pinnedUntil = c.until;
        else delete m.pinnedUntil;
        break;
    }
    await storage.putMessage(m);
    this.emit('message', m);
    return true;
  }

  /** Changes that arrived before their message. */
  private async applyWaiting(chat: Chat, m: Message) {
    const key = `waiting:${chat.id}:${m.author}:${m.id}`;
    const list = await this.o.storage.getValue<Waiting[]>(key);
    if (!list) return;
    await this.o.storage.deleteValue(key);
    for (const w of list) await this.applyChange(chat, w.from, w.at, w.change as Content & Change, false);
  }

  /** A note in the chat from this device itself, like "messages now disappear after 7 days". */
  private async note(chat: Chat, id: string, event: SystemEvent, at: number) {
    const m: Message = { chatId: chat.id, id, author: event.by, authorDevice: 0, seq: null, order: QUEUED + at, sentAt: at, kind: 'system', event };
    await this.o.storage.putMessage(m);
    this.emit('message', m);
  }

  // ---- Group notes from the server ----

  private async applySystem(e: WireEnvelope) {
    const data = (e.data ?? {}) as SystemEvent;
    const users = Array.isArray(data.users) ? (data.users as string[]) : [];
    const at = Date.parse(e.sent_at) || this.now();
    const meGone = (data.event === 'removed' || data.event === 'left') && users.includes(this.s.userId);
    const chat = meGone ? await this.o.storage.getChat(e.chat_id) : await this.refreshChat(e.chat_id);
    if (!chat) return;

    if (meGone) {
      const left = { ...chat, left: true, members: chat.members.filter((m) => m.userId !== this.s.userId) };
      await this.o.storage.putChat(left);
      this.emit('chat', left);
    } else if (data.event === 'removed' || data.event === 'left') {
      // Someone left: a new group key, so they can't read what comes next.
      await this.o.storage.deleteValue(`groupKey:${chat.id}`);
    }

    const m: Message = {
      chatId: chat.id,
      id: `system-${e.seq ?? e.id}`,
      author: e.from,
      authorDevice: 0,
      seq: e.seq,
      order: e.seq ?? QUEUED + at,
      sentAt: at,
      kind: 'system',
      event: { ...data, by: e.from },
    };
    await this.o.storage.putMessage(m);
    this.emit('message', m);
  }

  // ---- Ticks ----

  private async applyReceipt(e: WireEnvelope) {
    const data = e.data as { status?: string; seqs?: number[] } | undefined;
    const seqs = Array.isArray(data?.seqs) ? data.seqs.filter(Number.isInteger) : [];
    const status = data?.status;
    if (!seqs.length || (status !== 'delivered' && status !== 'read')) return;
    const { storage } = this.o;
    const chat = await storage.getChat(e.chat_id);
    if (!chat) return;

    if (e.from === this.s.userId) {
      // I read these on another device: they're not unread here either.
      if (status === 'read') await this.markReadUpTo(chat, Math.max(...seqs));
      return;
    }

    const others = chat.members.map((m) => m.userId).filter((u) => u !== this.s.userId);
    for (const seq of seqs) {
      const m = await storage.getMessageBySeq(chat.id, seq);
      if (!m || m.author !== this.s.userId) continue;
      if (chat.kind === 'direct') {
        if (status === 'read') m.status = 'read';
        else if (m.status !== 'read') m.status = 'delivered';
      } else {
        m.deliveredTo = [...new Set([...(m.deliveredTo ?? []), e.from])];
        if (status === 'read') m.readBy = [...new Set([...(m.readBy ?? []), e.from])];
        if (others.every((u) => m.readBy?.includes(u))) m.status = 'read';
        else if (others.every((u) => m.deliveredTo?.includes(u)) && m.status !== 'read') m.status = 'delivered';
      }
      await storage.putMessage(m);
      this.emit('message', m);
    }
  }

  private async markReadUpTo(chat: Chat, upTo: number) {
    const { storage } = this.o;
    const fresh = (await storage.getChat(chat.id)) ?? chat;
    fresh.readUpTo = Math.max(fresh.readUpTo, upTo);
    const recent = await storage.listMessages(chat.id, { limit: 1000 });
    fresh.unread = recent.filter((m) => m.kind !== 'system' && m.author !== this.s.userId && (m.seq ?? 0) > fresh.readUpTo).length;
    await storage.putChat(fresh);
    this.emit('chat', fresh);
  }

  /** I opened the chat: blue ticks for the others (if their settings allow), and no more unread. */
  async markRead(chatId: string) {
    const ticks = await this.inLane(async () => {
      const chat = await this.o.storage.getChat(chatId);
      if (!chat) return [];
      const recent = await this.o.storage.listMessages(chatId, { limit: 1000 });
      const unread = recent.filter((m) => m.kind !== 'system' && m.author !== this.s.userId && m.seq != null && m.seq > chat.readUpTo);
      const top = Math.max(chat.readUpTo, ...recent.map((m) => m.seq ?? 0));
      await this.markReadUpTo(chat, top);
      const byAuthor = new Map<string, number[]>();
      for (const m of unread) byAuthor.set(m.author, [...(byAuthor.get(m.author) ?? []), m.seq!]);
      return [...byAuthor];
    });
    for (const [to, seqs] of ticks) {
      await this.push('receipt', { chat_id: chatId, to, status: 'read', seqs }).catch(() => {});
    }
  }

  // ---- Asking again ----

  /** Keeps a group envelope until its key arrives. */
  private async hold(e: WireEnvelope) {
    const now = this.now();
    const list = ((await this.o.storage.getValue<WireEnvelope[]>('held')) ?? []).filter((h) => now - (Date.parse(h.sent_at) || now) < HOLD_MS);
    await this.o.storage.setValue('held', [...list, e].slice(-MAX_HELD));
    this.heldNow.push(e);
  }

  /** Tries every held group message again (each sender once). */
  private async releaseAll() {
    const list = (await this.o.storage.getValue<WireEnvelope[]>('held')) ?? [];
    const senders = new Map(list.filter((h) => h.from_device != null).map((h) => [`${h.from}:${h.from_device}`, h]));
    for (const h of senders.values()) await this.release(h.from, h.from_device!);
  }

  /** A group key arrived: open what was waiting for it. */
  private async release(from: string, fromDevice: number) {
    const list = (await this.o.storage.getValue<WireEnvelope[]>('held')) ?? [];
    const mine = list.filter((h) => h.from === from && h.from_device === fromDevice);
    if (!mine.length) return;
    const keep = list.filter((h) => !mine.includes(h));
    const done: number[] = [];
    for (const h of mine) {
      try {
        const text = await this.o.signal.groupDecrypt(this.s.handle, from, fromDevice, h.body!, h.id);
        await this.applyContent(h, text);
        done.push(h.id);
      } catch (err) {
        // Still no key for this one (it's older than the key): keep waiting for the resend.
        if (errorCode(err) === SignalError.noGroupKey) keep.push(h);
      }
    }
    await this.o.storage.setValue('held', keep);
    if (done.length) await this.o.signal.forgetOpened(this.s.handle, done);
  }

  /** Tells the sender's device we couldn't open their message, so it sends it again. Once per message. */
  private async askAgain(e: WireEnvelope, why: 'session' | 'groupKey') {
    if (e.seq == null || e.from_device == null || (e.from === this.s.userId && e.from_device === this.s.deviceId)) return;
    const asked = `asked:${e.chat_id}:${e.seq}:${e.from}:${e.from_device}`;
    if (await this.o.storage.getValue(asked)) return;
    await this.o.storage.setValue(asked, true);
    if (why === 'session') await this.o.signal.deleteSession(this.s.handle, e.from, e.from_device);
    const retry = this.content(e.chat_id, { t: 'retry', seq: e.seq, why });
    await this.push('send', {
      chat_id: e.chat_id,
      kind: 'control',
      envelopes: [{ user_id: e.from, device_id: e.from_device, type: SEALED.plain, body: toB64(writeContent(retry)) }],
    }).catch(() => {});
  }

  /** Someone couldn't open one of our messages: start fresh with that device and send it again. */
  private async onRetry(e: WireEnvelope, c: Content & { t: 'retry' }) {
    if (e.from_device == null) return;
    const device = { userId: e.from, deviceId: e.from_device };
    const once = `resent:${e.chat_id}:${c.seq}:${deviceKey(device)}`;
    const { storage } = this.o;
    if (await storage.getValue(once)) return;
    const record = ((await storage.getValue<SentRecord[]>('sent')) ?? []).find((r) => r.chatId === e.chat_id && r.seq === c.seq);
    const chat = await storage.getChat(e.chat_id);
    if (!record || !chat || !chat.members.some((m) => m.userId === e.from)) return;
    await storage.setValue(once, true);

    // Start a fresh session with that device either way: if it was reinstalled,
    // the old one can't reach it.
    await this.o.signal.deleteSession(this.s.handle, device.userId, device.deviceId);
    if (c.why === 'groupKey') {
      const key = await this.groupKey(chat.id);
      key.sharedWith = key.sharedWith.filter((k) => k !== deviceKey(device));
      await storage.setValue(`groupKey:${chat.id}`, key);
    }
    // Send it to just that device, locked for it alone. Same content, same id,
    // so it shows once even if the first one turns up after all.
    const content = parseContent(record.content);
    if (content) await this.queue(content, 'control', undefined, [device], `resend:${content.id}:${deviceKey(device)}`);
    void this.flush();
  }

  // ---- Small things ----

  /** "Typing…" (never saved). */
  typing(chatId: string, typing: boolean) {
    void this.push('typing', { chat_id: chatId, typing }, 2_000).catch(() => {});
  }

  /** Follow someone's online and last seen. */
  watch(userId: string) {
    return this.push('watch', { user_id: userId });
  }

  unwatch(userId: string) {
    return this.push('unwatch', { user_id: userId });
  }

  /** The 60-digit code to compare with someone (their phone, device 1). */
  async safetyNumber(userId: string) {
    return this.inLane(async () => {
      await this.ensureSessions([{ userId, deviceId: 1 }]);
      return this.o.signal.safetyNumber(this.s.handle, userId, 1);
    });
  }

  /** What's in the outbox: for a "waiting to send" clock icon, or tests. */
  outbox() {
    return this.o.storage.listOutbox();
  }
}
