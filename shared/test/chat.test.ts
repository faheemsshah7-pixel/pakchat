// One-to-one chats, several devices, being offline, and ticks.
// Every test runs three ways: everyone on Node's Signal library, everyone on
// the website's WebAssembly build, and phones and websites mixed.

import { afterEach, describe, expect, test } from 'vitest';

import { World } from './people';
import type { Kind } from './signals';

const WAYS: [string, Kind, Kind][] = [
  ['node', 'node', 'node'],
  ['wasm', 'wasm', 'wasm'],
  ['mixed', 'node', 'wasm'],
];

describe.each(WAYS)('chats (%s)', (_label, phone, web) => {
  let w: World;
  afterEach(() => w.stop());

  async function two() {
    w = new World();
    const ali = await w.person('Ali', phone);
    const sara = await w.person('Sara', web);
    const chat = await ali.client.openDirect(sara.id);
    return { ali, sara, chat };
  }

  test('Ali and Sara chat, and the ticks go sent, delivered, read', async () => {
    const { ali, sara, chat } = await two();
    const sent = await ali.client.sendText(chat.id, 'Assalam o Alaikum, Sara!');
    expect(sent.status).toBe('queued');
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali: Assalam o Alaikum, Sara!']);
    expect((await sara.storage.getChat(chat.id))!.unread).toBe(1);
    expect((await ali.storage.getMessage(chat.id, ali.id, sent.id))!.status).toBe('delivered');

    await sara.client.markRead(chat.id);
    await w.settle();
    expect((await sara.storage.getChat(chat.id))!.unread).toBe(0);
    expect((await ali.storage.getMessage(chat.id, ali.id, sent.id))!.status).toBe('read');

    await sara.client.sendText(chat.id, 'Walaikum Assalam! 🌙');
    await w.settle();
    expect(await w.texts(ali, chat.id)).toEqual(['Ali: Assalam o Alaikum, Sara!', 'Sara: Walaikum Assalam! 🌙']);
    expect(await w.texts(sara, chat.id)).toEqual(await w.texts(ali, chat.id));
  });

  test("the server never sees the words, and both see the same safety number", async () => {
    const { ali, sara, chat } = await two();
    const words = ['Meet at the library at 4', 'My password is not this'];
    for (const t of words) await ali.client.sendText(chat.id, t);
    await w.settle();
    expect(w.server.seen.length).toBeGreaterThan(0);
    for (const e of w.server.seen) {
      const raw = Buffer.from(e.body!, 'base64').toString('latin1');
      for (const t of words) expect(raw).not.toContain(t);
    }
    const a = await ali.client.safetyNumber(sara.id);
    expect(a).toMatch(/^\d{60}$/);
    expect(await sara.client.safetyNumber(ali.id)).toBe(a);
  });

  test("a website linked later gets messages, and my own website sees what I sent", async () => {
    const { ali, sara, chat } = await two();
    await ali.client.sendText(chat.id, 'Before the website');
    await w.settle();
    // Ali's phone still thinks Sara has one device: the server says "stale", and it learns.
    const saraWeb = await w.website(sara, web);
    const aliWeb = await w.website(ali, web);
    await ali.client.sendText(chat.id, 'After the website');
    await w.settle();
    expect(await w.texts(saraWeb, chat.id)).toEqual(['Ali: After the website']);
    expect(await w.texts(aliWeb, chat.id)).toEqual(['Ali: After the website']);
    // A reply from Sara's website reaches Ali's phone and website, and Sara's phone.
    await saraWeb.client.sendText(chat.id, 'From my laptop');
    await w.settle();
    for (const p of [ali, aliWeb, sara]) expect((await w.texts(p, chat.id)).at(-1)).toBe('Sara: From my laptop');
    // Reading on the website clears unread on the phone too. (Her own message doesn't count.)
    expect((await sara.storage.getChat(chat.id))!.unread).toBe(2);
    await saraWeb.client.markRead(chat.id);
    await w.settle();
    expect((await sara.storage.getChat(chat.id))!.unread).toBe(0);
  });

  test('Sara goes offline, catches up when she comes back, and the server forgets', async () => {
    const { ali, sara, chat } = await two();
    const bilal = await w.person('Bilal', phone);
    const bilalChat = await bilal.client.openDirect(sara.id);
    sara.client.stop();
    for (let i = 1; i <= 5; i++) await ali.client.sendText(chat.id, `Ali ${i}`);
    // Bilal has never messaged Sara: he starts a new session while she's away.
    await bilal.client.sendText(bilalChat.id, 'Can I borrow your notes?');
    await w.settle();
    expect(w.server.pendingFor(sara.id, 1)).toBe(6);
    // She comes back on a weak network: everything arrives jumbled, and twice.
    w.server.chaos = { shuffle: true, duplicate: true };
    sara.client.start();
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali 1', 'Ali 2', 'Ali 3', 'Ali 4', 'Ali 5'].map((t) => `Ali: ${t}`));
    expect(await w.texts(sara, bilalChat.id)).toEqual(['Bilal: Can I borrow your notes?']);
    expect(w.server.pendingFor(sara.id, 1)).toBe(0);
  });

  test('messages written offline wait in the outbox and go in order', async () => {
    const { ali, sara, chat } = await two();
    ali.client.stop();
    for (const t of ['one', 'two', 'three']) await ali.client.sendText(chat.id, t);
    // They show at once on Ali's phone, waiting.
    expect((await ali.client.messages(chat.id)).map((m) => `${m.text}:${m.status}`)).toEqual(['one:queued', 'two:queued', 'three:queued']);
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual([]);
    ali.client.start();
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali: one', 'Ali: two', 'Ali: three']);
    expect((await ali.client.messages(chat.id)).map((m) => m.status)).toEqual(['delivered', 'delivered', 'delivered']);
    expect(await ali.client.outbox()).toEqual([]);
  });

  test('a message pushed twice shows once, and alerts once', async () => {
    const { ali, sara, chat } = await two();
    const alerts: string[] = [];
    sara.client.on('arrived', (m) => alerts.push(m.text ?? ''));
    const mine: string[] = [];
    ali.client.on('arrived', (m) => mine.push(m.text ?? ''));
    w.server.chaos = { duplicate: true };
    await ali.client.sendText(chat.id, 'Only once please');
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali: Only once please']);
    expect(alerts).toEqual(['Only once please']);
    // Ticks and my own messages never alert.
    expect(mine).toEqual([]);
  });

  test('settled() waits for a send to finish, so the app can let go safely', async () => {
    const { ali, chat } = await two();
    const sent = await ali.client.sendText(chat.id, 'Before I go');
    await ali.client.settled();
    expect((await ali.storage.getMessage(chat.id, ali.id, sent.id))!.seq).not.toBeNull();
    expect(await ali.client.outbox()).toEqual([]);
  });

  test('the app picks up where it left off after a restart', async () => {
    const { ali, sara, chat } = await two();
    await ali.client.sendText(chat.id, 'Before');
    await w.settle();
    sara.client.stop();
    await ali.client.sendText(chat.id, 'While closed');
    await w.settle();
    // A new PakChat with the same storage and keys, as when the app opens again.
    const { PakChat } = await import('../src/client');
    const again = new PakChat({ signal: sara.signal, storage: sara.storage, server: w.server.api(), connect: w.server.connect });
    expect(await again.load()).toBe(true);
    sara.client = again;
    again.start();
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali: Before', 'Ali: While closed']);
    await again.sendText(chat.id, 'Back');
    await w.settle();
    expect((await w.texts(ali, chat.id)).at(-1)).toBe('Sara: Back');
  });

  test('a message is not lost if the app is killed right after opening it', async () => {
    const { ali, sara, chat } = await two();
    await ali.client.sendText(chat.id, 'Before');
    await w.settle();
    // Sara's phone opens the next message, then dies before saving it.
    const put = sara.storage.putMessage.bind(sara.storage);
    let dying = true;
    let opened = false;
    sara.storage.putMessage = (m) => {
      if (dying && m.text === 'Killed') {
        opened = true;
        return new Promise<void>(() => {});
      }
      return put(m);
    };
    await ali.client.sendText(chat.id, 'Killed');
    for (let i = 0; i < 500 && !opened; i++) await new Promise((r) => setTimeout(r, 2));
    expect(opened).toBe(true);
    sara.client.stop();
    dying = false;
    // The app opens again: the server still has the envelope (never confirmed) and sends it again.
    const { PakChat } = await import('../src/client');
    const again = new PakChat({ signal: sara.signal, storage: sara.storage, server: w.server.api(), connect: w.server.connect });
    expect(await again.load()).toBe(true);
    sara.client = again;
    again.start();
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali: Before', 'Ali: Killed']);
    await ali.client.sendText(chat.id, 'After');
    await w.settle();
    expect((await w.texts(sara, chat.id)).at(-1)).toBe('Ali: After');
  });

  test('a reinstalled phone: new keys, chats carry on, and a "security code changed"', async () => {
    const { ali, sara, chat } = await two();
    await ali.client.sendText(chat.id, 'Hi');
    await sara.client.sendText(chat.id, 'Hello');
    await w.settle();
    const changed: string[] = [];
    ali.client.on('securityCodeChanged', (e) => changed.push(e.userId));
    // Sara reinstalls: new keys, and the server replaces her device.
    sara.client.stop();
    const fresh = await w.person('Sara', web);
    // Ali still has the old session: Sara can't open it, asks again, and Ali resends.
    await ali.client.sendText(chat.id, 'Did you get a new phone?');
    await w.settle();
    expect(await w.texts(fresh, chat.id)).toEqual(['Ali: Did you get a new phone?']);
    expect(changed).toContain(fresh.id);
    await fresh.client.sendText(chat.id, 'Yes!');
    await w.settle();
    expect((await w.texts(ali, chat.id)).at(-1)).toBe('Sara: Yes!');
  });

  test("a message the server moved to another chat is ignored", async () => {
    const { ali, sara, chat } = await two();
    const other = await sara.client.openDirect(sara.id);
    w.server.chaos = { rewrite: (e) => (e.chat_id === chat.id && e.body ? { ...e, chat_id: other.id } : e) };
    await ali.client.sendText(chat.id, 'Only for this chat');
    await w.settle();
    expect(await w.texts(sara, other.id)).toEqual([]);
    expect(await w.texts(sara, chat.id)).toEqual([]);
  });

  test('messaging yourself works, and reaches your website', async () => {
    w = new World();
    const ali = await w.person('Ali', phone);
    const self = await ali.client.openDirect(ali.id);
    await ali.client.sendText(self.id, 'Note to self');
    await w.settle();
    expect((await ali.client.messages(self.id))[0].status).toBe('sent');
    const web2 = await w.website(ali, web);
    await ali.client.sendText(self.id, 'Shopping list');
    await w.settle();
    expect(await w.texts(web2, self.id)).toEqual(['Ali: Shopping list']);
  });
});
