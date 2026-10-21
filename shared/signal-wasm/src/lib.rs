//! PakChat's Signal device for web browsers.
//!
//! This is a thin wrapper: every bit of real cryptography is done by Signal's
//! own library (libsignal). We only keep one device's keys in memory, and let
//! JavaScript save them (`export_state`) and load them again (`restore`).
//!
//! It does the same jobs as the phone's Kotlin module, so the shared core
//! (`shared/src`) can use either one through its `SignalApi`.
//!
//! Bytes travel as base64 text, like everywhere else in PakChat. Errors come
//! back as text starting with a code, like "ERR_DUPLICATE: ...".

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

use futures_util::FutureExt;
use libsignal_protocol::*;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

type Result<T, E = SignalProtocolError> = std::result::Result<T, E>;

// The id of the "last resort" Kyber key: the one handed out when the
// one-time Kyber keys run out. It is the biggest id Signal allows, so it
// never clashes with the one-time keys, which count up from 1.
const LAST_RESORT_KYBER_ID: u32 = 0xFF_FFFF;
const SIGNED_PRE_KEY_ID: u32 = 1;

/// Browsers have no clock inside WebAssembly, so JavaScript passes the time in.
fn at(now_ms: f64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_millis(now_ms as u64)
}

fn rng() -> impl rand::CryptoRng {
    rand::rngs::OsRng.unwrap_err()
}

fn b64(bytes: &[u8]) -> String {
    base64_encode(bytes)
}

