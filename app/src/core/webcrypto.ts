// webcrypto.ts: the one piece of the browser's crypto.subtle the shared code
// needs on the phone. Scanning the website's QR checks the phone's key with a
// SHA-256 digest (shared/src/link.ts, identityCheck), and Hermes has no
// crypto.subtle, so the scan failed with "Couldn't do that". expo-crypto
// does the digest natively instead.
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';

type Subtle = { digest: (algorithm: string | { name: string }, data: BufferSource) => Promise<ArrayBuffer> };
const g = globalThis as unknown as { crypto?: { subtle?: Partial<Subtle> } };

const sha256: Subtle['digest'] = (algorithm, data) => {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
  if (name.toUpperCase() !== 'SHA-256') return Promise.reject(new Error(`Only SHA-256 is here, not ${name}`));
  return digest(CryptoDigestAlgorithm.SHA256, data);
};

if (typeof g.crypto?.subtle?.digest !== 'function') {
  const subtle = { ...g.crypto?.subtle, digest: sha256 };
  try {
    g.crypto ??= {};
    g.crypto.subtle = subtle;
  } catch {
    // A read-only crypto (or subtle): put ours in its place.
    Object.defineProperty(globalThis, 'crypto', { value: { ...g.crypto, subtle }, configurable: true, writable: true });
  }
}
