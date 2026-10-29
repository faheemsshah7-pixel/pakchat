// CameraSheet.tsx: PakChat's own camera, opened from the 📷 in the message bar
// (or Camera in the attach menu). Laid out like WhatsApp's:
//
//   ✕ and ⚡ at the top        close, and the flash (round, over the picture)
//   The row of squares        your newest photos and videos: tap to pick (each
//                             shows its number), then the green Send takes them
//                             to the editor. Swipe it up (or tap the — above it)
//                             for the whole gallery.
//   The bar under it          the gallery, the white button, the other camera
//   Video · Photo · Video note   the modes: tap one, or swipe the picture sideways
//
//   Photo        tap for a photo; hold for a video while you hold (up to 2 minutes)
//   Video        tap to start filming, tap again to stop
//   Video note   a round video with the front camera (up to a minute), sent as it is
//
// What you take or pick goes to the editor (MediaComposer.tsx) before it's sent.
import { CameraView, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import type { Picked } from '../../core/files';
import { outsideFor } from '../../core/lock';
import { stopAll } from '../../core/player';
import { VoiceSession } from '../../core/voice';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration } from '../format';
import { Icon, type IconName } from '../icons';
import { Pressy, Txt } from '../kit';
import { thud, tick } from '../motion';
import { pickedOf } from './Gallery';
import type { RoundVideo } from './RoundRecorder';
import { toast } from '../overlays';

const MAX_VIDEO_S = 120;
const MAX_NOTE_S = 60;
/** Hold the button this long (in Photo) and it films instead. */
const HOLD_MS = 320;
const RED = '#E5484D';

type Kind = 'video' | 'photo' | 'note';

