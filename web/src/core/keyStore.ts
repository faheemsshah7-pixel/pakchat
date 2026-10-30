// keyStore.ts: where this browser keeps its Signal keys and sessions.
//
// They're locked (AES-GCM) with a key the browser made and won't let anyone
// read out, not even our own code (a "non-extractable" CryptoKey). That key
// is kept next to them, so this only stops someone reading the keys from a
// copy of the files on disk, like WhatsApp Web does. Signing out deletes both.

const DB = 'pakchat-keys';

function open(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('states');
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
  });
}

export async function keyStore(factory?: IDBFactory) {
  const db = await open(factory);
  let lock = await run<CryptoKey | undefined>(db, 'meta', 'readonly', (s) => s.get('lock'));
  if (!lock) {
    lock = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await run(db, 'meta', 'readwrite', (s) => s.put(lock, 'lock'));
  }
  const key = lock;

  return {
    async save(handle: string, state: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const locked = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(state));
      await run(db, 'states', 'readwrite', (s) => s.put({ iv, locked }, handle));
    },
    async load(handle: string): Promise<string | null> {
      const v = await run<{ iv: Uint8Array; locked: ArrayBuffer } | undefined>(db, 'states', 'readonly', (s) => s.get(handle));
      if (!v) return null;
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv as BufferSource }, key, v.locked));
    },
    async forget(handle: string) {
      await run(db, 'states', 'readwrite', (s) => s.delete(handle));
    },
    /** Signing out: every key on this browser goes. */
    async wipe() {
      await run(db, 'states', 'readwrite', (s) => s.clear());
      await run(db, 'meta', 'readwrite', (s) => s.clear());
    },
  };
}
