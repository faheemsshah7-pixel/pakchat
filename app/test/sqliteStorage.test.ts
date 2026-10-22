// The phone's SQLite storage, run on a computer with Node's own SQLite.
// It must pass the same checks as every Storage (shared/test/storageContract.ts),
// plus the phone's search.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { storageContract } from '@pakchat/shared/testing';
import { describe, expect, test } from 'vitest';

import { SqliteStorage, type Db, type SqlValue } from '../src/data/sqliteStorage';

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
});
