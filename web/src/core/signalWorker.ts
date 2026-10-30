// signalWorker.ts: Signal (libsignal, as WebAssembly) runs here, off the
// page's main thread, so locking and opening messages never makes typing or
// scrolling stutter. The page talks to it through workerSignal.ts.

import { loadSignalWasm, wasmSignal } from '@pakchat/shared/web';

import { keyStore } from './keyStore';

type Call = { id: number; method: string; args: unknown[] };

const ready = (async () => {
  const [, keys] = await Promise.all([loadSignalWasm(), keyStore()]);
  return { api: wasmSignal(keys) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, keys };
})();

self.onmessage = async (e: MessageEvent<Call>) => {
  const { id, method, args } = e.data;
  try {
    const { api, keys } = await ready;
    const result = method === 'wipe' ? await keys.wipe() : await api[method](...args);
    self.postMessage({ id, result });
  } catch (err) {
    const error = err as { message?: string; code?: string };
    self.postMessage({ id, error: { message: error?.message ?? String(err), code: error?.code } });
  }
};
