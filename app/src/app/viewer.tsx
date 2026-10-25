// viewer.tsx: photos and videos full screen, on black, like WhatsApp.
//
// It opens on the one you tapped, and you can swipe left and right through
// every photo and video in the chat. Tap the picture to hide everything else;
// tap again to bring it back. A video plays when you reach it, with our own
// controls: play and pause in the middle, and along the bottom the time, the
// line to drag through it, its length and the sound. One that isn't
// downloaded yet shows its blurred preview and a download button.
// Share sends the file to another app.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, isOffline } from '../core/core';
import { Cancelled, download, FileBroken, FileGone, haveFile, tagOf } from '../core/files';
import { useFileProgress } from '../core/hooks';
import { outsideFor } from '../core/lock';
import { useT } from '../i18n';
import { clock, dayLabel, duration, fileSize } from '../ui/format';
import { Icon } from '../ui/icons';
import { IconButton, Pressy, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';
import { Slider } from '../ui/Slider';

const keyOf = (m: Message) => `${m.author}/${m.id}`;

export default function Viewer() {
  const { chat, author, id } = useLocalSearchParams<{ chat: string; author: string; id: string }>();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [all, setAll] = useState<Message[] | null>(null);
  // Where it opened (the one tapped), and where it is now.
  const [start, setStart] = useState(0);
  const [index, setIndex] = useState(0);
  const first = useRef(true);
  const [chrome, setChrome] = useState(true);
  const pager = useRef<FlatList<Message>>(null);

  // Every photo and video in the chat, oldest first (so swiping left goes to newer ones).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = (await core.storage.shared(chat, 'media')).reverse();
      // The one tapped is always there (even if it's older than the newest 500).
      if (!list.some((m) => m.author === author && m.id === id)) {
        const one = await core.storage.getMessage(chat, author, id);
        if (one) list.unshift(one);
      }
      if (!alive) return;
      if (first.current) {
        first.current = false;
        const at = Math.max(0, list.findIndex((x) => x.author === author && x.id === id));
        setStart(at);
        setIndex(at);
      }
      setAll(list);
    };
    void load().catch(() => {});
    const off = core.on(`messages:${chat}`, () => void load().catch(() => {}));
    return () => {
      alive = false;
      off();
    };
  }, [chat, author, id]);

  const m = all?.[index] ?? null;
  const f = m?.file;
  const who = m ? (m.author === core.myId ? t.youWord : core.name(m.author) || '…') : '';

  if (!all) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar style="light" hidden={!chrome} />
      <FlatList
        ref={pager}
        style={{ flex: 1 }}
        data={all}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={keyOf}
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        // Which page it settled on after a swipe (in Urdu the pages run the other way, and so does x).
        onMomentumScrollEnd={(e) => setIndex(Math.max(0, Math.min(all.length - 1, Math.round(Math.abs(e.nativeEvent.contentOffset.x) / width))))}
        windowSize={3}
        initialNumToRender={1}
        renderItem={({ item, index: i }) => <Page m={item} width={width} active={i === index} chrome={chrome} onTap={() => setChrome((c) => !c)} />}
      />

      {chrome && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', top: insets.top + 6, start: 8, end: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <IconButton icon="back" label={t.back} onPress={() => router.back()} flip look="onAccent" size={42} testID="viewer-back" />
          <View style={{ flex: 1 }}>
            <Txt size={16} weight="700" color="#FFFFFF" lines={1}>
              {who}
            </Txt>
            {!!m && (
              <Txt size={12.5} color="rgba(255,255,255,0.75)">
                {dayLabel(m.sentAt, t)}, {clock(m.sentAt)}
              </Txt>
            )}
          </View>
          {!!f?.local && haveFile(m!) && (
            <IconButton icon="forward" label={t.share} look="onAccent" size={42} flip onPress={() => void outsideFor(() => Sharing.shareAsync(f.local!, { mimeType: f.mime })).catch(() => {})} testID="viewer-share" />
          )}
        </Animated.View>
      )}

      {/* The caption (above a video's controls). */}
      {chrome && !!m?.text && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(120)}
          pointerEvents="none"
          style={{ position: 'absolute', start: 0, end: 0, bottom: insets.bottom + (f?.kind === 'video' && haveFile(m) ? VIDEO_BAR : 0), paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          <Txt size={15} color="#FFFFFF" lines={4}>
            {m.text}
          </Txt>
        </Animated.View>
      )}
    </View>
  );
}

