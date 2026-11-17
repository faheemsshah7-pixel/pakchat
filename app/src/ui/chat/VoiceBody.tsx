// VoiceBody.tsx: a voice note (or an audio file) inside a message bubble.
//
// A play button, the voice note's bars (how loud each moment was; the part
// already heard is coloured in), and its length. Tap the bars to jump there;
// while it plays, a 1× button changes the speed (1.5×, 2×). Before it has
// downloaded, the play button is a download button, and while it moves a ring
// fills around a ✕, as on photos.
//
// "Aa" turns a voice note into words, on the phone itself (Transcribe.kt,
// Android 13 and later): nothing is sent anywhere. The words are kept with the
// message, only on this phone.
//
// The little mic on the photo turns blue once the voice note is played (by
// them, on mine; by me, on theirs), like WhatsApp.
import type { Message } from '@pakchat/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle } from 'react-native-svg';

import { fileModule } from '../../../modules/pakchat-signal';
import { core, isOffline } from '../../core/core';
import { Cancelled, cancelDownload, download, FileBroken, FileGone, haveFile, pauseSend, resumeSend, tagOf } from '../../core/files';
import { useFileProgress } from '../../core/hooks';
import { nextSpeed, pause, play, seek, useVoicePlayer } from '../../core/player';
import { barsOf } from '../../core/voice';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration as clockOf } from '../format';
import { Icon } from '../icons';
import { Avatar, Pressy, Txt } from '../kit';
import { toast } from '../overlays';

let canTranscribe: boolean | null = null;
/** Can this phone turn speech into words by itself? (Asked once.) */
function transcriptsHere() {
  if (canTranscribe === null) {
    try {
      canTranscribe = fileModule().transcriptsAvailable();
    } catch {
      canTranscribe = false;
    }
  }
  return canTranscribe;
}

// (Fewer bars than before: the sender's photo sits beside them now, like WhatsApp.)
const BAR_COUNT = 28;
const BAR_W = 3;
const GAP = 2;
const WIDTH = BAR_COUNT * (BAR_W + GAP);
/** The "listened" blue, like WhatsApp's (its own colour, so it shows on every accent). */
const PLAYED = '#34B7F1';

export const voiceKey = (m: Message) => `${m.chatId}/${m.author}/${m.id}`;

