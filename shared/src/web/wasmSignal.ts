// The SignalApi for web browsers: Signal's own library (libsignal), built as
// WebAssembly from shared/signal-wasm. It's the same Rust code as the phone's,
// so a browser and a phone understand each other exactly.
//
// The keys live in memory while the page is open. Every change is handed to
// `save`, so the website can keep them in IndexedDB and `load` them next time.

import type { Bundle, DeviceKeys, PreKeys, Sealed, SignalApi } from '../signal';
import init, { initSync, SignalDevice } from './wasm/signal.js';

export type WasmSignalOptions = {
  /** Called with a device's whole state (secret keys included) after every change. */
  save?: (handle: string, state: string) => void | Promise<void>;
  /** Gives back a state saved earlier, or null. */
  load?: (handle: string) => (string | null) | Promise<string | null>;
  /** The state saved under this handle isn't needed any more. */
  forget?: (handle: string) => void | Promise<void>;
};

let ready: Promise<unknown> | null = null;

/** Marks a saved state that also holds kept texts: the marker, their JSON, a new line, then the state. */
const KEPT = 'pakchat-kept:';

/**
 * Loads the WebAssembly once. In a browser, call it with nothing (it fetches
 * signal_bg.wasm next to signal.js). In Node, pass the file's bytes.
 */
export function loadSignalWasm(bytes?: BufferSource): Promise<unknown> {
  if (bytes) {
    initSync({ module: bytes });
    ready = Promise.resolve();
  }
  ready ??= init();
  return ready;
}

/** Turns "ERR_DUPLICATE: ..." from the Rust side into an Error with a `code`. */
function coded<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = /^(ERR_[A-Z_]+):/.exec(message)?.[1];
    throw Object.assign(new Error(message), code ? { code } : {});
  }
}

export function wasmSignal(options: WasmSignalOptions = {}): SignalApi {
  const devices = new Map<string, SignalDevice>();
  const handleOf = (name: string, deviceId: number) => `${name}:${deviceId}`;

  // Opened texts kept by envelope number and sender (see SignalApi.decrypt).
  // They're saved in the same `save` as the keys, so both land together.
  const opened = new Map<string, Record<string, string>>();
  const kept = (handle: string) => {
    let o = opened.get(handle);
    if (!o) opened.set(handle, (o = {}));
    return o;
  };
  const pack = (handle: string) => {
    const o = opened.get(handle);
    const state = get(handle).exportState();
    return o && Object.keys(o).length ? `${KEPT}${JSON.stringify(o)}\n${state}` : state;
  };
  const unpack = (handle: string, saved: string) => {
    if (!saved.startsWith(KEPT)) return saved;
    const cut = saved.indexOf('\n');
    opened.set(handle, JSON.parse(saved.slice(KEPT.length, cut)) as Record<string, string>);
    return saved.slice(cut + 1);
  };

  const get = (handle: string) => {
    const d = devices.get(handle);
    if (!d) throw new Error(`No device called ${handle}`);
    return d;
  };

  /** Runs one step, then saves the device if anything changed. */
  async function step<T>(handle: string, run: (d: SignalDevice) => T, changes = true): Promise<T> {
    await ready;
    const d = get(handle);
    const result = coded(() => run(d));
    if (changes) await options.save?.(handle, pack(handle));
    return result;
  }

  /** Opens with `run`, or gives back the text kept under `keep`. */
  function opening(handle: string, keep: number | undefined, name: string, id: number, run: () => string) {
    if (keep == null) return run();
    const o = kept(handle);
    const key = `${keep}/${name}.${id}`;
    return (o[key] ??= run());
  }

  return {
    async createDevice(name, deviceId) {
      await ready;
      const handle = handleOf(name, deviceId);
      devices.get(handle)?.free();
      devices.set(handle, coded(() => SignalDevice.create(name, deviceId, Date.now())));
      opened.delete(handle);
      await options.save?.(handle, pack(handle));
      return handle;
    },

    async openDevice(name, deviceId) {
      await ready;
      const handle = handleOf(name, deviceId);
      if (devices.has(handle)) return handle;
      const state = await options.load?.(handle);
      if (!state) return null;
      devices.set(handle, coded(() => SignalDevice.restore(unpack(handle, state))));
      return handle;
    },

    async setAddress(handle, name, deviceId) {
      await ready;
      const d = get(handle);
      coded(() => d.setAddress(name, deviceId));
      const next = handleOf(name, deviceId);
      devices.delete(handle);
      devices.set(next, d);
      const o = opened.get(handle);
      opened.delete(handle);
      if (o) opened.set(next, o);
      await options.save?.(next, pack(next));
      if (next !== handle) await options.forget?.(handle);
      return next;
    },

    deviceKeys: (handle) => step(handle, (d) => JSON.parse(d.deviceKeys()) as DeviceKeys, false),
    newPreKeys: (handle, count) => step(handle, (d) => JSON.parse(d.newPreKeys(count, Date.now())) as PreKeys),
    startSession: (handle, name, id, bundle: Bundle) => step(handle, (d) => d.startSession(name, id, JSON.stringify(bundle), Date.now())),
    hasSession: (handle, name, id) => step(handle, (d) => d.hasSession(name, id, Date.now()), false),
    deleteSession: (handle, name, id) => step(handle, (d) => d.deleteSession(name, id)),
    identityKey: (handle, name, id) => step(handle, (d) => d.identityKey(name, id) ?? null, false),
    encrypt: (handle, name, id, text) => step(handle, (d) => JSON.parse(d.encrypt(name, id, text, Date.now())) as Sealed),
    decrypt: (handle, name, id, sealed, keep) =>
      step(handle, (d) => opening(handle, keep, name, id, () => d.decrypt(name, id, sealed.type, sealed.body))),
    async forgetOpened(handle, keeps) {
      const o = kept(handle);
      const before = Object.keys(o).length;
      for (const key of Object.keys(o)) if (keeps.includes(Number(key.split('/')[0]))) delete o[key];
      if (Object.keys(o).length !== before) await options.save?.(handle, pack(handle));
    },
    createGroupKey: (handle, distributionId) => step(handle, (d) => d.createGroupKey(distributionId)),
    acceptGroupKey: (handle, name, id, key) => step(handle, (d) => d.acceptGroupKey(name, id, key)),
    groupEncrypt: (handle, distributionId, text) => step(handle, (d) => d.groupEncrypt(distributionId, text)),
    groupDecrypt: (handle, name, id, body, keep) => step(handle, (d) => opening(handle, keep, name, id, () => d.groupDecrypt(name, id, body))),
    safetyNumber: (handle, name, id) => step(handle, (d) => d.safetyNumber(name, id), false),
  };
}
