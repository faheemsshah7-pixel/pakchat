// The JavaScript side of our Signal module. The real work happens in Kotlin
// (android/src/main/java/.../PakchatSignalModule.kt), using Signal's own library.
// It does exactly what the shared core's SignalApi asks (shared/src/signal.ts),
// and also locks, uploads and downloads files (FileLock.kt, FileTransfer.kt).
import type { SignalApi } from '@pakchat/shared';
import { requireNativeModule, type EventSubscription } from 'expo';

/** A place the phone keeps contacts: a Google account (synced to Gmail), the phone, or a SIM. */
export type PhoneBookAccount = { type: string | null; name: string | null; kind: 'google' | 'phone' | 'sim' | 'other' };

/** Files: locked on the phone, moved a piece at a time, with progress. */
export type FileModule = {
  /** How big a file of `plain` bytes is once locked. */
  lockedSize(plain: number): number;
  /** Locks the file at `uri` and PUTs it to `url`. `key` only for backups (base64, 64 bytes). */
  uploadFile(uri: string, url: string, key: string | null, tag: string): Promise<{ key: string; digest: string; size: number }>;
  /** Fetches, checks and unlocks a file to `to`. Throws ERR_FILE_CHANGED if it was tampered with. */
  downloadFile(url: string, to: string, key: string, digest: string | null, tag: string): Promise<string>;
  backupKey(password: string, userId: string): Promise<string>;
  /** Where a contact can be saved on this phone (WhatsApp's "Save to"). */
  contactAccounts(): Promise<PhoneBookAccount[]>;
  /** Saves a contact in the phone's address book. Null type and account: the phone itself. */
  saveToPhoneBook(type: string | null, account: string | null, name: string, phone: string | null, email: string | null): Promise<string>;
  addListener(event: 'progress', fn: (e: { tag: string; done: number; total: number }) => void): EventSubscription;
};

type Native = SignalApi & FileModule;

let native: Native | null = null;

/**
 * Finds the Kotlin module the first time it's asked for, not when the app
 * loads, so if it's missing the app can show the error instead of a blank screen.
 */
function load(): Native {
  native ??= requireNativeModule<Native>('PakchatSignal');
  return native;
}

export function loadSignal(): SignalApi {
  return load();
}

export function fileModule(): FileModule {
  return load();
}
