// voice.ts: recording voice notes, the WhatsApp way.
//
// Hold the mic to record and let go to send; slide left to cancel; slide up to
// lock it, and then you can pause, listen back, carry on, delete or send.
// (The gestures are in ui/chat/VoiceRecorder.tsx; this file is the recording.)
//
// Pausing really stops the recorder, because a half-made recording can't be
// played. Each stretch you record is a "piece"; the pieces are joined into
// one file (AudioJoin.kt) to listen back and to send. While recording, how
// loud you are is sampled ten times a second; those become the bars drawn on
// the voice note (its "waveform"), which travel with it, locked like the sound.
import type { Ref } from '@pakchat/shared';
import { AudioModule, setAudioModeAsync, type AudioRecorder, type RecordingOptions } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';

/** Small and clear: mono AAC at 48 kbit/s is about 6 KB a second. */
export const VOICE_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: 48_000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: 'aac ', audioQuality: 96, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48_000 },
};

/** How many bars a voice note shows. */
export const BARS = 48;
/** Voice notes stop by themselves after 15 minutes. */
export const MAX_VOICE_MS = 15 * 60_000;
/** Shorter than this when you let go, and it's thrown away (a tap meant to be a hold). */
export const MIN_VOICE_MS = 1_000;

/** Loudness in decibels (-160 silent … 0 loudest) as 0…255. Talking is roughly -40 to -10. */
export function levelOf(db: number | undefined) {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.round(Math.min(1, Math.max(0, (db + 55) / 50)) * 255);
}

/** Squeezes many samples into `bars` bars (the loudest of each stretch), as base64. */
export function waveformOf(levels: number[], bars = BARS) {
  if (!levels.length) return undefined;
  const out = new Uint8Array(bars);
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    let top = 0;
    for (let j = from; j < to && j < levels.length; j++) top = Math.max(top, levels[j]);
    out[i] = top;
  }
  return btoa(String.fromCharCode(...out));
}

/** The bars back from a message's waveform (0…1 each); flat if it has none. */
export function barsOf(waveform: string | undefined, bars = BARS): number[] {
  try {
    if (waveform) {
      const raw = atob(waveform);
      if (raw.length) return Array.from({ length: bars }, (_, i) => raw.charCodeAt(Math.floor((i * raw.length) / bars)) / 255);
    }
  } catch {
    // A broken waveform just draws flat.
  }
  return Array.from({ length: bars }, () => 0.15);
}

function folder() {
  const d = new Directory(Paths.cache, 'voice');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

const remove = (uri: string | null | undefined) => {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
};

export type Recorded = { uri: string; duration: number; waveform?: string };

/**
 * One voice note being made. `rec` is the screen's recorder (useAudioRecorder);
 * a new piece starts each time it records.
 */
export class VoiceSession {
  /** Finished pieces (file URIs) and their lengths. */
  private parts: string[] = [];
  private partsMs = 0;
  /** Loudness samples (0…255), ten a second. */
  readonly levels: number[] = [];
  private preview: string | null = null;
  recording = false;
  done = false;

  constructor(private rec: AudioRecorder) {}

  /** Is the mic allowed already? (Doesn't ask.) */
  static async allowedNow() {
    return (await AudioModule.getRecordingPermissionsAsync()).granted;
  }

  /** Asks for the mic the first time. False if you said no. */
  static async allowed() {
    const now = await AudioModule.getRecordingPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await AudioModule.requestRecordingPermissionsAsync()).granted;
  }

  /** Getting the recorder ready takes a moment; letting go during it still stops it. */
  private starting: Promise<void> | null = null;

  /** Starts (or carries on after a pause): a new piece. */
  record() {
    if (this.done || this.recording || this.starting) return this.starting ?? Promise.resolve();
    this.starting = (async () => {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
        await this.rec.prepareToRecordAsync(VOICE_OPTIONS);
        this.rec.record();
        this.recording = true;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  /** How long it is so far, in ms, and takes a loudness sample. Call ten times a second. */
  sample() {
    if (!this.recording) return this.partsMs;
    const s = this.rec.getStatus();
    this.levels.push(levelOf(s.metering));
    return this.partsMs + (s.durationMillis ?? 0);
  }

  /** Length so far without sampling. */
  get elapsed() {
    return this.recording ? this.partsMs + (this.rec.getStatus().durationMillis ?? 0) : this.partsMs;
  }

  /** Ends the piece being recorded. */
  private async endPiece() {
    await this.starting?.catch(() => {});
    if (!this.recording) return;
    this.recording = false;
    const ms = this.rec.getStatus().durationMillis ?? 0;
    try {
      await this.rec.stop();
    } catch {
      // A piece too short to keep: the recorder couldn't finish it.
    }
    const uri = this.rec.uri;
    if (uri && new File(uri).exists) {
      this.parts.push(uri);
      this.partsMs += ms;
    }
  }

  /** Pauses, and answers a file of everything so far to listen to (null if nothing yet). */
  async pause(): Promise<Recorded | null> {
    await this.endPiece();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    return this.joined();
  }

  /** All the pieces as one file. */
  private async joined(): Promise<Recorded | null> {
    if (!this.parts.length) return null;
    remove(this.preview);
    const out = new File(folder(), `${core.newId()}.m4a`);
    let duration = this.partsMs;
    if (this.parts.length === 1) {
      // Copying takes a moment: wait for it, or the piece could be deleted before it's copied.
      await new File(this.parts[0]).copy(out);
    } else {
      duration = await fileModule().joinAudio(this.parts, out.uri);
    }
    this.preview = out.uri;
    return { uri: out.uri, duration: Math.max(duration, this.partsMs > 0 ? 1 : 0), waveform: waveformOf(this.levels) };
  }

  /** Finished: the voice note to send (null if it's too short or nothing was recorded). */
  async finish(minMs = 0): Promise<Recorded | null> {
    if (this.done) return null;
    await this.endPiece();
    this.done = true;
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const out = this.partsMs >= minMs ? await this.joined() : null;
    this.cleanParts(out?.uri);
    if (!out) remove(this.preview);
    // The file is the caller's now (sendVoice moves it).
    this.preview = null;
    return out;
  }

  /** Cancelled or deleted: nothing is kept. */
  async discard() {
    if (this.done) return;
    await this.endPiece().catch(() => {});
    this.done = true;
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    this.cleanParts(null);
    remove(this.preview);
    this.preview = null;
  }

  private cleanParts(keep: string | null | undefined) {
    for (const p of this.parts) if (p !== keep) remove(p);
    this.parts = [];
  }
}

/** Sends a finished voice note: it moves into PakChat's own folder first, like any file. */
export async function sendVoice(chatId: string, v: Recorded, replyTo?: Ref) {
  const files = new Directory(Paths.document, 'files');
  if (!files.exists) files.create({ intermediates: true, idempotent: true });
  const copy = new File(files, `${core.newId()}.m4a`);
  // Wait for the move to finish before reading its size or sending it.
  await new File(v.uri).move(copy);
  await core.client.sendFile(
    chatId,
    {
      local: copy.uri,
      size: copy.size,
      mime: 'audio/mp4',
      kind: 'voice',
      duration: Math.round(v.duration),
      ...(v.waveform ? { waveform: v.waveform } : {}),
    },
    { replyTo },
  );
}
