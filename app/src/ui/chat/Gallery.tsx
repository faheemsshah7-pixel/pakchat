// Gallery.tsx: PakChat's own gallery, like WhatsApp's 📎 › Gallery. Your
// photos and videos, newest first, in a grid; the albums (Camera, Screenshots,
// WhatsApp Images, …) are chips at the top. Tap to pick, up to 100 at once
// (each shows its number), then ✓ takes them to the editor.
//
// It reads the phone's gallery (asked once, like WhatsApp). Without that, or
// from the ⋯ at the top, the phone's own picker opens instead.
import type { Picked } from '../../core/files';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Modal, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { outsideFor } from '../../core/lock';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration } from '../format';
import { Icon } from '../icons';
import { Chip, IconButton, Pressy, Txt } from '../kit';
import { tick } from '../motion';
import { toast } from '../overlays';

/** The most you can pick at once, as on WhatsApp. */
export const GALLERY_MAX = 100;
const PAGE = 120;
const COLS = 4;

const MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
};

/** A gallery photo or video, ready for the editor. */
export function pickedOf(a: MediaLibrary.Asset): Picked {
  const video = a.mediaType === 'video';
  const ext = (/\.([a-z0-9]+)$/i.exec(a.filename)?.[1] ?? '').toLowerCase();
  const mime = MIMES[ext] ?? (video ? 'video/mp4' : 'image/jpeg');
  return { uri: a.uri, mime, kind: video ? 'video' : 'image', name: a.filename, width: a.width, height: a.height, ...(video ? { duration: Math.round(a.duration * 1000) } : {}) };
}

/** May PakChat read the gallery? Asks once; null if not (then the phone's own picker is used). */
export async function galleryAllowed() {
  try {
    const now = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await outsideFor(() => MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']))).granted;
  } catch {
    return false;
  }
}

// One gallery at a time, opened from anywhere (attachments.ts) and shown by GalleryHost.
type Ask = { id: number; max: number; done: (p: Picked[] | 'system') => void };
let seq = 0;
let asking: Ask | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Opens the gallery; answers what was picked (empty if closed), or 'system' for the phone's own picker. */
export function openGallery(max = GALLERY_MAX): Promise<Picked[] | 'system'> {
  asking?.done([]);
  return new Promise((resolve) => {
    asking = {
      id: ++seq,
      max,
      done: (p) => {
        asking = null;
        changed();
        resolve(p);
      },
    };
    changed();
  });
}

/** In the root layout: the gallery, when something opened it. */
export function GalleryHost() {
  const ask = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => asking,
  );
  return (
    <Modal visible={!!ask} animationType="slide" onRequestClose={() => ask?.done([])} statusBarTranslucent navigationBarTranslucent>
      {ask && <GalleryScreen key={ask.id} ask={ask} />}
    </Modal>
  );
}

