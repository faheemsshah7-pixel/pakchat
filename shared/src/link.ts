// Linking a website to a phone by QR code, like WhatsApp Web.
//
//   1. The website makes its Signal keys and a one-off X25519 key pair, sends
//      the Signal public keys to the server (POST /api/link), and shows a QR:
//
//        PAKCHAT1,<code>,<one-off public key>,<check of its identity key>
//
//      The server never sees the one-off key: it only lives in the QR.
//   2. The phone scans it, asks the server which website the code belongs to,
//      and checks that website's identity key against the QR. So the server
//      can't swap in keys of its own.
//   3. The phone locks a "provision" to the one-off key (X25519, then HKDF,
//      then AES-256-GCM) and approves. The server passes it on unopened. It
//      tells the website which phone linked it, so the website can check
//      that the history it is sent really comes from that phone.
//
// Linking with a phone number instead, like WhatsApp's: the website shows an
// 8-letter code and no QR. It seals its QR text with that code (PBKDF2, then
// AES-256-GCM, bound to the number) and gives the server the number and the
// sealed text. The phone with that number fetches what is waiting for it,
// opens it with the code its owner types, and goes on as if it had scanned
// the QR. The server never sees the code. The key is the phone's backup-key
// sum (PBKDF2-SHA256, 310,000 rounds, salt "pakchat-backup:pair:<number>"),
// so the phone can make it with what it already has.
//
// The website side uses WebCrypto. The phone does the same in Kotlin
// (LinkLock.kt); `test/link.test.ts` checks the two agree.

import { fromBytes, toBytes } from './bytes';

export const QR_PREFIX = 'PAKCHAT1';
const INFO = new TextEncoder().encode('PakChat link provision v1');
const VERSION = 1;

/** What the phone tells a website it links. */
export type Provision = {
  v: 1;
  /** The account the website now belongs to. */
  userId: string;
  /** The phone's Signal identity key (base64, 33 bytes), to check its messages by. */
  identityKey: string;
  /** Like "Pixel 7". */
  phoneName: string;
};

export type QrInfo = { code: string; publicKey: Uint8Array; identityCheck: Uint8Array };

const b64url = (bytes: Uint8Array) => fromBytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (text: string) => toBytes(text.replace(/-/g, '+').replace(/_/g, '/'));

/** The first 16 bytes of SHA-256 of an identity key: short enough for a QR, too long to fake. */
export async function identityCheck(identityKey: string): Promise<Uint8Array> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', toBytes(identityKey) as BufferSource));
  return hash.slice(0, 16);
}

export function qrText(code: string, publicKey: Uint8Array, check: Uint8Array): string {
  return [QR_PREFIX, code, b64url(publicKey), b64url(check)].join(',');
}

/** Reads a scanned QR. Null if it isn't a PakChat linking QR. */
export function parseQr(text: string): QrInfo | null {
  const parts = text.trim().split(',');
  if (parts.length !== 4 || parts[0] !== QR_PREFIX || !/^[A-Za-z0-9_-]{16,64}$/.test(parts[1])) return null;
  try {
    const publicKey = unb64url(parts[2]);
    const check = unb64url(parts[3]);
    if (publicKey.length !== 32 || check.length !== 16) return null;
    return { code: parts[1], publicKey, identityCheck: check };
  } catch {
    return null;
  }
}

/** Does the identity key the server gave match the QR? Compared in full, never shortcut. */
export async function identityMatches(identityKey: string, check: Uint8Array): Promise<boolean> {
  const mine = await identityCheck(identityKey);
  let diff = mine.length ^ check.length;
  for (let i = 0; i < mine.length; i++) diff |= mine[i] ^ (check[i] ?? 0);
  return diff === 0;
}

/** The website's one-off key pair. The private half can't be read out of the browser. */
export async function newLinkKeys(): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey };
}

async function aesKey(privateKey: CryptoKey, theirPublic: Uint8Array, usage: KeyUsage) {
  const their = await crypto.subtle.importKey('raw', theirPublic as BufferSource, { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: their }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/**
 * Locks a provision to the website's one-off key. The phone does this in
 * Kotlin; this copy is for tests and for linking from another website later.
 *
 * Layout: 1 version byte, the sender's one-off public key (32), the IV (12),
 * then AES-GCM's output. The version byte and both public keys are checked too.
 */
export async function lockProvision(p: Provision, websiteKey: Uint8Array): Promise<string> {
  const mine = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  const myPublic = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const key = await aesKey(mine.privateKey, websiteKey, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(p));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(myPublic, websiteKey) }, key, plain));
  return fromBytes(concat(new Uint8Array([VERSION]), myPublic, iv, sealed));
}

/** Opens what the phone sent. Throws if it was changed, or isn't for this website. */
export async function openProvision(locked: string, keys: { privateKey: CryptoKey; publicKey: Uint8Array }): Promise<Provision> {
  const bytes = toBytes(locked);
  if (bytes.length < 1 + 32 + 12 + 16 || bytes[0] !== VERSION) throw new Error('Not a provision');
  const theirPublic = bytes.slice(1, 33);
  const iv = bytes.slice(33, 45);
  let p: Partial<Provision>;
  try {
    const key = await aesKey(keys.privateKey, theirPublic, 'decrypt');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(theirPublic, keys.publicKey) }, key, bytes.slice(45));
    p = JSON.parse(new TextDecoder().decode(plain)) as Partial<Provision>;
  } catch {
    throw new Error('Not a provision');
  }
  if (p.v !== 1 || typeof p.userId !== 'string' || typeof p.identityKey !== 'string' || typeof p.phoneName !== 'string') {
    throw new Error('Not a provision');
  }
  return { v: 1, userId: p.userId, identityKey: p.identityKey, phoneName: p.phoneName.slice(0, 50) };
}

