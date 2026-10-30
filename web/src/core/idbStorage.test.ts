// The website's storage passes the same checks as the phone's.
import 'fake-indexeddb/auto';

import { storageContract } from '@pakchat/shared/testing';
import { describe, expect, test } from 'vitest';

import { IdbStorage, openIdb } from './idbStorage';

let n = 0;
const fresh = async () => new IdbStorage(await openIdb(`test-${n++}`));

storageContract('IndexedDB', fresh);

describe('IndexedDB extras', () => {
  test('a failed transaction leaves nothing behind, and reads inside see their own changes', async () => {
    const s = await fresh();
    const chat = { id: 'c1', kind: 'direct' as const, members: [], readUpTo: 0, unread: 0, lastActivity: 1 };
    await expect(
      s.transaction(async () => {
        await s.putChat(chat);
        expect(await s.getChat('c1')).toEqual(chat);
        expect(await s.listChats()).toHaveLength(1);
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await s.getChat('c1')).toBeNull();
    await s.transaction(async () => {
      await s.putChat(chat);
      await s.setValue('a', { b: 1 });
    });
    expect(await s.getChat('c1')).toEqual(chat);
    expect(await s.getValue('a')).toEqual({ b: 1 });
    await s.clear();
    expect(await s.listChats()).toEqual([]);
  });

  test('newestOfEach finds the newest message of every chat in one walk', async () => {
    const s = await fresh();
    const msg = (chatId: string, id: string, order: number) => ({ chatId, id, author: 'u', authorDevice: 1, seq: order, order, sentAt: order, kind: 'text' as const, text: id });
    for (const [c, id, o] of [['a', 'a1', 1], ['a', 'a2', 5], ['b', 'b1', 3], ['c', 'c1', 2], ['c', 'c2', 9], ['c', 'c3', 4]] as const) await s.putMessage(msg(c, id, o));
    const newest = await s.newestOfEach();
    expect(Object.fromEntries([...newest].map(([k, m]) => [k, m.id]))).toEqual({ a: 'a2', b: 'b1', c: 'c2' });
  });

  test('searchText finds words in any chat, newest first, skipping deleted ones', async () => {
    const s = await fresh();
    const msg = (chatId: string, id: string, at: number, text: string, deleted = false) => ({ chatId, id, author: 'u', authorDevice: 1, seq: at, order: at, sentAt: at, kind: 'text' as const, text, ...(deleted ? { deleted: true } : {}) });
    await s.putMessage(msg('a', 'a1', 1, 'Kal *University* aa rahi ho?'));
    await s.putMessage(msg('b', 'b1', 5, 'university ka kaam'));
    await s.putMessage(msg('b', 'b2', 7, 'university gone', true));
    await s.putMessage(msg('c', 'c1', 3, 'kuch aur'));
    expect((await s.searchText('  UNIVERSITY ')).map((m) => m.id)).toEqual(['b1', 'a1']);
    expect(await s.searchText('')).toEqual([]);
  });

  test('pinnedMessages finds only the chat\'s messages pinned now, newest first, through unsaved changes', async () => {
    const s = await fresh();
    const now = Date.now();
    const msg = (chatId: string, id: string, sentAt: number, pinnedUntil?: number) => ({ chatId, id, author: 'u', authorDevice: 1, seq: sentAt, order: sentAt, sentAt, kind: 'text' as const, text: id, ...(pinnedUntil ? { pinnedUntil } : {}) });
    await s.putMessage(msg('a', 'a1', 1, now + 60_000));
    await s.putMessage(msg('a', 'a2', 2));
    await s.putMessage(msg('a', 'a3', 3, now - 1));
    await s.putMessage(msg('a', 'a4', 4, now + 60_000));
    await s.putMessage(msg('b', 'b1', 5, now + 60_000));
    expect((await s.pinnedMessages('a')).map((m) => m.id)).toEqual(['a4', 'a1']);
    await s.transaction(async () => {
      await s.putMessage(msg('a', 'a1', 1));
      await s.putMessage(msg('a', 'a2', 2, now + 60_000));
      expect((await s.pinnedMessages('a')).map((m) => m.id)).toEqual(['a4', 'a2']);
    });
  });

  test('searchText reads in pages and keeps the newest', async () => {
    const s = await fresh();
    await s.transaction(async () => {
      for (let i = 0; i < 4_500; i++) await s.putMessage({ chatId: 'a', id: `m${i}`, author: 'u', authorDevice: 1, seq: i, order: i, sentAt: i, kind: 'text', text: i % 2 ? 'hello there' : 'bye' });
    });
    const found = await s.searchText('HELLO', 3);
    expect(found.map((m) => m.id)).toEqual(['m4499', 'm4497', 'm4495']);
  });
});
