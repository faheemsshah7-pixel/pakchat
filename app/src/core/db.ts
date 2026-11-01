// db.ts: opens the phone's database (expo-sqlite) and wraps it in the small
// `Db` interface our storage uses (src/data/sqliteStorage.ts).
//
// The database is locked (SQLCipher, owner, 31 Oct): the whole file is
// scrambled with a key only this phone has, made once at random and kept in
// Android's protected storage (the Keystore, through expo-secure-store). A copy
// of the file taken off the phone is useless without it. Messages were already
// locked on their way (end to end); this locks the copy kept on the phone too.
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { SqliteStorage, type Db, type SqlValue } from '../data/sqliteStorage';

/** The locked database. */
const FILE = 'chats.db';
/** The unlocked one from before build 15: moved into the locked one once, then deleted. */
const OLD = 'pakchat.db';
/** Where this phone's database key is kept. */
const KEY = 'chatsDbKey';

const inDir = (name: string) => new File(`file://${SQLite.defaultDatabaseDirectory}`, name);
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * This phone's key for its database (64 hex digits, 32 random bytes). A new key
 * is only ever made when there's no locked database yet; otherwise a missing key
 * means it's gone for good (the app's data was copied to a new phone without its
 * Keystore, say), and the database it locked can never be opened again.
 */
async function dbKey(): Promise<string> {
  const saved = SecureStore.getItem(KEY);
  if (saved) return saved;
  if (inDir(FILE).exists) {
    console.log('[pakchat] start: the database key is gone; starting with an empty database');
    await SQLite.deleteDatabaseAsync(FILE);
  }
  const made = hex(Crypto.getRandomBytes(32));
  SecureStore.setItem(KEY, made);
  return made;
}

export async function openStorage(): Promise<SqliteStorage> {
  const key = await dbKey();
  const hadOld = inDir(OLD).exists;
  // The old database is only deleted once it's fully copied. If it's still here,
  // any locked one is from a copy that stopped part way: start that copy again.
  if (hadOld && inDir(FILE).exists) await SQLite.deleteDatabaseAsync(FILE);

  const sqlite = await SQLite.openDatabaseAsync(FILE);
  // The key goes first, before anything reads the file.
  await sqlite.execAsync(`PRAGMA key = "x'${key}'"`);
  // A wrong key fails here ("file is not a database"), so starting stops with a clear reason.
  await sqlite.getFirstAsync('SELECT count(*) FROM sqlite_master');

  if (hadOld) {
    console.log('[pakchat] start: locking the database (once)');
    const old = `${SQLite.defaultDatabaseDirectory}/${OLD}`;
    await sqlite.runAsync("ATTACH DATABASE ? AS old KEY ''", [old]);
    try {
      const v = await sqlite.getFirstAsync<{ user_version: number }>('PRAGMA old.user_version');
      await sqlite.execAsync(`SELECT sqlcipher_export('main', 'old'); PRAGMA main.user_version = ${Number(v?.user_version ?? 0)};`);
    } finally {
      await sqlite.execAsync('DETACH DATABASE old');
    }
    await SQLite.deleteDatabaseAsync(OLD);
  }

  const db: Db = {
    exec: (sql) => sqlite.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await sqlite.runAsync(sql, params);
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => sqlite.getAllAsync<T>(sql, params),
    first: <T,>(sql: string, params: SqlValue[] = []) => sqlite.getFirstAsync<T>(sql, params),
    allNow: <T,>(sql: string, params: SqlValue[] = []) => sqlite.getAllSync<T>(sql, params),
  };
  return SqliteStorage.open(db, { locked: true });
}
