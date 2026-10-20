// The same SignalApi as the phone's Kotlin module, but using Signal's official
// Node library, so the phase 1 test can run on a computer. Not part of the app.

import * as S from '@signalapp/libsignal-client';

import type { Bundle, Sealed, SignalApi } from '../src/spike/types';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

/** Keeps one device's keys in memory, like InMemorySignalProtocolStore on Android. */
class Store {
  sessions = new Map<string, S.SessionRecord>();
  identities = new Map<string, S.PublicKey>();
  preKeys = new Map<number, S.PreKeyRecord>();
  signedPreKeys = new Map<number, S.SignedPreKeyRecord>();
  kyberPreKeys = new Map<number, S.KyberPreKeyRecord>();
  senderKeys = new Map<string, S.SenderKeyRecord>();

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
      async isTrustedIdentity(a: S.ProtocolAddress, key: S.PublicKey) {
        const old = s.identities.get(a.toString());
        return !old || old.equals(key);
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
      async markKyberPreKeyUsed() {}
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

type Device = { name: string; deviceId: number; store: Store; nextPreKeyId: number; signedPreKey: S.SignedPreKeyRecord };

/** Turns the library's "already seen" error into the same code the Kotlin module uses. */
async function dupesAsCoded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err as { code?: unknown }).code === S.ErrorCode.DuplicatedMessage) {
      throw Object.assign(new Error('This message was already received'), { code: 'ERR_DUPLICATE' });
    }
    throw err;
  }
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
      const signedPreKey = S.SignedPreKeyRecord.new(1, Date.now(), kp.getPublicKey(), kp, identity.privateKey.sign(kp.getPublicKey().serialize()));
      store.signedPreKeys.set(1, signedPreKey);
      const handle = `${name}:${deviceId}`;
      devices.set(handle, { name, deviceId, store, nextPreKeyId: 1, signedPreKey });
      return handle;
    },

    async newBundle(handle): Promise<Bundle> {
      const d = get(handle);
      const id = d.nextPreKeyId++;
      const pre = S.PrivateKey.generate();
      d.store.preKeys.set(id, S.PreKeyRecord.new(id, pre.getPublicKey(), pre));
      const kyber = S.KEMKeyPair.generate();
      const kyberSig = d.store.identity.privateKey.sign(kyber.getPublicKey().serialize());
      d.store.kyberPreKeys.set(id, S.KyberPreKeyRecord.new(id, Date.now(), kyber, kyberSig));
      return {
        registrationId: d.store.registrationId,
        deviceId: d.deviceId,
        preKeyId: id,
        preKey: b64(pre.getPublicKey().serialize()),
        signedPreKeyId: d.signedPreKey.id(),
        signedPreKey: b64(d.signedPreKey.publicKey().serialize()),
        signedPreKeySignature: b64(d.signedPreKey.signature()),
        identityKey: b64(d.store.identity.publicKey.serialize()),
        kyberPreKeyId: id,
        kyberPreKey: b64(kyber.getPublicKey().serialize()),
        kyberPreKeySignature: b64(kyberSig),
      };
    },

    async startSession(handle, theirName, theirDeviceId, b) {
      const d = get(handle);
      const bundle = S.PreKeyBundle.new(
        b.registrationId,
        b.deviceId,
        b.preKeyId,
        S.PublicKey.deserialize(bytes(b.preKey)),
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
      return get(handle).store.sessions.has(addr(theirName, theirDeviceId).toString());
    },

    async encrypt(handle, toName, toDeviceId, text): Promise<Sealed> {
      const d = get(handle);
      const m = await S.signalEncrypt(new Uint8Array(Buffer.from(text, 'utf8')), addr(toName, toDeviceId), local(d), d.store.sessionStore, d.store.identityStore);
      return { type: m.type(), body: b64(m.serialize()) };
    },

    async decrypt(handle, fromName, fromDeviceId, sealed) {
      const d = get(handle);
      const them = addr(fromName, fromDeviceId);
      const s = d.store;
      return dupesAsCoded(async () => {
        const plain =
          sealed.type === S.CiphertextMessageType.PreKey
            ? await S.signalDecryptPreKey(S.PreKeySignalMessage.deserialize(bytes(sealed.body)), them, local(d), s.sessionStore, s.identityStore, s.preKeyStore, s.signedPreKeyStore, s.kyberPreKeyStore)
            : await S.signalDecrypt(S.SignalMessage.deserialize(bytes(sealed.body)), them, local(d), s.sessionStore, s.identityStore);
        return Buffer.from(plain).toString('utf8');
      });
    },

    async createGroupKey(handle, groupId) {
      const d = get(handle);
      const m = await S.SenderKeyDistributionMessage.create(local(d), groupId, d.store.senderKeyStore);
      return b64(m.serialize());
    },

    async acceptGroupKey(handle, fromName, fromDeviceId, groupKey) {
      const m = S.SenderKeyDistributionMessage.deserialize(bytes(groupKey));
      await S.processSenderKeyDistributionMessage(addr(fromName, fromDeviceId), m, get(handle).store.senderKeyStore);
    },

    async groupEncrypt(handle, groupId, text) {
      const d = get(handle);
      const m = await S.groupEncrypt(local(d), groupId, d.store.senderKeyStore, new Uint8Array(Buffer.from(text, 'utf8')));
      return b64(m.serialize());
    },

    async groupDecrypt(handle, fromName, fromDeviceId, body) {
      return dupesAsCoded(async () => {
        const plain = await S.groupDecrypt(addr(fromName, fromDeviceId), get(handle).store.senderKeyStore, bytes(body));
        return Buffer.from(plain).toString('utf8');
      });
    },

    async safetyNumber(handle, theirName, theirDeviceId) {
      const d = get(handle);
      const theirs = d.store.identities.get(addr(theirName, theirDeviceId).toString());
      if (!theirs) throw new Error(`No session with ${theirName} yet`);
      const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
      return S.Fingerprint.new(5200, 2, enc(d.name), d.store.identity.publicKey, enc(theirName), theirs).displayableFingerprint().toString();
    },
  };
}
