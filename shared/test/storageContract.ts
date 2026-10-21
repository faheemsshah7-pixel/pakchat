// The checks every Storage must pass. The phone's SQLite storage (phase 4) and
// the website's IndexedDB storage (phase 8) run these too:
//
//   import { storageContract } from '@pakchat/shared/testing';
//   storageContract('SQLite', () => openTestDatabase());

import { describe, expect, test } from 'vitest';

import type { Chat, Message, OutboxItem, Storage } from '../src/storage';

const chat = (id: string, lastActivity: number): Chat => ({ id, kind: 'direct', members: [{ userId: 'u1', role: 'member' }], readUpTo: 0, unread: 0, lastActivity });

const msg = (id: string, order: number, extra: Partial<Message> = {}): Message => ({
  chatId: 'c1',
  id,
  author: 'u1',
  authorDevice: 1,
  seq: order < 1e15 ? order : null,
  order,
  sentAt: 1000 + order,
  kind: 'text',
  text: `text ${id}`,
  ...extra,
});

const item = (id: string, added: number): OutboxItem => ({ id, chatId: 'c1', kind: 'message', content: '{}', tries: 0, notBefore: 0, added });

export function storageContract(name: string, make: () => Storage | Promise<Storage>) {
  describe(`Storage: ${name}`, () => {
    test('chats: save, read back, newest first', async () => {
      const s = await make();
      expect(await s.getChat('a')).toBeNull();
      await s.putChat(chat('a', 1));
      await s.putChat(chat('b', 3));
      await s.putChat({ ...chat('a', 2), title: 'changed' });
      expect((await s.getChat('a'))!.title).toBe('changed');
      expect((await s.listChats()).map((c) => c.id)).toEqual(['b', 'a']);
    });

    test('messages: by id, by number, in order, in pages', async () => {
      const s = await make();
      for (let i = 1; i <= 10; i++) await s.putMessage(msg(`m${i}`, i));
      await s.putMessage(msg('queued', 1e15 + 5));
      await s.putMessage({ ...msg('other', 3), chatId: 'c2' });
      expect((await s.getMessage('c1', 'u1', 'm3'))!.text).toBe('text m3');
      expect(await s.getMessage('c1', 'u2', 'm3')).toBeNull();
      expect((await s.getMessageBySeq('c1', 4))!.id).toBe('m4');
      expect(await s.getMessageBySeq('c1', 99)).toBeNull();
      expect((await s.listMessages('c1', { limit: 3 })).map((m) => m.id)).toEqual(['m9', 'm10', 'queued']);
      expect((await s.listMessages('c1', { beforeOrder: 4, limit: 2 })).map((m) => m.id)).toEqual(['m2', 'm3']);
      await s.putMessage({ ...msg('m3', 3), text: 'edited', reactions: { u2: '👍' } });
      expect(await s.getMessage('c1', 'u1', 'm3')).toMatchObject({ text: 'edited', reactions: { u2: '👍' } });
      await s.deleteMessage('c1', 'u1', 'm3');
      expect(await s.getMessage('c1', 'u1', 'm3')).toBeNull();
    });

    test('the outbox: oldest first, removed when sent', async () => {
      const s = await make();
      await s.putOutbox(item('b', 2));
      await s.putOutbox(item('a', 1));
      await s.putOutbox({ ...item('b', 2), tries: 3 });
      expect((await s.listOutbox()).map((i) => `${i.id}${i.tries}`)).toEqual(['a0', 'b3']);
      await s.deleteOutbox('a');
      expect((await s.listOutbox()).map((i) => i.id)).toEqual(['b']);
    });

    test('envelopes already seen', async () => {
      const s = await make();
      expect(await s.hasSeen(7)).toBe(false);
      await s.markSeen(7);
      await s.markSeen(7);
      expect(await s.hasSeen(7)).toBe(true);
    });

    test('small values', async () => {
      const s = await make();
      expect(await s.getValue('x')).toBeUndefined();
      await s.setValue('x', { list: [1, 2], ok: true });
      expect(await s.getValue('x')).toEqual({ list: [1, 2], ok: true });
      await s.deleteValue('x');
      expect(await s.getValue('x')).toBeUndefined();
    });

    test('what you get back is a copy', async () => {
      const s = await make();
      await s.putMessage(msg('m1', 1));
      const m = (await s.getMessage('c1', 'u1', 'm1'))!;
      m.text = 'changed but not saved';
      expect((await s.getMessage('c1', 'u1', 'm1'))!.text).toBe('text m1');
    });

    test('a transaction saves all or nothing', async () => {
      const s = await make();
      await s.transaction(async () => {
        await s.putMessage(msg('m1', 1));
        await s.setValue('k', 1);
      });
      await expect(
        s.transaction(async () => {
          await s.putMessage(msg('m2', 2));
          await s.setValue('k', 2);
          await s.markSeen(9);
          throw new Error('power cut');
        }),
      ).rejects.toThrow('power cut');
      expect(await s.getMessage('c1', 'u1', 'm1')).not.toBeNull();
      expect(await s.getMessage('c1', 'u1', 'm2')).toBeNull();
      expect(await s.getValue('k')).toBe(1);
      expect(await s.hasSeen(9)).toBe(false);
    });
  });
}
