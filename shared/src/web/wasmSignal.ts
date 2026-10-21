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
    if (changes) await options.save?.(handle, d.exportState());
    return result;
  }

  return {
    async createDevice(name, deviceId) {
      await ready;
      const handle = handleOf(name, deviceId);
      devices.get(handle)?.free();
      devices.set(handle, coded(() => SignalDevice.create(name, deviceId, Date.now())));
      await options.save?.(handle, get(handle).exportState());
      return handle;
    },

    async openDevice(name, deviceId) {
      await ready;
      const handle = handleOf(name, deviceId);
      if (devices.has(handle)) return handle;
      const state = await options.load?.(handle);
      if (!state) return null;
      devices.set(handle, coded(() => SignalDevice.restore(state)));
      return handle;
    },

    async setAddress(handle, name, deviceId) {
      await ready;
      const d = get(handle);
      coded(() => d.setAddress(name, deviceId));
      const next = handleOf(name, deviceId);
      devices.delete(handle);
      devices.set(next, d);
      await options.save?.(next, d.exportState());
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
    decrypt: (handle, name, id, sealed) => step(handle, (d) => d.decrypt(name, id, sealed.type, sealed.body)),
    createGroupKey: (handle, distributionId) => step(handle, (d) => d.createGroupKey(distributionId)),
    acceptGroupKey: (handle, name, id, key) => step(handle, (d) => d.acceptGroupKey(name, id, key)),
    groupEncrypt: (handle, distributionId, text) => step(handle, (d) => d.groupEncrypt(distributionId, text)),
    groupDecrypt: (handle, name, id, body) => step(handle, (d) => d.groupDecrypt(name, id, body)),
    safetyNumber: (handle, name, id) => step(handle, (d) => d.safetyNumber(name, id), false),
  };
}
