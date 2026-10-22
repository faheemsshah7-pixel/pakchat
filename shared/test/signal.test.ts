// Signal itself: every SignalApi must behave the same, and a phone (Node's
// library here) and a browser (the WebAssembly build) must understand each other.

import * as S from '@signalapp/libsignal-client';
import { describe, expect, test } from 'vitest';

import type { Bundle, SignalApi } from '../src/signal';
import { SignalError } from '../src/signal';
import { wasmSignal } from '../src/web/wasmSignal';
import { safetyNumberFor } from '../src/web/wasm/signal.js';
import { make, PAIRS } from './signals';

const GROUP = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';

/** Turns keys from a device into the bundle the server would hand out. */
async function bundleFor(api: SignalApi, handle: string, deviceId: number, withOneTime = true): Promise<Bundle> {
  const keys = await api.deviceKeys(handle);
  const pre = await api.newPreKeys(handle, 1);
  return {
    registrationId: keys.registrationId,
    deviceId,
    preKeyId: withOneTime ? pre.preKeys[0].keyId : null,
    preKey: withOneTime ? pre.preKeys[0].publicKey : null,
    signedPreKeyId: keys.signedPreKey.keyId,
    signedPreKey: keys.signedPreKey.publicKey,
    signedPreKeySignature: keys.signedPreKey.signature,
    identityKey: keys.identityKey,
    // Like the server: a one-time Kyber key, or the last resort one when they run out.
    kyberPreKeyId: withOneTime ? pre.kyberPreKeys[0].keyId : keys.kyberLastResort.keyId,
    kyberPreKey: withOneTime ? pre.kyberPreKeys[0].publicKey : keys.kyberLastResort.publicKey,
    kyberPreKeySignature: withOneTime ? pre.kyberPreKeys[0].signature : keys.kyberLastResort.signature,
  };
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'no error';
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).message;
  }
}

