// photos.ts: pictures of people, groups and communities, like WhatsApp's.
//
// A `photo` value (on a person, or on a group or community) is a web address
// (the Gmail picture from signing in with Google), or `pk1:<id>:<key>:<digest>`:
// a file on PakChat's server, locked with that key. Each one is fetched once
// and kept in the phone's cache; Avatar shows it, and the letters until then.
// Like WhatsApp's, photos aren't end-to-end locked: the server shows the value
// only to people allowed to see it (Settings › Privacy › Profile photo).
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';
import { outsideFor } from './lock';

type Locked = { id: string; key: string; digest: string };

function parse(value: string): Locked | null {
  const [tag, id, key, digest] = value.split(':');
  return tag === 'pk1' && id && key && digest ? { id, key, digest } : null;
}

function folder() {
  const d = new Directory(Paths.cache, 'photos');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** Photos already on the phone (id → its file), fetches under way, and ones that failed (tried again after a while). */
const here = new Map<string, string>();
const fetching = new Set<string>();
const failedAt = new Map<string, number>();

/** Something to show for a photo value now: a web address or a file on the phone, or null (letters) while it comes. */
export function photoUri(value?: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('https://')) return value;
  const p = parse(value);
  if (!p) return null;
  const known = here.get(p.id);
  if (known) return known;
  const file = new File(folder(), `${p.id}.jpg`);
  if (file.exists) {
    here.set(p.id, file.uri);
    return file.uri;
  }
  void fetch(p, file);
  return null;
}

async function fetch(p: Locked, file: File) {
  if (fetching.has(p.id) || Date.now() - (failedAt.get(p.id) ?? 0) < 60_000) return;
  fetching.add(p.id);
  try {
    const url = await core.server.fileLink(p.id);
    await fileModule().downloadFile(url, file.uri, p.key, p.digest, `photo:${p.id}`);
    here.set(p.id, file.uri);
    core.emit('photos');
  } catch {
    failedAt.set(p.id, Date.now());
  } finally {
    fetching.delete(p.id);
  }
}

/** Picks a photo from the gallery, cropped square (null if you didn't pick one). */
export async function pickPhoto(): Promise<string | null> {
  const r = await outsideFor(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 }));
  return r.canceled ? null : (r.assets[0]?.uri ?? null);
}

/** Makes a picked photo 640 pixels square, locks and uploads it: answers its `photo` value. `chatId`: a group's or community's. */
export async function uploadPhoto(uri: string, chatId?: string): Promise<string> {
  const edit = ImageManipulator.manipulate(uri);
  edit.resize({ width: 640, height: 640 });
  const small = await (await edit.renderAsync()).saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
  const fm = fileModule();
  const { id, uploadUrl } = await core.server.startPhoto(fm.lockedSize(new File(small.uri).size), chatId);
  const r = await fm.uploadFile(small.uri, uploadUrl, null, `photo:${id}`);
  // It shows at once here, without fetching it back.
  const mine = new File(folder(), `${id}.jpg`);
  await new File(small.uri).move(mine);
  here.set(id, mine.uri);
  return `pk1:${id}:${r.key}:${r.digest}`;
}
