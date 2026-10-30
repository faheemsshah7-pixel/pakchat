// VoiceRecorder.tsx: the mic button's voice notes, as on WhatsApp.
//
//   Hold the mic        it records while you hold; let go and it sends.
//   Slide left          cancels (right in Urdu): nothing is sent.
//   Slide up to the 🔒   locks: let go and it keeps recording. Then:
//                         🗑 deletes, ⏸ pauses (and you can listen back,
//                         tap the bars to jump, 🎤 to record more), ➤ sends.
//   Tap the mic once    the same locked recording, without holding.
//   ①                   (locked or paused) view once: they can play it one time.
//
// The mic button itself stays in place the whole time (it holds your finger),
// and becomes the send button once locked. The recording is in core/voice.ts.
import { useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { core } from '../../core/core';
import { stopAll } from '../../core/player';
import { barsOf, MAX_VOICE_MS, MIN_VOICE_MS, VOICE_OPTIONS, VoiceSession, type Recorded } from '../../core/voice';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration } from '../format';
import { Icon } from '../icons';
import { IconButton, Pressy, Txt } from '../kit';
import { fadeIn, fadeOut, quick, snappy, tick } from '../motion';
import { toast } from '../overlays';

/** How far to slide to cancel, and up to lock (in points). */
const CANCEL_AT = 110;
const LOCK_AT = 80;
/** Let go sooner than this, without moving, and it was a tap. */
const TAP_MS = 300;

export type VoiceMode = 'idle' | 'holding' | 'locked' | 'paused';

