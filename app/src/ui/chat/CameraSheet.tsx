// CameraSheet.tsx: PakChat's own camera, opened from the 📷 in the message bar
// (or Camera in the attach menu). Full screen and black, like WhatsApp:
//
//   Tap the round button    a photo
//   Hold it                 a video, while you hold (up to 2 minutes)
//   ⚡ / ⟲ / ✕              flash, the other camera, close
//   The row of photos       your newest photos and videos: tap one to send it,
//                           hold to pick several (then ✓)
//   The small square        the whole gallery instead
//
// What you take goes to the editor (MediaComposer.tsx) before it's sent.
import { CameraView, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Picked } from '../../core/files';
import { outsideFor } from '../../core/lock';
import { stopAll } from '../../core/player';
import { VoiceSession } from '../../core/voice';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration } from '../format';
import { Icon } from '../icons';
import { IconButton, Txt } from '../kit';
import { snappy, thud, tick } from '../motion';
import { toast } from '../overlays';

const MAX_VIDEO_S = 120;
/** Hold the button this long and it films instead. */
const HOLD_MS = 320;

export function CameraSheet({ visible, onClose, onTaken, onGallery }: { visible: boolean; onClose: () => void; onTaken: (p: Picked[]) => void; onGallery: () => void }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const t = useT();

  // Asked each time it opens (Android only asks once; after that it's Settings).
  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const now = await ImagePicker.getCameraPermissionsAsync();
      const granted = now.granted || (await outsideFor(() => ImagePicker.requestCameraPermissionsAsync())).granted;
      if (!granted) {
        toast(t.cameraNeeded);
        void Linking.openSettings().catch(() => {});
        onClose();
      }
      setOk(granted);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>{visible && ok && <Camera onClose={onClose} onTaken={onTaken} onGallery={onGallery} />}</View>
    </Modal>
  );
}

function Camera({ onClose, onTaken, onGallery }: { onClose: () => void; onTaken: (p: Picked[]) => void; onGallery: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const cam = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState(false);
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [filming, setFilming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const busy = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const readyWait = useRef<(() => void) | null>(null);
  const recording = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const startedAt = useRef(0);
  const press = useSharedValue(0);

  useEffect(() => {
    stopAll();
  }, []);

  useEffect(() => {
    if (!filming) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    return () => clearInterval(id);
  }, [filming]);

  async function photo() {
    if (busy.current || !cam.current) return;
    busy.current = true;
    tick();
    try {
      const shot = await cam.current.takePictureAsync({ quality: 0.95, exif: false, shutterSound: false });
      if (shot?.uri) onTaken([{ uri: shot.uri, mime: 'image/jpeg', kind: 'image', width: shot.width, height: shot.height }]);
    } catch {
      toast(t.couldNot);
    } finally {
      busy.current = false;
    }
  }

  /** The camera finished switching (photo to video): start filming. */
  function ready() {
    readyWait.current?.();
    readyWait.current = null;
  }

  async function film() {
    const allowed = (await VoiceSession.allowedNow()) || (await VoiceSession.allowed());
    if (!allowed) {
      toast(t.micNeeded);
      return;
    }
    if (!held.current) return;
    thud();
    setMode('video');
    // Wait for the camera to be ready for video (a moment), or half a second at most.
    await new Promise<void>((done) => {
      readyWait.current = done;
      setTimeout(done, 700);
    });
    if (!held.current || !cam.current) return setMode('picture');
    startedAt.current = Date.now();
    setElapsed(0);
    setFilming(true);
    recording.current = cam.current.recordAsync({ maxDuration: MAX_VIDEO_S }).catch(() => undefined);
    // It stops itself at the limit, too.
    void recording.current.then(() => {
      if (held.current) void stopFilm();
    });
  }

  async function stopFilm() {
    held.current = false;
    const job = recording.current;
    if (!job) return setMode('picture');
    recording.current = null;
    const took = Date.now() - startedAt.current;
    cam.current?.stopRecording();
    const r = await job;
    setFilming(false);
    setMode('picture');
    if (!r?.uri || took < 700) return toast(t.tapPhotoHoldVideo);
    onTaken([{ uri: r.uri, mime: 'video/mp4', kind: 'video', duration: Math.min(MAX_VIDEO_S * 1000, took) }]);
  }

  function pressIn() {
    press.value = withSpring(1, snappy);
    held.current = true;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      void film();
    }, HOLD_MS);
  }

  function pressOut() {
    press.value = withSpring(0, snappy);
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      held.current = false;
      void photo();
      return;
    }
    void stopFilm();
  }

  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + press.value * 0.18 }] }));
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(filming ? 0.55 : 1, { duration: 160 }) }], borderRadius: withTiming(filming ? 10 : 30, { duration: 160 }) }));

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        ref={cam}
        style={{ flex: 1 }}
        facing={facing}
        mode={mode}
        flash={flash && mode === 'picture' ? 'on' : 'off'}
        enableTorch={flash && mode === 'video'}
        videoQuality="1080p"
        mirror={facing === 'front'}
        onCameraReady={ready}
        animateShutter
        testID="camera-view"
      />

      {/* The top: close, and the flash. */}
      <View style={{ position: 'absolute', top: insets.top + 8, start: 10, end: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton icon="close" label={t.close} look="onAccent" onPress={onClose} testID="camera-close" />
        {filming && (
          <Animated.View
            entering={FadeIn}
            exiting={FadeOut}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)' }}
          >
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5484D' }} />
            <Txt size={15} weight="700" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
              {duration(elapsed)}
            </Txt>
          </Animated.View>
        )}
        <IconButton icon={flash ? 'flash' : 'flashOff'} label={t.flashWord} look="onAccent" onPress={() => setFlash(!flash)} testID="camera-flash" />
      </View>

      {/* The bottom: the gallery, the button, the other camera. */}
      <View style={{ position: 'absolute', bottom: insets.bottom + 26, start: 0, end: 0, alignItems: 'center', gap: 14 }}>
        {!filming && <Recent onPick={onTaken} />}
        {!filming && (
          <Txt size={13} color="rgba(255,255,255,0.85)" align="center">
            {t.tapPhotoHoldVideo}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 34 }}>
          <View style={{ width: 48, opacity: filming ? 0 : 1 }}>
            <IconButton icon="photo" label={t.gallery} look="onAccent" size={48} onPress={onGallery} disabled={filming} testID="camera-gallery" />
          </View>
          <Pressable onPressIn={pressIn} onPressOut={pressOut} accessibilityRole="button" accessibilityLabel={t.takePhoto} accessibilityHint={t.tapPhotoHoldVideo} testID="shutter">
            <Animated.View style={[{ width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, ring]}>
              <Animated.View style={[{ width: 62, height: 62, backgroundColor: filming ? '#E5484D' : theme.acc }, dot]} />
            </Animated.View>
          </Pressable>
          <View style={{ width: 48, opacity: filming ? 0 : 1 }}>
            <IconButton icon="flipCamera" label={t.flipCamera} look="onAccent" size={48} onPress={() => setFacing(facing === 'back' ? 'front' : 'back')} disabled={filming} testID="camera-flip" />
          </View>
        </View>
      </View>
    </View>
  );
}

