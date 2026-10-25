// RoundRecorder.tsx: round video messages, from the 📷 in the message bar.
//
//   Tap the 📷       opens the camera (photos and videos to edit and send)
//   Hold the 📷      records a round video with the front camera while you hold
//   Let go           sends it
//   Slide left       cancels (right in Urdu): nothing is sent
//
// It records up to a minute. The circle shows what the camera sees, with a ring
// that fills as the minute goes.
import { CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { stopAll } from '../../core/player';
import { VoiceSession } from '../../core/voice';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration } from '../format';
import { Txt } from '../kit';
import { snappy, thud, tick } from '../motion';
import { toast } from '../overlays';

export type RoundVideo = { uri: string; duration: number };

const MAX_MS = 60_000;
/** Hold this long before it starts recording (a quicker let go is a tap). */
const HOLD_MS = 280;
const CANCEL_AT = 110;
const SIZE = 250;

export function useRoundRecorder({ enabled, onTap, onSend }: { enabled: boolean; onTap: () => void; onSend: (v: RoundVideo) => void }) {
  const t = useT();
  const { rtl } = useLook();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const camera = useRef<CameraView>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const result = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const ready = useRef(false);
  const tx = useSharedValue(0);
  const dir = rtl ? -1 : 1;

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_MS) void finish(false);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function allowed() {
    const cam = await ImagePicker.getCameraPermissionsAsync();
    const mic = await VoiceSession.allowedNow();
    if (cam.granted && mic) return true;
    // The first time, Android asks; the press that asked doesn't record.
    const askCam = cam.granted || (await ImagePicker.requestCameraPermissionsAsync()).granted;
    const askMic = mic || (await VoiceSession.allowed());
    if (!askCam || !askMic) {
      toast(t.cameraNeeded);
      void Linking.openSettings().catch(() => {});
    }
    return false;
  }

  async function begin() {
    if (!(await allowed())) return;
    stopAll();
    thud();
    cancelled.current = false;
    ready.current = false;
    result.current = null;
    startedAt.current = Date.now();
    setElapsed(0);
    setRecording(true);
  }

  /** The camera is on: start recording (it may already have been let go). */
  function cameraReady() {
    if (ready.current || !camera.current) return;
    ready.current = true;
    startedAt.current = Date.now();
    result.current = camera.current.recordAsync({ maxDuration: MAX_MS / 1000 }).catch(() => undefined);
  }

  async function finish(cancel: boolean) {
    if (!recording && !result.current) return;
    const took = Date.now() - startedAt.current;
    cancelled.current = cancel;
    camera.current?.stopRecording();
    const r = await (result.current ?? Promise.resolve(undefined));
    result.current = null;
    setRecording(false);
    if (cancel) return tick();
    if (!r?.uri || took < 800) return toast(t.holdForRound);
    onSend({ uri: r.uri, duration: Math.min(MAX_MS, took) });
  }

  function pressIn() {
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      void begin();
    }, HOLD_MS);
  }

  function pressOut(slid: number) {
    if (holdTimer.current) {
      // Let go before it started: a tap.
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      if (slid < 12) onTap();
      return;
    }
    void finish(slid > CANCEL_AT);
  }

  const gesture = usePanGesture({
    enabled,
    minDistance: 0,
    shouldCancelWhenOutside: false,
    onBegin: () => {
      tx.value = 0;
      scheduleOnRN(pressIn);
    },
    onUpdate: (e) => {
      tx.value = Math.min(0, e.translationX * dir);
    },
    onFinalize: () => {
      const slid = -tx.value;
      tx.value = withSpring(0, snappy);
      scheduleOnRN(pressOut, slid);
    },
  });

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value * dir }],
    opacity: interpolate(-tx.value, [0, CANCEL_AT], [1, 0.25]),
  }));

  return {
    recording,
    gesture,
    overlay: recording ? <RoundOverlay camera={camera} elapsed={elapsed} onReady={cameraReady} slideStyle={slideStyle} /> : null,
  };
}

function RoundOverlay({ camera, elapsed, onReady, slideStyle }: { camera: React.RefObject<CameraView | null>; elapsed: number; onReady: () => void; slideStyle: object }) {
  const t = useT();
  const { theme } = useLook();
  const ring = (SIZE + 16) / 2 - 4;
  const around = 2 * Math.PI * ring;
  return (
    <Animated.View
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(120)}
      pointerEvents="none"
      style={{ position: 'absolute', start: 0, end: 0, bottom: '100%', alignItems: 'center', paddingBottom: 18 }}
      testID="round-recording"
    >
      <View style={{ width: SIZE + 16, height: SIZE + 16, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView ref={camera} style={{ flex: 1 }} facing="front" mode="video" videoQuality="720p" mirror onCameraReady={onReady} />
        </View>
        <Svg width={SIZE + 16} height={SIZE + 16} style={{ position: 'absolute' }}>
          <Circle cx={(SIZE + 16) / 2} cy={(SIZE + 16) / 2} r={ring} stroke="rgba(255,255,255,0.35)" strokeWidth={5} fill="none" />
          <Circle
            cx={(SIZE + 16) / 2}
            cy={(SIZE + 16) / 2}
            r={ring}
            stroke={theme.acc}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${around} ${around}`}
            strokeDashoffset={around * (1 - Math.min(1, elapsed / MAX_MS))}
            transform={`rotate(-90 ${(SIZE + 16) / 2} ${(SIZE + 16) / 2})`}
          />
        </Svg>
      </View>
      <Animated.View style={[{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14, backgroundColor: theme.glassStrong, flexDirection: 'row', gap: 10, alignItems: 'center' }, slideStyle]}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#E5484D' }} />
        <Txt size={14} weight="700" style={{ fontVariant: ['tabular-nums'] }}>
          {duration(elapsed)}
        </Txt>
        <Txt size={13} color={theme.muted}>
          {t.slideToCancelRound} · {t.releaseToSend}
        </Txt>
      </Animated.View>
    </Animated.View>
  );
}
