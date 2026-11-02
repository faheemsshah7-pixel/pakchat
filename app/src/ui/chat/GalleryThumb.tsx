// GalleryThumb.tsx: one tile's picture in PakChat's gallery and in the row under the camera.
//
// It shows the phone's own small preview of the photo or video (GalleryThumbs.kt), the one
// Google Photos and WhatsApp use, never the whole file: making previews from whole photos and
// videos left the tiles empty and froze the app on a phone full of videos (owner, 2 Nov).
import { Image } from 'expo-image';
import type * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useState } from 'react';
import { PixelRatio, View } from 'react-native';

import { fileModule } from '../../../modules/pakchat-signal';

// Each preview once per run: its address, or null if the phone has none.
const known = new Map<string, string | null>();
const asking = new Map<string, Promise<string | null>>();

/** One preview: the item, its size, and when it last changed (an edited photo gets a new one). */
const keyOf = (a: MediaLibrary.Asset, px: number) => `${a.id}:${px}:${Math.round(a.modificationTime || 0)}`;

function thumb(a: MediaLibrary.Asset, px: number): Promise<string | null> {
  const key = keyOf(a, px);
  const was = asking.get(key);
  if (was) return was;
  const p = fileModule()
    .galleryThumb(a.id, a.mediaType === 'video', px, Math.round(a.modificationTime || 0))
    .catch(() => null)
    .then((uri) => {
      known.set(key, uri);
      asking.delete(key);
      return uri;
    });
  asking.set(key, p);
  return p;
}

/** The tile's picture, `size` points square, on `bg` until it comes. */
export function GalleryThumb({ asset, size, bg }: { asset: MediaLibrary.Asset; size: number; bg: string }) {
  // Pixels across, in steps, so tiles of about the same size share a preview.
  const px = Math.min(512, Math.ceil((size * PixelRatio.get()) / 64) * 64);
  const key = keyOf(asset, px);
  // Known already (shown at once), or fetched for this key; undefined while it comes.
  const [got, setGot] = useState<{ key: string; uri: string | null } | null>(null);
  const uri = known.has(key) ? known.get(key) : got?.key === key ? got.uri : undefined;
  useEffect(() => {
    if (known.has(key)) return;
    let alive = true;
    void thumb(asset, px).then((u) => alive && setGot({ key, uri: u }));
    return () => {
      alive = false;
    };
    // (The asset is the same as long as its key is.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // No preview from the phone (rare): a photo is shown from itself; a video stays a plain tile.
  const source = uri ? { uri } : uri === null && asset.mediaType !== 'video' ? { uri: asset.uri } : null;
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {source && <Image source={source} style={{ flex: 1 }} contentFit="cover" recyclingKey={asset.id} transition={120} />}
    </View>
  );
}
