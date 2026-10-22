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
import { OfflineError, type FileKind, type FileUploader, type Message, type Ref } from '@pakchat/shared';
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

export type Picked = { uri: string; mime: string; kind: FileKind; name?: string; size?: number; width?: number; height?: number; duration?: number };

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

export class TooBig extends Error {}

/** Sends a picked file to a chat. Throws TooBig over the server's limit. */
export async function sendPicked(chatId: string, p: Picked, caption?: string) {
  const source = new File(p.uri);
  const size = p.size ?? source.size;
  if (size > maxBytes) throw new TooBig(String(maxBytes));
  // Our own copy: the picker's copy can be cleared by Android at any time.
  const copy = new File(folder(), `${core.newId()}.${extOf(p.name, p.mime)}`);
  await source.copy(copy);
  const thumb = await thumbOf({ ...p, uri: copy.uri });
  const file = {
    local: copy.uri,
    size,
    mime: p.mime,
    kind: p.kind,
    ...(p.kind === 'doc' || p.kind === 'audio' ? { name: (p.name ?? 'file').slice(0, 255) } : {}),
    ...(p.width ? { width: Math.round(p.width) } : {}),
    ...(p.height ? { height: Math.round(p.height) } : {}),
    ...(p.duration ? { duration: Math.round(p.duration) } : {}),
    ...(thumb ? { thumb } : {}),
  };
  return core.client.sendFile(chatId, file, { caption });
}

/** Sends a file I already have to another chat (forwarding). It's locked again with a new key. */
export async function forwardFile(chatId: string, m: Message) {
  if (!m.file?.local) return;
  const { local, id: _id, key: _key, digest: _digest, ...meta } = m.file;
  const copy = new File(folder(), `${core.newId()}.${extOf(meta.name, meta.mime)}`);
  await new File(local).copy(copy);
  await core.client.sendFile(chatId, { ...meta, local: copy.uri }, { caption: m.text || undefined, forwarded: true });
}

// ---- Receiving ----

export class FileGone extends Error {}
export class FileBroken extends Error {}

const fetching = new Set<string>();

/** Downloads a message's file, checks it, and keeps it. */
export async function download(m: Message) {
  const f = m.file;
  if (!f || f.local || !f.key || !f.digest) return;
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
  if (!m?.file?.local) return;
  try {
    const f = new File(m.file.local);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
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
  if (!m.file || m.file.local || m.deleted) return;
  const net = await Network.getNetworkStateAsync().catch(() => null);
  if (!net?.isConnected) return;
  const a = autoDownload();
  const on = net.type === Network.NetworkStateType.WIFI || net.type === Network.NetworkStateType.ETHERNET ? a.wifi : a.mobile;
  if (on.includes(m.file.kind)) await download(m).catch(() => {});
}
