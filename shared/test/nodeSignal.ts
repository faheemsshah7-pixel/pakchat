// The SignalApi with Signal's official Node library, so the shared core can be
// tested on a computer. Same Rust code as the phone and the website.
// Keys live in memory: "restarting" means keeping the same nodeSignal().

import * as S from '@signalapp/libsignal-client';

import type { Bundle, DeviceKeys, PreKeys, Sealed, SignalApi } from '../src/signal';
import { SignalError } from '../src/signal';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

// The same ids as the website's module (shared/signal-wasm/src/lib.rs).
const LAST_RESORT_KYBER_ID = 0xffffff;
const SIGNED_PRE_KEY_ID = 1;

/** Keeps one device's keys in memory. */
class Store {
  sessions = new Map<string, S.SessionRecord>();
  identities = new Map<string, S.PublicKey>();
  preKeys = new Map<number, S.PreKeyRecord>();
  signedPreKeys = new Map<number, S.SignedPreKeyRecord>();
  kyberPreKeys = new Map<number, S.KyberPreKeyRecord>();
  senderKeys = new Map<string, S.SenderKeyRecord>();
  /** Opened texts kept by envelope number and sender, like the phone's "opened" table. */
  opened = new Map<string, string>();

  constructor(
    readonly identity: S.IdentityKeyPair,
    readonly registrationId: number,
  ) {}

  sessionStore = ((s) =>
    new (class extends S.SessionStore {
      async saveSession(a: S.ProtocolAddress, r: S.SessionRecord) {
        s.sessions.set(a.toString(), r);
      }
      async getSession(a: S.ProtocolAddress) {
        return s.sessions.get(a.toString()) ?? null;
      }
      async getExistingSessions(list: S.ProtocolAddress[]) {
        return list.map((a) => {
          const r = s.sessions.get(a.toString());
          if (!r) throw new Error(`no session for ${a.toString()}`);
          return r;
        });
      }
    })())(this);

  identityStore = ((s) =>
    new (class extends S.IdentityKeyStore {
      async getIdentityKey() {
        return s.identity.privateKey;
      }
      async getLocalRegistrationId() {
        return s.registrationId;
      }
      async saveIdentity(a: S.ProtocolAddress, key: S.PublicKey) {
        const old = s.identities.get(a.toString());
        s.identities.set(a.toString(), key);
        return old && !old.equals(key) ? S.IdentityChange.ReplacedExisting : S.IdentityChange.NewOrUnchanged;
      }
      // Like WhatsApp: a new key is trusted; the app shows "security code changed".
      async isTrustedIdentity() {
        return true;
      }
      async getIdentity(a: S.ProtocolAddress) {
        return s.identities.get(a.toString()) ?? null;
      }
    })())(this);

  preKeyStore = ((s) =>
    new (class extends S.PreKeyStore {
      async savePreKey(id: number, r: S.PreKeyRecord) {
        s.preKeys.set(id, r);
      }
      async getPreKey(id: number) {
        const r = s.preKeys.get(id);
        if (!r) throw new Error(`no pre-key ${id}`);
        return r;
      }
      async removePreKey(id: number) {
        s.preKeys.delete(id);
      }
    })())(this);

  signedPreKeyStore = ((s) =>
    new (class extends S.SignedPreKeyStore {
      async saveSignedPreKey(id: number, r: S.SignedPreKeyRecord) {
        s.signedPreKeys.set(id, r);
      }
      async getSignedPreKey(id: number) {
        const r = s.signedPreKeys.get(id);
        if (!r) throw new Error(`no signed pre-key ${id}`);
        return r;
      }
    })())(this);

  kyberPreKeyStore = ((s) =>
    new (class extends S.KyberPreKeyStore {
      async saveKyberPreKey(id: number, r: S.KyberPreKeyRecord) {
        s.kyberPreKeys.set(id, r);
      }
      async getKyberPreKey(id: number) {
        const r = s.kyberPreKeys.get(id);
        if (!r) throw new Error(`no kyber pre-key ${id}`);
        return r;
      }
      // One-time Kyber keys are used once. The last resort one stays.
      async markKyberPreKeyUsed(id: number) {
        if (id !== LAST_RESORT_KYBER_ID) s.kyberPreKeys.delete(id);
      }
    })())(this);

  senderKeyStore = ((s) =>
    new (class extends S.SenderKeyStore {
      async saveSenderKey(a: S.ProtocolAddress, id: S.Uuid, r: S.SenderKeyRecord) {
        s.senderKeys.set(`${a.toString()}/${id}`, r);
      }
      async getSenderKey(a: S.ProtocolAddress, id: S.Uuid) {
        return s.senderKeys.get(`${a.toString()}/${id}`) ?? null;
      }
    })())(this);
}