export function CameraSheet({
  visible,
  onClose,
  onTaken,
  onGallery,
  onRound,
}: {
  visible: boolean;
  onClose: () => void;
  onTaken: (p: Picked[]) => void;
  onGallery: () => void;
  /** A video note was recorded (only in a chat; without it there's no Video note mode). */
  onRound?: (v: RoundVideo) => void;
}) {
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
    <Modal visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* Swipes inside a Modal need their own gesture root on Android. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        {visible && ok && <Camera onClose={onClose} onTaken={onTaken} onGallery={onGallery} onRound={onRound} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Camera({ onClose, onTaken, onGallery, onRound }: { onClose: () => void; onTaken: (p: Picked[]) => void; onGallery: () => void; onRound?: (v: RoundVideo) => void }) {
  const t = useT();
  const { rtl } = useLook();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cam = useRef<CameraView>(null);
  const kinds: Kind[] = onRound ? ['video', 'photo', 'note'] : ['video', 'photo'];
  const [kind, setKind] = useState<Kind>('photo');
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState(false);
  // In Photo, holding the button switches the camera to video for a moment.
  const [holding, setHolding] = useState(false);
  const [filming, setFilming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const busy = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const readyWait = useRef<(() => void) | null>(null);
  const recording = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const startedAt = useRef(0);
  const note = kind === 'note';
  const limit = note ? MAX_NOTE_S : MAX_VIDEO_S;

  useEffect(() => {
    stopAll();
  }, []);

  useEffect(() => {
    if (!filming) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    return () => clearInterval(id);
  }, [filming]);

  function choose(k: Kind) {
    if (filming || k === kind) return;
    tick();
    // A video note is of you, so it starts on the front camera, like WhatsApp.
    if (k === 'note') setFacing('front');
    else if (kind === 'note') setFacing('back');
    setKind(k);
  }

  // Swiping the picture sideways moves to the next mode.
  function swiped(dx: number) {
    const step = (rtl ? -dx : dx) < 0 ? 1 : -1;
    const next = kinds[kinds.indexOf(kind) + step];
    if (next) choose(next);
  }
  const swipe = usePanGesture({
    enabled: !filming,
    activeOffsetX: [-30, 30],
    failOffsetY: [-25, 25],
    onDeactivate: (e) => {
      'worklet';
      if (Math.abs(e.translationX) > 60) scheduleOnRN(swiped, e.translationX);
    },
  });

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

  /** The camera is ready (or finished switching from photo to video). */
  function ready() {
    readyWait.current?.();
    readyWait.current = null;
  }

  async function micOk() {
    const allowed = (await VoiceSession.allowedNow()) || (await VoiceSession.allowed());
    if (!allowed) toast(t.micNeeded);
    return allowed;
  }

  function record() {
    if (!cam.current) return;
    thud();
    held.current = true;
    startedAt.current = Date.now();
    setElapsed(0);
    setFilming(true);
    recording.current = cam.current.recordAsync({ maxDuration: limit }).catch(() => undefined);
    // It stops itself at the limit, too.
    void recording.current.then(() => {
      if (held.current) void stopFilm();
    });
  }

  /** Photo: the button is being held, so film while it is. */
  async function filmWhileHeld() {
    if (!(await micOk()) || !held.current) return;
    setHolding(true);
    // Wait for the camera to be ready for video (a moment), or 0.7 s at most.
    await new Promise<void>((done) => {
      readyWait.current = done;
      setTimeout(done, 700);
    });
    if (!held.current || !cam.current) return setHolding(false);
    record();
  }

  async function stopFilm() {
    held.current = false;
    const job = recording.current;
    if (!job) return setHolding(false);
    recording.current = null;
    const took = Date.now() - startedAt.current;
    cam.current?.stopRecording();
    const r = await job;
    setFilming(false);
    setHolding(false);
    if (!r?.uri || took < 700) return toast(kind === 'photo' ? t.tapPhotoHoldVideo : t.couldNot);
    if (note && onRound) onRound({ uri: r.uri, duration: Math.min(MAX_NOTE_S * 1000, took) });
    else onTaken([{ uri: r.uri, mime: 'video/mp4', kind: 'video', duration: Math.min(MAX_VIDEO_S * 1000, took) }]);
  }

  function pressIn() {
    if (kind !== 'photo') return;
    held.current = true;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      void filmWhileHeld();
    }, HOLD_MS);
  }

  async function pressOut() {
    if (kind !== 'photo') {
      // Video and Video note: tap to start, tap again to stop.
      if (filming) return void stopFilm();
      if (await micOk()) record();
      return;
    }
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      held.current = false;
      void photo();
      return;
    }
    void stopFilm();
  }

  // White for a photo; red for video; a small red rounded square while filming.
  const dotColor = kind === 'photo' && !filming ? '#FFFFFF' : RED;

  const circle = Math.min(width - 56, 300);
  const camera = (
    <CameraView
      ref={cam}
      style={{ flex: 1 }}
      facing={facing}
      mode={kind === 'photo' && !holding ? 'picture' : 'video'}
      flash={flash && kind === 'photo' && !holding ? 'on' : 'off'}
      enableTorch={flash && !note && (kind === 'video' || holding)}
      videoQuality={note ? '720p' : '1080p'}
      mirror={facing === 'front'}
      onCameraReady={ready}
      animateShutter={false}
      testID="camera-view"
    />
  );

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      {/* The picture, with everything over it. */}
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <GestureDetector gesture={swipe}>
          <View style={StyleSheet.absoluteFill}>
            {note ? (
              // A video note: what the front camera sees, in a circle, like WhatsApp.
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }}>
                <View style={{ width: circle, height: circle, borderRadius: circle / 2, overflow: 'hidden', backgroundColor: '#111' }}>{camera}</View>
                {filming && <NoteRing size={circle} progress={elapsed / (MAX_NOTE_S * 1000)} />}
              </View>
            ) : (
              camera
            )}
          </View>
        </GestureDetector>

        {/* The top: close, the time while filming, and the flash. */}
        <View style={{ position: 'absolute', top: 12, start: 12, end: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Round icon="close" size={42} label={t.close} onPress={onClose} testID="camera-close" />
          {filming && (
            <Animated.View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)' }}
            >
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: RED }} />
              <Txt size={15} weight="700" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
                {duration(elapsed)}
              </Txt>
            </Animated.View>
          )}
          {note ? <View style={{ width: 42 }} /> : <Round icon={flash ? 'flash' : 'flashOff'} size={42} label={t.flashWord} onPress={() => setFlash(!flash)} testID="camera-flash" />}
        </View>

        {/* The bottom: the newest photos, then the gallery, the button and the other camera. */}
        <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0 }}>
          {!filming && !note && <Recent onPick={onTaken} onGallery={onGallery} />}
          {note && !filming && (
            <Txt size={14} weight="600" color="#FFFFFF" align="center" style={{ marginBottom: 12, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 }}>
              {t.tapToRecord}
            </Txt>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.3)' }}>
            <View style={{ opacity: filming ? 0 : 1 }} pointerEvents={filming ? 'none' : 'auto'}>
              <Round icon="photo" size={52} label={t.gallery} onPress={onGallery} testID="camera-gallery" />
            </View>
            <Pressable
              onPressIn={pressIn}
              onPressOut={() => void pressOut()}
              accessibilityRole="button"
              accessibilityLabel={kind === 'photo' ? t.takePhoto : filming ? t.stopWord : kind === 'note' ? t.videoNote : t.videoLabel}
              accessibilityHint={kind === 'photo' ? t.tapPhotoHoldVideo : t.tapToRecord}
              testID="shutter"
            >
              <View style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: filming ? 29 : 58, height: filming ? 29 : 58, borderRadius: filming ? 8 : 29, backgroundColor: dotColor }} />
              </View>
            </Pressable>
            <View style={{ opacity: filming ? 0 : 1 }} pointerEvents={filming ? 'none' : 'auto'}>
              <Round icon="flipCamera" size={52} label={t.flipCamera} onPress={() => setFacing(facing === 'back' ? 'front' : 'back')} testID="camera-flip" />
            </View>
          </View>
        </View>
      </View>

      {/* Video · Photo · Video note, under the picture on black. */}
      <View style={{ paddingTop: 12, paddingBottom: insets.bottom + 14, opacity: filming ? 0 : 1 }} pointerEvents={filming ? 'none' : 'auto'}>
        <Modes kinds={kinds} kind={kind} onPick={choose} />
      </View>
    </View>
  );
}

