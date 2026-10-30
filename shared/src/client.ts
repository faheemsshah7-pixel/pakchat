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
import type { Attachment, Body, CallPlan, CallSignal, Change, ChatQuote, Content, HistoryFile, LinkPreview, SyncChange, SharedContact, Payload, Place, Ref, StatusQuote } from './content';
import { isBody, isChange, LIVE_MAX_MS, parseContent, writeContent } from './content';
import type { HistoryBundle } from './history';
import { importHistory } from './history';
import { randomId } from './ids';
import { changeAllowed, maySend, statusOwner } from './rules';
import type { GroupChanges, GroupSettings, Me, ServerApi, ServerChat, SignedIn } from './server';
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

/** A file on this device, about to be sent. `poster`: a video's sharp first frame, for this phone only. */
export type OutgoingFile = Omit<Attachment, 'id' | 'key' | 'digest'> & { local: string; poster?: string };

export type ClientOptions = {
  signal: SignalApi;
  storage: Storage;
  server: ServerApi;
  connect: ConnectionFactory;
  /** Is the app on screen right now? Only then is this person "online" (see setActive). Left out: always. */
  active?: () => boolean;
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
  /** Someone reacted to one of my messages (or liked my status): for alerts. `at` is when they did. */
  reacted: (e: { message: Message; from: string; emoji: string; at: number }) => void;
  chat: (c: Chat) => void;
  typing: (e: { chatId: string; userId: string; typing: boolean; audio?: boolean }) => void;
  presence: (p: Record<string, unknown>) => void;
  connection: (connected: boolean) => void;
  /** Someone's security code changed (they reinstalled, or a new device). */
  securityCodeChanged: (e: { userId: string }) => void;
  /** A call message (ringing, connecting, hanging up). Never saved: the app's call code handles it. */
  call: (e: CallEvent) => void;
  /** A group note with nothing to show in the chat: someone asked to join, a group was suggested for a community, or one of those was answered. */
  notice: (e: { chatId: string; event: string }) => void;
  /** A website: my phone sent a part of its history. The app downloads it and calls `importHistory`. */
  history: (e: { part: number; last: boolean; file: HistoryFile }) => void;
  /** One of my other devices changed a chat setting (see SyncChange): do the same here. */
  sync: (e: SyncChange) => void;
  /** Something went wrong that the app might want to log. */
  error: (err: Error) => void;
};

/** Group notes that only tell the app to look again (its admins' lists), never a line in the chat. */
const QUIET_NOTES = ['requested', 'request_done', 'suggested', 'suggestion_done'];

export type Device = { userId: string; deviceId: number };

/** A call message from one device (see `CallSignal` in content.ts). `at` is the server's time. */
export type CallEvent = { chatId: string; from: string; fromDevice: number; signal: CallSignal & { id: string }; at: number };

/** What any message may carry. `hold`: wait this long (ms) before it goes, for "Undo". */
export type SendExtra = { replyTo?: Ref; mentions?: string[]; forwarded?: boolean; hops?: number; status?: StatusQuote; quote?: ChatQuote; hold?: number };

