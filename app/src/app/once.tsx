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
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fileModule } from '../../modules/pakchat-signal';
import { core, isOffline } from '../core/core';
import { download, FileBroken, FileGone, forgetFile, haveFile } from '../core/files';
import { stopAll } from '../core/player';
import { useT } from '../i18n';
import { duration, whenLabel } from '../ui/format';
import { Icon } from '../ui/icons';
import { IconButton, Pressy, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';

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
        <OnceVoice uri={f.local} length={f.duration ?? 0} />
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

function OnceVoice({ uri, length }: { uri: string; length: number }) {
  const t = useT();
  const player = useAudioPlayer({ uri }, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    player.play();
  }, [player]);
  const at = Math.round((status.currentTime ?? 0) * 1000);
  const total = length || Math.round((status.duration ?? 0) * 1000);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }} testID="once-voice">
      <Pressy onPress={() => (status.playing ? player.pause() : (status.didJustFinish && void player.seekTo(0), player.play()))} label={status.playing ? t.pause : t.play} scale={0.9}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={status.playing ? 'pause' : 'play'} size={40} color="#FFFFFF" />
        </View>
      </Pressy>
      <View style={{ width: 240, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
        <View style={{ width: `${total ? Math.min(100, (at / total) * 100) : 0}%`, height: 4, backgroundColor: '#FFFFFF' }} />
      </View>
      <Txt size={14} weight="600" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
        {duration(at)} / {duration(total)}
      </Txt>
    </View>
  );
}
