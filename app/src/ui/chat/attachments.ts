// attachments.ts: picking photos, videos and documents to send.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { kindOf, type Picked } from '../../core/files';
import { outsideFor } from '../../core/lock';
import { GALLERY_MAX, galleryAllowed, openGallery } from './Gallery';

function fromPicker(a: ImagePicker.ImagePickerAsset): Picked {
  const video = a.type === 'video';
  const mime = a.mimeType ?? (video ? 'video/mp4' : 'image/jpeg');
  return {
    uri: a.uri,
    mime,
    kind: video ? 'video' : 'image',
    name: a.fileName ?? undefined,
    size: a.fileSize,
    width: a.width || undefined,
    height: a.height || undefined,
    duration: video && a.duration ? a.duration : undefined,
  };
}

/**
 * Photos and videos from the gallery: up to 100 at once in PakChat's own
 * gallery (Gallery.tsx), like WhatsApp, or just one. Without access to the
 * gallery (or from its ⋯), the phone's own picker. Empty if you closed it.
 */
export async function fromGallery(many = true): Promise<Picked[]> {
  if (many && (await galleryAllowed())) {
    const got = await openGallery(GALLERY_MAX);
    if (got !== 'system') return got;
  }
  const r = await outsideFor(() =>
    ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: many, selectionLimit: many ? GALLERY_MAX : 1, quality: 1 }),
  );
  return r.canceled ? [] : r.assets.map(fromPicker);
}

/** A photo or video taken now. Null if you closed the camera or said no to it. */
export async function fromCamera(): Promise<Picked | null> {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  if (!granted) return null;
  const r = await outsideFor(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 }));
  return r.canceled ? null : fromPicker(r.assets[0]);
}

/** Any file. Null if you closed the picker. */
export async function fromFiles(): Promise<Picked | null> {
  const r = await outsideFor(() => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false }));
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const mime = a.mimeType ?? 'application/octet-stream';
  // A photo sent as a document stays a document (sent as it is, never squeezed).
  const kind = kindOf(mime) === 'audio' ? 'audio' : 'doc';
  return { uri: a.uri, mime, kind, name: a.name, size: a.size };
}

/** One photo, cropped square in the picker (for making a sticker). Null if you closed it. */
export async function squarePhoto(): Promise<Picked | null> {
  const r = await outsideFor(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 }));
  return r.canceled || !r.assets[0] ? null : fromPicker(r.assets[0]);
}

/** A song or other sound file, from the phone's files (sent as audio, with a player). Null if you closed the picker. */
export async function fromAudio(): Promise<Picked | null> {
  const r = await outsideFor(() => DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false }));
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, mime: a.mimeType ?? 'audio/mpeg', kind: 'audio', name: a.name, size: a.size };
}
