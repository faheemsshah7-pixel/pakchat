// The shared core against the REAL Phoenix server and Postgres, over real
// web addresses and a real WebSocket. Start the test server first:
//
//   cd server && MIX_ENV=test mix run --no-start test/e2e_server.exs
//
// then, in another terminal:
//
//   cd shared && npm run test:server
//
// It uses its own empty database (pakchat_e2e), never real accounts.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PakChat } from '../../src/client';
import { phoenixConnection } from '../../src/connection';
import { HttpServer, type SignedIn } from '../../src/server';
import type { SignalApi } from '../../src/signal';
import { MemoryStorage, type Message } from '../../src/storage';
import { type Kind, make } from '../signals';

const HTTP = process.env.PAKCHAT_SERVER ?? 'http://localhost:4002';
const SOCKET = HTTP.replace(/^http/, 'ws') + '/socket';
const HELPER = process.env.PAKCHAT_HELPER ?? 'http://localhost:4003';

type Person = { name: string; client: PakChat; signal: SignalApi; storage: MemoryStorage; id: string };
const people: Person[] = [];

async function helper<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${HELPER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json as T;
}

function newClient(kind: Kind, signal = make[kind](), storage = new MemoryStorage()) {
  const client = new PakChat({ signal, storage, server: new HttpServer(HTTP), connect: phoenixConnection(SOCKET), deviceName: 'Test' });
  return { client, signal, storage };
}

/** Signs someone in with a pretend Google account. The same `key` is the same account. */
async function person(name: string, kind: Kind, key = `${name}-${Date.now()}-${Math.random()}`): Promise<Person> {
  const { client, signal, storage } = newClient(kind);
  const { id_token } = await helper<{ id_token: string }>('/google_token', { name, key });
  const s = await client.signIn(id_token);
  const p = { name, client, signal, storage, id: s.userId, key };
  people.push(p);
  await connected(client);
  return p;
}

/** Links a website to someone's phone, through the test helper (the QR code comes in phase 8). */
async function website(phone: Person, kind: Kind): Promise<Person> {
  const { client, signal, storage } = newClient(kind);
  const s = await client.signInWith(async (device, keys) => {
    const r = await helper<{ token: string; device_id: number; device_uuid: string }>('/link', {
      token: phone.client.me!.token,
      device: {
        name: device.name,
        registration_id: device.registrationId,
        identity_key: device.identityKey,
        signed_pre_key: { key_id: device.signedPreKey.keyId, public_key: device.signedPreKey.publicKey, signature: device.signedPreKey.signature },
        kyber_last_resort: { key_id: device.kyberLastResort.keyId, public_key: device.kyberLastResort.publicKey, signature: device.kyberLastResort.signature },
      },
      pre_keys: keys.preKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey })),
      kyber_pre_keys: keys.kyberPreKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey, signature: k.signature })),
    });
    return { token: r.token, deviceId: r.device_id, deviceUuid: r.device_uuid, user: phone.client.me!.me } satisfies SignedIn;
  });
  const p = { name: `${phone.name} (web)`, client, signal, storage, id: s.userId };
  people.push(p);
  await connected(client);
  return p;
}

function connected(client: PakChat) {
  return new Promise<void>((resolve) => {
    const off = client.on('connection', (c) => {
      if (c) {
        off();
        resolve();
      }
    });
    client.start();
  });
}