export function VoiceBody({ m, mine, selecting, onPick }: { m: Message; mine: boolean; selecting: boolean; onPick: () => void }) {
  const t = useT();
  const { theme, lang, rtl } = useLook();
  const f = m.file!;
  const key = voiceKey(m);
  const [writing, setWriting] = useState(false);
  const [shown, setShown] = useState(true);
  const now = useVoicePlayer(key);
  const progress = useFileProgress(tagOf(m.chatId, m));
  const here = haveFile(m);
  const sending = mine && m.status === 'queued';
  const paused = mine && m.status === 'paused';
  const [bars] = useState(() => barsOf(f.waveform, BAR_COUNT));
  const ink = mine ? theme.bubbleMineText : theme.text;
  const meta = mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted;
  const length = now?.duration || f.duration || 0;
  const at = now ? now.position : 0;
  const done = length ? Math.min(1, at / length) : 0;
  const playing = !!now?.playing;

  // The dot on the bars: where it's got to. Drag it to jump, like WhatsApp (it jumps on letting go).
  const pos = useSharedValue(done);
  const drag = useSharedValue(-1);
  useEffect(() => {
    pos.set(done);
  }, [done, pos]);
  const jump = (to: number) => {
    if (f.local) seek(key, f.local, Math.round(to * length));
  };
  const pan = usePanGesture({
    enabled: here && !selecting && length > 0,
    activeOffsetX: [-4, 4],
    failOffsetY: [-14, 14],
    onUpdate: (e) => {
      'worklet';
      // Urdu: the bars run right to left, so the far end is on the left.
      const x = Math.min(1, Math.max(0, e.x / WIDTH));
      drag.value = rtl ? 1 - x : x;
    },
    onDeactivate: () => {
      'worklet';
      if (drag.value >= 0) {
        pos.set(drag.value);
        scheduleOnRN(jump, drag.value);
      }
      drag.value = -1;
    },
  });
  const dotAt = useAnimatedStyle(() => {
    const at = (drag.value >= 0 ? drag.value : pos.value) * WIDTH;
    // `start: 0` is the right edge in Urdu, so it moves left from there.
    return { transform: [{ translateX: rtl ? 6 - at : at - 6 }] };
  });
  const face = f.kind === 'voice';

  // Started playing a voice note sent to me: the blue mic for them (the "listened" sign).
  const fresh = face && !mine && !m.played;
  useEffect(() => {
    if (playing && fresh) void core.client.markPlayed(m).catch(() => {});
  }, [playing, fresh, m]);

  async function tap() {
    if (selecting) return onPick();
    if (paused) return void resumeSend(m).catch(() => {});
    if (sending) return void pauseSend(m).catch(() => {});
    if (progress !== undefined) return cancelDownload(m);
    if (here) return playing ? pause() : play(key, f.local!);
    try {
      await download(m);
    } catch (err) {
      if (err instanceof Cancelled) return;
      toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
    }
  }

  async function transcribe() {
    if (selecting) return onPick();
    if (f.transcript) return setShown(!shown);
    if (!here || writing) return;
    setWriting(true);
    try {
      const words = (await fileModule().transcribe(f.local!, lang === 'ur' ? 'ur-PK' : 'en-US')).trim();
      if (!words) return toast(t.noWordsHeard);
      await core.client.changeHere(m.chatId, m, (x) => {
        if (x.file) x.file.transcript = words.slice(0, 4000);
      });
      setShown(true);
    } catch {
      toast(t.couldNotTranscribe);
    } finally {
      setWriting(false);
    }
  }
  const showAa = f.kind === 'voice' && here && !sending && (!!f.transcript || transcriptsHere());

  const moving = progress !== undefined || sending;
  const icon = moving ? null : paused ? 'upload' : !here ? 'download' : playing ? 'pause' : 'play';

  return (
    <View style={{ marginBottom: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minWidth: 236 }}>
        {/* The sender's photo with a little mic, like WhatsApp's voice notes. */}
        {face && (
          <View testID="voice-face">
            <Avatar id={m.author} name={core.name(m.author) || '…'} size={42} />
            <View style={{ position: 'absolute', bottom: -2, end: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: m.played ? PLAYED : mine ? 'rgba(255,255,255,0.35)' : theme.bubbleIn, alignItems: 'center', justifyContent: 'center' }} testID={m.played ? 'voice-played' : undefined}>
              <Icon name="mic" size={11} color={m.played || mine ? '#FFFFFF' : theme.accInk} />
            </View>
          </View>
        )}
        <Pressy onPress={tap} onLongPress={onPick} label={playing ? t.pause : t.play} scale={0.9} testID="voice-play">
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
            {moving ? <Ring progress={progress ?? 0} color={mine ? '#FFFFFF' : theme.accInk} /> : icon && <Icon name={icon} size={20} color={mine ? '#FFFFFF' : theme.accInk} />}
          </View>
        </Pressy>
        <View style={{ flex: 1 }}>
          <GestureDetector gesture={pan}>
          <Pressable
            disabled={!here || selecting}
            onPress={(e) => {
              const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / WIDTH));
              seek(key, f.local!, Math.round((rtl ? 1 - x : x) * length));
            }}
            onLongPress={onPick}
            accessibilityLabel={t.voiceNote}
            style={{ height: 30, width: WIDTH, flexDirection: 'row', alignItems: 'center', gap: GAP }}
            testID="voice-bars"
          >
            {bars.map((b, i) => (
              <View
                key={i}
                style={{
                  width: BAR_W,
                  height: Math.max(3, Math.round(b * 26)),
                  borderRadius: 2,
                  backgroundColor: (i + 0.5) / bars.length <= done ? (mine ? '#FFFFFF' : theme.acc) : mine ? 'rgba(255,255,255,0.4)' : theme.muted,
                  opacity: (i + 0.5) / bars.length <= done ? 1 : 0.6,
                }}
              />
            ))}
            {here && length > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[{ position: 'absolute', start: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: mine ? '#FFFFFF' : theme.acc }, dotAt]}
                testID="voice-dot"
              />
            )}
          </Pressable>
          </GestureDetector>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Txt size={11.5} color={meta}>
              {clockOf(now && (playing || at > 0) ? at : length)}
            </Txt>
            {now && (
              <Pressy onPress={nextSpeed} label={t.speed} scale={0.9} testID="voice-speed">
                <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : theme.accSoft, justifyContent: 'center' }}>
                  <Txt size={11} weight="700" color={ink}>
                    {`${now.speed}×`}
                  </Txt>
                </View>
              </Pressy>
            )}
            {f.kind === 'audio' && f.name && (
              <Txt size={11.5} color={meta} lines={1} style={{ flex: 1 }}>
                {f.name}
              </Txt>
            )}
            {showAa && (
              <Pressy onPress={() => void transcribe()} label={t.transcribe} scale={0.9} testID="voice-transcribe">
                <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : theme.accSoft, justifyContent: 'center' }}>
                  {writing ? (
                    <ActivityIndicator size={11} color={ink} />
                  ) : (
                    <Txt size={11} weight="800" color={ink}>
                      Aa
                    </Txt>
                  )}
                </View>
              </Pressy>
            )}
          </View>
        </View>
      </View>
      {!!f.transcript && shown && (
        <Animated.View style={{ maxWidth: 236, paddingTop: 2, paddingBottom: 2 }} testID="voice-transcript">
          <Txt size={13.5} color={ink} style={{ fontStyle: 'italic' }}>
            {f.transcript}
          </Txt>
        </Animated.View>
      )}
    </View>
  );
}

function Ring({ progress, color }: { progress: number; color: string }) {
  const size = 42;
  const r = size / 2 - 3;
  const round = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="file-progress">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeOpacity={0.3} strokeWidth={2.5} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${round} ${round}`}
          strokeDashoffset={round * (1 - Math.max(0.03, Math.min(1, progress)))}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Icon name="close" size={17} color={color} />
    </View>
  );
}