export function useVoiceRecorder({ chatId, enabled, onSend }: { chatId: string; enabled: boolean; onSend: (v: Recorded) => void }) {
  const t = useT();
  const { rtl } = useLook();
  const rec = useAudioRecorder(VOICE_OPTIONS);
  const session = useRef<VoiceSession | null>(null);
  const [mode, setModeState] = useState<VoiceMode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<Recorded | null>(null);
  // View once, for a locked recording (a held one sends as you let go).
  const [once, setOnce] = useState(false);
  const allowed = useRef(false);
  const busy = useRef(false);

  // Where the finger is, on the UI thread: the slide and the lock follow it.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // 0 nothing, 1 holding, 2 locked or paused (the button sends).
  const phase = useSharedValue(0);
  const startedIn = useSharedValue(0);
  const startedAt = useSharedValue(0);
  const ended = useSharedValue(false);
  // How far the finger went in all, to tell a tap from a hold.
  const moved = useSharedValue(0);
  const dir = rtl ? -1 : 1;

  const setMode = (m: VoiceMode) => {
    setModeState(m);
    phase.value = m === 'idle' ? 0 : m === 'holding' ? 1 : 2;
  };

  useEffect(() => {
    void VoiceSession.allowedNow().then((ok) => (allowed.current = ok));
  }, []);

  // While recording: ten loudness samples a second, and the clock.
  const recording = mode === 'holding' || mode === 'locked';
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const s = session.current;
      if (!s) return;
      const ms = s.sample();
      setElapsed(ms);
      // 15 minutes: a held one sends, a locked one pauses for you to decide.
      if (ms >= MAX_VOICE_MS) void (mode === 'holding' ? release() : pauseIt());
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, mode]);

  // While recording, they see "recording audio…" (said again every few seconds, as typing is).
  useEffect(() => {
    if (!recording) return;
    core.client.typing(chatId, true, true);
    const id = setInterval(() => core.client.typing(chatId, true, true), 4_000);
    return () => {
      clearInterval(id);
      core.client.typing(chatId, false);
    };
  }, [recording, chatId]);

  // Leaving the chat throws an unsent recording away.
  useEffect(
    () => () => {
      void session.current?.discard();
      session.current = null;
    },
    [],
  );

  async function begin() {
    if (session.current || busy.current) return;
    if (!allowed.current) {
      // The first time, Android asks; the press that asked doesn't record.
      ended.value = true;
      const ok = await VoiceSession.allowed();
      allowed.current = ok;
      if (!ok) {
        toast(t.micNeeded);
        void Linking.openSettings().catch(() => {});
      } else toast(t.holdToRecord);
      return;
    }
    stopAll();
    tick();
    const s = new VoiceSession(rec);
    session.current = s;
    setElapsed(0);
    setPreview(null);
    setOnce(false);
    setMode('holding');
    try {
      await s.record();
    } catch {
      if (session.current === s) {
        session.current = null;
        setMode('idle');
      }
      await s.discard();
      toast(t.couldNot);
    }
  }

  /** Let go while holding: send it (if it's long enough). */
  async function release() {
    const s = session.current;
    if (!s) return;
    session.current = null;
    setMode('idle');
    const v = await s.finish(MIN_VOICE_MS).catch(() => null);
    if (v) onSend(v);
    else toast(t.holdToRecord);
  }

  async function cancel() {
    const s = session.current;
    session.current = null;
    setMode('idle');
    setPreview(null);
    tick();
    await s?.discard();
  }

  function lock() {
    // A tap that only asked for the mic: nothing is recording.
    if (!session.current) return setMode('idle');
    tick();
    setMode('locked');
  }

  async function pauseIt() {
    const s = session.current;
    if (!s || busy.current) return;
    busy.current = true;
    try {
      const v = await s.pause();
      if (session.current !== s) return;
      setPreview(v);
      setElapsed(v?.duration ?? s.elapsed);
      setMode('paused');
    } catch {
      toast(t.couldNot);
    } finally {
      busy.current = false;
    }
  }

  async function resume() {
    const s = session.current;
    if (!s || busy.current) return;
    busy.current = true;
    setPreview(null);
    setMode('locked');
    try {
      await s.record();
    } catch {
      toast(t.couldNot);
    } finally {
      busy.current = false;
    }
  }

  /** The send button, once locked or paused. */
  async function sendLocked() {
    const s = session.current;
    if (busy.current) return;
    if (!s) return setMode('idle');
    session.current = null;
    setMode('idle');
    setPreview(null);
    const v = await s.finish(1).catch(() => null);
    if (v) onSend(once ? { ...v, once: true } : v);
  }

  const pan = usePanGesture({
    enabled: enabled || mode !== 'idle',
    minDistance: 0,
    shouldCancelWhenOutside: false,
    onBegin: () => {
      startedIn.value = phase.value;
      startedAt.value = Date.now();
      ended.value = false;
      moved.value = 0;
      tx.value = 0;
      ty.value = 0;
      if (phase.value === 0) scheduleOnRN(begin);
    },
    onUpdate: (e) => {
      moved.value = Math.max(moved.value, Math.abs(e.translationX) + Math.abs(e.translationY));
      if (startedIn.value !== 0 || ended.value) return;
      tx.value = Math.min(0, e.translationX * dir);
      ty.value = Math.min(0, e.translationY);
      if (phase.value !== 1) return;
      if (-tx.value > CANCEL_AT) {
        ended.value = true;
        tx.value = withSpring(0, snappy);
        ty.value = 0;
        scheduleOnRN(cancel);
      } else if (-ty.value > LOCK_AT) {
        ended.value = true;
        tx.value = withSpring(0, snappy);
        ty.value = withSpring(0, snappy);
        phase.value = 2;
        scheduleOnRN(lock);
      }
    },
    onFinalize: () => {
      tx.value = withSpring(0, snappy);
      ty.value = withSpring(0, snappy);
      if (startedIn.value === 2) {
        // Locked or paused: the button is "send".
        if (moved.value < 20) scheduleOnRN(sendLocked);
        return;
      }
      if (ended.value) return;
      ended.value = true;
      if (Date.now() - startedAt.value < TAP_MS && moved.value < 12) {
        // A tap: the same as sliding up to lock.
        phase.value = 2;
        scheduleOnRN(lock);
      } else scheduleOnRN(release);
    },
  });

  // ---- How it looks ----

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value * dir }],
    opacity: interpolate(-tx.value, [0, CANCEL_AT], [1, 0.2]),
  }));
  const micStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value * dir }, { translateY: ty.value * 0.6 }, { scale: withTiming(phase.value === 1 ? 1.35 : 1, quick) }],
  }));
  const lockStyle = useAnimatedStyle(() => ({
    opacity: phase.value === 1 ? 1 : 0,
    transform: [{ translateY: ty.value * 0.5 }],
  }));

  return {
    mode,
    gesture: pan,
    micStyle,
    lockHint: mode === 'holding' ? <LockHint style={lockStyle} /> : null,
    strip:
      mode === 'holding' ? (
        <HoldStrip elapsed={elapsed} slideStyle={slideStyle} label={t.slideToCancel} />
      ) : mode === 'locked' ? (
        <LockedStrip elapsed={elapsed} levels={session.current?.levels ?? []} onDelete={cancel} onPause={pauseIt} once={<OnceToggle on={once} onChange={setOnce} />} />
      ) : mode === 'paused' ? (
        <PausedStrip preview={preview} elapsed={elapsed} onDelete={cancel} onResume={resume} once={<OnceToggle on={once} onChange={setOnce} />} />
      ) : null,
  };
}

