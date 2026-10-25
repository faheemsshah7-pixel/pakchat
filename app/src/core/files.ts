// files.ts: photos, videos and documents.
//
// Sending: the file is copied into PakChat's own folder, a tiny blurred preview is
// made, and the message shows at once. The outbox then locks the file (a new key
// for every file) and uploads it, and only then sends the message, which carries
// the key. The server only ever has locked bytes.
//
// Receiving: the message has the file's id, key and fingerprint. The phone asks
// the server for a download link, fetches the locked bytes, checks the
// fingerprint, and unlocks them into PakChat's folder. Photos (and whatever you
// switched on in Settings › Storage) download by themselves.
import { OfflineError, type ChatQuote, type FileKind, type FileUploader, type Message, type Ref } from '@pakchat/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Network from 'expo-network';
import KV from 'expo-sqlite/kv-store';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';

// ---- Where files live ----

function folder() {
  const d = new Directory(Paths.document, 'files');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

const extOf = (name: string | undefined, mime: string) => {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name ?? '')?.[1];
  if (fromName) return fromName.toLowerCase();
  const sub = mime.split('/')[1] ?? 'bin';
  return { jpeg: 'jpg', quicktime: 'mov', 'x-matroska': 'mkv', mpeg: 'mp3' }[sub] ?? sub.replace(/[^a-z0-9]/g, '').slice(0, 8);
};

/** The tag progress events carry for a message's file. */
export const tagOf = (chatId: string, m: Ref) => `${chatId}/${m.author}/${m.id}`;

// ---- Progress, for the bubbles ----

/** tag → 0..1 while a file is moving. */
export const moving: Record<string, number> = {};
let listening = false;

export function listen() {
  if (listening) return;
  listening = true;
  fileModule().addListener('progress', ({ tag, done, total }) => {
    if (total <= 0) return;
    moving[tag] = Math.min(1, done / total);
    core.emit('files');
  });
}

export function stopped(tag: string) {
  delete moving[tag];
  core.emit('files');
}

// ---- The server's limit ----

let maxBytes = 100 * 1024 * 1024;

/** Asks the server how big a file may be (it can change without an app update). */
export async function loadLimits() {
  try {
    maxBytes = (await core.server.fileLimits()).maxBytes;
  } catch {
    // Keep the last answer.
  }
  return maxBytes;
}

export const fileLimit = () => maxBytes;

// ---- Sending ----

/** Locks and uploads a file for the outbox. A dropped connection means "try again later". */
export const uploader: FileUploader = {
  async upload(chatId, local, message) {
    listen();
    const file = new File(local);
    if (!file.exists) throw new Error('The file to send is gone');
    const fm = fileModule();
    const { id, uploadUrl } = await core.server.startUpload(chatId, fm.lockedSize(file.size));
    const tag = tagOf(chatId, message);
    moving[tag] = 0;
    try {
      const r = await fm.uploadFile(local, uploadUrl, null, tag);
      return { id, key: r.key, digest: r.digest };
    } catch {
      throw new OfflineError('The upload stopped');
    } finally {
      stopped(tag);
    }
  },
};

export type Picked = {
  uri: string;
  mime: string;
  kind: FileKind;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  /** A GIF (a short silent video that loops). */
  gif?: true;
  /** Send a photo or video as it is, without making it smaller (the "HD" switch). */
  hd?: boolean;
  /** A video cut in the editor: from and to (ms). */
  trim?: { start: number; end: number };
  /** View once. */
  once?: true;
  /** A round video message. */
  round?: true;
  /** The photo was drawn on, cropped or turned in the editor (already a fresh copy without its camera details). */
  edited?: true;
};

/** Photos and videos from the chat list's 📷, waiting while you choose a chat (send-to.tsx). */
let handOff: Picked[] | null = null;
export function handOffMedia(list: Picked[]) {
  handOff = list;
}
/** The chat that was chosen takes them (once). */
export function takeHandOff() {
  const list = handOff;
  handOff = null;
  return list;
}
export function dropHandOff() {
  handOff = null;
}

/** What kind of file a type is. */
export function kindOf(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'doc';
}

