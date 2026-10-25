// The phone's SQLite storage, run on a computer with Node's own SQLite.
// It must pass the same checks as every Storage (shared/test/storageContract.ts),
// plus the phone's search.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { storageContract } from '@pakchat/shared/testing';
import { describe, expect, test } from 'vitest';

import { linksIn, SqliteStorage, type Db, type SqlValue } from '../src/data/sqliteStorage';

/** Node's SQLite behind the same small interface the app uses for expo-sqlite. */
function nodeDb(file = ':memory:'): Db {
  const d = new DatabaseSync(file);
  return {
    async exec(sql) {
      d.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      d.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return d.prepare(sql).all(...params) as T[];
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (d.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}

storageContract('SQLite (phone)', () => SqliteStorage.open(nodeDb()));

describe('search on the phone', () => {
  const msg = (id: string, text: string, sentAt: number, extra = {}) => ({
    chatId: 'c1',
    id,
    author: 'u1',
    authorDevice: 1,
    seq: sentAt,
    order: sentAt,
    sentAt,
    kind: 'text' as const,
    text,
    ...extra,
  });

  test('finds words and the start of words, newest first, in English and Urdu', async () => {
    const s = await SqliteStorage.open(nodeDb());
    await s.putMessage(msg('a', 'DSA ke notes kisi ke paas hain?', 1));
    await s.putMessage(msg('b', 'Theek hai, notes bana leta hoon', 2));
    await s.putMessage(msg('c', 'نوٹس مجھے بھی بھیج دینا', 3));
    await s.putMessage(msg('d', 'Match dekha?', 4));
    expect((await s.search('note')).map((f) => f.id)).toEqual(['b', 'a']);
    expect((await s.search('notes bana')).map((f) => f.id)).toEqual(['b']);
    expect((await s.search('نوٹ')).map((f) => f.id)).toEqual(['c']);
    expect(await s.search('   ')).toEqual([]);
    // Quotes and stars typed by the user don't break the search.
    expect((await s.search('"match*')).map((f) => f.id)).toEqual(['d']);
  });

  test('edits are found by their new words, deleted messages not at all', async () => {
    const s = await SqliteStorage.open(nodeDb());
    await s.putMessage(msg('a', 'old words', 1));
    await s.putMessage(msg('a', 'new words', 1, { editedAt: 5 }));
    expect(await s.search('old')).toEqual([]);
    expect((await s.search('new')).map((f) => f.id)).toEqual(['a']);
    await s.putMessage(msg('a', 'new words', 1, { deleted: true }));
    expect(await s.search('new')).toEqual([]);
    await s.putMessage(msg('b', 'gone soon', 2));
    await s.deleteMessage('c1', 'u1', 'b');
    expect(await s.search('gone')).toEqual([]);
  });

  test('opening an existing database keeps everything', async () => {
    const db = nodeDb();
    const s = await SqliteStorage.open(db);
    await s.setValue('session', { token: 't' });
    const again = await SqliteStorage.open(db);
    expect(await again.getValue('session')).toEqual({ token: 't' });
  });
});

describe('backups', () => {
  const msg = (chatId: string, id: string, text: string, extra = {}) => ({
    chatId,
    id,
    author: 'u1',
    authorDevice: 1,
    seq: 1,
    order: 1,
    sentAt: 1,
    kind: 'text' as const,
    text,
    ...extra,
  });

  test("a new phone takes the old phone's chats, but not its housekeeping", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pakchat-'));
    const old = await SqliteStorage.open(nodeDb());
    await old.putChat({ id: 'c1', kind: 'direct', members: [], readUpTo: 0, lastActivity: 5, unread: 0 });
    await old.putMessage(msg('c1', 'a', 'Purani baat'));
    await old.putMessage(
      msg('c1', 'f', 'Photo', { kind: 'file', file: { id: 'x', key: 'k', digest: 'd', size: 3, mime: 'image/jpeg', kind: 'image', local: 'file:///old/x.jpg' } }),
    );
    await old.putMessage(msg('c1', 'q', 'Not sent yet', { status: 'queued' }));
    await old.setValue('session', { token: 'old' });
    await old.putOutbox({ id: 'o1', kind: 'message', chatId: 'c1', content: 'x', added: 1, tries: 0, notBefore: 0 } as never);
    await old.setValue('app:contacts', { u2: 'Sara' });
    await old.exportTo(join(dir, 'backup.db'));
    // The sign-in never goes into a backup, not even in the file's free space.
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'backup.db')).toString('latin1')).not.toContain('"token"');
    expect(readFileSync(join(dir, 'backup.db')).toString('latin1')).toContain('Purani baat');

    const fresh = await SqliteStorage.open(nodeDb());
    await fresh.setValue('session', { token: 'new' });
    await fresh.putMessage(msg('c1', 'a', 'Already here'));
    expect(await fresh.chatCount()).toBe(0);
    await fresh.importFrom(join(dir, 'backup.db'));
    expect(await fresh.chatCount()).toBe(1);
    expect(await fresh.getValue('session')).toEqual({ token: 'new' });
    expect(await fresh.getValue('app:contacts')).toEqual({ u2: 'Sara' });
    expect((await fresh.getMessage('c1', 'u1', 'a'))!.text).toBe('Already here');
    const photo = await fresh.getMessage('c1', 'u1', 'f');
    expect(photo!.file!.id).toBe('x');
    expect(photo!.file!.local).toBeUndefined();
    expect(await fresh.getMessage('c1', 'u1', 'q')).toBeFalsy();
    // Search follows what this phone keeps: its own words for a, the backup's for the photo.
    expect(await fresh.search('purani')).toEqual([]);
    expect((await fresh.search('photo')).map((f) => f.id)).toEqual(['f']);
  });
  test('restored chats keep their times and order, with what came since counted on top', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pakchat-'));
    const old = await SqliteStorage.open(nodeDb());
    const chat = (id: string, lastActivity: number, extra = {}) => ({ id, kind: 'direct' as const, members: [], readUpTo: 3, unread: 2, lastActivity, ...extra });
    await old.putChat(chat('older', 1_000, { timer: 86_400 }));
    await old.putChat(chat('newer', 2_000));
    await old.putChat(chat('quiet', 1_500));
    await old.putMessage(msg('older', 'a', 'Hi', { sentAt: 1_000 }));
    await old.putMessage(msg('newer', 'b', 'Hello', { sentAt: 2_000 }));
    await old.putMessage(msg('newer', 'p', 'Paused photo', { seq: null, status: 'paused', sentAt: 2_100 }));
    await old.exportTo(join(dir, 'backup.db'));

    // Signing in on the new phone saved the chats "just now", and one message came meanwhile.
    const fresh = await SqliteStorage.open(nodeDb());
    const now = 9_000_000;
    await fresh.putChat(chat('older', now, { readUpTo: 0, unread: 1, title: 'From server' }));
    await fresh.putChat(chat('newer', now, { readUpTo: 0, unread: 0 }));
    await fresh.putChat(chat('quiet', now, { readUpTo: 0, unread: 0 }));
    await fresh.putChat(chat('brandNew', now, { readUpTo: 0, unread: 0 }));
    await fresh.putMessage(msg('older', 'c', 'Since', { seq: 4, order: 4, sentAt: 5_000 }));
    await fresh.importFrom(join(dir, 'backup.db'));

    const list = await fresh.listChats();
    expect(list.map((c) => c.id)).toEqual(['brandNew', 'older', 'newer', 'quiet']);
    const older = list.find((c) => c.id === 'older')!;
    expect(older.lastActivity).toBe(5_000);
    expect(older.unread).toBe(3);
    expect(older.readUpTo).toBe(3);
    expect(older.timer).toBe(86_400);
    expect(older.title).toBe('From server');
    expect(list.find((c) => c.id === 'newer')!.lastActivity).toBe(2_000);
    expect(list.find((c) => c.id === 'quiet')!.lastActivity).toBe(1_500);
    // A file that never went isn't brought back (its file isn't in the backup).
    expect(await fresh.getMessage('newer', 'u1', 'p')).toBeNull();
  });
});

