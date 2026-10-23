// VoiceBody.tsx: a voice note (or an audio file) inside a message bubble.
//
// A play button, the voice note's bars (how loud each moment was; the part
// already heard is coloured in), and its length. Tap the bars to jump there;
// while it plays, a 1× button changes the speed (1.5×, 2×). Before it has
// downloaded, the play button is a download button, and while it moves a ring
// fills around a ✕, as on photos.
import type { Message } from '@pakchat/shared';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { isOffline } from '../../core/core';
import { Cancelled, cancelDownload, download, FileBroken, FileGone, haveFile, pauseSend, resumeSend, tagOf } from '../../core/files';
import { useFileProgress } from '../../core/hooks';
import { nextSpeed, pause, play, seek, useVoicePlayer } from '../../core/player';
import { barsOf } from '../../core/voice';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration as clockOf } from '../format';
import { Icon } from '../icons';
import { Pressy, Txt } from '../kit';
import { toast } from '../overlays';

const BAR_COUNT = 34;
const BAR_W = 3;
const GAP = 2;
const WIDTH = BAR_COUNT * (BAR_W + GAP);

export const voiceKey = (m: Message) => `${m.chatId}/${m.author}/${m.id}`;

export function VoiceBody({ m, mine, selecting, onPick }: { m: Message; mine: boolean; selecting: boolean; onPick: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const key = voiceKey(m);
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

  const moving = progress !== undefined || sending;
  const icon = moving ? null : paused ? 'upload' : !here ? 'download' : playing ? 'pause' : 'play';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minWidth: 236, marginBottom: 2 }}>
      <Pressy onPress={tap} onLongPress={onPick} label={playing ? t.pause : t.play} scale={0.9} testID="voice-play">
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          {moving ? <Ring progress={progress ?? 0} color={mine ? '#FFFFFF' : theme.accInk} /> : icon && <Icon name={icon} size={20} color={mine ? '#FFFFFF' : theme.accInk} />}
        </View>
      </Pressy>
      <View style={{ flex: 1 }}>
        <Pressable
          disabled={!here || selecting}
          onPress={(e) => seek(key, f.local!, Math.round(Math.min(1, Math.max(0, e.nativeEvent.locationX / WIDTH)) * length))}
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
        </Pressable>
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
        </View>
      </View>
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
