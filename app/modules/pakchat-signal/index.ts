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
  /** Shows or updates one chat's message alert (WhatsApp style). See push.ts for the JSON. */
  showChatAlert(json: string): void;
  dismissChatAlert(chatId: string): void;
  chatAlertShowing(chatId: string): boolean;
  /** Stops an upload or download by its tag; it then fails with code ERR_CANCELLED. */
  cancelTransfer(tag: string): void;
  backupKey(password: string, userId: string): Promise<string>;
  /** Where a contact can be saved on this phone (WhatsApp's "Save to"). */
  contactAccounts(): Promise<PhoneBookAccount[]>;
  /** Saves a contact in the phone's address book. Null type and account: the phone itself. */
  saveToPhoneBook(type: string | null, account: string | null, name: string, phone: string | null, email: string | null): Promise<string>;
  /** Answers after `ms`, even in the background, where setTimeout stops (see push.ts). */
  wait(ms: number): Promise<void>;
  addListener(event: 'progress', fn: (e: { tag: string; done: number; total: number }) => void): EventSubscription;

  // ---- Voice notes (AudioJoin.kt) ----
  /** Joins voice-note pieces (file URIs, in order) into `to`. Answers the length in ms. */
  joinAudio(parts: string[], to: string): Promise<number>;

  // ---- Calls (CallAlerts.kt, CallAudio.kt, CallService.kt, PakchatPackage.kt) ----
  /** Rings with a full-screen call alert. See calls.ts for the JSON. */
  callRing(json: string): void;
  callStopRing(callId: string): void;
  callMissed(json: string): void;
  callDismissMissed(chatId: string): void;
  /** Shows or updates the "Ongoing call" alert, which keeps the mic going in the background. */
  callOngoing(json: string): void;
  /** Ends everything native about a call: the alert, call mode, the lock-screen view. */
  callEnded(): void;
  callAudioStart(video: boolean): void;
  callRoute(to: AudioRoute): void;
  callVideo(on: boolean): void;
  callAudioState(): CallAudioState;
  callTone(kind: 'ringing' | 'busy' | 'ended'): void;
  callStopTone(): void;
  callShowOverLock(on: boolean, keepOn: boolean): void;
  callFullScreenAllowed(): boolean;
  callOpenFullScreenSettings(): void;
  addListener(event: 'callAudio', fn: (e: CallAudioState) => void): EventSubscription;
};

/** Where a call's sound comes out. */
export type AudioRoute = 'earpiece' | 'speaker' | 'headset' | 'bluetooth';
export type CallAudioState = { routes: AudioRoute[]; route: AudioRoute };

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