describe.each(PAIRS)('Signal, %s', (_label, aKind, bKind) => {
  async function pair(withOneTime = true) {
    const a = make[aKind]();
    const b = make[bKind]();
    const ali = await a.createDevice('ali', 1);
    const sara = await b.createDevice('sara', 1);
    await a.startSession(ali, 'sara', 1, await bundleFor(b, sara, 1, withOneTime));
    return { a, b, ali, sara };
  }

  test('a first message starts the session, and both can reply', async () => {
    const { a, b, ali, sara } = await pair();
    const first = await a.encrypt(ali, 'sara', 1, 'Assalam o Alaikum');
    expect(first.type).toBe(3);
    expect(await b.decrypt(sara, 'ali', 1, first)).toBe('Assalam o Alaikum');
    const reply = await b.encrypt(sara, 'ali', 1, 'Walaikum Assalam 🌙');
    expect(reply.type).toBe(2);
    expect(await a.decrypt(ali, 'sara', 1, reply)).toBe('Walaikum Assalam 🌙');
    expect(await a.hasSession(ali, 'sara', 1)).toBe(true);
    expect(await b.hasSession(sara, 'ali', 1)).toBe(true);
  });

  test('works when the one-time keys have run out (last resort key)', async () => {
    const { a, b, ali, sara } = await pair(false);
    for (const text of ['one', 'two']) {
      expect(await b.decrypt(sara, 'ali', 1, await a.encrypt(ali, 'sara', 1, text))).toBe(text);
    }
  });

  test('messages opened out of order, and a repeat is refused', async () => {
    const { a, b, ali, sara } = await pair();
    expect(await b.decrypt(sara, 'ali', 1, await a.encrypt(ali, 'sara', 1, 'hello'))).toBe('hello');
    await a.decrypt(ali, 'sara', 1, await b.encrypt(sara, 'ali', 1, 'hi'));
    const sent = [];
    for (let i = 0; i < 6; i++) sent.push(await a.encrypt(ali, 'sara', 1, `m${i}`));
    for (const i of [4, 0, 5, 2, 1, 3]) expect(await b.decrypt(sara, 'ali', 1, sent[i])).toBe(`m${i}`);
    expect(await codeOf(b.decrypt(sara, 'ali', 1, sent[2]))).toBe(SignalError.duplicate);
  });

  test('a changed message is refused, and the real one still opens', async () => {
    const { a, b, ali, sara } = await pair();
    const sealed = await a.encrypt(ali, 'sara', 1, 'Original');
    const raw = Buffer.from(sealed.body, 'base64');
    raw[Math.floor(raw.length / 2)] ^= 1;
    expect(await codeOf(b.decrypt(sara, 'ali', 1, { type: sealed.type, body: raw.toString('base64') }))).not.toBe('no error');
    expect(await b.decrypt(sara, 'ali', 1, sealed)).toBe('Original');
  });

  test('no session gives ERR_NO_SESSION', async () => {
    const { a, b, ali, sara } = await pair();
    await b.decrypt(sara, 'ali', 1, await a.encrypt(ali, 'sara', 1, 'hello'));
    const normal = await b.encrypt(sara, 'ali', 1, 'reply');
    await a.deleteSession(ali, 'sara', 1);
    expect(await a.hasSession(ali, 'sara', 1)).toBe(false);
    expect(await codeOf(a.decrypt(ali, 'sara', 1, normal))).toBe(SignalError.noSession);
  });

  test('group keys: one lock, many readers, out of order, repeats refused', async () => {
    const { a, b, ali, sara } = await pair();
    const key = await a.createGroupKey(ali, GROUP);
    // Before the key arrives, Sara can't read Ali's group messages.
    const early = await a.groupEncrypt(ali, GROUP, 'early');
    expect(await codeOf(b.groupDecrypt(sara, 'ali', 1, early))).toBe(SignalError.noGroupKey);
    await b.acceptGroupKey(sara, 'ali', 1, key);
    const later = [];
    for (let i = 0; i < 4; i++) later.push(await a.groupEncrypt(ali, GROUP, `g${i}`));
    for (const i of [2, 0, 3, 1]) expect(await b.groupDecrypt(sara, 'ali', 1, later[i])).toBe(`g${i}`);
    expect(await codeOf(b.groupDecrypt(sara, 'ali', 1, later[0]))).toBe(SignalError.duplicate);
    // The key was made before "early", so that one opens too once the key is in.
    expect(await b.groupDecrypt(sara, 'ali', 1, early)).toBe('early');
  });

  test('both sides see the same safety number', async () => {
    const { a, b, ali, sara } = await pair();
    await b.decrypt(sara, 'ali', 1, await a.encrypt(ali, 'sara', 1, 'hi'));
    const seen = await a.safetyNumber(ali, 'sara', 1);
    expect(seen).toMatch(/^\d{60}$/);
    expect(await b.safetyNumber(sara, 'ali', 1)).toBe(seen);
  });

  test('a reinstalled phone gets a new identity, and chats carry on', async () => {
    const { a, b, ali, sara } = await pair();
    await b.decrypt(sara, 'ali', 1, await a.encrypt(ali, 'sara', 1, 'before'));
    const oldKey = await a.identityKey(ali, 'sara', 1);
    // Sara reinstalls: a new device with the same address.
    const sara2 = await b.createDevice('sara', 1);
    await a.deleteSession(ali, 'sara', 1);
    await a.startSession(ali, 'sara', 1, await bundleFor(b, sara2, 1));
    expect(await a.identityKey(ali, 'sara', 1)).not.toBe(oldKey);
    expect(await b.decrypt(sara2, 'ali', 1, await a.encrypt(ali, 'sara', 1, 'after'))).toBe('after');
  });
});

describe('the website keeps its keys between visits', () => {
  test('a device saved and loaded again still opens messages', async () => {
    const saved = new Map<string, string>();
    const options = { save: (h: string, s: string) => void saved.set(h, s), load: (h: string) => saved.get(h) ?? null };
    const web = wasmSignal(options);
    const phone = make.node();
    const site = await web.createDevice('ali', 2);
    const sara = await phone.createDevice('sara', 1);
    await phone.startSession(sara, 'ali', 2, await bundleFor(web, site, 2));
    expect(await web.decrypt(site, 'sara', 1, await phone.encrypt(sara, 'ali', 2, 'one'))).toBe('one');

    // The tab is closed and opened again: a fresh module, loading what was saved.
    const again = wasmSignal(options);
    expect(await again.openDevice('ali', 3)).toBeNull();
    const handle = (await again.openDevice('ali', 2))!;
    expect(await again.decrypt(handle, 'sara', 1, await phone.encrypt(sara, 'ali', 2, 'two'))).toBe('two');
    expect(await phone.decrypt(sara, 'ali', 2, await again.encrypt(handle, 'sara', 1, 'three'))).toBe('three');
  });
});

