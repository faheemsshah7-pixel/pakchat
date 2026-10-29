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

import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PakChat, type FileUploader } from '../../src/client';
import { phoenixConnection } from '../../src/connection';
import { HttpServer, REQUESTED, ServerError, type ServerChat, type SignedIn } from '../../src/server';
import type { SignalApi } from '../../src/signal';
import { MemoryStorage, type Message } from '../../src/storage';
import { type Kind, make } from '../signals';

/** A join that went straight in (not a request to its admins). */
function inside(chat: ServerChat | typeof REQUESTED): ServerChat {
  if (chat === REQUESTED) throw new Error('Asked to join instead of joining');
  return chat;
}

const HTTP = process.env.PAKCHAT_SERVER ?? 'http://localhost:4002';
const SOCKET = HTTP.replace(/^http/, 'ws') + '/socket';
const HELPER = process.env.PAKCHAT_HELPER ?? 'http://localhost:4003';

type Person = { name: string; client: PakChat; signal: SignalApi; storage: MemoryStorage; server: HttpServer; id: string };
const people: Person[] = [];

async function helper<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${HELPER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json as T;
}

// Stand-in for the phone's locked files: "local" names bytes kept here, and
// what goes up is those bytes as they are (the server can't tell either way).
const localFiles = new Map<string, Buffer>();

function uploaderFor(server: HttpServer): FileUploader {
  return {
    async upload(chatId, local) {
      const bytes = localFiles.get(local)!;
      const { id, uploadUrl } = await server.startUpload(chatId, bytes.length);
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
      if (res.status !== 204) throw new Error(`upload: ${res.status}`);
      return { id, key: 'test-key', digest: createHash('sha256').update(bytes).digest('base64') };
    },
  };
}

function newClient(kind: Kind, signal = make[kind](), storage = new MemoryStorage(), active?: () => boolean) {
  const server = new HttpServer(HTTP);
  const client = new PakChat({ signal, storage, server, connect: phoenixConnection(SOCKET), active, deviceName: 'Test', files: uploaderFor(server) });
  return { client, signal, storage, server };
}