/** Waits until `check` passes (the network takes a moment). */
async function eventually(check: () => Promise<void>, ms = 8_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

const nameOf = (id: string) => people.find((p) => p.id === id)?.name.replace(' (web)', '') ?? id;
const line = (m: Message) => (m.deleted ? `${nameOf(m.author)}: (deleted)` : `${nameOf(m.author)}: ${m.text}${m.editedAt ? ' (edited)' : ''}`);
async function texts(p: Person, chatId: string) {
  return (await p.client.messages(chatId, { limit: 1000 })).filter((m) => m.kind === 'text').map(line);
}

beforeAll(async () => {
  const health = await fetch(`${HTTP}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error('Start the test server first: cd server && MIX_ENV=test mix run --no-start test/e2e_server.exs');
});

afterAll(() => {
  for (const p of people) p.client.stop();
});

describe('against the real server', () => {
  test('a phone and a website-built device chat, with ticks', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'wasm');
    const chat = await ali.client.openDirect(sara.id);
    const m = await ali.client.sendText(chat.id, 'Assalam o Alaikum from the real server');
    await eventually(async () => expect(await texts(sara, chat.id)).toEqual(['Ali: Assalam o Alaikum from the real server']));
    await eventually(async () => expect((await ali.storage.getMessage(chat.id, ali.id, m.id))!.status).toBe('delivered'));
    await sara.client.markRead(chat.id);
    await eventually(async () => expect((await ali.storage.getMessage(chat.id, ali.id, m.id))!.status).toBe('read'));
    await sara.client.sendText(chat.id, 'Walaikum Assalam');
    await eventually(async () => expect((await texts(ali, chat.id)).at(-1)).toBe('Sara: Walaikum Assalam'));
  });

  test('several devices: a new website learns from "stale devices" and gets everything after', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'node');
    const chat = await ali.client.openDirect(sara.id);
    await ali.client.sendText(chat.id, 'Before');
    await eventually(async () => expect(await texts(sara, chat.id)).toEqual(['Ali: Before']));
    const saraWeb = await website(sara, 'wasm');
    const aliWeb = await website(ali, 'wasm');
    await ali.client.sendText(chat.id, 'After');
    await eventually(async () => expect(await texts(saraWeb, chat.id)).toEqual(['Ali: After']));
    await eventually(async () => expect(await texts(aliWeb, chat.id)).toEqual(['Ali: After']));
    await saraWeb.client.sendText(chat.id, 'From the laptop');
    for (const p of [ali, aliWeb, sara]) await eventually(async () => expect((await texts(p, chat.id)).at(-1)).toBe('Sara: From the laptop'));
  });

  test('offline: the server holds everything, and it all arrives in order on reconnect', async () => {
    const ali = await person('Ali', 'wasm');
    const sara = await person('Sara', 'node');
    const chat = await ali.client.openDirect(sara.id);
    await ali.client.sendText(chat.id, 'Hello');
    await eventually(async () => expect(await texts(sara, chat.id)).toHaveLength(1));
    sara.client.stop();
    for (let i = 1; i <= 20; i++) await ali.client.sendText(chat.id, `Message ${i}`);
    await eventually(async () => expect(await ali.client.outbox()).toEqual([]));
    await connected(sara.client);
    const expected = ['Ali: Hello', ...Array.from({ length: 20 }, (_, i) => `Ali: Message ${i + 1}`)];
    await eventually(async () => expect(await texts(sara, chat.id)).toEqual(expected));
  });

  test('groups: join, leave, new keys, edits and reactions', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'wasm');
    const bilal = await person('Bilal', 'node');
    const g = await ali.client.createGroup('Study group', [sara.id, bilal.id]);
    const exam = await ali.client.sendText(g.id, 'Exam on Mondy');
    for (const p of [sara, bilal]) await eventually(async () => expect(await texts(p, g.id)).toEqual(['Ali: Exam on Mondy']));
    await ali.client.edit(g.id, exam.id, 'Exam on Monday');
    await sara.client.react(g.id, { author: ali.id, id: exam.id }, '📚');
    for (const p of [sara, bilal]) await eventually(async () => expect(await texts(p, g.id)).toEqual(['Ali: Exam on Monday (edited)']));
    await eventually(async () => expect((await bilal.storage.getMessage(g.id, ali.id, exam.id))!.reactions).toEqual({ [sara.id]: '📚' }));

    await bilal.client.removeMember(g.id, bilal.id);
    await eventually(async () => expect((await ali.storage.getChat(g.id))!.members.map((m) => m.userId)).not.toContain(bilal.id));
    const zara = await person('Zara', 'wasm');
    await ali.client.addMembers(g.id, [zara.id]);
    await eventually(async () => expect((await sara.storage.getChat(g.id))!.members.map((m) => m.userId)).toContain(zara.id));
    await sara.client.sendText(g.id, 'Welcome Zara, bye Bilal');
    await eventually(async () => expect(await texts(zara, g.id)).toEqual(['Sara: Welcome Zara, bye Bilal']));
    await eventually(async () => expect((await texts(ali, g.id)).at(-1)).toBe('Sara: Welcome Zara, bye Bilal'));
    await new Promise((r) => setTimeout(r, 300));
    expect(await texts(bilal, g.id)).toEqual(['Ali: Exam on Monday (edited)']);
  });

  test('a reinstalled phone keeps chatting, after asking for what it missed', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'node');
    const chat = await ali.client.openDirect(sara.id);
    await ali.client.sendText(chat.id, 'Hi');
    await eventually(async () => expect(await texts(sara, chat.id)).toHaveLength(1));
    sara.client.stop();
    // Same Google account, brand new keys.
    const fresh = await person('Sara', 'wasm', (sara as Person & { key: string }).key);
    expect(fresh.id).toBe(sara.id);
    const changed: string[] = [];
    ali.client.on('securityCodeChanged', (e) => changed.push(e.userId));
    await ali.client.sendText(chat.id, 'New phone?');
    await eventually(async () => expect(await texts(fresh, chat.id)).toEqual(['Ali: New phone?']));
    expect(changed).toContain(sara.id);
  });
});
