// idbStorage.ts: where the website keeps its chats, in the browser's own
// database (IndexedDB). Nothing here leaves the computer. It does what
// shared/src/storage.ts asks, and passes the same checks as the phone's
// SQLite (see idbStorage.test.ts).
//
// IndexedDB can't hold a transaction open while other work (like Signal)
// runs in between, so `transaction` collects the changes in memory, and
// writes them all in one go at the end, or drops them all if it fails.

import type { Chat, Message, OutboxItem, Storage } from '@pakchat/shared';

/** 2: the 'pinned' index (pinned messages, for the bar under a chat's header). */
const VERSION = 2;
const GONE = Symbol('gone');

type StoreName = 'chats' | 'messages' | 'outbox' | 'seen' | 'values';
type Pending = Map<StoreName, Map<string, unknown>>;

const msgKey = (chatId: string, author: string, id: string) => [chatId, author, id];
// Pending changes are kept by a text key; IndexedDB's own keys are arrays.
const textKey = (key: IDBValidKey) => JSON.stringify(key);

function done(req: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Saving was stopped'));
  });
}

/** Opens (or makes) one account's database. `name` keeps accounts apart. */
export function openIdb(name: string, factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) makeStores(db);
      // Only pinned messages have pinnedUntil, so only they are in it.
      if (e.oldVersion < 2) req.transaction!.objectStore('messages').createIndex('pinned', ['chatId', 'pinnedUntil']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The stores and indexes of version 1. */
function makeStores(db: IDBDatabase) {
  const chats = db.createObjectStore('chats', { keyPath: 'id' });
  chats.createIndex('activity', 'lastActivity');
  const messages = db.createObjectStore('messages', { keyPath: ['chatId', 'author', 'id'] });
  messages.createIndex('order', ['chatId', 'order']);
  // Messages still waiting to be sent have no number, so they're simply not in this one.
  messages.createIndex('seq', ['chatId', 'seq']);
  const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
  outbox.createIndex('added', 'added');
  db.createObjectStore('seen');
  db.createObjectStore('values');
}

export class IdbStorage implements Storage {
  private pending: Pending | null = null;
  private depth = 0;

  constructor(private db: IDBDatabase) {}

  // ---- Reading and writing, through any changes not saved yet ----

  private store(name: StoreName, mode: IDBTransactionMode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  private peek(name: StoreName, key: IDBValidKey): { hit: boolean; value?: unknown } {
    const map = this.pending?.get(name);
    if (!map) return { hit: false };
    const k = textKey(key);
    if (!map.has(k)) return { hit: false };
    const v = map.get(k);
    return { hit: true, value: v === GONE ? undefined : v };
  }

  private async get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const p = this.peek(name, key);
    if (p.hit) return structuredClone(p.value) as T | undefined;
    return (await done(this.store(name).get(key))) as T | undefined;
  }

  private async put(name: StoreName, key: IDBValidKey, value: unknown) {
    if (this.pending) {
      let map = this.pending.get(name);
      if (!map) this.pending.set(name, (map = new Map()));
      map.set(textKey(key), value === GONE ? GONE : structuredClone(value));
      return;
    }
    const s = this.store(name, 'readwrite');
    const keyed = s.keyPath !== null;
    if (value === GONE) await done(s.delete(key));
    else await done(keyed ? s.put(value) : s.put(value, key));
  }

  /** What's waiting to be saved in one store, as [key, value or GONE]. */
  private waiting(name: StoreName): [string, unknown][] {
    return [...(this.pending?.get(name) ?? new Map()).entries()];
  }

  // ---- Chats ----

  getChat(id: string) {
    return this.get<Chat>('chats', id).then((c) => c ?? null);
  }
  putChat(chat: Chat) {
    return this.put('chats', chat.id, chat);
  }
  async listChats() {
    const all = (await done(this.store('chats').getAll())) as Chat[];
    const byId = new Map(all.map((c) => [c.id, c]));
    for (const [k, v] of this.waiting('chats')) {
      const id = JSON.parse(k) as string;
      if (v === GONE) byId.delete(id);
      else byId.set(id, structuredClone(v as Chat));
    }
    return [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity);
  }

  // ---- Messages ----

  getMessage(chatId: string, author: string, id: string) {
    return this.get<Message>('messages', msgKey(chatId, author, id)).then((m) => m ?? null);
  }
  async getMessageBySeq(chatId: string, seq: number) {
    for (const [, v] of this.waiting('messages')) {
      if (v !== GONE && (v as Message).chatId === chatId && (v as Message).seq === seq) return structuredClone(v as Message);
    }
    const m = (await done(this.store('messages').index('seq').get([chatId, seq]))) as Message | undefined;
    if (!m) return null;
    // It may have been changed or deleted in the changes not saved yet.
    const p = this.peek('messages', msgKey(m.chatId, m.author, m.id));
    if (p.hit) return p.value && (p.value as Message).seq === seq ? structuredClone(p.value as Message) : null;
    return m;
  }
  /**
   * Each chat's newest message, in one walk of the database (not one read per
   * chat), for the chat list. Reads what's saved, not changes still pending.
   */
  async newestOfEach(): Promise<Map<string, Message>> {
    const out = new Map<string, Message>();
    await new Promise<void>((resolve, reject) => {
      const req = this.store('messages').index('order').openCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const m = c.value as Message;
        out.set(m.chatId, m);
        // Jump straight past the rest of this chat, to the newest of the one before it.
        c.continue([m.chatId, -Infinity]);
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }

  /**
   * Messages in any chat whose words (or caption) include `words`, newest
   * first, for the chat list's search. One walk of what's saved.
   */
  async searchText(words: string, limit = 50): Promise<Message[]> {
    const want = words.trim().toLowerCase();
    if (!want) return [];
    const found: Message[] = [];
    // Read in big pages (getAll), which is many times quicker than a cursor's
    // one callback per message, and keep only the newest `limit` as it goes.
    const PAGE = 2_000;
    let after: IDBValidKey | null = null;
    for (;;) {
      const range = after === null ? undefined : IDBKeyRange.lowerBound(after, true);
      const store = this.store('messages');
      const [keys, page] = (await Promise.all([done(store.getAllKeys(range, PAGE)), done(store.getAll(range, PAGE))])) as [IDBValidKey[], Message[]];
      for (const m of page) {
        if (m.text && !m.deleted && m.kind !== 'system' && m.text.toLowerCase().replace(/[*_~`]/g, '').includes(want)) found.push(m);
      }
      if (found.length > limit * 4) {
        found.sort((a, b) => b.sentAt - a.sentAt);
        found.length = limit;
      }
      if (keys.length < PAGE) break;
      after = keys[keys.length - 1];
    }
    return found.sort((a, b) => b.sentAt - a.sentAt).slice(0, limit);
  }

  /** The chat's messages pinned now (newest first), from the 'pinned' index, not a walk of the chat. */
  async pinnedMessages(chatId: string): Promise<Message[]> {
    const now = Date.now();
    const range = IDBKeyRange.bound([chatId, now], [chatId, Infinity]);
    const byKey = new Map(((await done(this.store('messages').index('pinned').getAll(range))) as Message[]).map((m) => [textKey(msgKey(m.chatId, m.author, m.id)), m]));
    // Changes not saved yet: pinned, unpinned or deleted meanwhile.
    for (const [k, v] of this.waiting('messages')) {
      if ((JSON.parse(k) as string[])[0] !== chatId) continue;
      if (v !== GONE && ((v as Message).pinnedUntil ?? 0) > now) byKey.set(k, structuredClone(v as Message));
      else byKey.delete(k);
    }
    return [...byKey.values()].filter((m) => !m.deleted).sort((a, b) => b.sentAt - a.sentAt);
  }

  putMessage(message: Message) {
    return this.put('messages', msgKey(message.chatId, message.author, message.id), message);
  }
  deleteMessage(chatId: string, author: string, id: string) {
    return this.put('messages', msgKey(chatId, author, id), GONE);
  }
  async listMessages(chatId: string, options: { beforeOrder?: number; limit?: number } = {}) {
    const limit = options.limit ?? 50;
    const before = options.beforeOrder ?? Infinity;
    const waiting = this.waiting('messages').filter(([k]) => (JSON.parse(k) as string[])[0] === chatId);
    // Read a few extra in case some of them were changed or deleted meanwhile.
    const want = limit + waiting.length;
    const upper = before === Infinity ? [chatId, Infinity] : [chatId, before];
    const range = IDBKeyRange.bound([chatId, -Infinity], upper, false, true);
    const found: Message[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = this.store('messages').index('order').openCursor(range, 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (!c || found.length >= want) return resolve();
        found.push(c.value as Message);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const byKey = new Map(found.map((m) => [textKey(msgKey(m.chatId, m.author, m.id)), m]));
    for (const [k, v] of waiting) {
      if (v === GONE) byKey.delete(k);
      else if ((v as Message).order < before) byKey.set(k, structuredClone(v as Message));
      else byKey.delete(k);
    }
    return [...byKey.values()].sort((a, b) => a.order - b.order || a.sentAt - b.sentAt).slice(-limit);
  }

  // ---- The outbox ----

  putOutbox(item: OutboxItem) {
    return this.put('outbox', item.id, item);
  }
  async listOutbox() {
    const all = (await done(this.store('outbox').getAll())) as OutboxItem[];
    const byId = new Map(all.map((i) => [i.id, i]));
    for (const [k, v] of this.waiting('outbox')) {
      const id = JSON.parse(k) as string;
      if (v === GONE) byId.delete(id);
      else byId.set(id, structuredClone(v as OutboxItem));
    }
    return [...byId.values()].sort((a, b) => a.added - b.added);
  }
  deleteOutbox(id: string) {
    return this.put('outbox', id, GONE);
  }

  // ---- Envelopes already handled ----

  async hasSeen(envelopeId: number) {
    return (await this.get<true>('seen', envelopeId)) === true;
  }
  markSeen(envelopeId: number) {
    return this.put('seen', envelopeId, true);
  }

  // ---- Small values ----

  getValue<T>(key: string) {
    return this.get<T>('values', key);
  }
  setValue<T>(key: string, value: T) {
    return this.put('values', key, value);
  }
  deleteValue(key: string) {
    return this.put('values', key, GONE);
  }

  // ---- All or nothing ----

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    // Inside another one: part of it.
    if (this.depth > 0) {
      this.depth++;
      try {
        return await work();
      } finally {
        this.depth--;
      }
    }
    this.pending = new Map();
    this.depth = 1;
    let result: T;
    try {
      result = await work();
    } catch (err) {
      this.pending = null;
      this.depth = 0;
      throw err;
    }
    const changes = this.pending;
    this.pending = null;
    this.depth = 0;
    await this.save(changes);
    return result;
  }

  /** Writes every change in one IndexedDB transaction. */
  private async save(changes: Pending) {
    const names = [...changes.keys()];
    if (!names.length) return;
    const tx = this.db.transaction(names, 'readwrite');
    const end = finished(tx);
    for (const name of names) {
      const s = tx.objectStore(name);
      const keyed = s.keyPath !== null;
      for (const [k, v] of changes.get(name)!) {
        const key = JSON.parse(k) as IDBValidKey;
        if (v === GONE) s.delete(key);
        else if (keyed) s.put(v);
        else s.put(v, key);
      }
    }
    await end;
  }

  /** Deletes everything (signing out). */
  async clear() {
    const names: StoreName[] = ['chats', 'messages', 'outbox', 'seen', 'values'];
    const tx = this.db.transaction(names, 'readwrite');
    const end = finished(tx);
    for (const n of names) tx.objectStore(n).clear();
    await end;
  }
}