/** A status lasts a day. */
export const STATUS_MS = 24 * 3600_000;
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
// Reactions, votes, "opened" and live location moves never wake a phone (the server lets them
// through as reactions, which also go in groups where only admins send).
const kindFor = (p: Payload): OutboxItem['kind'] => (p.t === 'react' || p.t === 'vote' || p.t === 'opened' || p.t === 'live' ? 'reaction' : 'message');
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
  /**
   * How many times each message was stopped before it went (paused, or deleted
   * while waiting). A send that started before a stop sees the number change and
   * lets it go, even if it was sent again since (that's a new try of its own).
   */
  private stops = new Map<string, number>();
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
    this.conn = this.o.connect({ token: this.s.token, deviceUuid: this.s.deviceUuid, active: this.o.active });
    this.conn.open({
      envelopes: (list) => this.receive(list),
      typing: (e) => this.emit('typing', { chatId: e.chat_id, userId: e.user_id, typing: e.typing, audio: e.audio === true }),
      presence: (p) => this.emit('presence', p),
      status: (connected) => {
        this.connected = connected;
        this.emit('connection', connected);
        if (connected) {
          // Came on screen while joining: the join may have said "not on screen".
          if (this.o.active) this.setActive(this.o.active());
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
   * never runs in the middle of a message being saved. One of mine that hasn't
   * gone yet (waiting, or paused) doesn't go at all.
   */
  deleteHere(chatId: string, refs: Ref[]) {
    const { storage } = this.o;
    return this.inLane(() =>
      storage.transaction(async () => {
        for (const r of refs) {
          if (r.author === this.s.userId) {
            const m = await storage.getMessage(chatId, r.author, r.id);
            if (m && m.seq == null) {
              this.stopSending(r.id);
              await storage.deleteOutbox(r.id);
              await storage.deleteValue(`paused:${r.id}`);
            }
          }
          await storage.deleteMessage(chatId, r.author, r.id);
        }
      }),
    );
  }

  private stopSending(id: string) {
    this.stops.set(id, (this.stops.get(id) ?? 0) + 1);
  }

  /**
   * The ✕ on one of my files still sending, like WhatsApp: it stops, and stays
   * in the chat, paused, with an upload button to send it again (resumeSend).
   * Delete it from the message menu to take it back for good. False if it had
   * already gone. Stopping the upload itself is the app's job (it knows the transfer).
   */
  pauseSend(chatId: string, ref: Ref): Promise<boolean> {
    const { storage } = this.o;
    return this.inLane(async () => {
      if (ref.author !== this.s.userId) return false;
      const m = await storage.getMessage(chatId, ref.author, ref.id);
      if (!m || m.seq != null || m.status !== 'queued') return false;
      const item = (await storage.listOutbox()).find((o) => o.id === ref.id);
      if (!item) return false;
      this.stopSending(ref.id);
      m.status = 'paused';
      await storage.transaction(async () => {
        // The outbox item waits on the side (with the upload, if it finished) until it's sent again.
        await storage.setValue(`paused:${ref.id}`, item);
        await storage.deleteOutbox(ref.id);
        await storage.putMessage(m);
      });
      this.emit('message', m);
      return true;
    });
  }

  /** The upload button on a paused file: it goes back in the outbox and sends. */
  async resumeSend(chatId: string, ref: Ref): Promise<boolean> {
    const { storage } = this.o;
    const ok = await this.inLane(async () => {
      const item = await storage.getValue<OutboxItem>(`paused:${ref.id}`);
      const m = await storage.getMessage(chatId, ref.author, ref.id);
      if (!item || !m || m.status !== 'paused') return false;
      m.status = 'queued';
      await storage.transaction(async () => {
        await storage.putOutbox({ ...item, tries: 0, notBefore: 0 });
        await storage.deleteValue(`paused:${ref.id}`);
        await storage.putMessage(m);
      });
      this.emit('message', m);
      return true;
    });
    if (ok) void this.flush();
    return ok;
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

  /** Keeps a chat the server just answered with (joining by a link, a new community). */
  adopt(sc: ServerChat): Promise<Chat> {
    return this.inLane(() => this.saveChat(sc));
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
    for (const k of ['title', 'description', 'photo', 'onlyAdminsSend', 'inviteCode', 'inviteExpiresAt', 'inviteMaxUses', 'inviteUses', 'communityId', 'announcements', 'callLink', 'groupsByMembers', 'joinApproval', 'membersEdit', 'membersAdd', 'createdBy'] as const) {
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

  /**
   * My chat with someone (made if there isn't one). `defaultTimer` (seconds,
   * Settings › Privacy › Default message timer): a brand-new chat, with
   * nothing in it yet, starts with disappearing messages on, as on WhatsApp.
   */
  async openDirect(userId: string, defaultTimer = 0) {
    const sc = await this.o.server.openDirect(userId);
    const chat = await this.inLane(() => this.saveChat(sc));
    if (defaultTimer > 0 && sc.seq === 0 && !chat.timer) await this.setTimer(chat.id, defaultTimer);
    return chat;
  }

  /** A new group. `defaultTimer` as for openDirect: a new group starts with it. */
  async createGroup(title: string, memberIds: string[], options?: GroupSettings & { defaultTimer?: number }) {
    const { defaultTimer = 0, ...rest } = options ?? {};
    const sc = await this.o.server.createGroup(title, memberIds, rest);
    const chat = await this.inLane(() => this.saveChat(sc));
    if (defaultTimer > 0) await this.setTimer(chat.id, defaultTimer);
    return chat;
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

  async updateGroup(chatId: string, changes: GroupChanges) {
    const sc = await this.o.server.updateGroup(chatId, changes);
    return this.inLane(() => this.saveChat(sc));
  }

  // ---- Sending ----

  /**
   * `bg`: a status in words, on one of the app's colours. `status`: replying to someone's status.
   * `quote`: replying privately to a group message. `link`: the card for a web address in it.
   * `hold`: wait this long (ms) before it goes, so it can be taken back ("Undo", see `takeBack`).
   */
  sendText(chatId: string, text: string, extra: SendExtra & { bg?: number; link?: LinkPreview } = {}) {
    if (text.trim() === '') throw new Error('Nothing to send');
    const body: Body = { t: 'text', text };
    if (extra.mentions?.length) body.mentions = extra.mentions;
    if (extra.replyTo) body.replyTo = extra.replyTo;
    if (extra.forwarded) body.forwarded = true;
    if (extra.forwarded && extra.hops && extra.hops > 1) body.hops = extra.hops;
    if (extra.bg !== undefined) body.bg = extra.bg;
    if (extra.status) body.status = extra.status;
    if (extra.quote) body.quote = extra.quote;
    if (extra.link) body.link = extra.link;
    return this.sendBody(chatId, body, undefined, extra.hold);
  }

  /**
   * Sends a photo, video, voice note or document. It shows at once; the file is
   * locked and uploaded by the outbox (through `files.upload`), then the message goes.
   */
  sendFile(chatId: string, file: OutgoingFile, extra: SendExtra & { caption?: string } = {}) {
    if (!this.o.files) throw new Error('This device cannot send files');
    // Only what the others should get: never this phone's own notes about the file.
    const { local, poster, transcript: _words, ...meta } = file as OutgoingFile & { transcript?: string };
    const body: Body = { t: 'file', file: { ...meta, id: PENDING, key: '', digest: '' } };
    if (extra.caption?.trim()) body.caption = extra.caption;
    if (extra.mentions?.length) body.mentions = extra.mentions;
    if (extra.replyTo) body.replyTo = extra.replyTo;
    if (extra.forwarded) body.forwarded = true;
    if (extra.forwarded && extra.hops && extra.hops > 1) body.hops = extra.hops;
    if (extra.status) body.status = extra.status;
    if (extra.quote) body.quote = extra.quote;
    return this.sendBody(chatId, body, local, extra.hold, poster);
  }

  sendPoll(chatId: string, question: string, options: string[], multi = false, hold?: number) {
    return this.sendBody(chatId, { t: 'poll', question, options, multi }, undefined, hold);
  }

  /** A place, or (with `live`, the time it ends) my live location; send the moves with `moveLive`. */
  sendLocation(chatId: string, place: Place, extra: { replyTo?: Ref; forwarded?: boolean; hops?: number; hold?: number } = {}) {
    const body: Body = { t: 'location', lat: place.lat, lng: place.lng };
    if (place.name) body.name = place.name;
    if (place.address) body.address = place.address;
    if (place.live) body.live = place.live;
    if (extra.replyTo) body.replyTo = extra.replyTo;
    if (extra.forwarded) body.forwarded = true;
    if (extra.forwarded && extra.hops && extra.hops > 1) body.hops = extra.hops;
    return this.sendBody(chatId, body, undefined, extra.hold);
  }

  /** One or more contact cards. */
  sendContacts(chatId: string, cards: SharedContact[], extra: { replyTo?: Ref; forwarded?: boolean; hops?: number; hold?: number } = {}) {
    const body: Body = { t: 'contact', cards };
    if (extra.replyTo) body.replyTo = extra.replyTo;
    if (extra.forwarded) body.forwarded = true;
    if (extra.forwarded && extra.hops && extra.hops > 1) body.hops = extra.hops;
    return this.sendBody(chatId, body, undefined, extra.hold);
  }

  /** A call planned for later. */
  sendPlan(chatId: string, plan: CallPlan) {
    const { at, ...rest } = plan;
    return this.sendBody(chatId, { t: 'event', ...rest, when: at });
  }

  /** I opened someone's view once message. */
  opened(chatId: string, target: Ref) {
    return this.sendChange(chatId, { t: 'opened', target });
  }

  /** My live location moved (or, with `stop`, I stopped sharing it). */
  moveLive(chatId: string, target: Ref, lat: number, lng: number, stop = false) {
    const change: Change = { t: 'live', target, lat, lng };
    if (stop) change.stop = true;
    return this.sendChange(chatId, change);
  }

  /**
   * "Undo" on a message sent with `hold`: if it's still waiting, it never goes
   * and is gone from here. False if it's too late (it went, or is going).
   */
  takeBack(chatId: string, ref: Ref): Promise<boolean> {
    const { storage } = this.o;
    return this.inLane(async () => {
      if (ref.author !== this.s.userId) return false;
      const item = (await storage.listOutbox()).find((o) => o.id === ref.id);
      if (!item?.held || item.notBefore <= this.now()) return false;
      this.stopSending(ref.id);
      await storage.transaction(async () => {
        await storage.deleteOutbox(ref.id);
        await storage.deleteMessage(chatId, ref.author, ref.id);
      });
      return true;
    });
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

  /** Keep in chat (or let go again) a disappearing message. */
  keep(chatId: string, target: Ref, keep: boolean) {
    return this.sendChange(chatId, { t: 'keep', target, keep });
  }

  /** Disappearing messages, in seconds (0 turns them off). */
  setTimer(chatId: string, seconds: number) {
    return this.sendChange(chatId, { t: 'timer', seconds });
  }

  // ---- Status ----

  /** My own status chat, once I've set who sees it (see `setStatusAudience`). */
  async myStatus(): Promise<Chat | null> {
    const all = await this.o.storage.listChats();
    return all.find((c) => c.kind === 'status' && c.members.some((m) => m.userId === this.s.userId && m.role === 'admin')) ?? null;
  }

  /**
   * Sets who sees my status. If anyone was taken out, the next status goes
   * with a new key, so they can't read it even if a copy reached them.
   */
  async setStatusAudience(userIds: string[]) {
    const sc = await this.o.server.statusAudience(userIds);
    return this.inLane(async () => {
      const old = await this.o.storage.getChat(sc.id);
      const now = new Set(sc.members.map((m) => m.userId));
      if (old && old.members.some((m) => !now.has(m.userId))) await this.o.storage.deleteValue(`groupKey:${sc.id}`);
      return this.saveChat(sc, old);
    });
  }

  // ---- Calls ----

  /**
   * Sends a call message now, never through the outbox: a call message that
   * arrives late is no use. `to` names the devices (the phone I'm connecting
   * to); without it, every device in the chat gets it (ringing, joining,
   * hanging up). `ring` makes a closed phone ring. Throws OfflineError when
   * not connected.
   */
  async sendCall(chatId: string, signal: Omit<CallSignal, 't'>, options: { to?: Device[]; ring?: boolean } = {}) {
    if (!this.connected) throw new OfflineError('Not connected');
    const content = this.content(chatId, { ...signal, t: 'call' } as CallSignal);
    if (!parseContent(writeContent(content))) throw new Error('Bad call message');
    const envelopes = await this.inLane(async () => {
      const chat = await this.mustChat(chatId);
      const targets = options.to ?? (await this.targetsFor(chat));
      return this.lockFor(targets, writeContent(content));
    });
    if (!envelopes.length) return;
    await this.push('call', { chat_id: chatId, envelopes, ring: options.ring === true });
  }

  /**
   * The phone: sends one part of its history to a device it just linked,
   * through the outbox (so it still goes if the phone is offline for a bit).
   * `chatId` is my "Message yourself" chat, where the part was uploaded.
   */
  async sendHistory(chatId: string, deviceId: number, part: { part: number; last: boolean; file: HistoryFile }) {
    const content = this.content(chatId, { t: 'history', ...part });
    if (!parseContent(writeContent(content))) throw new Error('Bad history part');
    await this.inLane(() => this.queue(content, 'control', undefined, [{ userId: this.s.userId, deviceId }]));
    void this.flush();
  }

  /**
   * Tells my other devices (the phone, linked websites) about a chat setting
   * changed here, through the outbox, so it still goes after being offline.
   * Nothing goes if this is my only device.
   */
  async sendSync(change: SyncChange) {
    if (!this.session) return;
    let mine: number[];
    try {
      mine = await this.o.server.devices(this.s.userId);
      await this.o.storage.setValue(`devices:${this.s.userId}`, mine);
    } catch {
      mine = await this.devicesOf(this.s.userId);
    }
    const to = mine.filter((d) => d !== this.s.deviceId).map((deviceId) => ({ userId: this.s.userId, deviceId }));
    if (!to.length) return;
    const self = await this.openDirect(this.s.userId);
    const content = this.content(self.id, { t: 'sync', ...change });
    if (!parseContent(writeContent(content))) throw new Error('Bad sync change');
    await this.inLane(() => this.queue(content, 'control', undefined, to));
    void this.flush();
  }

  /** This device's Signal identity key (base64), as others see it. */
  async myIdentityKey(): Promise<string> {
    return (await this.inLane(() => this.o.signal.deviceKeys(this.s.handle))).identityKey;
  }

  /** A website: adds a downloaded history part. Returns the chats it touched. */
  async importHistory(bundle: HistoryBundle): Promise<string[]> {
    const touched = await this.inLane(() => this.o.storage.transaction(() => importHistory(this.o.storage, bundle)));
    for (const id of touched) {
      const chat = await this.o.storage.getChat(id);
      if (chat) this.emit('chat', chat);
    }
    return touched;
  }

  /**
   * A call in the chat's history, on this phone only: "Missed voice call",
   * "Video call · 2:15". `by` is who called.
   */
  async noteCall(chatId: string, callId: string, info: { by: string; video: boolean; group: boolean; missed: boolean; seconds: number }, at: number) {
    await this.inLane(async () => {
      const chat = await this.o.storage.getChat(chatId);
      if (!chat || chat.kind === 'status') return;
      await this.note(chat, `call-${callId}`, { event: 'call', ...info }, at);
    });
  }

  /** This device, as call messages name it. */
  get device(): Device {
    return { userId: this.s.userId, deviceId: this.s.deviceId };
  }

  private content(chatId: string, payload: Payload): Content {
    return { ...payload, v: 1, id: this.newId(), chat: chatId, at: this.now() } as Content;
  }

  private async sendBody(chatId: string, body: Body, local?: string, hold?: number, poster?: string): Promise<Message> {
    const content = this.content(chatId, body);
    const parsed = parseContent(writeContent(content));
    if (!parsed) throw new Error('That message is not allowed (too long, or empty)');
    const message = await this.inLane(async () => {
      const chat = await this.mustChat(chatId);
      const now = this.now();
      const m = this.toMessage(chat, parsed as Content & Body, this.s.userId, this.s.deviceId, null, now);
      m.status = 'queued';
      if (m.file && local) m.file.local = local;
      if (m.file && poster) m.file.poster = poster;
      await this.o.storage.transaction(async () => {
        await this.o.storage.putMessage(m);
        await this.queue(content, kindFor(content), { author: m.author, id: m.id }, undefined, content.id, hold);
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

  private async queue(content: Content, kind: OutboxItem['kind'], message?: Ref, to?: Device[], id = content.id, hold?: number) {
    const item: OutboxItem = { id, chatId: content.chat, kind, content: writeContent(content), tries: 0, notBefore: 0, added: this.now() };
    if (hold && hold > 0) {
      item.notBefore = this.now() + hold;
      item.held = true;
    }
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
          const item = this.nextToSend(await this.o.storage.listOutbox());
          if (!item) break;
          if (!(await this.sendOne(item))) break;
        }
      } while (this.flushAgain && this.connected);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * The oldest item that may go now. One waiting to try again holds up
   * everything after it; one held for "Undo" holds up only its own chat, so a
   * message there can't overtake it. Null (with a timer set) when nothing may go yet.
   */
  private nextToSend(list: OutboxItem[]): OutboxItem | null {
    const heldChats = new Set<string>();
    let soonest = Infinity;
    for (const item of list) {
      if (heldChats.has(item.chatId)) continue;
      const wait = item.notBefore - this.now();
      if (wait <= 0) return item;
      soonest = Math.min(soonest, wait);
      if (!item.held) break;
      heldChats.add(item.chatId);
    }
    if (soonest < Infinity) this.later(soonest);
    return null;
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
    const stops = this.stops.get(item.id) ?? 0;
    const stopped = () => (this.stops.get(item.id) ?? 0) !== stops;
    try {
      item = await this.uploadFirst(item, stopped);
      if (stopped()) return true;
      prepared = await this.inLane(() => this.prepare(item));
      const reply = await this.push('send', prepared.payload);
      await this.inLane(() => this.sent(item, prepared, reply));
      return true;
    } catch (err) {
      // Paused or deleted while it was on its way: nothing more to do.
      if (stopped()) return true;
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
  private async uploadFirst(item: OutboxItem, stopped: () => boolean): Promise<OutboxItem> {
    const c = parseContent(item.content);
    if (c?.t !== 'file' || c.file.id !== PENDING || !item.message) return item;
    const ref = item.message;
    const m = await this.o.storage.getMessage(item.chatId, ref.author, ref.id);
    if (!m?.file?.local || !this.o.files) throw new Error('The file to send is gone');
    const done = await this.o.files.upload(item.chatId, m.file.local, ref);
    const content = writeContent({ ...c, file: { ...c.file, ...done } });
    const next = { ...item, content };
    await this.inLane(async () => {
      // Paused or deleted while it uploaded: don't bring it back.
      if (stopped()) return;
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
    // Someone else's status: a like goes to its owner alone, never to the others watching it.
    const owner = statusOwner(chat);
    if (owner && owner !== this.s.userId) {
      const theirs = targets.filter((t) => t.userId === owner);
      return { payload: { ...base, envelopes: await this.lockFor(theirs, item.content) }, shared: [] };
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
          // Paused just as it went: it went, so it shows as sent.
          if (m.status === 'queued' || m.status === 'failed' || m.status === 'paused') m.status = 'sent';
          if (chat?.kind === 'status') m.expiresAt = sentAt + STATUS_MS;
          else if (chat?.timer) m.expiresAt = sentAt + chat.timer * 1000;
          await storage.putMessage(m);
          changed = m;
        }
      }
      if (item.kind !== 'control') await this.rememberSent({ chatId: item.chatId, seq, kind: item.kind, content: item.content, at: this.now() });
      const chat = await storage.getChat(item.chatId);
      if (chat) await storage.putChat({ ...chat, lastActivity: Math.max(chat.lastActivity, sentAt) });
      await storage.deleteOutbox(item.id);
      await storage.deleteValue(`paused:${item.id}`);
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
      // A call message can't be sent again (it's too late by then).
      if (e.kind !== 'call') await this.askAgain(e, e.type === SEALED.group ? 'groupKey' : 'session');
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
    if (c.t === 'sync') {
      // Only from my own devices.
      if (e.from === this.s.userId && e.from_device !== this.s.deviceId && e.kind === 'control') {
        const { t: _t, v: _v, id: _id, chat: _chat, at: _at, ...change } = c;
        this.emit('sync', change);
      }
      return;
    }
    if (c.t === 'history') {
      // Only from my own phone, to a linked device.
      if (e.from === this.s.userId && e.from_device === 1 && this.s.deviceId !== 1 && e.kind === 'control') {
        this.emit('history', { part: c.part, last: c.last, file: c.file });
      }
      return;
    }

    let chat = await this.chatFor(e.chat_id);
    if (!chat) return;
    if (!chat.members.some((m) => m.userId === e.from)) {
      // Maybe they just joined and we haven't heard yet.
      chat = await this.refreshChat(e.chat_id);
      if (!chat || !chat.members.some((m) => m.userId === e.from)) return;
    }
    if (!maySend(chat, e.from, c.t)) return;

    const at = Date.parse(e.sent_at) || this.now();
    if (c.t === 'call') {
      // Only as a call message, and only in chats with calls (the server checks too).
      if (e.kind === 'call' && chat.kind !== 'status') this.emit('call', { chatId: chat.id, from: e.from, fromDevice: e.from_device, signal: c, at });
      return;
    }
    // Anything else must not pretend to be a call message.
    if (e.kind === 'call') return;
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
      if (c.hops) m.forwardHops = c.hops;
      if (c.bg !== undefined) m.bg = c.bg;
      if (c.status) m.statusReply = c.status;
      if (c.quote) m.quote = c.quote;
      if (c.link) m.link = c.link;
    } else if (c.t === 'file') {
      m.file = { ...c.file };
      if (c.caption) m.text = c.caption;
      if (c.mentions) m.mentions = c.mentions;
      if (c.replyTo) m.replyTo = c.replyTo;
      if (c.forwarded) m.forwarded = true;
      if (c.hops) m.forwardHops = c.hops;
      if (c.status) m.statusReply = c.status;
      if (c.quote) m.quote = c.quote;
    } else if (c.t === 'location') {
      m.location = { lat: c.lat, lng: c.lng };
      if (c.name) m.location.name = c.name;
      if (c.address) m.location.address = c.address;
      // A live location can't last longer than 8 hours, whatever the sender's phone says.
      if (c.live) m.location.live = Math.min(c.live, at + LIVE_MAX_MS);
      if (c.replyTo) m.replyTo = c.replyTo;
      if (c.forwarded) m.forwarded = true;
      if (c.hops) m.forwardHops = c.hops;
    } else if (c.t === 'contact') {
      m.contacts = c.cards;
      if (c.replyTo) m.replyTo = c.replyTo;
      if (c.forwarded) m.forwarded = true;
      if (c.hops) m.forwardHops = c.hops;
    } else if (c.t === 'event') {
      m.plan = { title: c.title, at: c.when, video: c.video };
      if (c.link) m.plan.link = c.link;
      if (c.about) m.plan.about = c.about;
      if (c.end) m.plan.end = c.end;
      if (c.place) m.plan.place = c.place;
      if (c.general) m.plan.general = true;
      if (c.call) m.plan.call = true;
    } else {
      m.poll = { question: c.question, options: c.options, multi: c.multi };
    }
    if (author === this.s.userId) m.status = 'sent';
    // A status goes after a day; disappearing messages after the chat's timer.
    if (chat.kind === 'status') m.expiresAt = at + STATUS_MS;
    else if (chat.timer) m.expiresAt = at + chat.timer * 1000;
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
    // Someone else's new reaction to my message, to tell the app.
    let reacted: string | null = null;
    switch (c.t) {
      case 'edit':
        m.text = c.text;
        if (c.mentions) m.mentions = c.mentions;
        else delete m.mentions;
        m.editedAt = at;
        break;
      case 'delete':
        m.deleted = true;
        for (const k of ['text', 'mentions', 'replyTo', 'poll', 'votes', 'reactions', 'pinnedUntil', 'quote', 'link', 'location', 'contacts', 'plan'] as const) delete m[k];
        break;
      case 'opened':
        // On my other devices it's gone too; on the sender's, it says who opened it.
        if (from === this.s.userId) {
          m.opened = true;
          if (m.file) delete m.file.thumb;
        }
        if (m.author === this.s.userId && from !== this.s.userId) m.openedBy = [...new Set([...(m.openedBy ?? []), from])];
        break;
      case 'live':
        if (!m.location) break;
        m.location = { ...m.location, lat: c.lat, lng: c.lng, updatedAt: at };
        if (c.stop) m.location.live = Math.min(m.location.live ?? at, at);
        break;
      case 'react':
        m.reactions ??= {};
        if (c.emoji && m.reactions[from] !== c.emoji && from !== this.s.userId && m.author === this.s.userId) reacted = c.emoji;
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
      case 'keep':
        if (c.keep) {
          m.keptBy = from;
          if (m.expiresAt) m.keptExpiresAt = m.expiresAt;
          delete m.expiresAt;
        } else {
          // Let go: it disappears when it would have (straight away if that's passed).
          if (m.keptExpiresAt) m.expiresAt = m.keptExpiresAt;
          delete m.keptBy;
          delete m.keptExpiresAt;
        }
        break;
    }
    await storage.putMessage(m);
    this.emit('message', m);
    if (reacted) this.emit('reacted', { message: m, from, emoji: reacted, at });
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
    // It goes just after the newest sent message, so later messages still come under it.
    const recent = await this.o.storage.listMessages(chat.id, { limit: 50 });
    const last = recent.find((x) => x.seq !== null)?.seq ?? 0;
    const m: Message = { chatId: chat.id, id, author: event.by, authorDevice: 0, seq: null, order: last + 0.5, sentAt: at, kind: 'system', event };
    await this.o.storage.putMessage(m);
    this.emit('message', m);
  }

  // ---- Group notes from the server ----

  private async applySystem(e: WireEnvelope) {
    const data = (e.data ?? {}) as SystemEvent;
    const users = Array.isArray(data.users) ? (data.users as string[]) : [];
    const at = Date.parse(e.sent_at) || this.now();
    if (QUIET_NOTES.includes(data.event)) {
      this.emit('notice', { chatId: e.chat_id, event: data.event });
      return;
    }
    // A deactivated community (and its announcements) has nobody in it any more.
    const meGone = ((data.event === 'removed' || data.event === 'left') && users.includes(this.s.userId)) || data.event === 'deactivated';
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

  /**
   * I opened the chat: blue ticks for the others (if their settings allow), and
   * no more unread. With `upTo`, only up to that message number (a status I
   * just watched, not the ones after it).
   */
  async markRead(chatId: string, upTo?: number) {
    const ticks = await this.inLane(async () => {
      const chat = await this.o.storage.getChat(chatId);
      if (!chat) return [];
      const recent = (await this.o.storage.listMessages(chatId, { limit: 1000 })).filter((m) => upTo === undefined || (m.seq ?? 0) <= upTo);
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

  /** "Typing…", or with `audio` "recording audio…" (never saved). */
  typing(chatId: string, typing: boolean, audio = false) {
    void this.push('typing', { chat_id: chatId, typing, ...(audio ? { audio } : {}) }, 2_000).catch(() => {});
  }

  /**
   * The app came on screen (true) or went away (false): I show as "online" only
   * while it's on screen. A connection made in the background (to collect a
   * message) says so when it joins, so it never shows me online at all.
   */
  setActive(active: boolean) {
    void this.push('active', { active }, 5_000).catch(() => {});
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