// Both public keys and the version, so a provision can't be replayed to another website.
const aad = (phoneKey: Uint8Array, websiteKey: Uint8Array) => concat(new Uint8Array([VERSION]), phoneKey, websiteKey) as BufferSource;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- Linking with a phone number ----

/** No 0/O or 1/I to mix up: 32 letters, so 8 of them are 40 bits. */
const PAIR_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIR_ROUNDS = 310_000;
const pairAad = (phone: string) => new TextEncoder().encode(`PakChat pairing v1:${phone}`) as BufferSource;

/** A new 8-letter code for the website to show, like "K7QM2XRP". */
export function newPairCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => PAIR_LETTERS[b % 32]).join('');
}

/** The code as typed on the phone ("k7qm-2xrp"), tidied, or null if it can't be one. */
export function tidyPairCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  return code.length === 8 && [...code].every((c) => PAIR_LETTERS.includes(c)) ? code : null;
}

/** "K7QM-2XRP", as the website shows it. */
export const showPairCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** The AES key from the code and the tidied number (the phone makes the same one natively). */
export async function pairKey(code: string, phone: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const salt = new TextEncoder().encode(`pakchat-backup:pair:${phone}`);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PAIR_ROUNDS }, base, 512);
  return new Uint8Array(bits).slice(0, 32);
}

/** The website: its QR text sealed with the code's key. Base64 of the IV (12), then AES-GCM's output. */
export async function sealQr(text: string, key: Uint8Array, phone: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: pairAad(phone) }, k, new TextEncoder().encode(text)));
  return fromBytes(concat(iv, sealed));
}

/** Opens a sealed QR text (WebCrypto: tests, and any phone that has it). Null if the code is wrong. */
export async function openSealedQr(sealed: string, key: Uint8Array, phone: string): Promise<string | null> {
  try {
    const bytes = toBytes(sealed);
    const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: pairAad(phone) }, k, bytes.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** The extra data the seal is bound to, for a phone that opens it itself (base64). */
export const pairExtra = (phone: string) => fromBytes(new TextEncoder().encode(`PakChat pairing v1:${phone}`));

/**
 * The phone, after its owner typed the website's code: finds the website
 * waiting for this number that the code opens, then links it just as a
 * scanned QR does. Throws LinkRefused "wrong_code" if none opens, or
 * "no_phone" if this account has no number.
 */
export async function approvePairing(
  server: LinkServer & { pairing(): Promise<{ phone: string | null; waiting: { sealed: string; name: string }[] }> },
  typed: string,
  provision: Provision,
  lock: (p: Provision, websiteKey: Uint8Array) => Promise<string>,
  open: (sealed: string, code: string, phone: string) => Promise<string | null>,
): Promise<{ deviceId: number; deviceUuid: string; name: string }> {
  const code = tidyPairCode(typed);
  if (!code) throw new LinkRefused('wrong_code');
  // A new code can come in while this runs (they change every 20 seconds): one more go then.
  for (let tries = 0; ; tries++) {
    const { phone, waiting } = await server.pairing();
    if (!phone) throw new LinkRefused('no_phone');
    let text: string | null = null;
    for (const w of waiting) {
      const t = await open(w.sealed, code, phone);
      if (t && parseQr(t)) {
        text = t;
        break;
      }
    }
    if (!text) throw new LinkRefused('wrong_code');
    try {
      const linked = await approveQr(server, text, provision, lock);
      if (linked) return linked;
      throw new LinkRefused('expired');
    } catch (err) {
      if (tries === 0 && err instanceof LinkRefused && err.reason === 'expired') continue;
      throw err;
    }
  }
}

/** A name for this browser in "Linked devices", like "Chrome on Mac". */
export function browserName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  // iPhones say "like Mac OS X" too, so they're checked first.
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'Mac'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Why the phone couldn't link a QR, in words the app can show. */
export class LinkRefused extends Error {
  constructor(readonly reason: 'not_a_qr' | 'expired' | 'mismatch' | 'too_many_devices' | 'wrong_code' | 'no_phone') {
    super(reason);
  }
}

type LinkServer = {
  linkInfo(code: string): Promise<{ name: string; identityKey: string }>;
  approveLink(code: string, provision: string): Promise<{ deviceId: number; deviceUuid: string }>;
};

/**
 * The phone, after scanning: checks the QR against the server, then says yes.
 * `lock` locks the provision to the QR's key (WebCrypto's `lockProvision`, or
 * the phone's own Kotlin). `confirm` sees the website's name first and may say no.
 */
export async function approveQr(
  server: LinkServer,
  text: string,
  provision: Provision,
  lock: (p: Provision, websiteKey: Uint8Array) => Promise<string>,
  confirm: (name: string) => Promise<boolean> = async () => true,
): Promise<{ deviceId: number; deviceUuid: string; name: string } | null> {
  const qr = parseQr(text);
  if (!qr) throw new LinkRefused('not_a_qr');
  const info = await server.linkInfo(qr.code).catch((err: { status?: number }) => {
    throw err?.status === 404 ? new LinkRefused('expired') : err;
  });
  // The keys the server holds must be the ones on the screen.
  if (!(await identityMatches(info.identityKey, qr.identityCheck))) throw new LinkRefused('mismatch');
  if (!(await confirm(info.name))) return null;
  const locked = await lock(provision, qr.publicKey);
  try {
    return { ...(await server.approveLink(qr.code, locked)), name: info.name };
  } catch (err) {
    const e = err as { status?: number; reason?: string };
    if (e?.reason === 'too_many_devices') throw new LinkRefused('too_many_devices');
    if (e?.status === 404) throw new LinkRefused('expired');
    throw err;
  }
}
