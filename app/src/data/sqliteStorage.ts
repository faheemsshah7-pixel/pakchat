// sqliteStorage.ts: where the phone keeps its chats and messages, in SQLite.
//
// It does exactly what the shared core's Storage interface asks
// (shared/src/storage.ts), and passes the same checks as the in-memory one
// (test/sqliteStorage.test.ts runs storageContract on it). On top of that it
// has a search index, so finding an old message is instant and never leaves
// the phone.
//
// It talks to the database through the small `Db` interface below, so the
// tests can run it on a computer with Node's own SQLite, and the app with
// expo-sqlite (see db.ts).
import { restoredChat, type Chat, type Message, type OutboxItem, type Storage } from '@pakchat/shared';

export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
}

/** The web addresses in some words ("www.x.pk" becomes "https://www.x.pk"). */
export function linksIn(text: string): string[] {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,;:!?)\]'"]/gi) ?? [];
  return found.map((l) => (/^https?:/i.test(l) ? l : `https://${l}`));
}

/** One search result. */
export type Found = { chatId: string; author: string; id: string; text: string; sentAt: number };

// Each change to the tables gets the next number here, so an old phone's
// database is brought up to date step by step.
const MIGRATIONS = [
  `
  CREATE TABLE chats (id TEXT PRIMARY KEY, last_activity INTEGER NOT NULL, json TEXT NOT NULL);
  CREATE TABLE messages (
    chat_id TEXT NOT NULL, author TEXT NOT NULL, id TEXT NOT NULL,
    seq INTEGER, ord NUMERIC NOT NULL, sent_at INTEGER NOT NULL, json TEXT NOT NULL,
    PRIMARY KEY (chat_id, author, id)
  );
  CREATE INDEX messages_by_order ON messages (chat_id, ord);
  CREATE INDEX messages_by_seq ON messages (chat_id, seq);
  CREATE TABLE outbox (id TEXT PRIMARY KEY, added INTEGER NOT NULL, json TEXT NOT NULL);
  CREATE TABLE seen (id INTEGER PRIMARY KEY);
  CREATE TABLE kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE VIRTUAL TABLE search USING fts5(
    text, chat_id UNINDEXED, author UNINDEXED, msg_id UNINDEXED, sent_at UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];

export class SqliteStorage implements Storage {
  private depth = 0;

  private constructor(private db: Db) {}

  /** Opens the storage, creating or updating the tables first. */
  static async open(db: Db): Promise<SqliteStorage> {
    await db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const row = await db.first<{ user_version: number }>('PRAGMA user_version');
    for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
      await db.exec(`BEGIN; ${MIGRATIONS[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
    }
    return new SqliteStorage(db);
  }

  // ---- Chats ----

  async getChat(id: string) {
    const r = await this.db.first<{ json: string }>('SELECT json FROM chats WHERE id = ?', [id]);
    return r ? (JSON.parse(r.json) as Chat) : null;
  }

  async putChat(chat: Chat) {
    await this.db.run('INSERT OR REPLACE INTO chats (id, last_activity, json) VALUES (?, ?, ?)', [chat.id, chat.lastActivity, JSON.stringify(chat)]);
  }

  async listChats() {
    const rows = await this.db.all<{ json: string }>('SELECT json FROM chats ORDER BY last_activity DESC');
    return rows.map((r) => JSON.parse(r.json) as Chat);
  }

  // ---- Messages ----

  async getMessage(chatId: string, author: string, id: string) {
    const r = await this.db.first<{ json: string }>('SELECT json FROM messages WHERE chat_id = ? AND author = ? AND id = ?', [chatId, author, id]);
    return r ? (JSON.parse(r.json) as Message) : null;
  }

  async getMessageBySeq(chatId: string, seq: number) {
    const r = await this.db.first<{ json: string }>('SELECT json FROM messages WHERE chat_id = ? AND seq = ?', [chatId, seq]);
    return r ? (JSON.parse(r.json) as Message) : null;
  }

  async putMessage(m: Message) {
    await this.transaction(async () => {
      await this.db.run('INSERT OR REPLACE INTO messages (chat_id, author, id, seq, ord, sent_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        m.chatId,
        m.author,
        m.id,
        m.seq,
        m.order,
        m.sentAt,
        JSON.stringify(m),
      ]);
      // Keep the search index in step: deleted messages and polls' answers aren't searchable.
      await this.db.run('DELETE FROM search WHERE chat_id = ? AND author = ? AND msg_id = ?', [m.chatId, m.author, m.id]);
      const words = m.deleted ? '' : m.kind === 'poll' ? [m.poll?.question, ...(m.poll?.options ?? [])].join(' ') : [m.text, m.file?.name].filter(Boolean).join(' ');
      if (words.trim() && m.kind !== 'system') {
        await this.db.run('INSERT INTO search (text, chat_id, author, msg_id, sent_at) VALUES (?, ?, ?, ?, ?)', [words, m.chatId, m.author, m.id, m.sentAt]);
      }
    });
  }

  async deleteMessage(chatId: string, author: string, id: string) {
    await this.transaction(async () => {
      await this.db.run('DELETE FROM messages WHERE chat_id = ? AND author = ? AND id = ?', [chatId, author, id]);
      await this.db.run('DELETE FROM search WHERE chat_id = ? AND author = ? AND msg_id = ?', [chatId, author, id]);
    });
  }

  async listMessages(chatId: string, options: { beforeOrder?: number; limit?: number } = {}) {
    const limit = options.limit ?? 50;
    const rows =
      options.beforeOrder === undefined
        ? await this.db.all<{ json: string }>('SELECT json FROM messages WHERE chat_id = ? ORDER BY ord DESC, sent_at DESC LIMIT ?', [chatId, limit])
        : await this.db.all<{ json: string }>('SELECT json FROM messages WHERE chat_id = ? AND ord < ? ORDER BY ord DESC, sent_at DESC LIMIT ?', [
            chatId,
            options.beforeOrder,
            limit,
          ]);
    return rows.reverse().map((r) => JSON.parse(r.json) as Message);
  }

  /**
   * The newest message of every chat that has one, by chat, in one read (the
   * chat list). The same one `listMessages(chatId, { limit: 1 })` gives, without
   * asking chat by chat.
   */
  async newestOfEach(): Promise<Map<string, Message>> {
    const rows = await this.db.all<{ chat_id: string; json: string }>(
      'SELECT m.chat_id AS chat_id, m.json AS json FROM chats c JOIN messages m ON m.rowid = (SELECT rowid FROM messages WHERE chat_id = c.id ORDER BY ord DESC, sent_at DESC LIMIT 1)',
    );
    return new Map(rows.map((r) => [r.chat_id, JSON.parse(r.json) as Message]));
  }

  // ---- The outbox ----

  async putOutbox(item: OutboxItem) {
    await this.db.run('INSERT OR REPLACE INTO outbox (id, added, json) VALUES (?, ?, ?)', [item.id, item.added, JSON.stringify(item)]);
  }

  async listOutbox() {
    const rows = await this.db.all<{ json: string }>('SELECT json FROM outbox ORDER BY added');
    return rows.map((r) => JSON.parse(r.json) as OutboxItem);
  }

  async deleteOutbox(id: string) {
    await this.db.run('DELETE FROM outbox WHERE id = ?', [id]);
  }

  // ---- Envelopes already handled ----

  async hasSeen(envelopeId: number) {
    return (await this.db.first('SELECT 1 FROM seen WHERE id = ?', [envelopeId])) !== null;
  }

  async markSeen(envelopeId: number) {
    await this.db.run('INSERT OR IGNORE INTO seen (id) VALUES (?)', [envelopeId]);
  }

  // ---- Small values ----

  async getValue<T>(key: string) {
    const r = await this.db.first<{ json: string }>('SELECT json FROM kv WHERE key = ?', [key]);
    return r ? (JSON.parse(r.json) as T) : undefined;
  }

  async setValue<T>(key: string, value: T) {
    await this.db.run('INSERT OR REPLACE INTO kv (key, json) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }

  async deleteValue(key: string) {
    await this.db.run('DELETE FROM kv WHERE key = ?', [key]);
  }

  // ---- All or nothing ----

  // A transaction inside a transaction becomes a "savepoint", so it can be undone on its own.
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const name = `t${this.depth}`;
    await this.db.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = await work();
      this.depth--;
      await this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      await this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  // ---- Search (the phone's own, never the server's) ----

  /** Finds messages containing every word typed, newest first. "not" finds "notes" too. */
  async search(query: string, limit = 50): Promise<Found[]> {
    const words = query
      .split(/\s+/)
      .map((w) => w.replace(/["*]/g, ''))
      .filter(Boolean);
    if (words.length === 0) return [];
    const match = words.map((w) => `"${w}"*`).join(' ');
    const rows = await this.db.all<{ text: string; chat_id: string; author: string; msg_id: string; sent_at: number }>(
      'SELECT text, chat_id, author, msg_id, sent_at FROM search WHERE search MATCH ? ORDER BY sent_at DESC LIMIT ?',
      [match, limit],
    );
    return rows.map((r) => ({ chatId: r.chat_id, author: r.author, id: r.msg_id, text: r.text, sentAt: Number(r.sent_at) }));
  }

  // ---- Media, links and docs (a chat's Info) ----

  /**
   * A chat's photos and videos (`media`), documents and audio files (`docs`),
   * or messages with a web address in them (`links`), newest first. GIFs and
   * stickers aren't counted (as on WhatsApp), nor deleted messages.
   */
  async shared(chatId: string, which: 'media' | 'docs' | 'links', limit = 500): Promise<Message[]> {
    const where = {
      // View once photos and videos are never in Media (nor round videos, like WhatsApp's).
      media: "json_extract(json, '$.file.kind') IN ('image', 'video') AND json_extract(json, '$.file.gif') IS NULL AND json_extract(json, '$.file.once') IS NULL AND json_extract(json, '$.file.round') IS NULL",
      docs: "json_extract(json, '$.file.kind') IN ('doc', 'audio')",
      links: "(json_extract(json, '$.text') LIKE '%http%' OR json_extract(json, '$.text') LIKE '%www.%')",
    }[which];
    const rows = await this.db.all<{ json: string }>(
      `SELECT json FROM messages WHERE chat_id = ? AND json_extract(json, '$.deleted') IS NOT 1 AND ${where} ORDER BY ord DESC, sent_at DESC LIMIT ?`,
      [chatId, limit],
    );
    const list = rows.map((r) => JSON.parse(r.json) as Message);
    return which === 'links' ? list.filter((m) => linksIn(m.text ?? '').length > 0) : list;
  }

  /**
   * The chats I've written to most since `since` (ms), most first, up to
   * `limit`: Forward's "Frequently contacted", like WhatsApp's. Only real
   * messages count (not calls or notes like "You changed the group name").
   */
  async frequentChats(me: string, since: number, limit = 5): Promise<string[]> {
    const rows = await this.db.all<{ chat_id: string }>(
      `SELECT chat_id, COUNT(*) AS n FROM messages WHERE author = ? AND sent_at > ? AND json_extract(json, '$.kind') NOT IN ('system', 'call')
       GROUP BY chat_id ORDER BY n DESC, MAX(sent_at) DESC LIMIT ?`,
      [me, since, limit],
    );
    return rows.map((r) => r.chat_id);
  }

  /**
   * Messages of one kind from every chat, newest first: Search's filters (Photos,
   * Videos, Links, GIFs, Audio, Docs, Polls), like WhatsApp's. Not deleted ones.
   */
  async allOf(which: 'image' | 'video' | 'gif' | 'audio' | 'doc' | 'poll' | 'links', limit = 300): Promise<Message[]> {
    const where = {
      image: "json_extract(json, '$.file.kind') = 'image' AND json_extract(json, '$.file.once') IS NULL",
      video: "json_extract(json, '$.file.kind') = 'video' AND json_extract(json, '$.file.gif') IS NULL AND json_extract(json, '$.file.once') IS NULL",
      gif: "json_extract(json, '$.file.gif') IS NOT NULL",
      audio: "json_extract(json, '$.file.kind') IN ('voice', 'audio') AND json_extract(json, '$.file.once') IS NULL",
      doc: "json_extract(json, '$.file.kind') = 'doc'",
      poll: "json_extract(json, '$.kind') = 'poll'",
      links: "(json_extract(json, '$.text') LIKE '%http%' OR json_extract(json, '$.text') LIKE '%www.%')",
    }[which];
    const rows = await this.db.all<{ json: string }>(
      `SELECT json FROM messages WHERE json_extract(json, '$.deleted') IS NOT 1 AND ${where} ORDER BY sent_at DESC LIMIT ?`,
      [limit],
    );
    const list = rows.map((r) => JSON.parse(r.json) as Message);
    return which === 'links' ? list.filter((m) => linksIn(m.text ?? '').length > 0) : list;
  }

  /**
   * Files kept on this phone, biggest first (Manage storage): from one chat, or
   * from all of them at least `atLeast` bytes big.
   */
  async keptFiles(options: { chatId?: string; atLeast?: number; limit?: number } = {}): Promise<Message[]> {
    const rows = await this.db.all<{ json: string }>(
      `SELECT json FROM messages WHERE json_extract(json, '$.file.local') IS NOT NULL AND json_extract(json, '$.deleted') IS NOT 1
       AND (? IS NULL OR chat_id = ?) AND COALESCE(json_extract(json, '$.file.size'), 0) >= ?
       ORDER BY json_extract(json, '$.file.size') DESC LIMIT ?`,
      [options.chatId ?? null, options.chatId ?? null, options.atLeast ?? 0, options.limit ?? 500],
    );
    return rows.map((r) => JSON.parse(r.json) as Message);
  }

  /** How much each chat's kept files take, biggest first (Manage storage). */
  async keptByChat(): Promise<{ chatId: string; bytes: number; count: number }[]> {
    const rows = await this.db.all<{ chat_id: string; bytes: number; count: number }>(
      `SELECT chat_id, SUM(COALESCE(json_extract(json, '$.file.size'), 0)) AS bytes, COUNT(*) AS count FROM messages
       WHERE json_extract(json, '$.file.local') IS NOT NULL AND json_extract(json, '$.deleted') IS NOT 1
       GROUP BY chat_id ORDER BY bytes DESC`,
    );
    return rows.map((r) => ({ chatId: r.chat_id, bytes: Number(r.bytes), count: Number(r.count) }));
  }

  // ---- Backups ----

  /** Writes a copy of the whole database to `path` (a file that mustn't exist yet), for a backup. */
  async exportTo(path: string) {
    await this.db.run('VACUUM INTO ?', [path]);
    // A backup holds chats, messages and this phone's own notes (names, contacts, prefs),
    // never the sign-in, the outbox or anything else only this phone should have.
    await this.db.run('ATTACH DATABASE ? AS b', [path]);
    try {
      await this.db.exec(`DELETE FROM b.kv WHERE key NOT LIKE 'app:%' OR key = 'app:lastUser'; DELETE FROM b.outbox; DELETE FROM b.seen;`);
      // Squeeze out the deleted rows, so nothing of them is left in the file.
      await this.db.exec('VACUUM b');
    } finally {
      await this.db.exec('DETACH DATABASE b');
    }
  }

  /**
   * Adds a backup's chats and messages to this phone. Chats and messages already
   * here stay as they are (they're newer); this phone's own housekeeping (session, outbox, keys waiting)
   * is never taken from the backup, and files from the old phone aren't here,
   * so their places are forgotten (they download again while the server has them).
   */
  async importFrom(path: string) {
    await this.db.run('ATTACH DATABASE ? AS b', [path]);
    try {
      await this.transaction(async () => {
        // Messages that hadn't gone (waiting, or paused) stay behind: their files aren't in the backup.
        await this.db.exec(`
          INSERT OR IGNORE INTO messages (chat_id, author, id, seq, ord, sent_at, json)
            SELECT chat_id, author, id, seq, ord, sent_at, json_remove(json, '$.file.local') FROM b.messages
            WHERE coalesce(json_extract(json, '$.status'), '') NOT IN ('queued', 'paused');
          INSERT INTO search (text, chat_id, author, msg_id, sent_at)
            SELECT s.text, s.chat_id, s.author, s.msg_id, s.sent_at FROM b.search s
            WHERE NOT EXISTS (SELECT 1 FROM search x WHERE x.chat_id = s.chat_id AND x.author = s.author AND x.msg_id = s.msg_id);
          INSERT OR REPLACE INTO kv (key, json) SELECT key, json FROM b.kv WHERE key LIKE 'app:%' AND key <> 'app:lastUser';
        `);
        // Chats come back as they were: same order, same times (not "just now"
        // from signing in), with anything that came since counted on top.
        const rows = await this.db.all<{ backup: string; here: string | null; newest: number | null }>(`
          SELECT bc.json AS backup, c.json AS here, (SELECT max(m.sent_at) FROM messages m WHERE m.chat_id = bc.id) AS newest
          FROM b.chats bc LEFT JOIN main.chats c ON c.id = bc.id`);
        for (const r of rows) await this.putChat(restoredChat(JSON.parse(r.backup) as Chat, r.here ? (JSON.parse(r.here) as Chat) : null, r.newest));
      });
    } finally {
      await this.db.exec('DETACH DATABASE b');
    }
  }

  /** How many chats this phone has (a new phone with none is offered its backup). */
  async chatCount() {
    return (await this.db.first<{ n: number }>('SELECT count(*) AS n FROM chats'))?.n ?? 0;
  }

  /** Forgets everything (signing in as someone else on this phone). */
  async wipe() {
    await this.db.exec('DELETE FROM chats; DELETE FROM messages; DELETE FROM outbox; DELETE FROM seen; DELETE FROM kv; DELETE FROM search;');
  }
}
