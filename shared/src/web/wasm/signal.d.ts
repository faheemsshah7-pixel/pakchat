/* tslint:disable */
/* eslint-disable */

/**
 * One PakChat device: its keys and its sessions with other devices.
 */
export class SignalDevice {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Saves another device's group key.
     */
    acceptGroupKey(from_name: string, from_device_id: number, group_key: string): void;
    /**
     * Makes a brand new device: an identity key, a signed pre-key and a
     * last resort Kyber key.
     */
    static create(name: string, device_id: number, now_ms: number): SignalDevice;
    /**
     * This device's group key for one group (made the first time). Send it,
     * locked, to each device in the group.
     */
    createGroupKey(distribution_id: string): string;
    /**
     * Opens a message from one device.
     */
    decrypt(from_name: string, from_device_id: number, kind: number, body: string): string;
    /**
     * Forgets the session with a device (it was removed, or reinstalled).
     */
    deleteSession(their_name: string, their_device_id: number): void;
    /**
     * The public keys the server needs when this device signs in.
     */
    deviceKeys(): string;
    /**
     * Locks a message for one device. Gives `{"type": 2 or 3, "body": base64}`.
     */
    encrypt(to_name: string, to_device_id: number, text: string, now_ms: number): string;
    /**
     * Everything this device knows, including its secret keys, as text.
     * Save it somewhere only this browser can read (IndexedDB).
     */
    exportState(): string;
    /**
     * Opens a group message from one device.
     */
    groupDecrypt(from_name: string, from_device_id: number, body: string): string;
    /**
     * Locks a group message once, with this device's group key.
     */
    groupEncrypt(distribution_id: string, text: string): string;
    hasSession(their_name: string, their_device_id: number, now_ms: number): boolean;
    /**
     * Their identity key as we last saw it (base64), or nothing.
     */
    identityKey(their_name: string, their_device_id: number): string | undefined;
    /**
     * Makes `count` new one-time keys of each kind. The secret halves stay
     * here; the public halves go to the server.
     */
    newPreKeys(count: number, now_ms: number): string;
    /**
     * Loads a device saved earlier with `export_state`.
     */
    static restore(state: string): SignalDevice;
    /**
     * The 60-digit security code both people see, to compare in person.
     */
    safetyNumber(their_name: string, their_device_id: number): string;
    /**
     * Gives this device its address once the server has said who we are:
     * our user id and device number. Keys are made before signing in, so the
     * device starts with a temporary one. Do this before any chat starts,
     * because both sides check the addresses.
     */
    setAddress(name: string, device_id: number): void;
    /**
     * Starts a locked session with another device, from its public keys.
     */
    startSession(their_name: string, their_device_id: number, bundle: string, now_ms: number): void;
}

/**
 * The security code for two identity keys (base64), without a device. Used
 * to check our build against Signal's published test numbers, and later for
 * "Verify security code" on a contact's screen.
 */
export function safetyNumberFor(local_name: string, local_key: string, remote_name: string, remote_key: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_signaldevice_free: (a: number, b: number) => void;
    readonly safetyNumberFor: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly signaldevice_acceptGroupKey: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly signaldevice_create: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly signaldevice_createGroupKey: (a: number, b: number, c: number) => [number, number, number, number];
    readonly signaldevice_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly signaldevice_deleteSession: (a: number, b: number, c: number, d: number) => [number, number];
    readonly signaldevice_deviceKeys: (a: number) => [number, number, number, number];
    readonly signaldevice_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly signaldevice_exportState: (a: number) => [number, number];
    readonly signaldevice_groupDecrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly signaldevice_groupEncrypt: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly signaldevice_hasSession: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly signaldevice_identityKey: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly signaldevice_newPreKeys: (a: number, b: number, c: number) => [number, number, number, number];
    readonly signaldevice_restore: (a: number, b: number) => [number, number, number];
    readonly signaldevice_safetyNumber: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly signaldevice_setAddress: (a: number, b: number, c: number, d: number) => [number, number];
    readonly signaldevice_startSession: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
