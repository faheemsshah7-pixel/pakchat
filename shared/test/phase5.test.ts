// Phase 5 in the core: signing in by phone, sending files (uploaded by the
// outbox, also when sent offline), and tidying numbers for contacts.

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';

import { PakChat } from '../src/client';
import { hashContacts, normalizePhone } from '../src/contacts';
import { parseContent } from '../src/content';
import { OfflineError } from '../src/server';
import { MemoryStorage } from '../src/storage';
import { FAKE_CODE } from './fakeServer';
import { World } from './people';
import { make } from './signals';

let w: World;
afterEach(() => w?.stop());

/** A pretend uploader: remembers what was "uploaded", and can pretend the network is down. */
function uploader() {
  const uploads: { chatId: string; local: string }[] = [];
  let down = 0;
  return {
    uploads,
    failNext: (n: number) => (down = n),
    files: {
      async upload(chatId: string, local: string) {
        if (down > 0) {
          down--;
          throw new OfflineError('no network');
        }
        uploads.push({ chatId, local });
        return { id: `file-${uploads.length}`, key: 'k'.repeat(88), digest: 'd'.repeat(44) };
      },
    },
  };
}

describe('phone numbers', () => {
  test('are tidied the same way as on the server', () => {
    for (const typed of ['0300 1234567', '0300-1234567', '+92 300 1234567', '0092 300 1234567', '923001234567', '300 1234567', '3001234567']) {
      expect(normalizePhone(typed)).toBe('+923001234567');
    }
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('12')).toBeNull();
  });

  test('contacts are hashed, never sent as they are', async () => {
    const sha = async (t: string) => createHash('sha256').update(t).digest('base64');
    const { phones, emails } = await hashContacts(
      [
        { name: 'Ammi', phones: ['0300 1234567'], emails: [] },
        { name: 'Sara', phones: [], emails: [' Sara@Gmail.com '] },
      ],
      sha,
    );
    expect([...phones.keys()]).toEqual([await sha('+923001234567')]);
    expect([...emails.keys()]).toEqual([await sha('sara@gmail.com')]);
    expect(phones.get(await sha('+923001234567'))).toBe(0);
  });
});

describe('signing in by phone', () => {
  test('makes the account once, then finds it again', async () => {
    w = new World();
    const make1 = () => new PakChat({ signal: make.node(), storage: new MemoryStorage(), server: w.server.api(), connect: w.server.connect });
    const first = await make1().signInWithPhone('+923001112233', FAKE_CODE);
    expect(first.newAccount).toBe(true);
    expect(first.me.phone).toBe('+923001112233');
    expect(first.me.email).toBeNull();
    const again = await make1().signInWithPhone('+923001112233', FAKE_CODE);
    expect(again.newAccount).toBeUndefined();
    expect(again.userId).toBe(first.userId);
    await expect(make1().signInWithPhone('+923001112233', '000000')).rejects.toThrow(/wrong_code/);
  });
});

describe('files', () => {
  async function two() {
    w = new World();
    const up = uploader();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    // Give Ali's phone an uploader (the app's comes from native code).
    (ali.client as unknown as { o: { files: unknown } }).o.files = up.files;
    const chat = await ali.client.openDirect(sara.id);
    return { up, ali, sara, chat };
  }

  const photo = { local: 'file:///photo.jpg', mime: 'image/jpeg', kind: 'image' as const, size: 2048, width: 640, height: 480, thumb: 'AAAA' };

  test('a photo is uploaded, then arrives with its key, caption and size', async () => {
    const { up, ali, sara, chat } = await two();
    const sent = await ali.client.sendFile(chat.id, photo, { caption: 'Look!' });
    expect(sent.kind).toBe('file');
    expect(sent.file?.local).toBe('file:///photo.jpg');
    await w.settle();
    expect(up.uploads).toEqual([{ chatId: chat.id, local: 'file:///photo.jpg' }]);

    const mine = await ali.storage.getMessage(chat.id, ali.id, sent.id);
    expect(mine?.file?.id).toBe('file-1');
    expect(mine?.file?.local).toBe('file:///photo.jpg');
    expect(mine?.status).not.toBe('queued');

    const [got] = await sara.client.messages(chat.id);
    expect(got.kind).toBe('file');
    expect(got.text).toBe('Look!');
    expect(got.file).toMatchObject({ id: 'file-1', key: 'k'.repeat(88), size: 2048, width: 640, kind: 'image', thumb: 'AAAA' });
    // Where it is on Ali's phone is Ali's business.
    expect(got.file?.local).toBeUndefined();
  });

  test('sent while the upload fails: it waits, then goes once', async () => {
    const { up, ali, sara, chat } = await two();
    up.failNext(2);
    await ali.client.sendFile(chat.id, photo);
    for (let i = 0; i < 40 && up.uploads.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 200));
      await w.settle();
    }
    await w.settle();
    expect(up.uploads).toHaveLength(1);
    expect(await sara.client.messages(chat.id)).toHaveLength(1);
  }, 20_000);

  test('a file message that was never uploaded is ignored', () => {
    const c = parseContent(JSON.stringify({ v: 1, id: 'x', chat: 'c', at: 1, t: 'file', file: { id: 'pending', key: '', digest: '', size: 1, mime: 'a/b', kind: 'doc' } }));
    // It parses (the sender's own copy looks like this), but the receiving side drops it (see client.ts).
    expect(c?.t).toBe('file');
    expect(parseContent(JSON.stringify({ v: 1, id: 'x', chat: 'c', at: 1, t: 'file', file: { id: 'f', key: 'k', digest: 'd', size: 1, mime: 'a/b', kind: 'weird' } }))).toBeNull();
  });

  test('downloaded somewhere: only this phone notes it', async () => {
    const { ali, sara, chat } = await two();
    const sent = await ali.client.sendFile(chat.id, photo);
    await w.settle();
    const m = await sara.client.changeHere(chat.id, { author: ali.id, id: sent.id }, (x) => {
      x.file!.local = 'file:///downloads/1.jpg';
    });
    expect(m?.file?.local).toBe('file:///downloads/1.jpg');
    expect((await sara.client.messages(chat.id))[0].file?.local).toBe('file:///downloads/1.jpg');
  });
});
