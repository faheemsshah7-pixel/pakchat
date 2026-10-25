// lock.ts: App lock and Chat lock (phase 7).
//
// App lock: PakChat opens only with your fingerprint or face (no PIN, by
// choice: the phone's own PIN would let anyone who knows it in). It locks
// again when you leave PakChat: at once, after 30 seconds or a minute, or when
// the phone's screen goes off. A failed try waits 30 seconds before the next.
// If the fingerprint or face stops working, the only way back in is to
// reinstall PakChat and restore a backup; Settings says so before you turn it
// on. Leaving PakChat for our own pickers (gallery, camera, files, share
// sheet) doesn't count, so the lock doesn't come up when you come back.
//
// Chat lock, two ways:
//   folder  WhatsApp's: the chat moves to "Locked chats", a folder at the top
//           of the chat list that shows when you pull the list down. With a
//           secret code, the folder is hidden too, and opens only by typing
//           the code in search.
//   list    Ours: the chat stays in the list with a lock, saying only
//           "Locked chat" (or "New message"), and opens with your fingerprint.
// Either way its alerts say only "New message", its words stay out of search,
// and it locks again when you leave it (at once, or after 30 s or a minute).
// Its photos never reach the phone's gallery (PakChat keeps files to itself).
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, type AppStateStatus } from 'react-native';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';

/** A failed try waits this long. */
export const FAIL_WAIT_MS = 30_000;
/** The Locked chats folder, in the "recently opened" list. */
export const FOLDER = '__locked';

let appLocked = false;
let leftAt = 0;
/** Away in one of our own pickers: coming back doesn't lock. */
let outside = 0;
let leftForPicker = false;
let waitUntil = 0;
let started = false;
/** Chats (and the folder) open right now, or left at this time (ms). Null: open now. */
const open = new Map<string, number | null>();
/** Chats opened from inside the unlocked folder: coming back from one keeps the folder open. */
const fromFolder = new Set<string>();

export const isAppLocked = () => appLocked;
export const lockWaitUntil = () => waitUntil;

/** Once the settings are read: lock at start if App lock is on, and watch PakChat going away. */
export function startLock() {
  appLocked = core.settings.appLock;
  core.emit('lock');
  if (started) return;
  started = true;
  AppState.addEventListener('change', moved);
}

function moved(s: AppStateStatus) {
  if (s === 'background') {
    leftAt = Date.now();
    leftForPicker = outside > 0;
    // Locked chats lock again when PakChat goes away (not for our own pickers).
    if (!leftForPicker && open.size) {
      console.log('[pakchat] lock: PakChat left, locked chats lock again');
      open.clear();
      fromFolder.clear();
      core.emit('lock');
    }
    return;
  }
  if (s !== 'active' || !core.settings.appLock || appLocked || !leftAt) return;
  const was = leftAt;
  leftAt = 0;
  if (leftForPicker) return;
  const after = core.settings.appLockAfter;
  const gone = Date.now() - was;
  // Locking the phone with PakChat open: the screen goes off about when PakChat goes away (either first).
  const lock = after === -1 ? fileModule().screenOffAt() >= was - 3_000 : gone >= after * 1000;
  if (lock) {
    appLocked = true;
    core.emit('lock');
  }
}

/** Runs one of our own pickers (gallery, camera, files, share): leaving PakChat for it doesn't lock. */
export async function outsideFor<T>(work: () => Promise<T>): Promise<T> {
  outside++;
  try {
    return await work();
  } finally {
    // Android says "active" a moment after the picker closes.
    setTimeout(() => {
      outside = Math.max(0, outside - 1);
    }, 1_500);
  }
}

/** Whether this phone can use App lock or Chat lock: a fingerprint or face is set up. */
export async function canUseBiometrics() {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return false;
    if (!(await LocalAuthentication.isEnrolledAsync())) return false;
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK;
  } catch {
    return false;
  }
}

/** `interrupted`: Android closed the prompt itself (PakChat was still coming back to the front, say). */
export type AuthResult = 'ok' | 'cancelled' | 'interrupted' | 'failed' | 'wait' | 'unavailable';

/** The prompt showing now: a second ask while it's up gets the same answer, not a second prompt. */
let asking: Promise<AuthResult> | null = null;

