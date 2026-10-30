// lock.ts: App lock and Chat lock on the website.
//
// App lock, like WhatsApp Web's: a password for this computer only (the
// phone's fingerprint can't reach a browser). PakChat locks when it opens,
// after a while without use (1 minute, 15 minutes or an hour), or with
// "Lock app" in the menu. While locked, alerts say only "New message". Only a
// check of the password is kept (PBKDF2, 200,000 rounds, with its own salt),
// never the password. Forgot it? Log out, and link again with the phone.
//
// Chat lock, the phone's: locked chats open with the same secret code as on
// the phone (its check comes over from the phone, see core.takeSync). Chats
// in the Locked chats folder show only once the code is typed, either at
// "Locked chats" or in the search box, and lock again when you leave the
// folder. A chat locked the other way ("list") stays in the list saying
// "Locked chat" and opens with the code; it locks again when you leave it.

import { core } from './core';

export type AppLock = { salt: string; hash: string; /** Minutes without use before it locks. */ after: 1 | 15 | 60 };

const KEY = 'web:appLock';
const ROUNDS = 200_000;
/** After this many wrong passwords, the next try waits WAIT_MS. */
const TRIES = 5;
const WAIT_MS = 30_000;

let lockSetting: AppLock | null = null;
let appLocked = false;
let wrong = 0;
let waitUntil = 0;
let lastUsed = Date.now();
let watching = false;
let version = 0;

/** The Locked chats folder is open (the code was typed). */
let folderOpen = false;
/** "list" locked chats opened with the code, until you leave them. */
const openChats = new Set<string>();

function changed() {
  version++;
  core.emit('lock');
}

export const lockVersion = () => version;
export const appLockSetting = () => lockSetting;
export const isAppLocked = () => appLocked;
export const lockWaitUntil = () => waitUntil;
export const isFolderOpen = () => folderOpen;
export const isChatOpen = (chatId: string) => openChats.has(chatId);

/** Read once the browser's database is open: locks at once if App lock is on. */
export async function startLock() {
  lockSetting = (await core.storage.getValue<AppLock>(KEY)) ?? null;
  appLocked = !!lockSetting;
  changed();
  if (watching) return;
  watching = true;
  const used = () => {
    lastUsed = Date.now();
  };
  for (const e of ['pointerdown', 'keydown', 'wheel', 'mousemove'] as const) addEventListener(e, used, { passive: true, capture: true });
  setInterval(() => {
    if (lockSetting && !appLocked && Date.now() - lastUsed >= lockSetting.after * 60_000) lockApp();
  }, 10_000);
}

// ---- App lock ----

async function check(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations: ROUNDS }, key, 256);
  return toHex(new Uint8Array(bits));
}

/** Turns App lock on, or sets a new password. */
export async function setAppLock(password: string, after: AppLock['after']) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  lockSetting = { salt, hash: await check(password, salt), after };
  await core.storage.setValue(KEY, lockSetting);
  lastUsed = Date.now();
  changed();
}

export async function setLockAfter(after: AppLock['after']) {
  if (!lockSetting) return;
  lockSetting = { ...lockSetting, after };
  await core.storage.setValue(KEY, lockSetting);
  changed();
}

/** Is this the App lock password? (Counts wrong tries, and makes the next one wait after five.) */
export async function rightPassword(password: string): Promise<'ok' | 'wrong' | 'wait'> {
  if (!lockSetting) return 'ok';
  if (Date.now() < waitUntil) return 'wait';
  if ((await check(password, lockSetting.salt)) === lockSetting.hash) {
    wrong = 0;
    return 'ok';
  }
  wrong++;
  if (wrong >= TRIES) {
    wrong = 0;
    waitUntil = Date.now() + WAIT_MS;
    changed();
    return 'wait';
  }
  return 'wrong';
}

export async function turnOffAppLock() {
  lockSetting = null;
  appLocked = false;
  await core.storage.deleteValue(KEY);
  changed();
}

/** "Lock app" in the menu, or time up. Locked chats lock again too. */
export function lockApp() {
  if (!lockSetting || appLocked) return;
  appLocked = true;
  relockChats();
  changed();
}

export async function unlockApp(password: string) {
  const r = await rightPassword(password);
  if (r === 'ok') {
    appLocked = false;
    lastUsed = Date.now();
    changed();
  }
  return r;
}

// ---- Chat lock ----

/** The check the phone keeps of the secret code (the same sum, so the same code works on both). */
export async function codeHash(code: string) {
  const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pakchat-locked:${code.trim().toLowerCase()}`));
  return toHex(new Uint8Array(sum));
}

export async function rightCode(code: string) {
  return !!core.lockCode && code.trim().length >= 4 && (await codeHash(code)) === core.lockCode;
}

/** The secret code was typed: the folder opens. */
export function openFolder() {
  folderOpen = true;
  changed();
}

export function openLockedChat(chatId: string) {
  openChats.add(chatId);
  changed();
}

/** Leaving: the folder (and any locked chat but `keep`) lock again. */
export function relockChats(keep?: string | null) {
  let any = false;
  for (const id of [...openChats]) {
    if (id === keep) continue;
    openChats.delete(id);
    any = true;
  }
  if (folderOpen && !(keep && core.prefs[keep]?.lock === 'folder')) {
    folderOpen = false;
    any = true;
  }
  if (any) changed();
}

export function closeFolder() {
  folderOpen = false;
  changed();
}

function toHex(b: Uint8Array) {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fromHex(h: string) {
  return new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
}
