// The shapes that cross between JavaScript and the Signal library.
// Bytes travel as base64 text. Secret keys never leave the library.

/** The public keys a device puts on the server, so others can start a chat with it. */
export type Bundle = {
  registrationId: number;
  deviceId: number;
  preKeyId: number;
  preKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  identityKey: string;
  kyberPreKeyId: number;
  kyberPreKey: string;
  kyberPreKeySignature: string;
};

/** An encrypted 1-to-1 message. Type 3 also starts a session; type 2 is a normal one. */
export type Sealed = { type: number; body: string };

/**
 * What our Signal module can do. On the phone it's Kotlin around Signal's
 * library (modules/pakchat-signal). In the computer tests it's Signal's Node
 * library (spike-check/nodeSignal.ts). Both are the same Rust code inside.
 *
 * `handle` names one device, like "Ali:1".
 */
export interface SignalApi {
  createDevice(name: string, deviceId: number): Promise<string>;
  newBundle(handle: string): Promise<Bundle>;
  startSession(handle: string, theirName: string, theirDeviceId: number, bundle: Bundle): Promise<void>;
  hasSession(handle: string, theirName: string, theirDeviceId: number): Promise<boolean>;
  encrypt(handle: string, toName: string, toDeviceId: number, text: string): Promise<Sealed>;
  /** Throws an error with code "ERR_DUPLICATE" if this message was already read. */
  decrypt(handle: string, fromName: string, fromDeviceId: number, sealed: Sealed): Promise<string>;
  createGroupKey(handle: string, groupId: string): Promise<string>;
  acceptGroupKey(handle: string, fromName: string, fromDeviceId: number, groupKey: string): Promise<void>;
  groupEncrypt(handle: string, groupId: string, text: string): Promise<string>;
  /** Throws an error with code "ERR_DUPLICATE" if this message was already read. */
  groupDecrypt(handle: string, fromName: string, fromDeviceId: number, body: string): Promise<string>;
  safetyNumber(handle: string, theirName: string, theirDeviceId: number): Promise<string>;
}
