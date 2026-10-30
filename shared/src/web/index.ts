// The website's extra piece: Signal's library built as WebAssembly.
export { loadSignalWasm, wasmSignal, type WasmSignalOptions } from './wasmSignal';
export { safetyNumberFor } from './wasm/signal.js';
export { FileChanged, lockedSize, lockFile, unlockFile } from './fileLock';
