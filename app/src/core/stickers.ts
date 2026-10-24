// stickers.ts: stickers and GIFs.
//
// A sticker is a picture with a see-through background, sent as a file of
// kind "sticker" and shown big, without a bubble. They come from three places:
//   the built-in pack   drawn by scripts/make-stickers.py, inside the app
//   my saved ones       "Save sticker" on one someone sent, kept in PakChat's folder
//                       (hold a sticker in a chat, or tap it, like WhatsApp's favourites)
//   made from a photo   a square from the middle of a photo, saved and sent
//
// The sticker panel also shows the ones I sent lately ("Recent"), newest first.
//
// A GIF is a short silent video (an MP4, much smaller than a real .gif). The
// GIF tab asks our server for them (it asks KLIPY, so KLIPY never learns who
// is looking), downloads the one picked, and sends it locked like any video,
// marked `gif`, so it plays on a loop with no sound. The person who gets it
// never contacts KLIPY.
import type { Gif, Ref } from '@pakchat/shared';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import KV from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { core } from './core';
import { sendPicked } from './files';

/** The built-in pack (assets/stickers, made by scripts/make-stickers.py). */
export const PACK: { name: string; source: number }[] = [
  { name: 'salam', source: require('../../assets/stickers/salam.webp') },
  { name: 'shukriya', source: require('../../assets/stickers/shukriya.webp') },
  { name: 'jazakallah', source: require('../../assets/stickers/jazakallah.webp') },
  { name: 'inshallah', source: require('../../assets/stickers/inshallah.webp') },
  { name: 'mashallah', source: require('../../assets/stickers/mashallah.webp') },
  { name: 'eid', source: require('../../assets/stickers/eid.webp') },
  { name: 'ameen', source: require('../../assets/stickers/ameen.webp') },
  { name: 'wah', source: require('../../assets/stickers/wah.webp') },
  { name: 'theek', source: require('../../assets/stickers/theek.webp') },
  { name: 'ji', source: require('../../assets/stickers/ji.webp') },
  { name: 'kamaal', source: require('../../assets/stickers/kamaal.webp') },
  { name: 'hahaha', source: require('../../assets/stickers/hahaha.webp') },
  { name: 'chai', source: require('../../assets/stickers/chai.webp') },
  { name: 'mubarak', source: require('../../assets/stickers/mubarak.webp') },
  { name: 'birthday', source: require('../../assets/stickers/birthday.webp') },
  { name: 'allahhafiz', source: require('../../assets/stickers/allahhafiz.webp') },
];

/** Stickers are this big (square), like WhatsApp's. */
export const STICKER_SIZE = 512;
const MAX_SAVED = 60;
const MAX_RECENT = 24;

/**
 * One of my saved stickers. `md5` is a fingerprint of the picture, so the same
 * sticker is known again whoever sent it and wherever its file is.
 */
export type SavedSticker = { id: string; uri: string; md5?: string };

/** A file's fingerprint (null when it can't be read). */
async function fingerprint(uri: string) {
  try {
    return await new File(uri).digest('MD5');
  } catch {
    return null;
  }
}

