// Phase 8 in the core: linking a website by QR code, locking files in the
// browser, and the phone copying its chat history to the website.

import { afterEach, describe, expect, test } from 'vitest';

import { fromBytes, toBytes } from '../src/bytes';
import { parseContent } from '../src/content';
import { exportHistory, parseHistory } from '../src/history';
import { browserName, identityCheck, identityMatches, lockProvision, newLinkKeys, openProvision, parseQr, qrText } from '../src/link';
import { FileChanged, lockedSize, lockFile, unlockFile } from '../src/web/fileLock';
import { World } from './people';

let w: World;
afterEach(() => w?.stop());

const identity = fromBytes(new Uint8Array(33).fill(5));
const provision = { v: 1 as const, userId: 'u1', identityKey: identity, phoneName: 'Pixel 7' };

describe('the QR code', () => {
  test('carries the code, the one-off key and a check of the identity key', async () => {
    const keys = await newLinkKeys();
    const text = qrText('abcdefghijklmnopqrstuv', keys.publicKey, await identityCheck(identity));
    expect(text.startsWith('PAKCHAT1,abcdefghijklmnopqrstuv,')).toBe(true);
    expect(text.length).toBeLessThan(120);
    const qr = parseQr(text)!;
    expect(qr.code).toBe('abcdefghijklmnopqrstuv');
    expect(qr.publicKey).toEqual(keys.publicKey);
    expect(await identityMatches(identity, qr.identityCheck)).toBe(true);
    // Keys the server swapped in don't match.
    expect(await identityMatches(fromBytes(new Uint8Array(33).fill(6)), qr.identityCheck)).toBe(false);
  });

  test('anything else is not a linking QR', () => {
    for (const text of ['', 'https://pakchat.app', 'PAKCHAT1,a,b,c', 'PAKCHAT2,abcdefghijklmnopqrstuv,AAAA,AAAA', 'PAKCHAT1,abcdefghijklmnopqrstuv,!!!!,AAAA']) {
      expect(parseQr(text)).toBeNull();
    }
  });

  test('the provision opens only on the website it was locked for', async () => {
    const site = await newLinkKeys();
    const other = await newLinkKeys();
    const locked = await lockProvision(provision, site.publicKey);
    expect(await openProvision(locked, site)).toEqual(provision);
    await expect(openProvision(locked, other)).rejects.toThrow('Not a provision');
    // One changed byte and it won't open.
    const bytes = toBytes(locked);
    bytes[bytes.length - 1] ^= 1;
    await expect(openProvision(fromBytes(bytes), site)).rejects.toThrow('Not a provision');
    // The server never sees anything readable.
    expect(atob(locked)).not.toContain('Pixel');
  });

  test('browser names', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    expect(browserName(mac)).toBe('Chrome on Mac');
    expect(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('Edge on Windows');
    expect(browserName('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox on Linux');
    expect(browserName('curl/8')).toBe('Browser');
  });
});

describe('files in the browser', () => {
  test('lock and unlock, in the phone format', async () => {
    const plain = new TextEncoder().encode('a photo, pretend'.repeat(100));
    const { locked, key, digest } = await lockFile(plain);
    expect(locked.length).toBe(lockedSize(plain.length));
    expect(toBytes(key).length).toBe(64);
    expect(await unlockFile(locked, key, digest)).toEqual(plain);
    const changed = locked.slice();
    changed[20] ^= 1;
    await expect(unlockFile(changed, key, digest)).rejects.toBeInstanceOf(FileChanged);
    const other = await lockFile(plain);
    await expect(unlockFile(locked, key, other.digest)).rejects.toBeInstanceOf(FileChanged);
  });
});

describe('history sync', () => {
  test('a history part is a control message only', () => {
    const wrap = (x: Record<string, unknown>) => JSON.stringify({ v: 1, id: 'm1', chat: 'c1', at: 1, ...x });
    const file = { id: 'f1', key: 'k', digest: 'd', size: 10 };
    expect(parseContent(wrap({ t: 'history', part: 1, last: false, file }))).toMatchObject({ t: 'history', part: 1, file });
    expect(parseContent(wrap({ t: 'history', part: 0, last: false, file }))).toBeNull();
    expect(parseContent(wrap({ t: 'history', part: 1, last: 'yes', file }))).toBeNull();
    expect(parseContent(wrap({ t: 'history', part: 1, last: true, file: { ...file, size: -1 } }))).toBeNull();
  });

  test('the phone copies its chats to a new website, which then works with the phone off', async () => {
    w = new World();
    const ali = await w.person('Ali', 'node');
    const sara = await w.person('Sara', 'node');
    const chat = await ali.client.openDirect(sara.id);
    for (let i = 1; i <= 40; i++) await (i % 2 ? ali : sara).client.sendText(chat.id, `Message ${i}`);
    await w.settle();
    await ali.storage.setValue('app:people', { [sara.id]: { name: 'Sara' } });

    // Ali scans the website's QR. It gets nothing from before.
    const web = await w.website(ali, 'wasm');
    expect(await w.texts(web, chat.id)).toEqual([]);

    // The phone makes the parts, locks each, "uploads" it, and tells the website.
    const uploads = new Map<string, Uint8Array>();
    const got: { part: number; last: boolean; file: { id: string; key: string; digest: string } }[] = [];
    web.client.on('history', (e) => got.push(e));

    const self = await ali.client.openDirect(ali.id);
    const bundles = await exportHistory(ali.storage, { recent: 10, valueKeys: ['app:people'] });
    expect(bundles.map((b) => b.messages.length)).toEqual([10, 30]);
    for (const b of bundles) {
      const { locked, key, digest } = await lockFile(new TextEncoder().encode(JSON.stringify(b)));
      const id = `file-${b.part}`;
      uploads.set(id, locked);
      await ali.client.sendHistory(self.id, web.deviceId, { part: b.part, last: b.part === bundles.length, file: { id, key, digest, size: locked.length } });
    }
    await w.settle();
    expect(got.map((g) => [g.part, g.last])).toEqual([
      [1, false],
      [2, true],
    ]);
    // Sara's phone never saw them (they went to the website alone).
    expect(await w.texts(sara, self.id).catch(() => [])).toEqual([]);

    // The website downloads, unlocks and adds each part.
    for (const g of got) {
      const plain = await unlockFile(uploads.get(g.file.id)!, g.file.key, g.file.digest);
      const bundle = parseHistory(new TextDecoder().decode(plain))!;
      await web.client.importHistory(bundle);
    }
    // The same chat, in the same order, as on the phone.
    const texts = await w.texts(web, chat.id);
    expect(texts).toHaveLength(40);
    expect(texts).toEqual(await w.texts(ali, chat.id));
    expect(await web.storage.getValue('app:people')).toEqual({ [sara.id]: { name: 'Sara' } });

    // The phone goes off. The website still sends and receives.
    ali.client.stop();
    await sara.client.sendText(chat.id, 'Is your phone off?');
    await w.settle();
    expect((await w.texts(web, chat.id)).at(-1)).toBe('Sara: Is your phone off?');
    await web.client.sendText(chat.id, 'Yes, from my laptop');
    await w.settle();
    expect((await w.texts(sara, chat.id)).at(-1)).toBe('Ali: Yes, from my laptop');
    // And the phone catches up when it's back.
    ali.client.start();
    await w.settle();
    expect((await w.texts(ali, chat.id)).slice(-2)).toEqual(['Sara: Is your phone off?', 'Ali: Yes, from my laptop']);
  });

  test('a history part from anyone but my own phone is ignored', async () => {
    w = new World();
    const ali = await w.person('Ali', 'node');
    const sara = await w.person('Sara', 'node');
    const web = await w.website(ali, 'wasm');
    const got: unknown[] = [];
    web.client.on('history', (e) => got.push(e));
    // Sara tries, in her chat with Ali.
    const chat = await sara.client.openDirect(ali.id);
    await w.settle();
    await sara.client.sendHistory(chat.id, web.deviceId, { part: 1, last: true, file: { id: 'x', key: 'k', digest: 'd', size: 1 } }).catch(() => {});
    await w.settle();
    expect(got).toEqual([]);
  });

  test("statuses, view once, unsent messages and the phone's file paths stay on the phone", async () => {
    w = new World();
    const ali = await w.person('Ali', 'node');
    const chat = await ali.client.openDirect(ali.id);
    await ali.client.sendText(chat.id, 'Note to self');
    await w.settle();
    const base = (await ali.storage.listMessages(chat.id))[0];
    await ali.storage.putMessage({ ...base, id: 'once', order: base.order + 1, kind: 'file', file: { id: 'f', key: 'k', digest: 'd', size: 1, mime: 'image/jpeg', kind: 'image', once: true } });
    await ali.storage.putMessage({ ...base, id: 'photo', order: base.order + 2, kind: 'file', file: { id: 'f', key: 'k', digest: 'd', size: 1, mime: 'image/jpeg', kind: 'image', local: 'file:///data/photo.jpg' } });
    await ali.storage.putMessage({ ...base, id: 'queued', seq: null, order: 1e15 });
    const [part] = await exportHistory(ali.storage);
    expect(part.messages.map((m) => m.id)).toEqual([base.id, 'photo']);
    expect(part.messages[1].file).not.toHaveProperty('local');
    expect(part.chats.every((c) => c.kind !== 'status')).toBe(true);
  });
});