// A small base64 encoder and decoder, so we need no extra library.
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn base64_decode(text: &str) -> Result<Vec<u8>, JsError> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut acc = 0u32;
    let mut bits = 0;
    for c in text.bytes() {
        if c == b'=' {
            break;
        }
        let v = B64
            .iter()
            .position(|&x| x == c)
            .ok_or_else(|| coded("ERR_BAD_INPUT", "not base64"))? as u32;
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

fn coded(code: &str, message: impl std::fmt::Display) -> JsError {
    JsError::new(&format!("{code}: {message}"))
}

/// Turns the library's errors into PakChat's codes (the same ones the
/// phone's module and the Node tests use).
fn err(e: impl Into<SignalProtocolError>) -> JsError {
    let e: SignalProtocolError = e.into();
    let code = match &e {
        SignalProtocolError::DuplicatedMessage(..) => "ERR_DUPLICATE",
        SignalProtocolError::NoSenderKeyState { .. } => "ERR_NO_GROUP_KEY",
        SignalProtocolError::SessionNotFound(..) => "ERR_NO_SESSION",
        _ => "ERR_SIGNAL",
    };
    coded(code, e)
}

fn bad(e: impl std::fmt::Display) -> JsError {
    coded("ERR_BAD_INPUT", e)
}

/// Runs one of the library's steps. They are written as "async" so they can
/// wait for a database, but ours is in memory, so they finish at once.
fn now<T>(f: impl std::future::Future<Output = T>) -> T {
    f.now_or_never().expect("in-memory steps never wait")
}

fn address(name: &str, device_id: u32) -> Result<ProtocolAddress, JsError> {
    let id = DeviceId::try_from(device_id).map_err(bad)?;
    Ok(ProtocolAddress::new(name.to_owned(), id))
}

/// Everything one device knows, as plain text, so JavaScript can save it.
/// Each part is its own small store, because the library asks for several
/// of them at once.
#[derive(Serialize, Deserialize, Default)]
struct Store {
    name: String,
    device_id: u32,
    next_pre_key_id: u32,
    identity: Identities,
    sessions: Sessions,
    pre_keys: PreKeys,
    signed_pre_keys: SignedPreKeys,
    kyber_pre_keys: KyberPreKeys,
    sender_keys: SenderKeys,
}

#[derive(Serialize, Deserialize, Default)]
struct Identities {
    registration_id: u32,
    /// Our identity key pair (secret!). Never leaves the device.
    own: String,
    /// Everyone else's public identity keys, as we first saw them.
    known: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(transparent)]
struct Sessions(BTreeMap<String, String>);
#[derive(Serialize, Deserialize, Default)]
#[serde(transparent)]
struct PreKeys(BTreeMap<u32, String>);
#[derive(Serialize, Deserialize, Default)]
#[serde(transparent)]
struct SignedPreKeys(BTreeMap<u32, String>);
#[derive(Serialize, Deserialize, Default)]
#[serde(transparent)]
struct KyberPreKeys(BTreeMap<u32, String>);
#[derive(Serialize, Deserialize, Default)]
#[serde(transparent)]
struct SenderKeys(BTreeMap<String, String>);

fn hex_bytes(text: &str) -> Result<Vec<u8>> {
    hex::decode(text).map_err(|_| SignalProtocolError::InvalidState("store", "bad hex".into()))
}

fn missing(what: &'static str) -> SignalProtocolError {
    SignalProtocolError::InvalidState(what, "not found".into())
}

impl Identities {
    fn pair(&self) -> Result<IdentityKeyPair> {
        IdentityKeyPair::try_from(&hex_bytes(&self.own)?[..])
    }
}

#[async_trait::async_trait(?Send)]
impl IdentityKeyStore for Identities {
    async fn get_identity_key_pair(&self) -> Result<IdentityKeyPair> {
        self.pair()
    }
    async fn get_local_registration_id(&self) -> Result<u32> {
        Ok(self.registration_id)
    }
    async fn save_identity(
        &mut self,
        address: &ProtocolAddress,
        identity: &IdentityKey,
    ) -> Result<IdentityChange> {
        let new = hex::encode(identity.serialize());
        let old = self.known.insert(address.to_string(), new.clone());
        Ok(match old {
            Some(old) if old != new => IdentityChange::ReplacedExisting,
            _ => IdentityChange::NewOrUnchanged,
        })
    }
    // Like WhatsApp: a new key is trusted, and the app shows "security code
    // changed" so people can check it if they want to.
    async fn is_trusted_identity(
        &self,
        _address: &ProtocolAddress,
        _identity: &IdentityKey,
        _direction: Direction,
    ) -> Result<bool> {
        Ok(true)
    }
    async fn get_identity(&self, address: &ProtocolAddress) -> Result<Option<IdentityKey>> {
        match self.known.get(&address.to_string()) {
            Some(h) => Ok(Some(IdentityKey::decode(&hex_bytes(h)?)?)),
            None => Ok(None),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl SessionStore for Sessions {
    async fn load_session(&self, address: &ProtocolAddress) -> Result<Option<SessionRecord>> {
        match self.0.get(&address.to_string()) {
            Some(h) => Ok(Some(SessionRecord::deserialize(&hex_bytes(h)?)?)),
            None => Ok(None),
        }
    }
    async fn store_session(
        &mut self,
        address: &ProtocolAddress,
        record: &SessionRecord,
    ) -> Result<()> {
        self.0
            .insert(address.to_string(), hex::encode(record.serialize()?));
        Ok(())
    }
}

#[async_trait::async_trait(?Send)]
impl PreKeyStore for PreKeys {
    async fn get_pre_key(&self, id: PreKeyId) -> Result<PreKeyRecord> {
        let h = self.0.get(&id.into()).ok_or(missing("pre key"))?;
        PreKeyRecord::deserialize(&hex_bytes(h)?)
    }
    async fn save_pre_key(&mut self, id: PreKeyId, record: &PreKeyRecord) -> Result<()> {
        self.0.insert(id.into(), hex::encode(record.serialize()?));
        Ok(())
    }
    async fn remove_pre_key(&mut self, id: PreKeyId) -> Result<()> {
        self.0.remove(&id.into());
        Ok(())
    }
}

#[async_trait::async_trait(?Send)]
impl SignedPreKeyStore for SignedPreKeys {
    async fn get_signed_pre_key(&self, id: SignedPreKeyId) -> Result<SignedPreKeyRecord> {
        let h = self.0.get(&id.into()).ok_or(missing("signed pre key"))?;
        SignedPreKeyRecord::deserialize(&hex_bytes(h)?)
    }
    async fn save_signed_pre_key(
        &mut self,
        id: SignedPreKeyId,
        record: &SignedPreKeyRecord,
    ) -> Result<()> {
        self.0.insert(id.into(), hex::encode(record.serialize()?));
        Ok(())
    }
}

#[async_trait::async_trait(?Send)]
impl KyberPreKeyStore for KyberPreKeys {
    async fn get_kyber_pre_key(&self, id: KyberPreKeyId) -> Result<KyberPreKeyRecord> {
        let h = self.0.get(&id.into()).ok_or(missing("kyber pre key"))?;
        KyberPreKeyRecord::deserialize(&hex_bytes(h)?)
    }
    async fn save_kyber_pre_key(
        &mut self,
        id: KyberPreKeyId,
        record: &KyberPreKeyRecord,
    ) -> Result<()> {
        self.0.insert(id.into(), hex::encode(record.serialize()?));
        Ok(())
    }
    // One-time Kyber keys are used once and deleted. The last resort one stays.
    async fn mark_kyber_pre_key_used(
        &mut self,
        id: KyberPreKeyId,
        _ec_prekey_id: SignedPreKeyId,
        _base_key: &PublicKey,
    ) -> Result<()> {
        let id: u32 = id.into();
        if id != LAST_RESORT_KYBER_ID {
            self.0.remove(&id);
        }
        Ok(())
    }
}

#[async_trait::async_trait(?Send)]
impl SenderKeyStore for SenderKeys {
    async fn store_sender_key(
        &mut self,
        sender: &ProtocolAddress,
        distribution_id: uuid::Uuid,
        record: &SenderKeyRecord,
    ) -> Result<()> {
        self.0.insert(
            format!("{sender}/{distribution_id}"),
            hex::encode(record.serialize()?),
        );
        Ok(())
    }
    async fn load_sender_key(
        &mut self,
        sender: &ProtocolAddress,
        distribution_id: uuid::Uuid,
    ) -> Result<Option<SenderKeyRecord>> {
        match self.0.get(&format!("{sender}/{distribution_id}")) {
            Some(h) => Ok(Some(SenderKeyRecord::deserialize(&hex_bytes(h)?)?)),
            None => Ok(None),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedKey {
    key_id: u32,
    public_key: String,
    signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OneTimeKey {
    key_id: u32,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceKeys {
    registration_id: u32,
    identity_key: String,
    signed_pre_key: SignedKey,
    kyber_last_resort: SignedKey,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NewPreKeys {
    pre_keys: Vec<OneTimeKey>,
    kyber_pre_keys: Vec<SignedKey>,
}

/// Another device's public keys, as the shared core passes them in.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    registration_id: u32,
    device_id: u32,
    pre_key_id: Option<u32>,
    pre_key: Option<String>,
    signed_pre_key_id: u32,
    signed_pre_key: String,
    signed_pre_key_signature: String,
    identity_key: String,
    kyber_pre_key_id: u32,
    kyber_pre_key: String,
    kyber_pre_key_signature: String,
}

#[derive(Serialize)]
struct Sealed {
    r#type: u8,
    body: String,
}

/// One PakChat device: its keys and its sessions with other devices.
#[wasm_bindgen]
pub struct SignalDevice {
    store: Store,
}

#[wasm_bindgen]
impl SignalDevice {
    /// Makes a brand new device: an identity key, a signed pre-key and a
    /// last resort Kyber key.
    pub fn create(name: &str, device_id: u32, now_ms: f64) -> Result<SignalDevice, JsError> {
        address(name, device_id)?;
        let mut rng = rng();
        let identity = IdentityKeyPair::generate(&mut rng);
        let mut store = Store {
            name: name.to_owned(),
            device_id,
            next_pre_key_id: 1,
            identity: Identities {
                // Signal's registration ids are 14 bits, never 0.
                registration_id: (rand::Rng::random::<u32>(&mut rng) % 16380) + 1,
                own: hex::encode(identity.serialize()),
                known: BTreeMap::new(),
            },
            ..Default::default()
        };
        let time = Timestamp::from_epoch_millis(now_ms as u64);

        let pair = KeyPair::generate(&mut rng);
        let sig = identity
            .private_key()
            .calculate_signature(&pair.public_key.serialize(), &mut rng)
            .map_err(err)?;
        let signed = SignedPreKeyRecord::new(SIGNED_PRE_KEY_ID.into(), time, &pair, &sig);
        now(store.signed_pre_keys.save_signed_pre_key(SIGNED_PRE_KEY_ID.into(), &signed)).map_err(err)?;

        let kyber = kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut rng);
        let sig = identity
            .private_key()
            .calculate_signature(&kyber.public_key.serialize(), &mut rng)
            .map_err(err)?;
        let last = KyberPreKeyRecord::new(LAST_RESORT_KYBER_ID.into(), time, &kyber, &sig);
        now(store.kyber_pre_keys.save_kyber_pre_key(LAST_RESORT_KYBER_ID.into(), &last)).map_err(err)?;

        Ok(SignalDevice { store })
    }

    /// Loads a device saved earlier with `export_state`.
    pub fn restore(state: &str) -> Result<SignalDevice, JsError> {
        let store: Store = serde_json::from_str(state).map_err(bad)?;
        Ok(SignalDevice { store })
    }

    /// Everything this device knows, including its secret keys, as text.
    /// Save it somewhere only this browser can read (IndexedDB).
    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> String {
        serde_json::to_string(&self.store).expect("always serializable")
    }

    /// Gives this device its address once the server has said who we are:
    /// our user id and device number. Keys are made before signing in, so the
    /// device starts with a temporary one. Do this before any chat starts,
    /// because both sides check the addresses.
    #[wasm_bindgen(js_name = setAddress)]
    pub fn set_address(&mut self, name: &str, device_id: u32) -> Result<(), JsError> {
        address(name, device_id)?;
        self.store.name = name.to_owned();
        self.store.device_id = device_id;
        Ok(())
    }

    /// The public keys the server needs when this device signs in.
    #[wasm_bindgen(js_name = deviceKeys)]
    pub fn device_keys(&self) -> Result<String, JsError> {
        let s = &self.store;
        let identity = s.identity.pair().map_err(err)?;
        let signed = now(s.signed_pre_keys.get_signed_pre_key(SIGNED_PRE_KEY_ID.into())).map_err(err)?;
        let kyber = now(s.kyber_pre_keys.get_kyber_pre_key(LAST_RESORT_KYBER_ID.into())).map_err(err)?;
        let keys = DeviceKeys {
            registration_id: s.identity.registration_id,
            identity_key: b64(&identity.identity_key().serialize()),
            signed_pre_key: SignedKey {
                key_id: SIGNED_PRE_KEY_ID,
                public_key: b64(&signed.public_key().map_err(err)?.serialize()),
                signature: b64(&signed.signature().map_err(err)?),
            },
            kyber_last_resort: SignedKey {
                key_id: LAST_RESORT_KYBER_ID,
                public_key: b64(&kyber.public_key().map_err(err)?.serialize()),
                signature: b64(&kyber.signature().map_err(err)?),
            },
        };
        Ok(serde_json::to_string(&keys).expect("always serializable"))
    }

    /// Makes `count` new one-time keys of each kind. The secret halves stay
    /// here; the public halves go to the server.
    #[wasm_bindgen(js_name = newPreKeys)]
    pub fn new_pre_keys(&mut self, count: u32, now_ms: f64) -> Result<String, JsError> {
        let mut rng = rng();
        let time = Timestamp::from_epoch_millis(now_ms as u64);
        let identity = self.store.identity.pair().map_err(err)?;
        let mut out = NewPreKeys {
            pre_keys: vec![],
            kyber_pre_keys: vec![],
        };
        for _ in 0..count {
            let id = self.store.next_pre_key_id;
            // Ids go up to just below the last resort one, then start again.
            self.store.next_pre_key_id = if id + 1 >= LAST_RESORT_KYBER_ID { 1 } else { id + 1 };

            let pair = KeyPair::generate(&mut rng);
            let record = PreKeyRecord::new(id.into(), &pair);
            now(self.store.pre_keys.save_pre_key(id.into(), &record)).map_err(err)?;
            out.pre_keys.push(OneTimeKey {
                key_id: id,
                public_key: b64(&pair.public_key.serialize()),
            });

            let kyber = kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut rng);
            let sig = identity
                .private_key()
                .calculate_signature(&kyber.public_key.serialize(), &mut rng)
                .map_err(err)?;
            let record = KyberPreKeyRecord::new(id.into(), time, &kyber, &sig);
            now(self.store.kyber_pre_keys.save_kyber_pre_key(id.into(), &record)).map_err(err)?;
            out.kyber_pre_keys.push(SignedKey {
                key_id: id,
                public_key: b64(&kyber.public_key.serialize()),
                signature: b64(&sig),
            });
        }
        Ok(serde_json::to_string(&out).expect("always serializable"))
    }

    /// Starts a locked session with another device, from its public keys.
    #[wasm_bindgen(js_name = startSession)]
    pub fn start_session(
        &mut self,
        their_name: &str,
        their_device_id: u32,
        bundle: &str,
        now_ms: f64,
    ) -> Result<(), JsError> {
        let b: Bundle = serde_json::from_str(bundle).map_err(bad)?;
        let pre_key = match (b.pre_key_id, b.pre_key) {
            (Some(id), Some(key)) => Some((
                id.into(),
                PublicKey::deserialize(&base64_decode(&key)?).map_err(err)?,
            )),
            _ => None,
        };
        let bundle = PreKeyBundle::new(
            b.registration_id,
            DeviceId::try_from(b.device_id).map_err(bad)?,
            pre_key,
            b.signed_pre_key_id.into(),
            PublicKey::deserialize(&base64_decode(&b.signed_pre_key)?).map_err(err)?,
            base64_decode(&b.signed_pre_key_signature)?,
            b.kyber_pre_key_id.into(),
            kem::PublicKey::deserialize(&base64_decode(&b.kyber_pre_key)?).map_err(err)?,
            base64_decode(&b.kyber_pre_key_signature)?,
            IdentityKey::decode(&base64_decode(&b.identity_key)?).map_err(err)?,
        )
        .map_err(err)?;
        let them = address(their_name, their_device_id)?;
        let me = self.local()?;
        let s = &mut self.store;
        now(process_prekey_bundle(
            &them,
            &me,
            &mut s.sessions,
            &mut s.identity,
            &bundle,
            at(now_ms),
            &mut rng(),
        ))
        .map_err(err)
    }

    #[wasm_bindgen(js_name = hasSession)]
    pub fn has_session(&self, their_name: &str, their_device_id: u32, now_ms: f64) -> Result<bool, JsError> {
        let them = address(their_name, their_device_id)?;
        // The same check as Signal's own apps: a session that isn't too old
        // and was made with the post-quantum (Kyber) keys.
        Ok(match now(self.store.sessions.load_session(&them)).map_err(err)? {
            Some(record) => record
                .has_usable_sender_chain(
                    at(now_ms),
                    SessionUsabilityRequirements::NotStale
                        | SessionUsabilityRequirements::EstablishedWithPqxdh
                        | SessionUsabilityRequirements::Spqr,
                )
                .map_err(err)?,
            None => false,
        })
    }

    /// Forgets the session with a device (it was removed, or reinstalled).
    #[wasm_bindgen(js_name = deleteSession)]
    pub fn delete_session(&mut self, their_name: &str, their_device_id: u32) -> Result<(), JsError> {
        let them = address(their_name, their_device_id)?;
        self.store.sessions.0.remove(&them.to_string());
        Ok(())
    }

    /// Their identity key as we last saw it (base64), or nothing.
    #[wasm_bindgen(js_name = identityKey)]
    pub fn identity_key(&self, their_name: &str, their_device_id: u32) -> Result<Option<String>, JsError> {
        let them = address(their_name, their_device_id)?;
        Ok(now(self.store.identity.get_identity(&them))
            .map_err(err)?
            .map(|k| b64(&k.serialize())))
    }

    /// Locks a message for one device. Gives `{"type": 2 or 3, "body": base64}`.
    pub fn encrypt(
        &mut self,
        to_name: &str,
        to_device_id: u32,
        text: &str,
        now_ms: f64,
    ) -> Result<String, JsError> {
        let them = address(to_name, to_device_id)?;
        let me = self.local()?;
        let s = &mut self.store;
        let m = now(message_encrypt(
            text.as_bytes(),
            &them,
            &me,
            &mut s.sessions,
            &mut s.identity,
            at(now_ms),
            &mut rng(),
        ))
        .map_err(err)?;
        let sealed = Sealed {
            r#type: m.message_type() as u8,
            body: b64(m.serialize()),
        };
        Ok(serde_json::to_string(&sealed).expect("always serializable"))
    }

    /// Opens a message from one device.
    pub fn decrypt(
        &mut self,
        from_name: &str,
        from_device_id: u32,
        kind: u8,
        body: &str,
    ) -> Result<String, JsError> {
        let them = address(from_name, from_device_id)?;
        let me = self.local()?;
        let bytes = base64_decode(body)?;
        let message = match kind {
            3 => CiphertextMessage::PreKeySignalMessage(
                PreKeySignalMessage::try_from(&bytes[..]).map_err(err)?,
            ),
            2 => CiphertextMessage::SignalMessage(SignalMessage::try_from(&bytes[..]).map_err(err)?),
            _ => return Err(bad("unknown message type")),
        };
        let s = &mut self.store;
        let plain = now(message_decrypt(
            &message,
            &them,
            &me,
            &mut s.sessions,
            &mut s.identity,
            &mut s.pre_keys,
            &s.signed_pre_keys,
            &mut s.kyber_pre_keys,
            &mut rng(),
        ))
        .map_err(err)?;
        String::from_utf8(plain).map_err(bad)
    }

    /// This device's group key for one group (made the first time). Send it,
    /// locked, to each device in the group.
    #[wasm_bindgen(js_name = createGroupKey)]
    pub fn create_group_key(&mut self, distribution_id: &str) -> Result<String, JsError> {
        let id = uuid::Uuid::parse_str(distribution_id).map_err(bad)?;
        let me = self.local()?;
        let m = now(create_sender_key_distribution_message(
            &me,
            id,
            &mut self.store.sender_keys,
            &mut rng(),
        ))
        .map_err(err)?;
        Ok(b64(m.serialized()))
    }

    /// Saves another device's group key.
    #[wasm_bindgen(js_name = acceptGroupKey)]
    pub fn accept_group_key(
        &mut self,
        from_name: &str,
        from_device_id: u32,
        group_key: &str,
    ) -> Result<(), JsError> {
        let them = address(from_name, from_device_id)?;
        let m = SenderKeyDistributionMessage::try_from(&base64_decode(group_key)?[..]).map_err(err)?;
        now(process_sender_key_distribution_message(&them, &m, &mut self.store.sender_keys)).map_err(err)
    }

    /// Locks a group message once, with this device's group key.
    #[wasm_bindgen(js_name = groupEncrypt)]
    pub fn group_encrypt(&mut self, distribution_id: &str, text: &str) -> Result<String, JsError> {
        let id = uuid::Uuid::parse_str(distribution_id).map_err(bad)?;
        let me = self.local()?;
        let m = now(group_encrypt(&mut self.store.sender_keys, &me, id, text.as_bytes(), &mut rng()))
            .map_err(err)?;
        Ok(b64(m.serialized()))
    }

    /// Opens a group message from one device.
    #[wasm_bindgen(js_name = groupDecrypt)]
    pub fn group_decrypt(
        &mut self,
        from_name: &str,
        from_device_id: u32,
        body: &str,
    ) -> Result<String, JsError> {
        let them = address(from_name, from_device_id)?;
        let plain = now(group_decrypt(&base64_decode(body)?, &mut self.store.sender_keys, &them)).map_err(err)?;
        String::from_utf8(plain).map_err(bad)
    }

    /// The 60-digit security code both people see, to compare in person.
    #[wasm_bindgen(js_name = safetyNumber)]
    pub fn safety_number(&self, their_name: &str, their_device_id: u32) -> Result<String, JsError> {
        let them = address(their_name, their_device_id)?;
        let theirs = now(self.store.identity.get_identity(&them))
            .map_err(err)?
            .ok_or_else(|| coded("ERR_NO_SESSION", "no session with them yet"))?;
        let mine = self.store.identity.pair().map_err(err)?;
        let f = Fingerprint::new(
            2,
            5200,
            self.store.name.as_bytes(),
            mine.identity_key(),
            their_name.as_bytes(),
            &theirs,
        )
        .map_err(bad)?;
        f.display_string().map_err(bad)
    }
}

impl SignalDevice {
    fn local(&self) -> Result<ProtocolAddress, JsError> {
        address(&self.store.name, self.store.device_id)
    }
}

/// The security code for two identity keys (base64), without a device. Used
/// to check our build against Signal's published test numbers, and later for
/// "Verify security code" on a contact's screen.
#[wasm_bindgen(js_name = safetyNumberFor)]
pub fn safety_number_for(
    local_name: &str,
    local_key: &str,
    remote_name: &str,
    remote_key: &str,
) -> Result<String, JsError> {
    let local = IdentityKey::decode(&base64_decode(local_key)?).map_err(err)?;
    let remote = IdentityKey::decode(&base64_decode(remote_key)?).map_err(err)?;
    Fingerprint::new(2, 5200, local_name.as_bytes(), &local, remote_name.as_bytes(), &remote)
        .map_err(bad)?
        .display_string()
        .map_err(bad)
}
