// workerSignal.ts: the page's side of signalWorker.ts. It looks like any
// other SignalApi to the shared core, but every call goes to the worker.

import type { SignalApi } from '@pakchat/shared';

type Waiting = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

export function workerSignal(): SignalApi & { wipe(): Promise<void> } {
  const worker = new Worker(new URL('./signalWorker.ts', import.meta.url), { type: 'module' });
  const waiting = new Map<number, Waiting>();
  let next = 1;

  worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: { message: string; code?: string } }>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.error) w.reject(Object.assign(new Error(e.data.error.message), e.data.error.code ? { code: e.data.error.code } : {}));
    else w.resolve(e.data.result);
  };

  const call = (method: string) => (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });

  return new Proxy({} as SignalApi & { wipe(): Promise<void> }, {
    // Not a promise itself: `await` must not mistake it for one.
    get: (_, method: string) => (method === 'then' ? undefined : call(method)),
  });
}
