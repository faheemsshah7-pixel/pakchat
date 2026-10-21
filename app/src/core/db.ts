// db.ts: opens the phone's database (expo-sqlite) and wraps it in the small
// `Db` interface our storage uses (src/data/sqliteStorage.ts).
import * as SQLite from 'expo-sqlite';

import { SqliteStorage, type Db, type SqlValue } from '../data/sqliteStorage';

export async function openStorage(): Promise<SqliteStorage> {
  const sqlite = await SQLite.openDatabaseAsync('pakchat.db');
  const db: Db = {
    exec: (sql) => sqlite.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await sqlite.runAsync(sql, params);
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => sqlite.getAllAsync<T>(sql, params),
    first: <T,>(sql: string, params: SqlValue[] = []) => sqlite.getFirstAsync<T>(sql, params),
  };
  return SqliteStorage.open(db);
}