/** One photo or video, the width of the screen. */
function Page({ m, width, active, chrome, onTap }: { m: Message; width: number; active: boolean; chrome: boolean; onTap: () => void }) {
  const t = useT();
  const f = m.file!;
  const here = haveFile(m);
  const progress = useFileProgress(tagOf(m.chatId, m));

  async function get() {
    if (progress !== undefined) return;
    try {
      await download(m);
    } catch (err) {
      if (err instanceof Cancelled) return;
      toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
    }
  }

  return (
    <View style={{ width, flex: 1 }}>
      {here && f.kind === 'video' ? (
        // Only the one on screen has a player (they're heavy), and it stops when you swipe away.
        active ? (
          <Video uri={f.local!} chrome={chrome} onTap={onTap} />
        ) : (
          <Pressable style={{ flex: 1 }} onPress={onTap} />
        )
      ) : here ? (
        <Pressable style={{ flex: 1 }} onPress={onTap}>
          <Image source={{ uri: f.local }} style={{ flex: 1 }} contentFit="contain" testID="viewer-image" />
        </Pressable>
      ) : (
        <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={onTap}>
          {f.thumb && <Image source={{ uri: `data:image/jpeg;base64,${f.thumb}` }} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="contain" blurRadius={8} />}
          <Pressy onPress={() => void get()} label={t.download} scale={0.92} testID="viewer-download">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)' }}>
              {progress !== undefined ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="download" size={20} color="#FFFFFF" />}
              <Txt size={14} weight="700" color="#FFFFFF">
                {progress !== undefined ? `${Math.round(progress * 100)}%` : fileSize(f.size)}
              </Txt>
            </View>
          </Pressy>
        </Pressable>
      )}
    </View>
  );
}

/** Turns a player's sound off or on. */
function muteVideo(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

/** The height of a video's controls along the bottom. */
const VIDEO_BAR = 64;

/** A video, playing, with WhatsApp-like controls that hide and show with a tap. */
function Video({ uri, chrome, onTap }: { uri: string; chrome: boolean; onTap: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });
  const [playing, setPlaying] = useState(true);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const [muted, setMuted] = useState(false);
  // While the line is being dragged, it shows where you are, not where the video is.
  const [dragging, setDragging] = useState<number | null>(null);
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, 'timeUpdate', ({ currentTime }) => setAt(currentTime));
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && player.duration > 0) setLength(player.duration);
  });
  useEventListener(player, 'playToEnd', () => {
    player.seekBy(-player.currentTime);
    setAt(0);
  });
  const shown = dragging ?? (length ? Math.min(1, at / length) : 0);
  const toggle = () => (playing ? player.pause() : player.play());

  return (
    <View style={{ flex: 1 }}>
      <Pressable style={{ flex: 1 }} onPress={onTap}>
        <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" testID="viewer-video" />
      </Pressable>
      {(chrome || !playing) && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Pressy onPress={toggle} label={playing ? t.pause : t.play} scale={0.9} testID="viewer-play">
            <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
            </View>
          </Pressy>
        </Animated.View>
      )}
      {chrome && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(120)}
          style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: VIDEO_BAR + insets.bottom, paddingBottom: insets.bottom, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          <Txt size={13} weight="600" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'], minWidth: 38 }}>
            {duration(shown * length * 1000)}
          </Txt>
          <View style={{ flex: 1 }}>
            <Slider
              value={shown}
              onChange={setDragging}
              onDone={(v) => {
                player.seekBy(v * length - player.currentTime);
                setAt(v * length);
                setDragging(null);
              }}
              label={t.videoLabel}
              testID="viewer-seek"
            />
          </View>
          <Txt size={13} weight="600" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'], minWidth: 38 }}>
            {duration(length * 1000)}
          </Txt>
          <IconButton
            icon={muted ? 'speakerOff' : 'speaker'}
            label={muted ? t.unmute : t.mute}
            look="onAccent"
            size={38}
            onPress={() => {
              muteVideo(player, !muted);
              setMuted(!muted);
            }}
            testID="viewer-mute"
          />
        </Animated.View>
      )}
    </View>
  );
}
