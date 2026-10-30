// Locking and unlocking files in the browser, in the same format as the
// phone's FileLock.kt (Signal's attachment format):
//
//   key    = 64 bytes: the first 32 lock (AES-256-CBC), the last 32 check (HMAC-SHA256)
//   locked = 16-byte IV, then the locked bytes, then a 32-byte HMAC of both
//   digest = SHA-256 of all the locked bytes, sent in the message
//
// The browser's WebCrypto does it all at once, which is fine for a website
// (files are at most 100 MB, and the phone streams instead).

import { fromBytes, toBytes } from '../bytes';

export class FileChanged extends Error {}

const IV = 16;
const MAC = 32;

async function keysFor(key: Uint8Array, usage: KeyUsage) {
  if (key.length !== 64) throw new Error('The key must be 64 bytes');
  const aes = await crypto.subtle.importKey('raw', key.slice(0, 32) as BufferSource, 'AES-CBC', false, [usage]);
  const hmac = await crypto.subtle.importKey('raw', key.slice(32) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { aes, hmac };
}

/** Locks bytes with a new random key. Returns the locked bytes, and the key and digest (base64) for the message. */
export async function lockFile(plain: Uint8Array): Promise<{ locked: Uint8Array; key: string; digest: string }> {
  const key = crypto.getRandomValues(new Uint8Array(64));
  const { aes, hmac } = await keysFor(key, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aes, plain as BufferSource));
  const locked = new Uint8Array(IV + body.length + MAC);
  locked.set(iv);
  locked.set(body, IV);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, locked.subarray(0, IV + body.length)));
  locked.set(mac, IV + body.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', locked));
  return { locked, key: fromBytes(key), digest: fromBytes(digest) };
}

/** Unlocks a downloaded file. Throws FileChanged if a single byte differs from what was sent. */
export async function unlockFile(locked: Uint8Array, key: string, digest?: string | null): Promise<Uint8Array> {
  if (locked.length < IV + 16 + MAC) throw new FileChanged('Too short to be a locked file');
  const { aes, hmac } = await keysFor(toBytes(key), 'decrypt');
  const end = locked.length - MAC;
  const ok = await crypto.subtle.verify('HMAC', hmac, locked.subarray(end) as BufferSource, locked.subarray(0, end) as BufferSource);
  if (!ok) throw new FileChanged('The file was changed');
  if (digest) {
    const mine = new Uint8Array(await crypto.subtle.digest('SHA-256', locked as BufferSource));
    if (fromBytes(mine) !== digest) throw new FileChanged("The file isn't the one that was sent");
  }
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: locked.subarray(0, IV) as BufferSource }, aes, locked.subarray(IV, end) as BufferSource));
  } catch {
    throw new FileChanged('The file was changed');
  }
}

/** How big a file of `plain` bytes is once locked (CBC pads to the next 16 bytes). */
export const lockedSize = (plain: number) => IV + (Math.floor(plain / 16) + 1) * 16 + MAC;