function stickerFolder() {
  const d = new Directory(Paths.document, 'stickers');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** My saved stickers, newest first (ones whose file went missing are left out). */
export function savedStickers(): SavedSticker[] {
  try {
    const list = JSON.parse(KV.getItemSync('stickers:saved') ?? '[]') as SavedSticker[];
    return list.filter((s) => new File(s.uri).exists);
  } catch {
    return [];
  }
}

function keep(list: SavedSticker[]) {
  KV.setItemSync('stickers:saved', JSON.stringify(list.slice(0, MAX_SAVED)));
  core.emit('stickers');
}

/** The saved sticker that is this picture, if I saved it. */
export async function savedAs(uri: string, list = savedStickers()) {
  const md5 = await fingerprint(uri);
  if (!md5) return null;
  for (const s of list) {
    // Stickers saved before fingerprints existed get one now.
    s.md5 ??= (await fingerprint(s.uri)) ?? undefined;
    if (s.md5 === md5) return s;
  }
  return null;
}

/** Keeps a copy of a sticker (from a message, or one I made) and returns the copy. Already saved: it moves to the front. */
export async function saveSticker(uri: string) {
  const list = savedStickers();
  const already = await savedAs(uri, list);
  if (already) {
    keep([already, ...list.filter((s) => s !== already)]);
    return already.uri;
  }
  const copy = new File(stickerFolder(), `${core.newId()}.webp`);
  await new File(uri).copy(copy);
  keep([{ id: core.newId(), uri: copy.uri, md5: (await fingerprint(copy.uri)) ?? undefined }, ...list]);
  return copy.uri;
}

/** Takes a sticker out of my saved ones, given any copy of its picture. */
export async function unsaveSticker(uri: string) {
  const s = await savedAs(uri);
  if (s) removeSticker(s.id);
}

export function removeSticker(id: string) {
  const list = savedStickers();
  const gone = list.find((s) => s.id === id);
  if (gone) {
    try {
      new File(gone.uri).delete();
    } catch {
      // Already gone.
    }
  }
  keep(list.filter((s) => s.id !== id));
}

/**
 * The stickers I sent lately, newest first: a file (one of my saved ones) or a
 * built-in one's `require` number. Ones I've since removed are left out.
 */
export function recentStickers(): (string | number)[] {
  try {
    const keys = JSON.parse(KV.getItemSync('stickers:recent') ?? '[]') as string[];
    const out: (string | number)[] = [];
    for (const k of keys) {
      if (k.startsWith('pack:')) {
        const p = PACK.find((s) => s.name === k.slice(5));
        if (p) out.push(p.source);
      } else if (new File(k).exists) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

/** Puts a sticker I just sent at the front of Recent. */
function noteRecent(from: string | number) {
  const key = typeof from === 'number' ? `pack:${PACK.find((s) => s.source === from)?.name ?? ''}` : from;
  if (key === 'pack:') return;
  try {
    const keys = JSON.parse(KV.getItemSync('stickers:recent') ?? '[]') as string[];
    KV.setItemSync('stickers:recent', JSON.stringify([key, ...keys.filter((k) => k !== key)].slice(0, MAX_RECENT)));
    core.emit('stickers');
  } catch {
    // Recent is only a convenience.
  }
}

/** A sticker from a photo: the biggest square from its middle, 512 px, saved to my stickers. Returns the saved file. */
export async function stickerFromPhoto(uri: string, width: number, height: number) {
  const side = Math.min(width, height);
  const ctx = ImageManipulator.manipulate(uri);
  ctx.crop({ originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side });
  ctx.resize({ width: STICKER_SIZE, height: STICKER_SIZE });
  const img = await ctx.renderAsync();
  const saved = await img.saveAsync({ compress: 0.8, format: SaveFormat.WEBP });
  return saveSticker(saved.uri);
}

/**
 * The file of a built-in sticker (the app's own copy, unpacked once into the cache).
 * In the built app on Android, a picture inside the app is an Android resource,
 * known only by its name ("assets_stickers_salam"), not a file. expo-asset then
 * hands back that name as if it were a file, so we ask it to unpack the resource
 * ("file:///android_res/drawable/…") into a real file instead.
 */
async function packFile(source: number) {
  const asset = Asset.fromModule(source);
  const name = asset.localUri ?? asset.uri;
  const real =
    Platform.OS === 'android' && !name.includes(':')
      ? new Asset({ name: asset.name, type: asset.type, hash: null, uri: `file:///android_res/drawable/${name}.${asset.type}` })
      : asset;
  await real.downloadAsync();
  if (!real.localUri || !real.localUri.includes(':')) throw new Error('The sticker is missing');
  return real.localUri;
}

/** Sends a sticker: one of mine (a file) or a built-in one (its `require` number). */
export async function sendSticker(chatId: string, from: string | number, replyTo?: Ref) {
  const uri = typeof from === 'number' ? await packFile(from) : from;
  const size = new File(uri).size;
  await sendPicked(chatId, { uri, mime: 'image/webp', kind: 'sticker', name: 'sticker.webp', size, width: STICKER_SIZE, height: STICKER_SIZE }, undefined, { replyTo });
  noteRecent(from);
}

// ---- GIFs ----

/** Null until the server is asked; false when it has no GIFs (the tab hides). */
let gifsOn: boolean | null = null;
export const gifsAvailable = () => gifsOn;

/** Popular GIFs (or a search), and where the next page starts. Null when the server has none. */
export async function findGifs(q: string, lang: string, pos?: string) {
  const r = await core.server.gifs(q, pos, lang);
  gifsOn = r !== null;
  return r;
}

/** Downloads the GIF's little video and sends it, marked as a GIF. */
export async function sendGif(chatId: string, g: Gif, replyTo?: Ref) {
  const dir = new Directory(Paths.cache, 'gifs');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = await File.downloadFileAsync(g.mp4, new File(dir, `${core.newId()}.mp4`));
  try {
    await sendPicked(chatId, { uri: file.uri, mime: 'video/mp4', kind: 'video', size: file.size, width: g.width, height: g.height, gif: true }, undefined, { replyTo });
  } finally {
    // sendPicked keeps its own copy.
    try {
      file.delete();
    } catch {
      // Already gone.
    }
  }
}