/** Asks for the fingerprint or face (never the phone's PIN). One prompt at a time. */
export function authenticate(prompt: string, cancel: string): Promise<AuthResult> {
  asking ??= ask(prompt, cancel).finally(() => {
    asking = null;
  });
  return asking;
}

async function ask(prompt: string, cancel: string): Promise<AuthResult> {
  if (Date.now() < waitUntil) return 'wait';
  if (!(await canUseBiometrics())) return 'unavailable';
  outside++;
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, disableDeviceFallback: true, requireConfirmation: false });
    console.log(`[pakchat] fingerprint: ${r.success ? 'ok' : r.error}`);
    if (r.success) return 'ok';
    if (r.error === 'user_cancel') return 'cancelled';
    if (r.error === 'system_cancel' || r.error === 'app_cancel') return 'interrupted';
    waitUntil = Date.now() + FAIL_WAIT_MS;
    core.emit('lock');
    return 'failed';
  } catch {
    return 'failed';
  } finally {
    setTimeout(() => {
      outside = Math.max(0, outside - 1);
    }, 1_500);
  }
}

/** Unlocks PakChat (App lock). Already unlocked: nothing to ask. */
export async function unlockApp(prompt: string, cancel: string): Promise<AuthResult> {
  if (!appLocked) return 'ok';
  const r = await authenticate(prompt, cancel);
  if (r === 'ok') {
    appLocked = false;
    core.emit('lock');
  }
  return r;
}

/** Is this locked chat (or the folder) open without asking again? */
export function chatOpen(key: string) {
  if (!open.has(key)) return false;
  const at = open.get(key);
  if (at === null) return true;
  const ok = Date.now() - (at ?? 0) < core.settings.chatRelock * 1000;
  if (!ok) {
    console.log(`[pakchat] lock: ${key === FOLDER ? 'the folder' : 'a chat'} locked again (time up)`);
    open.delete(key);
  }
  return ok;
}

/** Asks to open a locked chat (or the folder: FOLDER). */
export async function unlockChat(key: string, prompt: string, cancel: string) {
  if (chatOpen(key)) {
    open.set(key, null);
    return 'ok' as const;
  }
  const r = await authenticate(prompt, cancel);
  if (r === 'ok') {
    open.set(key, null);
    core.emit('lock');
  }
  return r;
}

/** A chat opened from the unlocked folder: it doesn't ask again, and the folder stays open behind it. */
export function openWith(chatId: string) {
  open.set(chatId, null);
  fromFolder.add(chatId);
}

/** The secret code opened the hidden folder. */
export function openFolderByCode() {
  open.set(FOLDER, null);
  core.emit('lock');
}

/** Left a locked chat (or the folder): it locks again after Settings' time (at once by default). */
export function leftChat(key: string) {
  if (!open.has(key)) return;
  // The folder is still there under a chat opened from it, whatever Android does with
  // the screens below meanwhile; it locks once you're really out of it (leftFolder).
  if (key === FOLDER && [...fromFolder].some((c) => open.get(c) === null)) return;
  if (core.settings.chatRelock === 0) open.delete(key);
  else open.set(key, Date.now());
  // Back from a chat into the folder: the folder is still open (it only locks once you leave it, or PakChat).
  if (fromFolder.delete(key)) open.set(FOLDER, null);
  if (key === FOLDER) fromFolder.clear();
  core.emit('lock');
}

/** Back on the chat list: the folder (if it was open) is left behind, so it locks again. */
export function leftFolder() {
  if (open.get(FOLDER) === null) leftChat(FOLDER);
}

/** The secret code's fingerprint (only this is kept). Spaces and case don't count. */
export async function codeHash(code: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `pakchat-locked:${code.trim().toLowerCase()}`);
}

/** Is this what was typed in search the secret code? */
export async function isSecretCode(typed: string) {
  const want = core.settings.secretCode;
  if (!want || typed.trim().length < 4) return false;
  return (await codeHash(typed)) === want;
}

/** Chats in the Locked chats folder. */
export const inFolder = (chatId: string) => core.prefs[chatId]?.lock === 'folder';
/** Any locked chat (either way). */
export const isLocked = (chatId: string) => !!core.prefs[chatId]?.lock;
