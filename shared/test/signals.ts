// The ways to run Signal in the tests: Node's library and the website's
// WebAssembly build. Most tests run once with each, and once with both mixed.

import { readFileSync } from 'node:fs';

import type { SignalApi } from '../src/signal';
import { loadSignalWasm, wasmSignal } from '../src/web/wasmSignal';
import { nodeSignal } from './nodeSignal';

await loadSignalWasm(readFileSync(new URL('../src/web/wasm/signal_bg.wasm', import.meta.url)));

export type Kind = 'node' | 'wasm';
export const make: Record<Kind, () => SignalApi> = { node: nodeSignal, wasm: () => wasmSignal() };

/** [label, the first person's library, the second person's library] */
export const PAIRS: [string, Kind, Kind][] = [
  ['node ↔ node', 'node', 'node'],
  ['wasm ↔ wasm', 'wasm', 'wasm'],
  ['node ↔ wasm', 'node', 'wasm'],
];