/** A round, see-through dark button over the picture, like WhatsApp's. */
function Round({ icon, size, label, onPress, testID }: { icon: IconName; size: number; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressy onPress={onPress} label={label} scale={0.9} testID={testID}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={Math.round(size * 0.48)} color="#FFFFFF" />
      </View>
    </Pressy>
  );
}

const MODE_W = 116;

/** The modes in a row, the chosen one in the middle in a soft pill (it moves there at once). */
function Modes({ kinds, kind, onPick }: { kinds: Kind[]; kind: Kind; onPick: (k: Kind) => void }) {
  const t = useT();
  const { rtl } = useLook();
  const label = { video: t.videoLabel, photo: t.photoLabel, note: t.videoNote };
  // The row is centred; this moves it so the chosen one sits in the middle.
  const middle = (kinds.length - 1) / 2;
  const shift = (middle - kinds.indexOf(kind)) * MODE_W * (rtl ? -1 : 1);
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', transform: [{ translateX: shift }] }}>
        {kinds.map((k) => (
          <Pressable key={k} onPress={() => onPick(k)} accessibilityRole="button" accessibilityLabel={label[k]} accessibilityState={{ selected: k === kind }} testID={`camera-mode-${k}`}>
            <View style={{ width: MODE_W, alignItems: 'center' }}>
              <View style={{ paddingHorizontal: 16, height: 38, borderRadius: 19, justifyContent: 'center', backgroundColor: k === kind ? 'rgba(255,255,255,0.16)' : 'transparent' }}>
                <Txt size={15} weight={k === kind ? '700' : '500'} color={k === kind ? '#FFFFFF' : 'rgba(255,255,255,0.85)'} lines={1}>
                  {label[k]}
                </Txt>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The ring round a video note that fills as its minute goes. */
function NoteRing({ size, progress }: { size: number; progress: number }) {
  const { theme } = useLook();
  const box = size + 16;
  const r = box / 2 - 4;
  const around = 2 * Math.PI * r;
  return (
    <Svg width={box} height={box} style={{ position: 'absolute', top: '50%', marginTop: -box / 2 - 40 }} pointerEvents="none">
      <Circle cx={box / 2} cy={box / 2} r={r} stroke="rgba(255,255,255,0.35)" strokeWidth={5} fill="none" />
      <Circle
        cx={box / 2}
        cy={box / 2}
        r={r}
        stroke={theme.acc}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${around} ${around}`}
        strokeDashoffset={around * (1 - Math.min(1, progress))}
        transform={`rotate(-90 ${box / 2} ${box / 2})`}
      />
    </Svg>
  );
}

const STRIP = 30;
const TILE = 66;

/**
 * Your newest photos and videos, in a row of squares edge to edge, like WhatsApp's.
 * Tap to pick (or unpick); Send takes the picked ones to the editor. Swipe up for the gallery.
 */
function Recent({ onPick, onGallery }: { onPick: (p: Picked[]) => void; onGallery: () => void }) {
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
        // No row: the gallery button still opens the gallery.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (id: string) => (tick(), setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])));
  const send = () =>
    onPick(
      picked
        .map((id) => items.find((a) => a.id === id))
        .filter((a): a is MediaLibrary.Asset => !!a)
        .map(pickedOf),
    );

  // Pulling the row (or the handle) up opens the whole gallery; sideways it scrolls.
  const up = usePanGesture({
    activeOffsetY: [-18, 1000],
    failOffsetX: [-14, 14],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY < -40) scheduleOnRN(onGallery);
    },
  });

  return (
    <View>
      {picked.length > 0 && (
        <Animated.View style={{ alignSelf: 'flex-end', marginEnd: 14, marginBottom: 10 }}>
          <Pressy onPress={send} label={t.send} scale={0.92} testID="camera-recent-send">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: theme.acc }}>
              <Icon name="send" size={19} color="#FFFFFF" flip />
              <Txt size={16} weight="700" color="#FFFFFF">
                {picked.length}
              </Txt>
            </View>
          </Pressy>
        </Animated.View>
      )}
      <GestureDetector gesture={up}>
        <View>
          <Pressable onPress={onGallery} accessibilityRole="button" accessibilityLabel={t.swipeUpGallery} hitSlop={10} style={{ alignSelf: 'center', paddingVertical: 8 }} testID="camera-handle">
            <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' }} />
          </Pressable>
          {items.length > 0 && (
            <FlatList
              horizontal
              data={items}
              keyExtractor={(a) => a.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 3 }}
              renderItem={({ item }) => {
                const n = picked.indexOf(item.id);
                return (
                  <Pressable
                    onPress={() => toggle(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={item.mediaType === 'video' ? t.videoLabel : t.photoLabel}
                    accessibilityState={{ selected: n >= 0 }}
                    testID="camera-recent"
                  >
                    <View style={{ width: TILE, height: TILE, backgroundColor: '#222' }}>
                      <Image source={{ uri: item.uri }} style={{ flex: 1 }} contentFit="cover" recyclingKey={item.id} />
                      {item.mediaType === 'video' && (
                        <View style={{ position: 'absolute', start: 5, bottom: 4 }}>
                          <Icon name="video" size={15} color="#FFFFFF" />
                        </View>
                      )}
                      {n >= 0 && <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 2.5, borderColor: theme.acc }} />}
                      {n >= 0 && (
                        <View
                          style={{
                            position: 'absolute',
                            top: 4,
                            end: 4,
                            width: 21,
                            height: 21,
                            borderRadius: 11,
                            borderWidth: 1.5,
                            borderColor: '#FFFFFF',
                            backgroundColor: theme.acc,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
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
          )}
          <View style={{ height: 3 }} />
        </View>
      </GestureDetector>
    </View>
  );
}
