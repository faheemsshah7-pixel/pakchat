// backup.ts: chat backups, locked with a password only you know.
//
// Backing up: the phone's chats and messages (not the sign-in, not the keys) are
// copied into one file, locked with a key made from your password (slowly, on
// purpose, so guessing passwords is slow too), and uploaded. The server keeps
// only your newest backup, and can't open it.
//
// Restoring on a new phone: after signing in, PakChat sees the backup and asks
// for its password. A wrong password can't open it (the lock's check fails).
// Photos and videos aren't in the backup; they download again while the server
// still has them (30 days).
import { File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import KV from 'expo-sqlite/kv-store';

import { fileModule } from '../../modules/pakchat-signal';
import { core, type ChatPrefs, type Contact, type Person } from './core';
import { listen, stopped } from './files';

// Each account on this phone has its own password and settings.
const PASSWORD = () => `backupPassword_${core.myId}`;
const LAST = () => `lastBackupAt:${core.myId}`;
// 12, not 8 (security review, Nov 2026): the backup sits on the server, so a short password could be guessed
// by whoever got the file. Only new passwords are checked; an older backup still opens with its own.
export const MIN_PASSWORD = 12;

export type BackupInfo = { id: string; size: number; madeAt: number; url: string };

export class WrongPassword extends Error {}

/** SQLite wants a plain path ("/data/…"), not a "file://" address. */
const plainPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

// ---- The password, kept in Android's locked storage ----

export const hasPassword = () => !!SecureStore.getItem(PASSWORD());

export function setPassword(password: string) {
  SecureStore.setItem(PASSWORD(), password);
}

/** Forgets this account's backup password and its last backup time (its account was deleted). */
export async function forgetBackup() {
  await SecureStore.deleteItemAsync(PASSWORD()).catch(() => {});
  KV.removeItemSync(LAST());
}

// ---- Settings ----

/** How often it backs up by itself, like WhatsApp's: daily, weekly, monthly, or only when you tap. */
export type BackupEvery = 'daily' | 'weekly' | 'monthly' | 'never';
/** `daily` is from before `every` (on: daily, off: only when you tap). */
export type BackupPrefs = { daily: boolean; wifiOnly: boolean; every?: BackupEvery };
const EVERY_MS: Record<Exclude<BackupEvery, 'never'>, number> = { daily: 24 * 3_600_000, weekly: 7 * 24 * 3_600_000, monthly: 30 * 24 * 3_600_000 };
export const backupEvery = (p: BackupPrefs): BackupEvery => p.every ?? (p.daily ? 'daily' : 'never');

export function backupPrefs(): BackupPrefs {
  try {
    return { daily: true, wifiOnly: true, ...(JSON.parse(KV.getItemSync('backupPrefs') ?? '{}') as Partial<BackupPrefs>) };
  } catch {
    return { daily: true, wifiOnly: true };
  }
}

export function setBackupPrefs(p: BackupPrefs) {
  KV.setItemSync('backupPrefs', JSON.stringify(p));
}

// ---- Backing up ----

let running: Promise<void> | null = null;

/** Backs up now (one at a time). Needs the password saved first. */
export function backUp() {
  running ??= (async () => {
    const password = SecureStore.getItem(PASSWORD());
    if (!password) throw new Error('No backup password');
    const fm = fileModule();
    const key = await fm.backupKey(password, core.myId);
    const file = new File(Paths.cache, 'pakchat-backup.db');
    if (file.exists) file.delete();
    listen();
    try {
      await core.storage.exportTo(plainPath(file.uri));
      const { uploadUrl } = await core.server.startBackup(fm.lockedSize(file.size));
      await fm.uploadFile(file.uri, uploadUrl, key, 'backup');
      KV.setItemSync(LAST(), String(Date.now()));
      core.emit('backup');
    } finally {
      if (file.exists) file.delete();
      stopped('backup');
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export const lastBackupAt = () => Number(KV.getItemSync(LAST()) ?? 0);

/** Daily, weekly or monthly, as picked (and on Wi-Fi, if asked): called when PakChat starts. */
export async function backUpIfDue() {
  const p = backupPrefs();
  const every = backupEvery(p);
  if (every === 'never' || !hasPassword() || Date.now() - lastBackupAt() < EVERY_MS[every]) return;
  if (p.wifiOnly) {
    const net = await Network.getNetworkStateAsync().catch(() => null);
    if (net?.type !== Network.NetworkStateType.WIFI && net?.type !== Network.NetworkStateType.ETHERNET) return;
  }
  await backUp().catch((err: unknown) => console.log(`[pakchat] backup: ${String(err)}`));
}

// ---- Restoring ----

/** The backup on the server, or null. */
export function findBackup(): Promise<BackupInfo | null> {
  return core.server.backup();
}

/** Opens a backup with its password and adds its chats to this phone. Throws WrongPassword. */
export async function restore(b: BackupInfo, password: string) {
  const fm = fileModule();
  const key = await fm.backupKey(password, core.myId);
  const file = new File(Paths.cache, 'pakchat-restore.db');
  if (file.exists) file.delete();
  listen();
  try {
    try {
      await fm.downloadFile(b.url, file.uri, key, null, 'restore');
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_FILE_CHANGED') throw new WrongPassword();
      throw err;
    }
    // What this phone learned since signing in wins over the backup's older copy.
    const now = { people: core.people, contacts: core.contacts, prefs: core.prefs };
    await core.storage.importFrom(plainPath(file.uri));
    const s = core.storage;
    core.people = { ...((await s.getValue<Record<string, Person>>('app:people')) ?? {}), ...now.people };
    core.contacts = { ...((await s.getValue<Record<string, Contact>>('app:contacts')) ?? {}), ...now.contacts };
    core.prefs = { ...((await s.getValue<Record<string, ChatPrefs>>('app:prefs')) ?? {}), ...now.prefs };
    core.starred = (await s.getValue<Record<string, true>>('app:starred')) ?? {};
    core.lists = (await s.getValue<typeof core.lists>('app:lists')) ?? [];
    await s.setValue('app:people', core.people);
    await s.setValue('app:contacts', core.contacts);
    await s.setValue('app:prefs', core.prefs);
    // Keep backing up with the same password.
    setPassword(password);
    KV.setItemSync(LAST(), String(b.madeAt));
    await core.client.syncChats().catch(() => {});
    for (const topic of ['chats', 'people', 'prefs', 'backup'] as const) core.emit(topic);
  } finally {
    if (file.exists) file.delete();
    stopped('restore');
  }
}