/** A made-up Pakistani mobile number, different every time. */
const newNumber = () => `0300${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const sha256 = (text: string) => createHash('sha256').update(text).digest('base64');

/** Signs someone in with a pretend Google account. The same `key` is the same account. */
async function person(name: string, kind: Kind, key = `${name}-${Date.now()}-${Math.random()}`, active?: () => boolean): Promise<Person> {
  const { client, signal, storage, server } = newClient(kind, undefined, undefined, active);
  const { id_token } = await helper<{ id_token: string }>('/google_token', { name, key });
  const s = await client.signIn(id_token);
  const p = { name, client, signal, storage, server, id: s.userId, key };
  people.push(p);
  await connected(client);
  return p;
}

/** Links a website to someone's phone, through the test helper (the QR code comes in phase 8). */
async function website(phone: Person, kind: Kind): Promise<Person> {
  const { client, signal, storage, server } = newClient(kind);
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
  const p = { name: `${phone.name} (web)`, client, signal, storage, server, id: s.userId };
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

  test('online only while the app is on screen, not when a phone wakes in the background', async () => {
    let onScreen = false;
    const sara = await person('Sara', 'node', undefined, () => onScreen);
    const ali = await person('Ali', 'node');
    const seen: Record<string, unknown>[] = [];
    ali.client.on('presence', (p) => void seen.push(p));
    // Sara's phone is connected (woken to collect a message), but she isn't online.
    expect(await ali.client.watch(sara.id)).toMatchObject({ online: false });
    onScreen = true;
    sara.client.setActive(true);
    await eventually(async () => expect(seen.at(-1)).toMatchObject({ user_id: sara.id, online: true }));
    onScreen = false;
    sara.client.setActive(false);
    await eventually(async () => expect(seen.at(-1)).toMatchObject({ user_id: sara.id, online: false }));
    // Connecting again in the background still isn't online; on screen, it is.
    sara.client.stop();
    await connected(sara.client);
    expect(await ali.client.watch(sara.id)).toMatchObject({ online: false });
    sara.client.stop();
    onScreen = true;
    await connected(sara.client);
    await eventually(async () => expect(await ali.client.watch(sara.id)).toMatchObject({ online: true }));
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

  test('phase 7: an invite link that stops after 2 joins, and a message from someone who joined with it', async () => {
    const ali = await person('Ali', 'node');
    const g = await ali.client.createGroup('Cricket', []);
    const link = await ali.server.resetInvite(g.id, { maxUses: 2, expiresIn: 3_600 });
    expect(link.maxUses).toBe(2);
    expect(link.expiresAt).toBeGreaterThan(Date.now());
    const [sara, bilal, zara] = [await person('Sara', 'wasm'), await person('Bilal', 'node'), await person('Zara', 'wasm')];
    const info = await sara.server.inviteInfo(link.code);
    expect(info).toMatchObject({ chatId: g.id, title: 'Cricket', kind: 'group', callLink: false });
    await sara.client.adopt(inside(await sara.server.joinInvite(link.code)));
    await bilal.client.adopt(inside(await bilal.server.joinInvite(link.code)));
    // The third join: the link has stopped.
    await expect(zara.server.joinInvite(link.code)).rejects.toBeInstanceOf(ServerError);
    await sara.client.sendText(g.id, 'Salam all');
    for (const p of [ali, bilal]) await eventually(async () => expect(await texts(p, g.id)).toContain('Sara: Salam all'));
    // A new link: the old one stops.
    const fresh = await ali.server.resetInvite(g.id);
    expect(fresh.code).not.toBe(link.code);
    await expect(zara.server.inviteInfo(link.code)).rejects.toBeInstanceOf(ServerError);
  });

  test('build 8: permissions and disappearing messages set while making a group', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'wasm');
    const bilal = await person('Bilal', 'node');
    const g = await ali.client.createGroup('Book club', [sara.id], { membersEdit: true, membersAdd: true, joinApproval: true, defaultTimer: 86_400 });
    expect(g).toMatchObject({ membersEdit: true, membersAdd: true, joinApproval: true, onlyAdminsSend: false });
    expect((await ali.storage.getChat(g.id))!.timer).toBe(86_400);
    // Sara isn't an admin, but members may add people.
    await eventually(async () => expect((await sara.storage.getChat(g.id))?.membersAdd).toBe(true));
    await sara.client.addMembers(g.id, [bilal.id]);
    await eventually(async () => expect((await ali.storage.getChat(g.id))!.members.map((m) => m.userId)).toContain(bilal.id));
  });

  test('phase 7: a community with announcements, a linked group, and a group joined from its list', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'wasm');
    const g = await ali.client.createGroup('Juniors', [sara.id]);
    const community = await ali.client.adopt(await ali.server.createCommunity('Model Town', 'Our street', [g.id]));
    expect(community.kind).toBe('community');
    const { groups } = await ali.server.communityGroups(community.id);
    const ann = groups.find((x) => x.announcements)!;
    expect(ann).toBeTruthy();
    expect(groups.some((x) => x.id === g.id)).toBe(true);
    // Sara joins the community; a new group in it is hers to join from its list.
    await ali.client.addMembers(community.id, [sara.id]);
    const seniors = await ali.server.addCommunityGroups(community.id, [], { title: 'Seniors' });
    expect(seniors).toBeTruthy();
    const list = await sara.server.communityGroups(community.id);
    expect(list.groups.find((x) => x.id === seniors)?.joined).toBe(false);
    expect(list.groups.find((x) => x.announcements)?.joined).toBe(true);
    const joined = await sara.client.adopt(inside(await sara.server.joinCommunityGroup(community.id, seniors!)));
    expect(joined.communityId).toBe(community.id);
    // Only admins post in announcements.
    await ali.client.syncChats();
    await ali.client.sendText(ann.id, 'Meeting on Friday');
    await sara.client.syncChats();
    await eventually(async () => expect(await texts(sara, ann.id)).toContain('Ali: Meeting on Friday'));
  });

  test('phase 7: a call link anyone can join, and a report', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'wasm');
    const call = await ali.client.adopt(await ali.server.createCallLink('Family call'));
    expect(call.callLink).toBe(true);
    expect(call.inviteCode).toBeTruthy();
    const info = await sara.server.inviteInfo(call.inviteCode!);
    expect(info.callLink).toBe(true);
    const joined = await sara.client.adopt(inside(await sara.server.joinInvite(call.inviteCode!)));
    expect(joined.members.map((m) => m.userId).sort()).toEqual([ali.id, sara.id].sort());
    const dm = await sara.client.openDirect(ali.id);
    await sara.server.report(dm.id, 'spam', ali.id, [{ author: ali.id, text: 'buy now', at: Date.now() }]);
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

  test('phone sign-in: a code, a new account, and the same account next time', async () => {
    const { client, server } = newClient('node');
    const sent = await server.sendSignInCode(newNumber());
    expect(sent.phone).toMatch(/^\+92300\d{7}$/);
    await expect(client.signInWithPhone(sent.phone, '000000')).rejects.toMatchObject({ reason: 'wrong_code' });
    const code = await server.testCode(sent.phone);
    const s = await client.signInWithPhone(sent.phone, code);
    expect(s.newAccount).toBe(true);
    expect(s.me.phone).toBe(sent.phone);
    expect(s.me.email).toBeNull();
    // A code works once.
    await expect(newClient('node').client.signInWithPhone(sent.phone, code)).rejects.toMatchObject({ reason: 'wrong_code' });

    // Friends can find the new account by its number.
    const friend = await person('Friend', 'node');
    const friendServer = new HttpServer(HTTP);
    friendServer.useToken(friend.client.me!.token);
    expect((await friendServer.lookup(sent.phone, 'phone'))?.id).toBe(s.userId);
    client.stop();
  });

  test('a Google account adds a number, signs in with it, and finds friends by hashed contacts', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'node');
    const aliServer = new HttpServer(HTTP);
    aliServer.useToken(ali.client.me!.token);
    const number = newNumber();
    const { phone } = await aliServer.sendLinkCode(number);
    const me = await aliServer.linkPhone(phone, await aliServer.testCode(phone));
    expect(me.phone).toBe(phone);
    expect(me.email).toBeTruthy();

    // Sara has Ali's number in her phone's contacts (typed her own way) and an unknown one.
    const saraServer = new HttpServer(HTTP);
    saraServer.useToken(sara.client.me!.token);
    const found = await saraServer.matchContacts([sha256(phone), sha256('+923009999999')], []);
    expect(found.map((f) => f.user.id)).toEqual([ali.id]);
    expect(found[0].hash).toBe(sha256(phone));
    expect((await saraServer.lookup(number, 'phone'))?.id).toBe(ali.id);

    // Sara can't take Ali's number.
    await expect(saraServer.sendLinkCode(number)).rejects.toMatchObject({ reason: 'taken' });

    // Signing in with the number reaches the same account (after the 30 s wait between codes).
    const fresh = newClient('wasm');
    await new Promise((r) => setTimeout(r, 31_000));
    await fresh.server.sendSignInCode(phone);
    const s = await fresh.client.signInWithPhone(phone, await fresh.server.testCode(phone));
    expect(s.userId).toBe(ali.id);
    expect(s.newAccount).toBeUndefined();
    // Both ways in: removing one is fine, removing the last is not.
    const noPhone = await fresh.server.unlink('phone');
    expect(noPhone.phone).toBeNull();
    await expect(fresh.server.unlink('google')).rejects.toMatchObject({ reason: 'last_sign_in' });
  }, 60_000);

  test('a file goes up, its message arrives, and only chat members can fetch it', async () => {
    const ali = await person('Ali', 'node');
    const sara = await person('Sara', 'wasm');
    const bilal = await person('Bilal', 'node');
    const chat = await ali.client.openDirect(sara.id);
    const bytes = randomBytes(300_000);
    localFiles.set('photo-1', bytes);
    await ali.client.sendFile(chat.id, { local: 'photo-1', size: bytes.length, mime: 'image/jpeg', kind: 'image', width: 800, height: 600 }, { caption: 'Library' });
    let got: Message | undefined;
    await eventually(async () => {
      got = (await sara.client.messages(chat.id)).find((m) => m.kind === 'file');
      expect(got?.file?.id).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(got!.text).toBe('Library');
    expect(got!.file).toMatchObject({ size: 300_000, mime: 'image/jpeg', kind: 'image', key: 'test-key', width: 800, height: 600 });

    const saraServer = new HttpServer(HTTP);
    saraServer.useToken(sara.client.me!.token);
    const link = await saraServer.fileLink(got!.file!.id);
    const down = Buffer.from(await (await fetch(link)).arrayBuffer());
    expect(down.equals(bytes)).toBe(true);
    expect(createHash('sha256').update(down).digest('base64')).toBe(got!.file!.digest);

    const bilalServer = new HttpServer(HTTP);
    bilalServer.useToken(bilal.client.me!.token);
    await expect(bilalServer.fileLink(got!.file!.id)).rejects.toBeInstanceOf(ServerError);
    // Ali's own copy now has the server's id too.
    await eventually(async () => expect((await ali.client.messages(chat.id)).find((m) => m.kind === 'file')?.file?.id).toBe(got!.file!.id));
    expect((await saraServer.fileLimits()).maxBytes).toBeGreaterThan(0);
  });

  test('a backup goes up, comes back, and is replaced by the next', async () => {
    const ali = await person('Ali', 'node');
    const server = new HttpServer(HTTP);
    server.useToken(ali.client.me!.token);
    expect(await server.backup()).toBeNull();
    for (const size of [1000, 2000]) {
      const bytes = randomBytes(size);
      const { uploadUrl } = await server.startBackup(size);
      expect((await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(bytes) })).status).toBe(204);
      const b = await server.backup();
      expect(b?.size).toBe(size);
      expect(Math.abs(Date.now() - b!.madeAt)).toBeLessThan(60_000);
      expect(Buffer.from(await (await fetch(b!.url)).arrayBuffer()).equals(bytes)).toBe(true);
    }
    await server.deleteBackup();
    expect(await server.backup()).toBeNull();
  });
});
