// The shapes that cross between the shared core and Signal's library.
// Bytes travel as base64 text. Secret keys never leave the library.
//
// There are three ways to run the library, all the same Rust code inside:
//   - the phone: Kotlin around libsignal (app/modules/pakchat-signal)
//   - the website: libsignal built as WebAssembly (src/web/wasmSignal.ts)
//   - the computer tests: Signal's Node library (test/nodeSignal.ts)

/** A public key signed with the device's identity key, so others can trust it. */
export type SignedKey = { keyId: number; publicKey: string; signature: string };

/** A one-time key, used once by one person to start a chat, then thrown away. */
export type OneTimeKey = { keyId: number; publicKey: string };

/** The public keys a device gives the server when it signs in. */
export type DeviceKeys = {
  registrationId: number;
  identityKey: string;
  signedPreKey: SignedKey;
  /** Handed out when the one-time Kyber keys run out. */
  kyberLastResort: SignedKey;
};

/** A batch of one-time keys of both kinds, to put on the server. */
export type PreKeys = { preKeys: OneTimeKey[]; kyberPreKeys: SignedKey[] };

/** Everything needed to start a locked chat with one device, from the server. */
export type Bundle = {
  registrationId: number;
  deviceId: number;
  /** Missing when that device's one-time keys have run out. It still works. */
  preKeyId: number | null;
  preKey: string | null;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  identityKey: string;
  kyberPreKeyId: number;
  kyberPreKey: string;
  kyberPreKeySignature: string;
};

/** A locked message for one device. Type 3 also starts a session; type 2 is a normal one. */
export type Sealed = { type: number; body: string };

/** Signal's message types, as the server knows them. */
export const SEALED = { normal: 2, first: 3, group: 7, plain: 8 } as const;

/** The error codes every SignalApi uses, so the core can react the same way everywhere. */
export const SignalError = {
  /** This message was already opened once. Safe to skip. */
  duplicate: 'ERR_DUPLICATE',
  /** No session with that device (for example, it was reinstalled). */
  noSession: 'ERR_NO_SESSION',
  /** No group key from that device yet. */
  noGroupKey: 'ERR_NO_GROUP_KEY',
} as const;

export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * What our Signal module can do. `handle` names one device on this phone or
 * browser, like "<user id>:1". `name` is always a person's user id.
 *
 * Every implementation must:
 *   - keep keys and sessions safe across restarts (only `openDevice` finds them again),
 *   - trust a new identity key for someone (like WhatsApp), so `identityKey`
 *     can be compared before and after to show "security code changed",
 *   - throw errors with the codes in `SignalError`.
 */
export interface SignalApi {
  createDevice(name: string, deviceId: number): Promise<string>;
  /** The handle of a device made earlier on this phone, or null. */
  openDevice(name: string, deviceId: number): Promise<string | null>;
  /**
   * Gives a device its real address (user id and device number) once the
   * server has said who we are. Keys are made before signing in, so a device
   * starts with a temporary name. Returns the new handle.
   */
  setAddress(handle: string, name: string, deviceId: number): Promise<string>;
  deviceKeys(handle: string): Promise<DeviceKeys>;
  newPreKeys(handle: string, count: number): Promise<PreKeys>;
  startSession(handle: string, theirName: string, theirDeviceId: number, bundle: Bundle): Promise<void>;
  hasSession(handle: string, theirName: string, theirDeviceId: number): Promise<boolean>;
  deleteSession(handle: string, theirName: string, theirDeviceId: number): Promise<void>;
  /** Their identity key as last seen (base64), or null if we never talked. */
  identityKey(handle: string, theirName: string, theirDeviceId: number): Promise<string | null>;
  encrypt(handle: string, toName: string, toDeviceId: number, text: string): Promise<Sealed>;
  decrypt(handle: string, fromName: string, fromDeviceId: number, sealed: Sealed): Promise<string>;
  /** This device's group key for one group (made the first time). `distributionId` is a UUID. */
  createGroupKey(handle: string, distributionId: string): Promise<string>;
  acceptGroupKey(handle: string, fromName: string, fromDeviceId: number, groupKey: string): Promise<void>;
  groupEncrypt(handle: string, distributionId: string, text: string): Promise<string>;
  groupDecrypt(handle: string, fromName: string, fromDeviceId: number, body: string): Promise<string>;
  safetyNumber(handle: string, theirName: string, theirDeviceId: number): Promise<string>;
}