const STRIP = 30;
const THUMB = 64;

/** Your newest photos and videos, in a row above the button, like WhatsApp's. */
function Recent({ onPick }: { onPick: (p: Picked[]) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [items, setItems] = useState<MediaLibrary.Asset[]>([]);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const now = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
        const ok = now.granted || (now.canAskAgain && (await outsideFor(() => MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']))).granted);
        if (!ok) return;
        const page = await MediaLibrary.getAssetsAsync({ first: STRIP, mediaType: ['photo', 'video'], sortBy: [['creationTime', false]] });
        if (alive) setItems(page.assets);
      } catch {
        // No gallery row: the square still opens the gallery.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!items.length) return null;
  const send = (list: MediaLibrary.Asset[]) => onPick(list.map(pickedOf));
  const toggle = (id: string) => (tick(), setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])));

  return (
    <View style={{ alignSelf: 'stretch', gap: 10 }}>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(a) => a.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
        renderItem={({ item }) => {
          const n = picked.indexOf(item.id);
          return (
            <Pressable
              onPress={() => (picked.length ? toggle(item.id) : send([item]))}
              onLongPress={() => toggle(item.id)}
              accessibilityRole="button"
              accessibilityLabel={item.mediaType === 'video' ? t.videoLabel : t.photoLabel}
              testID="camera-recent"
            >
              <View style={{ width: THUMB, height: THUMB, borderRadius: 12, overflow: 'hidden', borderWidth: n >= 0 ? 2.5 : 0, borderColor: theme.acc }}>
                <Image source={{ uri: item.uri }} style={{ flex: 1 }} contentFit="cover" recyclingKey={item.id} />
                {item.mediaType === 'video' && (
                  <Txt size={10.5} weight="700" color="#FFFFFF" style={{ position: 'absolute', bottom: 3, start: 5, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 }}>
                    {duration(Math.round(item.duration * 1000))}
                  </Txt>
                )}
                {n >= 0 && (
                  <View style={{ position: 'absolute', top: 4, end: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt size={11} weight="800" color="#FFFFFF">
                      {n + 1}
                    </Txt>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      {picked.length > 0 && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ alignSelf: 'flex-end', marginEnd: 14 }}>
          <Pressable
            onPress={() => send(picked.map((id) => items.find((a) => a.id === id)).filter((a): a is MediaLibrary.Asset => !!a))}
            accessibilityRole="button"
            accessibilityLabel={t.send}
            testID="camera-recent-send"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: theme.acc }}>
              <Icon name="check" size={18} color="#FFFFFF" stroke={2.6} />
              <Txt size={15} weight="700" color="#FFFFFF">
                {picked.length}
              </Txt>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

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
function pickedOf(a: MediaLibrary.Asset): Picked {
  const video = a.mediaType === 'video';
  const ext = (/\.([a-z0-9]+)$/i.exec(a.filename)?.[1] ?? '').toLowerCase();
  const mime = MIMES[ext] ?? (video ? 'video/mp4' : 'image/jpeg');
  return { uri: a.uri, mime, kind: video ? 'video' : 'image', name: a.filename, width: a.width, height: a.height, ...(video ? { duration: Math.round(a.duration * 1000) } : {}) };
}