describe('an opened message is kept until it is saved', () => {
  test.each(['node', 'wasm'] as const)('%s: opening again gives the same text, until forgotten', async (kind) => {
    const a = make.node();
    const b = make[kind]();
    const ali = await a.createDevice('ali', 1);
    const sara = await b.createDevice('sara', 1);
    await a.startSession(ali, 'sara', 1, await bundleFor(b, sara, 1));
    const first = await a.encrypt(ali, 'sara', 1, 'one');
    expect(await b.decrypt(sara, 'ali', 1, first, 41)).toBe('one');
    expect(await b.decrypt(sara, 'ali', 1, first, 41)).toBe('one');
    // Someone else can't get it back under the same number.
    expect(await codeOf(b.decrypt(sara, 'bob', 1, first, 41))).not.toBe('no error');
    await b.forgetOpened(sara, [41]);
    expect(await codeOf(b.decrypt(sara, 'ali', 1, first, 41))).toBe(SignalError.duplicate);

    await b.acceptGroupKey(sara, 'ali', 1, await a.createGroupKey(ali, GROUP));
    const g = await a.groupEncrypt(ali, GROUP, 'group');
    expect(await b.groupDecrypt(sara, 'ali', 1, g, 42)).toBe('group');
    expect(await b.groupDecrypt(sara, 'ali', 1, g, 42)).toBe('group');
    await b.forgetOpened(sara, [42]);
    expect(await codeOf(b.groupDecrypt(sara, 'ali', 1, g, 42))).toBe(SignalError.duplicate);
  });

  test('the website saves the kept text with its keys, in one go', async () => {
    const saved = new Map<string, string>();
    const options = { save: (h: string, s: string) => void saved.set(h, s), load: (h: string) => saved.get(h) ?? null };
    const web = wasmSignal(options);
    const phone = make.node();
    const site = await web.createDevice('ali', 2);
    const sara = await phone.createDevice('sara', 1);
    await phone.startSession(sara, 'ali', 2, await bundleFor(web, site, 2));
    const sealed = await phone.encrypt(sara, 'ali', 2, 'one');
    expect(await web.decrypt(site, 'sara', 1, sealed, 7)).toBe('one');

    // The tab closes before the message is saved; next visit, the same envelope comes again.
    const again = wasmSignal(options);
    const handle = (await again.openDevice('ali', 2))!;
    expect(await again.decrypt(handle, 'sara', 1, sealed, 7)).toBe('one');
    await again.forgetOpened(handle, [7]);
    const third = wasmSignal(options);
    const h3 = (await third.openDevice('ali', 2))!;
    expect(await codeOf(third.decrypt(h3, 'sara', 1, sealed, 7))).toBe(SignalError.duplicate);
    expect(await third.decrypt(h3, 'sara', 1, await phone.encrypt(sara, 'ali', 2, 'two'))).toBe('two');
  });
});

describe("Signal's published test numbers", () => {
  // From libsignal's own tests (rust/protocol/src/fingerprint.rs, "testVectorsVersion1"
  // in Signal's Java tests). Both of our builds must give exactly these.
  const alice = Buffer.from('0506863bc66d02b40d27b8d49ca7c09e9239236f9d7d25d6fcca5ce13c7064d868', 'hex');
  const bob = Buffer.from('05f781b6fb32fed9ba1cf2de978d4d5da28dc34046ae814402b5c0dbd96fda907b', 'hex');
  const expected = '300354477692869396892869876765458257569162576843440918079131';

  test('safety number (Node library)', () => {
    const f = S.Fingerprint.new(5200, 1, Buffer.from('+14152222222'), S.PublicKey.deserialize(alice), Buffer.from('+14153333333'), S.PublicKey.deserialize(bob));
    expect(f.displayableFingerprint().toString()).toBe(expected);
  });

  test('safety number (website build)', () => {
    // The displayed number doesn't depend on the version, only the QR code does.
    expect(safetyNumberFor('+14152222222', alice.toString('base64'), '+14153333333', bob.toString('base64'))).toBe(expected);
    expect(safetyNumberFor('+14153333333', bob.toString('base64'), '+14152222222', alice.toString('base64'))).toBe(expected);
  });

  test('X25519 key agreement (RFC 7748, section 6.1)', () => {
    // Signal's keys are Curve25519. These numbers come from the standard itself.
    const alicePrivate = S.PrivateKey.deserialize(Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex'));
    const bobPublic = S.PublicKey.deserialize(Buffer.from('05de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f', 'hex'));
    expect(Buffer.from(alicePrivate.agree(bobPublic)).toString('hex')).toBe('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  });
});