describe('media, links and docs', () => {
  const file = (kind: string, extra = {}) => ({ id: 'f', key: 'k', digest: 'd', size: 1, mime: 'x/y', kind, ...extra });
  const msg = (id: string, ord: number, extra: Record<string, unknown>) => ({
    chatId: 'c1',
    id,
    author: 'u1',
    authorDevice: 1,
    seq: ord,
    order: ord,
    sentAt: ord,
    kind: 'text' as const,
    status: 'sent' as const,
    ...extra,
  });

  test('photos and videos, documents, and links, newest first', async () => {
    const s = await SqliteStorage.open(nodeDb());
    await s.putMessage(msg('p1', 1, { kind: 'file', file: file('image') }) as never);
    await s.putMessage(msg('v1', 2, { kind: 'file', file: file('video') }) as never);
    await s.putMessage(msg('g1', 3, { kind: 'file', file: file('video', { gif: true }) }) as never);
    await s.putMessage(msg('s1', 4, { kind: 'file', file: file('sticker') }) as never);
    await s.putMessage(msg('d1', 5, { kind: 'file', file: file('doc', { name: 'notes.pdf' }) }) as never);
    await s.putMessage(msg('l1', 6, { text: 'Look: www.dawn.com/news' }));
    await s.putMessage(msg('t1', 7, { text: 'no link, just http talk' }));
    await s.putMessage(msg('p2', 8, { kind: 'file', file: file('image'), deleted: true }) as never);
    expect((await s.shared('c1', 'media')).map((m) => m.id)).toEqual(['v1', 'p1']);
    expect((await s.shared('c1', 'docs')).map((m) => m.id)).toEqual(['d1']);
    expect((await s.shared('c1', 'links')).map((m) => m.id)).toEqual(['l1']);
  });

  test('every chat\'s photos, GIFs, polls and links, and the files kept, biggest first', async () => {
    const s = await SqliteStorage.open(nodeDb());
    await s.putMessage(msg('p1', 1, { kind: 'file', file: file('image', { local: 'file:///p1', size: 300 }) }) as never);
    await s.putMessage({ ...msg('p2', 2, { kind: 'file', file: file('image', { size: 900, local: 'file:///p2' }) }), chatId: 'c2' } as never);
    await s.putMessage(msg('g1', 3, { kind: 'file', file: file('video', { gif: true }) }) as never);
    await s.putMessage(msg('v1', 4, { kind: 'file', file: file('video', { size: 50, local: 'file:///v1' }) }) as never);
    await s.putMessage(msg('o1', 5, { kind: 'poll', poll: { question: 'Tea?', options: ['Yes', 'No'] } }) as never);
    await s.putMessage(msg('l1', 6, { text: 'see https://dawn.com' }));
    expect((await s.allOf('image')).map((m) => m.id)).toEqual(['p2', 'p1']);
    expect((await s.allOf('video')).map((m) => m.id)).toEqual(['v1']);
    expect((await s.allOf('gif')).map((m) => m.id)).toEqual(['g1']);
    expect((await s.allOf('poll')).map((m) => m.id)).toEqual(['o1']);
    expect((await s.allOf('links')).map((m) => m.id)).toEqual(['l1']);
    expect((await s.keptFiles()).map((m) => m.id)).toEqual(['p2', 'p1', 'v1']);
    expect((await s.keptFiles({ chatId: 'c1' })).map((m) => m.id)).toEqual(['p1', 'v1']);
    expect((await s.keptFiles({ atLeast: 100 })).map((m) => m.id)).toEqual(['p2', 'p1']);
    expect(await s.keptByChat()).toEqual([
      { chatId: 'c2', bytes: 900, count: 1 },
      { chatId: 'c1', bytes: 350, count: 2 },
    ]);
  });

  test('finding web addresses in words', () => {
    expect(linksIn('see https://pak.chat/a?b=1, and www.x.pk.')).toEqual(['https://pak.chat/a?b=1', 'https://www.x.pk']);
    expect(linksIn('nothing here')).toEqual([]);
  });
});
