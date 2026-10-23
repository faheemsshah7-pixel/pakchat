// viewer.tsx: photos and videos full screen, on black, like WhatsApp.
//
// It opens on the one you tapped, and you can swipe left and right through
// every photo and video in the chat (or use the arrows at the sides). A strip
// along the bottom shows them all small: tap one to jump there. Tap the
// picture to hide everything else; tap again to bring it back. A video plays
// when you reach it, with the phone's own controls. One that isn't downloaded
// yet shows its blurred preview and a download button.
// Share sends the file to another app.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, isOffline } from '../core/core';
import { Cancelled, download, FileBroken, FileGone, haveFile, tagOf } from '../core/files';
import { useFileProgress } from '../core/hooks';
import { useT } from '../i18n';
import { clock, fileSize, listTime } from '../ui/format';
import { Icon } from '../ui/icons';
import { IconButton, Pressy, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';

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
  const strip = useRef<FlatList<Message>>(null);

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

  // The strip follows along.
  useEffect(() => {
    if (all?.length) strip.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [index, all?.length]);

  function go(to: number) {
    if (!all || to < 0 || to >= all.length) return;
    setIndex(to);
    pager.current?.scrollToIndex({ index: to, animated: true });
  }

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
        renderItem={({ item, index: i }) => <Page m={item} width={width} active={i === index} onTap={() => setChrome((c) => !c)} />}
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
                {listTime(m.sentAt, t)} · {clock(m.sentAt)}
              </Txt>
            )}
          </View>
          {!!f?.local && haveFile(m!) && (
            <IconButton icon="forward" label={t.share} look="onAccent" size={42} flip onPress={() => void Sharing.shareAsync(f.local!, { mimeType: f.mime }).catch(() => {})} testID="viewer-share" />
          )}
        </Animated.View>
      )}

      {/* The arrows, at the sides. */}
      {chrome && index > 0 && (
        <View style={{ position: 'absolute', top: '50%', marginTop: -22, start: 6 }}>
          <IconButton icon="back" label={t.previous} onPress={() => go(index - 1)} look="onAccent" size={44} flip testID="viewer-previous" />
        </View>
      )}
      {chrome && index < all.length - 1 && (
        <View style={{ position: 'absolute', top: '50%', marginTop: -22, end: 6 }}>
          <IconButton icon="chevron" label={t.next} onPress={() => go(index + 1)} look="onAccent" size={44} flip testID="viewer-next" />
        </View>
      )}

      {chrome && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', start: 0, end: 0, bottom: 0, paddingBottom: insets.bottom + 8, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          {!!m?.text && (
            <Txt size={15} color="#FFFFFF" style={{ paddingHorizontal: 16, paddingTop: 12 }} lines={4}>
              {m.text}
            </Txt>
          )}
          {all.length > 1 && (
            <FlatList
              ref={strip}
              data={all}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={keyOf}
              contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 10, gap: 4 }}
              getItemLayout={(_, i) => ({ length: 52, offset: 10 + 52 * i, index: i })}
              initialScrollIndex={Math.max(0, start - 3)}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index: i }) => <Thumb m={item} on={i === index} onPress={() => go(i)} />}
            />
          )}
        </Animated.View>
      )}
    </View>
  );
}

/** One photo or video, the width of the screen. */
function Page({ m, width, active, onTap }: { m: Message; width: number; active: boolean; onTap: () => void }) {
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
          <Video uri={f.local!} />
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

/** A small square in the strip. */
function Thumb({ m, on, onPress }: { m: Message; on: boolean; onPress: () => void }) {
  const f = m.file!;
  const source = f.kind === 'image' && f.local ? { uri: f.local } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;
  return (
    <Pressy onPress={onPress} scale={0.92} label={f.kind}>
      <View style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', borderWidth: on ? 2 : 0, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.12)', opacity: on ? 1 : 0.7 }}>
        {source && <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" />}
        {f.kind === 'video' && (
          <View style={{ position: 'absolute', bottom: 2, start: 3 }}>
            <Icon name="video" size={12} color="#FFFFFF" />
          </View>
        )}
      </View>
    </Pressy>
  );
}

function Video({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" testID="viewer-video" />;
}