function GalleryScreen({ ask }: { ask: Ask }) {
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [album, setAlbum] = useState<string | null>(null);
  const [items, setItems] = useState<MediaLibrary.Asset[] | null>(null);
  const [picked, setPicked] = useState<MediaLibrary.Asset[]>([]);
  const more = useRef<{ after?: string; done: boolean; busy: boolean }>({ done: false, busy: false });
  const size = Math.floor((width - (COLS - 1) * 2) / COLS);

  useEffect(() => {
    void MediaLibrary.getAlbumsAsync()
      .then((list) => setAlbums(list.filter((a) => a.assetCount > 0).sort((a, b) => b.assetCount - a.assetCount)))
      .catch(() => {});
  }, []);

  // A page of the album (or of everything), newest first.
  async function load(fresh: boolean) {
    const m = more.current;
    if (m.busy || (!fresh && m.done)) return;
    m.busy = true;
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        mediaType: ['photo', 'video'],
        sortBy: [['creationTime', false]],
        ...(album ? { album } : {}),
        ...(!fresh && m.after ? { after: m.after } : {}),
      });
      m.after = page.endCursor;
      m.done = !page.hasNextPage;
      setItems((old) => (fresh ? page.assets : [...(old ?? []), ...page.assets]));
    } catch {
      setItems((old) => old ?? []);
    } finally {
      m.busy = false;
    }
  }

  useEffect(() => {
    more.current = { done: false, busy: false };
    setTimeout(() => void load(true), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album]);

  const toggle = (a: MediaLibrary.Asset) => {
    tick();
    if (picked.some((p) => p.id === a.id)) setPicked(picked.filter((p) => p.id !== a.id));
    else if (picked.length >= ask.max) toast(fill(t.pickUpTo, { n: ask.max }));
    else setPicked([...picked, a]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }} testID="gallery">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6 }}>
        <IconButton icon="close" label={t.close} onPress={() => ask.done([])} testID="gallery-close" />
        <Txt size={18} weight="700" style={{ flex: 1 }}>
          {picked.length ? fill(t.nSelected, { n: picked.length }) : t.gallery}
        </Txt>
        <IconButton icon="folder" label={t.otherGallery} onPress={() => ask.done('system')} testID="gallery-system" />
      </View>
      {albums.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingBottom: 8 }} style={{ flexGrow: 0 }}>
          <Chip label={t.recentsWord} on={album === null} onPress={() => setAlbum(null)} testID="gallery-album-recents" />
          {albums.map((a) => (
            <Chip key={a.id} label={a.title} count={a.assetCount} on={album === a.id} onPress={() => setAlbum(a.id)} testID={`gallery-album-${a.title}`} />
          ))}
        </ScrollView>
      )}
      {items === null ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={theme.acc} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          numColumns={COLS}
          columnWrapperStyle={{ gap: 2 }}
          contentContainerStyle={{ gap: 2, paddingBottom: insets.bottom + 90 }}
          onEndReached={() => void load(false)}
          onEndReachedThreshold={1.5}
          initialNumToRender={32}
          windowSize={7}
          ListEmptyComponent={
            <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 50 }}>
              {t.nothingHere}
            </Txt>
          }
          renderItem={({ item }) => {
            const n = picked.findIndex((p) => p.id === item.id);
            return (
              <Pressy onPress={() => toggle(item)} label={item.mediaType === 'video' ? t.videoLabel : t.photoLabel} scale={0.94} testID="gallery-item">
                <View style={{ width: size, height: size, backgroundColor: theme.glass }}>
                  <Image source={{ uri: item.uri }} style={{ flex: 1 }} contentFit="cover" recyclingKey={item.id} />
                  {item.mediaType === 'video' && (
                    <View style={{ position: 'absolute', start: 5, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Icon name="video" size={13} color="#FFFFFF" />
                      <Txt size={11} weight="700" color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 }}>
                        {duration(Math.round(item.duration * 1000))}
                      </Txt>
                    </View>
                  )}
                  {n >= 0 && <View style={{ position: 'absolute', inset: 0, backgroundColor: theme.acc, opacity: 0.25 }} />}
                  <View
                    style={{
                      position: 'absolute',
                      top: 5,
                      end: 5,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 2,
                      borderColor: '#FFFFFF',
                      backgroundColor: n >= 0 ? theme.acc : 'rgba(0,0,0,0.2)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {n >= 0 && (
                      <Txt size={11} weight="800" color="#FFFFFF">
                        {n + 1}
                      </Txt>
                    )}
                  </View>
                </View>
              </Pressy>
            );
          }}
        />
      )}
      {picked.length > 0 && (
        <Animated.View style={{ position: 'absolute', end: 18, bottom: insets.bottom + 22 }}>
          <Pressy onPress={() => ask.done(picked.map(pickedOf))} label={t.send} scale={0.92} testID="gallery-done">
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 20,
                height: 52,
                borderRadius: 26,
                backgroundColor: theme.acc,
                boxShadow: `0 10px 24px -8px ${theme.shadow}`,
              }}
            >
              <Icon name="check" size={20} color="#FFFFFF" stroke={2.6} />
              <Txt size={16} weight="700" color="#FFFFFF">
                {picked.length}
              </Txt>
            </View>
          </Pressy>
        </Animated.View>
      )}
    </View>
  );
}