/** A tiny blurred-looking preview (about 40 px wide), base64 JPEG. */
async function thumbOf(p: Picked): Promise<string | undefined> {
  try {
    let source = p.uri;
    if (p.kind === 'video') source = (await VideoThumbnails.getThumbnailAsync(p.uri, { time: 0, quality: 0.5 })).uri;
    else if (p.kind !== 'image') return undefined;
    const ctx = ImageManipulator.manipulate(source);
    ctx.resize({ width: 40 });
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ base64: true, compress: 0.4, format: SaveFormat.JPEG });
    return saved.base64 && saved.base64.length < 15_000 ? saved.base64 : undefined;
  } catch {
    return undefined;
  }
}

/** Photos are made this wide (or tall) at most, unless sent in HD, like WhatsApp. */
const PHOTO_MAX = 1600;

/** HD photos: as big as they came, up to this (a 50 MP photo is far more than any screen). */
const PHOTO_HD_MAX = 4096;

/**
 * A photo, smaller: at most 1600 px on its long side, as a JPEG at 75%. A
 * phone photo of 4 MB usually becomes about 300 KB and looks the same on a
 * phone. With HD it keeps its size (as a JPEG at 92%).
 *
 * Either way it's a fresh copy, so where it was taken and the camera's
 * details (EXIF: GPS, phone model, time) never go with it: the "Private"
 * badge in the editor. A moving .gif stays as it is.
 */
async function smaller(p: Picked): Promise<Picked> {
  if (p.kind === 'video') return smallerVideo(p);
  if (p.kind !== 'image' || p.mime === 'image/gif') return p;
  try {
    const ctx = ImageManipulator.manipulate(p.uri);
    const w = p.width ?? 0;
    const h = p.height ?? 0;
    const max = p.hd ? PHOTO_HD_MAX : PHOTO_MAX;
    if (Math.max(w, h) > max) ctx.resize(w >= h ? { width: max } : { height: max });
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ compress: p.hd ? 0.92 : 0.75, format: SaveFormat.JPEG });
    const size = new File(saved.uri).size;
    const name = p.name ? `${p.name.replace(/\.[a-z0-9]{1,8}$/i, '')}.jpg` : undefined;
    return { ...p, uri: saved.uri, mime: 'image/jpeg', name, size, width: saved.width, height: saved.height };
  } catch {
    return p;
  }
}

/** Roughly how big a video will be once sent (for the trim strip: "about 4 MB"). */
export function videoSizeGuess(p: Picked, lengthMs: number) {
  if (p.hd && p.size && p.duration) return Math.round((p.size * lengthMs) / p.duration);
  // About 2 megabits a second for the picture, and a little for the sound.
  return Math.round(((2_000_000 + 128_000) / 8) * (lengthMs / 1000));
}

/**
 * A video, smaller (VideoShrink.kt): 720 px on its short side, about 2
 * megabits a second, so a minute is about 15 MB, like WhatsApp. With HD on it
 * keeps its size and quality (up to the server's 100 MB). Cut to the trim
 * strip's part, and always without where it was filmed. A GIF is already
 * small. If it can't be done, it goes as it is (a cut one is tried again
 * without HD first).
 */
async function smallerVideo(p: Picked): Promise<Picked> {
  if (p.gif) return p;
  const trimmed = !!p.trim && (p.trim.start > 0 || (!!p.duration && p.trim.end < p.duration));
  const attempt = async (hd: boolean) => {
    const out = new File(Paths.cache, `small-${core.newId()}.mp4`);
    try {
      return await fileModule().shrinkVideo(p.uri, out.uri, trimmed ? p.trim!.start : 0, trimmed ? p.trim!.end : 0, hd);
    } catch (err) {
      console.log(`[pakchat] video shrink: ${String(err)}`);
      if (out.exists) out.delete();
      return null;
    }
  };
  const r = (await attempt(!!p.hd)) ?? (p.hd ? await attempt(false) : null);
  if (!r) return p;
  const name = p.name ? `${p.name.replace(/\.[a-z0-9]{1,8}$/i, '')}.mp4` : undefined;
  const duration = trimmed ? p.trim!.end - p.trim!.start : p.duration;
  return { ...p, uri: r.uri, mime: 'video/mp4', name, size: r.size, duration, ...(r.width && r.height ? { width: r.width, height: r.height } : {}) };
}