/** A red dot that slowly blinks while recording. */
function RecDot() {
  const v = useSharedValue(1);
  useEffect(() => {
    v.value = withRepeat(withTiming(0.25, { duration: 600 }), -1, true);
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5484D' }, style]} />;
}

function HoldStrip({ elapsed, slideStyle, label }: { elapsed: number; slideStyle: object; label: string }) {
  const { theme } = useLook();
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={{ flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingStart: 10 }} testID="voice-holding">
      <RecDot />
      <Txt size={15} weight="600" color={theme.text} style={{ minWidth: 44, fontVariant: ['tabular-nums'] }}>
        {duration(elapsed)}
      </Txt>
      <Animated.View style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, slideStyle]}>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chevron" size={16} color={theme.muted} flip />
        </View>
        <Txt size={14} color={theme.muted}>
          {label}
        </Txt>
      </Animated.View>
    </Animated.View>
  );
}

/** The 🔒 above the mic while holding: slide up to it. */
function LockHint({ style }: { style: object }) {
  const { theme } = useLook();
  return (
    <Animated.View
      entering={fadeIn}
      exiting={fadeOut}
      pointerEvents="none"
      style={[{ position: 'absolute', end: 18, bottom: 74, width: 40, paddingVertical: 10, borderRadius: 20, backgroundColor: theme.glassStrong, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: theme.glassLine }, style]}
    >
      <Icon name="lock" size={18} color={theme.text} />
      <View style={{ transform: [{ rotate: '-90deg' }] }}>
        <Icon name="chevron" size={14} color={theme.muted} />
      </View>
    </Animated.View>
  );
}

