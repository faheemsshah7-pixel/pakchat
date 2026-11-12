// once.tsx: a view once photo, video or voice message, opened.
//
// It opens one time, full screen, with screenshots and screen recording blocked
// (FLAG_SECURE, Privacy.kt). Opening it tells the sender ("Opened"), and leaving
// deletes the file from this phone, so it can't be opened again, saved,
// forwarded or found in Media.
import type { Message } from '@pakchat/shared';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fileModule } from '../../modules/pakchat-signal';
import { core, isOffline } from '../core/core';
import { download, FileBroken, FileGone, forgetFile, haveFile } from '../core/files';
import { stopAll } from '../core/player';
import { barsOf } from '../core/voice';
import { useT } from '../i18n';
import { duration, whenLabel } from '../ui/format';
import { Icon } from '../ui/icons';
import { Avatar, IconButton, Pressy, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';

const BAR_W = 4;
const GAP = 3;

export default function Once() {
  const { chat, author, id } = useLocalSearchParams<{ chat: string; author: string; id: string }>();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [m, setM] = useState<Message | null>(null);
  const [ready, setReady] = useState(false);
  const told = useRef(false);
  const shown = useRef<Message | null>(null);

  // No screenshots while it's open.
  useEffect(() => {
    fileModule().setSecure(true);
    stopAll();
    return () => fileModule().setSecure(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const one = await core.storage.getMessage(chat, author, id);
      if (!alive) return;
      if (!one?.file?.once || one.opened || one.author === core.myId) {
        router.back();
        return;
      }
      setM(one);
      try {
        if (!haveFile(one)) await download(one);
        const fresh = (await core.storage.getMessage(chat, author, id)) ?? one;
        if (!alive) return;
        setM(fresh);
        setReady(true);
      } catch (err) {
        toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
        router.back();
      }
    })();
    return () => {
      alive = false;
    };
  }, [chat, author, id, t]);

  // Shown: the sender hears it was opened. Leaving: the file goes.
  useEffect(() => {
    if (!ready || !m || told.current) return;
    told.current = true;
    shown.current = m;
    void core.client.opened(chat, { author: m.author, id: m.id }).catch(() => {});
  }, [ready, m, chat]);
  useEffect(
    () => () => {
      const gone = shown.current;
      if (gone) void forgetFile(gone).then(() => core.emit(`messages:${gone.chatId}`));
    },
    [],
  );

  const f = m?.file;
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar style="light" />
      {!ready || !f?.local ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : f.kind === 'image' ? (
        <Image source={{ uri: f.local }} style={{ flex: 1 }} contentFit="contain" testID="once-image" />
      ) : f.kind === 'video' ? (
        <OnceVideo uri={f.local} />
      ) : (
        <OnceVoice uri={f.local} length={f.duration ?? 0} waveform={f.waveform} author={m!.author} />
      )}
      <View style={{ position: 'absolute', top: insets.top + 6, start: 8, end: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <IconButton icon="close" label={t.close} look="onAccent" size={42} onPress={() => router.back()} testID="once-close" />
        {/* Who sent it and when, like WhatsApp's. */}
        <View style={{ flex: 1 }}>
          <Txt size={16} weight="700" color="#FFFFFF" lines={1}>
            {m ? core.name(m.author) || '…' : ''}
          </Txt>
          {!!m && (
            <Txt size={12.5} color="rgba(255,255,255,0.75)" lines={1}>
              {whenLabel(m.sentAt, t)}
            </Txt>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)' }}>
          <Icon name="once" size={15} color="#FFFFFF" />
          <Txt size={12.5} weight="700" color="#FFFFFF">
            {t.viewOnce}
          </Txt>
        </View>
      </View>
    </View>
  );
}

function OnceVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" testID="once-video" />;
}

/**
 * A view once voice message, on its own dark screen like WhatsApp's: who sent it,
 * big bars of the voice that fill in as it plays, play/pause and the speed. Drag
 * or tap the bars to go back (or on). It can be heard again and again until this
 * screen is left; then it's gone.
 */
function OnceVoice({ uri, length, waveform, author }: { uri: string; length: number; waveform?: string; author: string }) {
  const t = useT();
  const { width } = useWindowDimensions();
  const player = useAudioPlayer({ uri }, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const barsWide = Math.min(width - 48, 340);
  const count = Math.floor((barsWide + GAP) / (BAR_W + GAP));
  const [bars] = useState(() => barsOf(waveform, count));
  useEffect(() => {
    player.play();
  }, [player]);

  const total = length || Math.round((status.duration ?? 0) * 1000);
  const at = drag !== null ? drag * total : Math.round((status.currentTime ?? 0) * 1000);
  const done = total ? Math.min(1, at / total) : 0;
  const ended = !status.playing && !!status.didJustFinish;
  const part = (x: number) => Math.min(1, Math.max(0, x / barsWide));

  function toggle() {
    if (status.playing) return player.pause();
    if (ended || (total && at >= total - 50)) void player.seekTo(0);
    player.play();
  }
  function seekTo(p: number) {
    setDrag(null);
    if (!total) return;
    void player.seekTo((p * total) / 1000);
    if (!status.playing) player.play();
  }
  function faster() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    player.setPlaybackRate(next);
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }} testID="once-voice">
      <View style={{ alignItems: 'center', gap: 12 }}>
        <View>
          <Avatar id={author} name={core.name(author) || '?'} size={112} />
          <View style={{ position: 'absolute', end: -2, bottom: -2, width: 36, height: 36, borderRadius: 18, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mic" size={20} color="#FFFFFF" />
          </View>
        </View>
        <Txt size={13.5} color="rgba(255,255,255,0.75)">
          {t.voiceNote}
        </Txt>
      </View>

      {/* The bars: tap or drag to go back or on. */}
      <View
        style={{ width: barsWide, height: 72, flexDirection: 'row', alignItems: 'center', gap: GAP }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDrag(part(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDrag(part(e.nativeEvent.locationX))}
        onResponderRelease={(e) => seekTo(part(e.nativeEvent.locationX))}
        onResponderTerminate={() => setDrag(null)}
        accessibilityRole="adjustable"
        accessibilityLabel={t.voiceNote}
        testID="once-voice-bars"
      >
        {bars.map((b, i) => {
          const heard = (i + 0.5) / bars.length <= done;
          return <View key={i} pointerEvents="none" style={{ width: BAR_W, height: Math.max(4, Math.round(b * 68)), borderRadius: BAR_W / 2, backgroundColor: heard ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />;
        })}
      </View>

      <Txt size={15} weight="600" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
        {duration(at)} / {duration(total)}
      </Txt>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
        <View style={{ width: 52 }} />
        <Pressy onPress={toggle} label={status.playing ? t.pause : t.play} testID="once-voice-play">
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={status.playing ? 'pause' : 'play'} size={34} color="#000000" />
          </View>
        </Pressy>
        <Pressy onPress={faster} label={t.speed} testID="once-voice-speed">
          <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={14} weight="700" color="#FFFFFF">
              {`${speed}×`}
            </Txt>
          </View>
        </Pressy>
      </View>
    </View>
  );
}
