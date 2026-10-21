// Where a device keeps its chats. The phone uses SQLite (phase 4), the
// website IndexedDB (phase 8). Both just have to do what this interface says,
// and `test/storageContract.ts` checks that they do.
//
// Signal's keys are NOT kept here: they stay inside the Signal module.

import type { Ref } from './content';

export type Role = 'admin' | 'member';

export type Chat = {
  id: string;
  kind: 'direct' | 'group';
  members: { userId: string; role: Role }[];
  title?: string;
  description?: string;
  photo?: string;
  onlyAdminsSend?: boolean;
  /** Only admins see it. */
  inviteCode?: string | null;
  /** Disappearing messages, in seconds. 0 or missing: off. */
  timer?: number;
  /** I left, or was removed. The chat stays, but I can't send. */
  left?: boolean;
  /** The newest message number I have read. */
  readUpTo: number;
  unread: number;
  /** For sorting the chat list. */
  lastActivity: number;
};

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

/** A group note from the server, like "Ali added Sara". */
export type SystemEvent = { event: string; by: string; users?: string[]; title?: string; [key: string]: unknown };

export type Message = {
  chatId: string;
  /** Made by the author's phone. With `author`, it names the message everywhere. */
  id: string;
  author: string;
  authorDevice: number;
  /** The chat's number for it, from the server. Null while it waits to be sent. */
  seq: number | null;
  /** Where it goes in the chat: its number, or after everything while it waits. */
  order: number;
  /** The server's time (ms), or this phone's time while it waits. */
  sentAt: number;
  kind: 'text' | 'poll' | 'system';
  text?: string;
  mentions?: string[];
  replyTo?: Ref;
  forwarded?: boolean;
  poll?: { question: string; options: string[]; multi: boolean };
  /** Poll answers: user id to option numbers. */
  votes?: Record<string, number[]>;
  /** User id to emoji. */
  reactions?: Record<string, string>;
  editedAt?: number;
  deleted?: boolean;
  pinnedUntil?: number;
  /** Disappearing messages: when it goes (ms). */
  expiresAt?: number;
  event?: SystemEvent;
  /** My own messages: how far they got. */
  status?: MessageStatus;
  /** Groups: who has it, and who has read it. */
  deliveredTo?: string[];
  readBy?: string[];
};

/** One thing waiting to go to the server, oldest first. */
export type OutboxItem = {
  /** The content's id. */
  id: string;
  chatId: string;
  kind: 'message' | 'reaction' | 'control';
  /** The content, as JSON. The same every time it's tried, so it's never shown twice. */
  content: string;
  /** Control messages go only to these devices. */
  to?: { userId: string; deviceId: number }[];
  /** The message bubble to update when it's sent (my own messages). */
  message?: Ref;
  tries: number;
  /** Don't try again before this time (ms). */
  notBefore: number;
  /** Its place in the queue. */
  added: number;
};

/** Everything here is async, so SQLite and IndexedDB can sit behind it. */
export interface Storage {
  getChat(id: string): Promise<Chat | null>;
  putChat(chat: Chat): Promise<void>;
  /** Newest activity first. */
  listChats(): Promise<Chat[]>;

  getMessage(chatId: string, author: string, id: string): Promise<Message | null>;
  getMessageBySeq(chatId: string, seq: number): Promise<Message | null>;
  putMessage(message: Message): Promise<void>;
  deleteMessage(chatId: string, author: string, id: string): Promise<void>;
  /** The newest `limit` messages before `beforeOrder` (or the newest of all), oldest first. */
  listMessages(chatId: string, options?: { beforeOrder?: number; limit?: number }): Promise<Message[]>;

  putOutbox(item: OutboxItem): Promise<void>;
  /** Oldest first. */
  listOutbox(): Promise<OutboxItem[]>;
  deleteOutbox(id: string): Promise<void>;

  /** Envelopes already handled, so one that comes twice is skipped. */
  hasSeen(envelopeId: number): Promise<boolean>;
  markSeen(envelopeId: number): Promise<void>;

  /** Small things: my session, who has which devices, group keys, waiting changes. */
  getValue<T>(key: string): Promise<T | undefined>;
  setValue<T>(key: string, value: T): Promise<void>;
  deleteValue(key: string): Promise<void>;

  /** Runs `work` so that all of its changes are saved, or none. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/** Keeps everything in memory. For tests, and as the simplest example. */
export class MemoryStorage implements Storage {
  private chats = new Map<string, Chat>();
  private messages = new Map<string, Message>();
  private outbox = new Map<string, OutboxItem>();
  private seen = new Set<number>();
  private values = new Map<string, unknown>();

  // Copies go in and out, like a real database: changing an object you got
  // back doesn't change what's saved until you put it again.
  private copy<T>(x: T): T {
    return structuredClone(x);
  }

  private key(chatId: string, author: string, id: string) {
    return `${chatId}/${author}/${id}`;
  }

  async getChat(id: string) {
    const c = this.chats.get(id);
    return c ? this.copy(c) : null;
  }
  async putChat(chat: Chat) {
    this.chats.set(chat.id, this.copy(chat));
  }
  async listChats() {
    return [...this.chats.values()].sort((a, b) => b.lastActivity - a.lastActivity).map((c) => this.copy(c));
  }

  async getMessage(chatId: string, author: string, id: string) {
    const m = this.messages.get(this.key(chatId, author, id));
    return m ? this.copy(m) : null;
  }
  async getMessageBySeq(chatId: string, seq: number) {
    for (const m of this.messages.values()) if (m.chatId === chatId && m.seq === seq) return this.copy(m);
    return null;
  }
  async putMessage(message: Message) {
    this.messages.set(this.key(message.chatId, message.author, message.id), this.copy(message));
  }
  async deleteMessage(chatId: string, author: string, id: string) {
    this.messages.delete(this.key(chatId, author, id));
  }
  async listMessages(chatId: string, options: { beforeOrder?: number; limit?: number } = {}) {
    const before = options.beforeOrder ?? Infinity;
    const list = [...this.messages.values()]
      .filter((m) => m.chatId === chatId && m.order < before)
      .sort((a, b) => a.order - b.order || a.sentAt - b.sentAt);
    return list.slice(-(options.limit ?? 50)).map((m) => this.copy(m));
  }

  async putOutbox(item: OutboxItem) {
    this.outbox.set(item.id, this.copy(item));
  }
  async listOutbox() {
    return [...this.outbox.values()].sort((a, b) => a.added - b.added).map((i) => this.copy(i));
  }
  async deleteOutbox(id: string) {
    this.outbox.delete(id);
  }

  async hasSeen(envelopeId: number) {
    return this.seen.has(envelopeId);
  }
  async markSeen(envelopeId: number) {
    this.seen.add(envelopeId);
  }

  async getValue<T>(key: string) {
    return this.values.has(key) ? this.copy(this.values.get(key) as T) : undefined;
  }
  async setValue<T>(key: string, value: T) {
    this.values.set(key, this.copy(value));
  }
  async deleteValue(key: string) {
    this.values.delete(key);
  }

  // Undo everything if `work` fails: put back a copy taken before.
  async transaction<T>(work: () => Promise<T>) {
    const before = this.copy({
      chats: this.chats,
      messages: this.messages,
      outbox: this.outbox,
      seen: this.seen,
      values: this.values,
    });
    try {
      return await work();
    } catch (err) {
      Object.assign(this, before);
      throw err;
    }
  }
}