/** Live bars: the last few seconds, moving left as you talk. */
function LiveBars({ levels }: { levels: number[] }) {
  const { theme } = useLook();
  const recent = levels.slice(-28);
  return (
    <View style={{ flex: 1, minWidth: 0, height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' }}>
      {recent.map((l, i) => (
        <View key={levels.length - recent.length + i} style={{ width: 3, height: Math.max(3, Math.round((l / 255) * 26)), borderRadius: 2, backgroundColor: theme.acc }} />
      ))}
    </View>
  );
}

/** ① View once: WhatsApp's mark, a filled green "1" when on. */
export function OnceToggle({ on, onChange, light }: { on: boolean; onChange: (on: boolean) => void; light?: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const ink = light ? '#FFFFFF' : theme.muted;
  return (
    <Pressy
      onPress={() => {
        tick();
        toast(on ? t.viewOnceOff : t.viewOnceOn);
        onChange(!on);
      }}
      label={t.viewOnce}
      scale={0.88}
      testID="view-once"
    >
      {/* Off: WhatsApp's view once mark. On: a filled green circle with the 1. */}
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: on ? theme.acc : 'transparent', alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 }}>
        {on ? (
          <Txt size={14} weight="800" color="#FFFFFF">
            1
          </Txt>
        ) : (
          <Icon name="once" size={28} color={ink} stroke={1.8} />
        )}
      </View>
    </Pressy>
  );
}

function LockedStrip({ elapsed, levels, onDelete, onPause, once }: { elapsed: number; levels: number[]; onDelete: () => void; onPause: () => void; once: ReactNode }) {
  const t = useT();
  const { theme } = useLook();
  return (
    <Animated.View entering={fadeIn} style={{ flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="voice-locked">
      <IconButton icon="trash" label={t.deleteRecording} onPress={onDelete} color={theme.muted} testID="voice-delete" />
      <RecDot />
      <Txt size={15} weight="600" color={theme.text} style={{ minWidth: 44, fontVariant: ['tabular-nums'] }}>
        {duration(elapsed)}
      </Txt>
      <LiveBars levels={levels} />
      {once}
      <IconButton icon="pause" label={t.pause} onPress={onPause} color="#E5484D" testID="voice-pause" />
    </Animated.View>
  );
}

function PausedStrip({ preview, elapsed, onDelete, onResume, once }: { preview: Recorded | null; elapsed: number; onDelete: () => void; onResume: () => void; once: ReactNode }) {
  const t = useT();
  const { theme } = useLook();
  const player = useAudioPlayer(preview ? { uri: preview.uri } : null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  // The wave fills whatever room is left (less once ① is there), 5 px a bar.
  const [width, setWidth] = useState(0);
  const bars = useMemo(() => (width ? barsOf(preview?.waveform, Math.max(8, Math.floor((width + 2) / 5))) : []), [preview?.waveform, width]);
  const length = preview?.duration ?? elapsed;
  const at = Math.round((status.currentTime ?? 0) * 1000);
  const done = length ? Math.min(1, at / length) : 0;

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  return (
    <Animated.View entering={fadeIn} style={{ flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="voice-paused">
      <IconButton
        icon="trash"
        label={t.deleteRecording}
        onPress={() => {
          player.pause();
          onDelete();
        }}
        color={theme.muted}
        testID="voice-delete"
      />
      <Pressy onPress={() => (status.playing ? player.pause() : player.play())} label={status.playing ? t.pause : t.play} scale={0.9} testID="voice-preview">
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={status.playing ? 'pause' : 'play'} size={16} color={theme.accInk} />
        </View>
      </Pressy>
      <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
        <Pressable
          onPress={(e) => void player.seekTo((Math.min(1, Math.max(0, e.nativeEvent.locationX / Math.max(1, width))) * length) / 1000)}
          accessibilityLabel={t.voiceNote}
          style={{ height: 26, flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          {bars.map((b, i) => (
            <View key={i} style={{ width: 3, height: Math.max(3, Math.round(b * 24)), borderRadius: 2, backgroundColor: (i + 0.5) / bars.length <= done ? theme.acc : theme.muted, opacity: (i + 0.5) / bars.length <= done ? 1 : 0.55 }} />
          ))}
        </Pressable>
        <Txt size={11} color={theme.muted} style={{ fontVariant: ['tabular-nums'] }}>
          {duration(status.playing || at > 0 ? at : length)}
        </Txt>
      </View>
      {once}
      <IconButton
        icon="mic"
        label={t.recordMore}
        onPress={() => {
          player.pause();
          onResume();
        }}
        color="#E5484D"
        testID="voice-resume"
      />
    </Animated.View>
  );
}