type Device = { name: string; deviceId: number; store: Store; nextPreKeyId: number };

/** Turns the library's errors into the codes in SignalError. */
async function coded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const message = (err as Error).message ?? '';
    const as = (c: string) => Object.assign(new Error(message), { code: c });
    if (code === S.ErrorCode.DuplicatedMessage) throw as(SignalError.duplicate);
    if (/(no|missing) sender key state/i.test(message)) throw as(SignalError.noGroupKey);
    if (/session (with .* )?not found|no session/i.test(message)) throw as(SignalError.noSession);
    throw err;
  }
}

/** Opens with `run`, or gives back the text kept under `keep` (see SignalApi.decrypt). */
async function opening(d: Device, keep: number | undefined, name: string, deviceId: number, run: () => Promise<string>) {
  const key = keep == null ? null : `${keep}/${name}.${deviceId}`;
  const kept = key ? d.store.opened.get(key) : undefined;
  if (kept !== undefined) return kept;
  const text = await coded(run);
  if (key) d.store.opened.set(key, text);
  return text;
}

export function nodeSignal(): SignalApi {
  const devices = new Map<string, Device>();
  const get = (h: string) => {
    const d = devices.get(h);
    if (!d) throw new Error(`No device called ${h}`);
    return d;
  };
  const addr = (name: string, id: number) => S.ProtocolAddress.new(name, id);
  const local = (d: Device) => addr(d.name, d.deviceId);

  return {
    async createDevice(name, deviceId) {
      const identity = S.IdentityKeyPair.generate();
      const store = new Store(identity, Math.floor(Math.random() * 16380) + 1);
      const kp = S.PrivateKey.generate();
      store.signedPreKeys.set(
        SIGNED_PRE_KEY_ID,
        S.SignedPreKeyRecord.new(SIGNED_PRE_KEY_ID, Date.now(), kp.getPublicKey(), kp, identity.privateKey.sign(kp.getPublicKey().serialize())),
      );
      const kyber = S.KEMKeyPair.generate();
      store.kyberPreKeys.set(
        LAST_RESORT_KYBER_ID,
        S.KyberPreKeyRecord.new(LAST_RESORT_KYBER_ID, Date.now(), kyber, identity.privateKey.sign(kyber.getPublicKey().serialize())),
      );
      const handle = `${name}:${deviceId}`;
      devices.set(handle, { name, deviceId, store, nextPreKeyId: 1 });
      return handle;
    },

    async openDevice(name, deviceId) {
      const handle = `${name}:${deviceId}`;
      return devices.has(handle) ? handle : null;
    },

    async setAddress(handle, name, deviceId) {
      const d = get(handle);
      devices.delete(handle);
      d.name = name;
      d.deviceId = deviceId;
      const next = `${name}:${deviceId}`;
      devices.set(next, d);
      return next;
    },

    async deviceKeys(handle): Promise<DeviceKeys> {
      const s = get(handle).store;
      const signed = s.signedPreKeys.get(SIGNED_PRE_KEY_ID)!;
      const kyber = s.kyberPreKeys.get(LAST_RESORT_KYBER_ID)!;
      return {
        registrationId: s.registrationId,
        identityKey: b64(s.identity.publicKey.serialize()),
        signedPreKey: { keyId: SIGNED_PRE_KEY_ID, publicKey: b64(signed.publicKey().serialize()), signature: b64(signed.signature()) },
        kyberLastResort: { keyId: LAST_RESORT_KYBER_ID, publicKey: b64(kyber.publicKey().serialize()), signature: b64(kyber.signature()) },
      };
    },

    async newPreKeys(handle, count): Promise<PreKeys> {
      const d = get(handle);
      const out: PreKeys = { preKeys: [], kyberPreKeys: [] };
      for (let i = 0; i < count; i++) {
        const id = d.nextPreKeyId;
        d.nextPreKeyId = id + 1 >= LAST_RESORT_KYBER_ID ? 1 : id + 1;
        const pre = S.PrivateKey.generate();
        d.store.preKeys.set(id, S.PreKeyRecord.new(id, pre.getPublicKey(), pre));
        out.preKeys.push({ keyId: id, publicKey: b64(pre.getPublicKey().serialize()) });
        const kyber = S.KEMKeyPair.generate();
        const sig = d.store.identity.privateKey.sign(kyber.getPublicKey().serialize());
        d.store.kyberPreKeys.set(id, S.KyberPreKeyRecord.new(id, Date.now(), kyber, sig));
        out.kyberPreKeys.push({ keyId: id, publicKey: b64(kyber.getPublicKey().serialize()), signature: b64(sig) });
      }
      return out;
    },

    async startSession(handle, theirName, theirDeviceId, b: Bundle) {
      const d = get(handle);
      const hasPre = b.preKeyId !== null && b.preKey !== null;
      const bundle = S.PreKeyBundle.new(
        b.registrationId,
        b.deviceId,
        hasPre ? b.preKeyId : null,
        hasPre ? S.PublicKey.deserialize(bytes(b.preKey!)) : null,
        b.signedPreKeyId,
        S.PublicKey.deserialize(bytes(b.signedPreKey)),
        bytes(b.signedPreKeySignature),
        S.PublicKey.deserialize(bytes(b.identityKey)),
        b.kyberPreKeyId,
        S.KEMPublicKey.deserialize(bytes(b.kyberPreKey)),
        bytes(b.kyberPreKeySignature),
      );
      await S.processPreKeyBundle(bundle, addr(theirName, theirDeviceId), local(d), d.store.sessionStore, d.store.identityStore);
    },

    async hasSession(handle, theirName, theirDeviceId) {
      const r = get(handle).store.sessions.get(addr(theirName, theirDeviceId).toString());
      return !!r && r.hasCurrentState();
    },

    async deleteSession(handle, theirName, theirDeviceId) {
      get(handle).store.sessions.delete(addr(theirName, theirDeviceId).toString());
    },

    async identityKey(handle, theirName, theirDeviceId) {
      const k = get(handle).store.identities.get(addr(theirName, theirDeviceId).toString());
      return k ? b64(k.serialize()) : null;
    },

    async encrypt(handle, toName, toDeviceId, text): Promise<Sealed> {
      const d = get(handle);
      return coded(async () => {
        const m = await S.signalEncrypt(utf8(text), addr(toName, toDeviceId), local(d), d.store.sessionStore, d.store.identityStore);
        return { type: m.type(), body: b64(m.serialize()) };
      });
    },

    async decrypt(handle, fromName, fromDeviceId, sealed, keep) {
      const d = get(handle);
      const them = addr(fromName, fromDeviceId);
      const s = d.store;
      return opening(d, keep, fromName, fromDeviceId, async () => {
        const plain =
          sealed.type === S.CiphertextMessageType.PreKey
            ? await S.signalDecryptPreKey(S.PreKeySignalMessage.deserialize(bytes(sealed.body)), them, local(d), s.sessionStore, s.identityStore, s.preKeyStore, s.signedPreKeyStore, s.kyberPreKeyStore)
            : await S.signalDecrypt(S.SignalMessage.deserialize(bytes(sealed.body)), them, local(d), s.sessionStore, s.identityStore);
        return Buffer.from(plain).toString('utf8');
      });
    },

    async createGroupKey(handle, distributionId) {
      const d = get(handle);
      const m = await S.SenderKeyDistributionMessage.create(local(d), distributionId, d.store.senderKeyStore);
      return b64(m.serialize());
    },

    async acceptGroupKey(handle, fromName, fromDeviceId, groupKey) {
      const m = S.SenderKeyDistributionMessage.deserialize(bytes(groupKey));
      await S.processSenderKeyDistributionMessage(addr(fromName, fromDeviceId), m, get(handle).store.senderKeyStore);
    },

    async groupEncrypt(handle, distributionId, text) {
      const d = get(handle);
      return coded(async () => {
        const m = await S.groupEncrypt(local(d), distributionId, d.store.senderKeyStore, utf8(text));
        return b64(m.serialize());
      });
    },

    async forgetOpened(handle, keeps) {
      const { opened } = get(handle).store;
      for (const key of [...opened.keys()]) if (keeps.includes(Number(key.split('/')[0]))) opened.delete(key);
    },

    async groupDecrypt(handle, fromName, fromDeviceId, body, keep) {
      return opening(get(handle), keep, fromName, fromDeviceId, async () => {
        const plain = await S.groupDecrypt(addr(fromName, fromDeviceId), get(handle).store.senderKeyStore, bytes(body));
        return Buffer.from(plain).toString('utf8');
      });
    },

    async safetyNumber(handle, theirName, theirDeviceId) {
      const d = get(handle);
      const theirs = d.store.identities.get(addr(theirName, theirDeviceId).toString());
      if (!theirs) throw Object.assign(new Error(`No session with ${theirName} yet`), { code: SignalError.noSession });
      return S.Fingerprint.new(5200, 2, utf8(d.name), d.store.identity.publicKey, utf8(theirName), theirs).displayableFingerprint().toString();
    },
  };
}