/** A sharp first frame of a video, kept on this phone, for its bubble while it sends. */
async function posterOf(uri: string): Promise<string | undefined> {
  try {
    const shot = await VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.8 });
    const copy = new File(folder(), `${core.newId()}-poster.jpg`);
    await new File(shot.uri).move(copy);
    return copy.uri;
  } catch {
    return undefined;
  }
}

export class TooBig extends Error {}

/** Sends a picked file to a chat (photos and videos made smaller first, unless HD). Throws TooBig over the server's limit. */
export async function sendPicked(chatId: string, picked: Picked, caption?: string, extra: { replyTo?: Ref; quote?: ChatQuote; hold?: number } = {}) {
  const p = await smaller(picked);
  const source = new File(p.uri);
  const size = p.size ?? source.size;
  if (size > maxBytes) throw new TooBig(String(maxBytes));
  // Our own copy: the picker's copy can be cleared by Android at any time.
  const copy = new File(folder(), `${core.newId()}.${extOf(p.name, p.mime)}`);
  await source.copy(copy);
  const thumb = await thumbOf({ ...p, uri: copy.uri });
  // View once: no little preview travels with it, so nothing shows before it's opened.
  const poster = p.kind === 'video' && !p.once ? await posterOf(copy.uri) : undefined;
  const file = {
    local: copy.uri,
    size,
    mime: p.mime,
    kind: p.kind,
    ...(p.kind === 'doc' || p.kind === 'audio' ? { name: (p.name ?? 'file').slice(0, 255) } : {}),
    ...(p.width ? { width: Math.round(p.width) } : {}),
    ...(p.height ? { height: Math.round(p.height) } : {}),
    ...(p.duration ? { duration: Math.round(p.duration) } : {}),
    ...(thumb && !p.once ? { thumb } : {}),
    ...(p.gif ? { gif: true as const } : {}),
    ...(p.once && (p.kind === 'image' || p.kind === 'video') ? { once: true as const } : {}),
    ...(p.round && p.kind === 'video' ? { round: true as const } : {}),
    ...(poster ? { poster } : {}),
  };
  try {
    return await core.client.sendFile(chatId, file, { caption, replyTo: extra.replyTo, quote: extra.quote, hold: extra.hold });
  } finally {
    // The smaller photo or video was only needed for the copy above.
    if (p.uri !== picked.uri) {
      try {
        source.delete();
      } catch {
        // Already gone.
      }
    }
  }
}

/** Sends a file I already have to another chat (forwarding). It's locked again with a new key. */
export async function forwardFile(chatId: string, m: Message) {
  await copyFileTo(chatId, m, { caption: m.text || undefined, forwarded: true });
}

/** A copy of a file I have, sent to another chat (forwarding, and broadcast lists). */
export async function copyFileTo(chatId: string, m: Message, extra: { caption?: string; forwarded?: boolean } = {}) {
  if (!m.file?.local) return null;
  const { local, id: _id, key: _key, digest: _digest, poster, transcript: _words, once: _once, ...meta } = m.file;
  const copy = new File(folder(), `${core.newId()}.${extOf(meta.name, meta.mime)}`);
  await new File(local).copy(copy);
  // Forwarding: the first frame is made again only for a broadcast (a forward shows the blurred one).
  const keep = !extra.forwarded && poster ? { poster } : {};
  return core.client.sendFile(chatId, { ...meta, ...keep, local: copy.uri }, { caption: extra.caption, forwarded: extra.forwarded });
}

/**
 * The ✕ on a file that's still sending, like WhatsApp: the upload stops and the
 * message stays in the chat, paused, with an upload button (resumeSend). False
 * if it had already gone.
 */
export async function pauseSend(m: Message) {
  const tag = tagOf(m.chatId, m);
  const paused = await core.client.pauseSend(m.chatId, m);
  // Only after the outbox has let go, so the stopped upload isn't tried again.
  fileModule().cancelTransfer(tag);
  if (!paused) return false;
  stopped(tag);
  core.emit(`messages:${m.chatId}`);
  return true;
}

/** The upload button on a paused file: it sends again (the upload starts over, unless it had finished). */
export async function resumeSend(m: Message) {
  const ok = await core.client.resumeSend(m.chatId, m);
  if (ok) core.emit(`messages:${m.chatId}`);
  return ok;
}

// ---- Receiving ----

export class FileGone extends Error {}
export class FileBroken extends Error {}
/** You stopped it (the ✕): nothing to say. */
export class Cancelled extends Error {}

/** The ✕ on a file that's downloading: stops it, and the download button comes back. */
export function cancelDownload(m: Message) {
  fileModule().cancelTransfer(tagOf(m.chatId, m));
}

const fetching = new Set<string>();

/** Downloads a message's file, checks it, and keeps it. */
export async function download(m: Message) {
  const f = m.file;
  // An opened view once message is gone for good.
  if (!f || f.local || !f.key || !f.digest || m.opened) return;
  const tag = tagOf(m.chatId, m);
  if (fetching.has(tag)) return;
  fetching.add(tag);
  listen();
  moving[tag] = 0;
  core.emit('files');
  try {
    const url = await core.server.fileLink(f.id).catch((err: unknown) => {
      throw (err as { status?: number }).status === 404 ? new FileGone() : err;
    });
    const out = new File(folder(), `${f.id}.${extOf(f.name, f.mime)}`);
    try {
      await fileModule().downloadFile(url, out.uri, f.key, f.digest, tag);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'ERR_CANCELLED') throw new Cancelled();
      if (e.code === 'ERR_FILE_CHANGED') throw new FileBroken();
      if (/ 404\b/.test(e.message ?? '')) throw new FileGone();
      throw new OfflineError('The download stopped');
    }
    await core.client.changeHere(m.chatId, m, (x) => {
      if (x.file) x.file = { ...x.file, local: out.uri };
    });
    core.emit(`messages:${m.chatId}`);
  } finally {
    fetching.delete(tag);
    stopped(tag);
  }
}

/** Deletes a message's file from the phone (deleting the message here). */
export async function forgetFile(m: Message | null) {
  for (const uri of [m?.file?.local, m?.file?.poster]) {
    if (!uri) continue;
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

/** Is the file there to open? (It can be deleted outside PakChat.) */
export function haveFile(m: Message) {
  return !!m.file?.local && new File(m.file.local).exists;
}

// ---- Auto-download (Settings › Storage) ----

export type AutoDownload = { wifi: FileKind[]; mobile: FileKind[] };
const DEFAULT_AUTO: AutoDownload = { wifi: ['image', 'video', 'audio', 'voice', 'doc'], mobile: ['image', 'voice'] };

export function autoDownload(): AutoDownload {
  try {
    return { ...DEFAULT_AUTO, ...(JSON.parse(KV.getItemSync('autoDownload') ?? '{}') as Partial<AutoDownload>) };
  } catch {
    return DEFAULT_AUTO;
  }
}

export function setAutoDownload(a: AutoDownload) {
  KV.setItemSync('autoDownload', JSON.stringify(a));
}

/** A new message came: download its file if Settings say so for this network. */
export async function maybeDownload(m: Message) {
  // View once comes only when it's opened (once.tsx), so it's never kept unopened.
  if (!m.file || m.file.local || m.deleted || m.file.once) return;
  const net = await Network.getNetworkStateAsync().catch(() => null);
  if (!net?.isConnected) return;
  const a = autoDownload();
  const on = net.type === Network.NetworkStateType.WIFI || net.type === Network.NetworkStateType.ETHERNET ? a.wifi : a.mobile;
  // Stickers and GIFs are small and mean nothing until seen, so they always come (as on WhatsApp).
  const small = m.file.kind === 'sticker' || (m.file.gif && m.file.size <= 8 * 1024 * 1024);
  if (small || on.includes(m.file.kind)) await download(m).catch(() => {});
}
