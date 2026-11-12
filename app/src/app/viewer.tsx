// viewer.tsx: photos and videos full screen, on black, like WhatsApp.
//
// It opens on the one you tapped, and you can swipe left and right through
// every photo and video in the chat. Tap the picture to hide everything else;
// tap again to bring it back. A video plays when you reach it, with our own
// controls: play and pause in the middle, and along the bottom the time, the
// line to drag through it, its length and the sound. One that isn't
// downloaded yet shows its blurred preview and a download button.
// Share sends the file to another app. Drag it up or down to close it.
// Like WhatsApp, it grows out of its spot in the chat when it opens, and
// shrinks back into it when it closes (SwipeToClose.tsx, zoom.ts).
// Along the top, like WhatsApp: Star, Forward, and ⋮ with Reply, Show in chat,
// All media, Share and Delete. The bars sit on a dim strip, top and bottom, and
// along the bottom are Reply and two quick reactions, like WhatsApp's.
// Pinch a photo (or double tap it) to zoom in (Zoomable.tsx).
import type { Message } from '@pakchat/shared';
import { UNSEND_HOURS } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, isOffline } from '../core/core';
import { Cancelled, download, FileBroken, FileGone, haveFile, tagOf } from '../core/files';
import { useChat, useFileProgress, useNow, useStarred } from '../core/hooks';
import { outsideFor } from '../core/lock';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { clock, dayLabel, duration, fileSize } from '../ui/format';
import { Icon } from '../ui/icons';
import { IconButton, Pressy, Txt } from '../ui/kit';
import { fadeIn, fadeOut } from '../ui/motion';
import { Dialog, MenuItem, Popup, toast } from '../ui/overlays';
import { Slider } from '../ui/Slider';
import { SwipeToClose, type Closer } from '../ui/SwipeToClose';
import { parseSpot, takeHanded } from '../ui/zoom';
import { Zoomable } from '../ui/Zoomable';

const keyOf = (m: Message) => `${m.author}/${m.id}`;

/** The two quick reactions along the bottom, like WhatsApp's. */
const QUICK = ['❤️', '🙏'];
/** How dim the strips behind the bars are. */
const DIM = 'rgba(0,0,0,0.4)';
/** The height of the Reply row along the bottom. */
const REPLY_ROW = 60;

export default function Viewer() {
  const { chat, author, id, spot: spotParam } = useLocalSearchParams<{ chat: string; author: string; id: string; spot?: string }>();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  // The height of a page (the whole screen), measured.
  const [pageH, setPageH] = useState(winH);
  const [all, setAll] = useState<Message[] | null>(null);
  // The one tapped, handed over by the chat so it shows at once; the rest are read once it has grown open.
  const [tapped] = useState(() => takeHanded(chat, author, id));
  const [spot] = useState(() => parseSpot(spotParam));
  const [opened, setOpened] = useState(false);
  // The one tapped stays on top, on its own, until the list of all of them is showing it too:
  // swapping straight from one to the other left a black frame (owner's video, 2 Nov).
  const [swapped, setSwapped] = useState(!tapped);
  // A photo being zoomed or pinched: no swiping to the next one or dragging to close meanwhile.
  const [zoomed, setZoomed] = useState(false);
  const closer = useRef<Closer>(null);
  const close = useCallback(() => (closer.current ? closer.current.close() : router.back()), []);
  // Where it opened (the one tapped), and where it is now.
  const [start, setStart] = useState(0);
  const [index, setIndex] = useState(0);
  const first = useRef(true);
  const [chrome, setChrome] = useState(true);
  // Being dragged to close: everything but the picture goes meanwhile.
  const [dragging, setDragging] = useState(false);
  const bars = chrome && !dragging && opened;
  const pager = useRef<FlatList<Message>>(null);
  const { rtl } = useLook();
  // Zoomed in and dragged on past the photo's edge: on to the next (or previous) one, like WhatsApp.
  // A finger going left shows the one to the right (in Urdu the pages run the other way).
  const edgeSwipe = useCallback(
    (dir: -1 | 1) => {
      if (!all) return;
      const to = index + ((rtl ? dir > 0 : dir < 0) ? 1 : -1);
      if (to < 0 || to >= all.length) return;
      setZoomed(false);
      setIndex(to);
      pager.current?.scrollToIndex({ index: to, animated: true });
    },
    [all, index, rtl],
  );

  // Every photo and video in the chat, oldest first (so swiping left goes to newer ones).
  useEffect(() => {
    if (tapped && !opened) return;
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
  }, [chat, author, id, tapped, opened]);

  // The list's page for the one tapped is showing: let it through (two frames later, so it's
  // surely on screen). If it never says so (a photo that won't load), after a moment anyway.
  const reveal = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setSwapped(true)));
  }, []);
  useEffect(() => {
    if (!all || swapped) return;
    const late = setTimeout(() => setSwapped(true), 700);
    return () => clearTimeout(late);
  }, [all, swapped]);

  // Back shrinks it into its spot too.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const list = all ?? (tapped ? [tapped] : null);
  const m = list?.[index] ?? null;
  const f = m?.file;
  const who = m ? (m.author === core.myId ? t.youWord : core.name(m.author) || '…') : '';
  const starred = useStarred();
  const chatInfo = useChat(chat);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const now = useNow(60_000);
  const isStarred = !!m && !!starred[`${m.chatId}/${m.author}/${m.id}`];
  const amAdmin = chatInfo?.kind === 'group' && chatInfo.members.some((mb) => mb.userId === core.myId && mb.role === 'admin');
  const canUnsend = !!m && m.seq !== null && (amAdmin || (m.author === core.myId && now - m.sentAt < UNSEND_HOURS * 3_600_000));
  const canReply = !!m && !chatInfo?.left;
  const myReaction = m?.reactions?.[core.myId];
  const react = (emoji: string) => {
    if (!m) return;
    void core.client.react(chat, { author: m.author, id: m.id }, myReaction === emoji ? null : emoji).catch(() => toast(t.couldNot));
  };
  const key = m ? `${m.author}/${m.id}` : '';
  // Back to the chat, at this message (and replying to it).
  const toChat = (params: { jump?: string; reply?: string }) => router.dismissTo({ pathname: '/chat/[id]', params: { id: chat, ...params } });
  const forward = () => {
    if (!m || !haveFile(m)) return toast(t.downloadFirst);
    router.push({ pathname: '/forward', params: { texts: '[]', files: JSON.stringify([[m.chatId, m.author, m.id]]) } });
  };
  const share = () => {
    if (f?.local && m && haveFile(m)) void outsideFor(() => Sharing.shareAsync(f.local!, { mimeType: f.mime })).catch(() => {});
  };
  const remove = (everyone: boolean) => {
    setDeleting(false);
    if (!m) return;
    const gone = m;
    void (everyone ? core.client.deleteForEveryone(chat, { author: gone.author, id: gone.id }) : core.deleteForMe([gone])).catch(() => toast(t.couldNot));
    if ((all?.length ?? 0) <= 1) router.back();
  };

  if (!list) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setPageH(e.nativeEvent.layout.height)}>
      <StatusBar style="light" hidden={!chrome} />
      <SwipeToClose
        ref={closer}
        locked={zoomed}
        onClose={() => router.back()}
        onDrag={setDragging}
        grow={{ spot, aspect: tapped?.file?.width && tapped.file.height ? tapped.file.height / tapped.file.width : null, back: index === start, onOpened: () => setOpened(true) }}
      >
        <View style={{ flex: 1 }}>
          {all && (
            <FlatList
              ref={pager}
              style={{ flex: 1 }}
              data={all}
              horizontal
              pagingEnabled
              scrollEnabled={!zoomed}
              showsHorizontalScrollIndicator={false}
              keyExtractor={keyOf}
              initialScrollIndex={start}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              // Which page it settled on after a swipe (in Urdu the pages run the other way, and so does x).
              onMomentumScrollEnd={(e) => setIndex(Math.max(0, Math.min(all.length - 1, Math.round(Math.abs(e.nativeEvent.contentOffset.x) / width))))}
              windowSize={3}
              initialNumToRender={1}
              renderItem={({ item, index: i }) => (
                <Page
                  m={item}
                  width={width}
                  height={pageH}
                  active={swapped && i === index}
                  chrome={bars}
                  lift={canReply ? insets.bottom + REPLY_ROW : 0}
                  onTap={() => setChrome((c) => !c)}
                  onZoomed={setZoomed}
                  onEdgeSwipe={edgeSwipe}
                  onShown={!swapped && i === start ? reveal : undefined}
                />
              )}
            />
          )}
          {/* The one tapped, alone: while it grows open, and until the list shows it too. */}
          {!swapped && tapped && (
            <View style={[StyleSheet.absoluteFill, all ? { backgroundColor: '#000000' } : null]}>
              {/* (It doesn't zoom: it's about to be swapped for the list's page, which does.) */}
              <Page m={tapped} width={width} height={pageH} active zoom={false} chrome={bars} lift={canReply ? insets.bottom + REPLY_ROW : 0} onTap={() => setChrome((c) => !c)} />
            </View>
          )}
        </View>
      </SwipeToClose>

      {/* A tap hides and shows the bars; they fade, like WhatsApp's. */}
      {bars && (
        <Animated.View
          entering={fadeIn}
          exiting={fadeOut}
          style={{ position: 'absolute', top: 0, start: 0, end: 0, paddingTop: insets.top + 6, paddingBottom: 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DIM }}
        >
          <IconButton icon="back" label={t.back} onPress={close} flip look="onAccent" size={42} testID="viewer-back" />
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
          {!!m && (
            <IconButton
              icon={isStarred ? 'starFilled' : 'star'}
              label={isStarred ? t.unstar : t.star}
              look="onAccent"
              size={42}
              onPress={() => {
                core.setStarred([m], !isStarred);
                toast(isStarred ? t.unstarred : t.starredNote);
              }}
              testID="viewer-star"
            />
          )}
          {!!m && haveFile(m) && <IconButton icon="forward" label={t.forward} look="onAccent" size={42} flip onPress={forward} testID="viewer-forward" />}
          <IconButton icon="more" label={t.moreOptions} look="onAccent" size={42} onPress={() => setMenu(true)} testID="viewer-more" />
        </Animated.View>
      )}

      <Popup visible={menu} onClose={() => setMenu(false)} top={insets.top + 50}>
        {!chatInfo?.left && <MenuItem icon="reply" label={t.reply} onPress={() => (setMenu(false), toChat({ jump: key, reply: key }))} testID="viewer-reply" />}
        <MenuItem icon="chat" label={t.showInChat} onPress={() => (setMenu(false), toChat({ jump: key }))} testID="viewer-show" />
        <MenuItem icon="photo" label={t.allMedia} onPress={() => (setMenu(false), router.push({ pathname: '/media/[id]', params: { id: chat } }))} testID="viewer-all-media" />
        {!!m && haveFile(m) && <MenuItem icon="upload" label={t.share} onPress={() => (setMenu(false), share())} testID="viewer-share" />}
        <MenuItem icon="trash" label={t.delete} danger onPress={() => (setMenu(false), setDeleting(true))} testID="viewer-delete" />
      </Popup>

      <Dialog
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={t.deleteOneMessage}
        buttons={[
          ...(canUnsend ? [{ label: t.deleteForEveryone, danger: true, onPress: () => remove(true), testID: 'viewer-delete-everyone' }] : []),
          { label: t.deleteForMe, danger: true, onPress: () => remove(false), testID: 'viewer-delete-me' },
          { label: t.cancel, onPress: () => setDeleting(false) },
        ]}
      />

      {/* The caption (above a video's controls, and the Reply row). */}
      {bars && !!m?.text && (
        <Animated.View
          entering={fadeIn}
          exiting={fadeOut}
          pointerEvents="none"
          style={{
            position: 'absolute',
            start: 0,
            end: 0,
            bottom: (canReply ? insets.bottom + REPLY_ROW : insets.bottom) + (f?.kind === 'video' && haveFile(m) ? VIDEO_BAR : 0),
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: DIM,
          }}
        >
          <Txt size={15} color="#FFFFFF" lines={4}>
            {m.text}
          </Txt>
        </Animated.View>
      )}

      {/* Along the bottom, like WhatsApp: Reply (back in the chat, replying to it), and two quick reactions. */}
      {bars && canReply && (
        <Animated.View
          entering={fadeIn}
          exiting={fadeOut}
          style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: REPLY_ROW + insets.bottom, paddingBottom: insets.bottom, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DIM }}
        >
          <Pressy onPress={() => toChat({ jump: key, reply: key })} label={t.reply} scale={0.98} testID="viewer-reply-bar" style={{ flex: 1 }}>
            <View style={{ height: 42, borderRadius: 21, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}>
              <Txt size={15} color="rgba(255,255,255,0.8)">
                {t.reply}
              </Txt>
            </View>
          </Pressy>
          {QUICK.map((e) => (
            <Pressy key={e} onPress={() => react(e)} label={e} scale={0.85} testID={`viewer-react-${e}`}>
              <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: myReaction === e ? 'rgba(255,255,255,0.22)' : 'transparent' }}>
                <Txt size={24} align="center">
                  {e}
                </Txt>
              </View>
            </Pressy>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

/** One photo or video, the size of the screen. */
function Page({
  m,
  width,
  height,
  active,
  zoom = true,
  chrome,
  lift,
  onTap,
  onZoomed,
  onEdgeSwipe,
  onShown,
}: {
  m: Message;
  width: number;
  height: number;
  active: boolean;
  /** False: a photo can't be zoomed. */
  zoom?: boolean;
  chrome: boolean;
  /** How far up from the bottom a video's controls sit (over the Reply row). */
  lift: number;
  onTap: () => void;
  onZoomed?: (zoomed: boolean) => void;
  /** Zoomed in and dragged on past an edge: the next or previous photo (Zoomable.tsx). */
  onEdgeSwipe?: (dir: -1 | 1) => void;
  /** Called once it's on screen (for a photo: once the photo itself shows). */
  onShown?: () => void;
}) {
  const t = useT();
  const f = m.file!;
  const here = haveFile(m);
  const progress = useFileProgress(tagOf(m.chatId, m));
  const photo = here && f.kind !== 'video';
  // Zoomed in: the photo at its full size on top, so the detail is sharp (on screen it's drawn
  // only as big as the screen, which looks soft when zoomed). Only while zoomed: it takes memory.
  const [sharp, setSharp] = useState(false);
  const zoomedHere = useCallback(
    (z: boolean) => {
      setSharp(z);
      onZoomed?.(z);
    },
    [onZoomed],
  );
  // Anything but a photo is on screen as soon as it's made.
  useEffect(() => {
    if (!photo) onShown?.();
  }, [photo, onShown]);

  async function get() {
    if (progress !== undefined) return;
    try {
      await download(m);
    } catch (err) {
      if (err instanceof Cancelled) return;
      toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
    }
  }

  // How big the photo shows, fitted inside the screen (so a zoomed one never moves past its own edges).
  const aspect = f.width && f.height ? f.height / f.width : null;
  const shownW = aspect ? Math.min(width, height / aspect) : width;
  const shownH = aspect ? shownW * aspect : height;

  return (
    <View style={{ width, flex: 1 }}>
      {here && f.kind === 'video' ? (
        // Only the one on screen has a player (they're heavy), and it stops when you swipe away.
        active ? (
          <Video uri={f.local!} chrome={chrome} lift={lift} onTap={onTap} />
        ) : (
          <Pressable style={{ flex: 1 }} onPress={onTap} />
        )
      ) : here ? (
        // Pinch anywhere on the screen to zoom; a tap shows and hides the bars. Only the one on
        // screen zooms, and swiping away from it puts it back.
        <Zoomable width={width} height={height} viewport={{ width, height }} picture={{ width: shownW, height: shownH }} enabled={active && zoom} onZoomed={zoomedHere} onTap={onTap} onEdgeSwipe={onEdgeSwipe}>
          {/* Kept in memory, so it shows at once when the pages swap in after opening. */}
          <Image source={{ uri: f.local }} style={{ width, height }} contentFit="contain" cachePolicy="memory-disk" onDisplay={onShown} testID="viewer-image" />
          {sharp && <Image source={{ uri: f.local }} style={StyleSheet.absoluteFill} contentFit="contain" allowDownscaling={false} transition={120} testID="viewer-image-sharp" />}
        </Zoomable>
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
function Video({ uri, chrome, lift, onTap }: { uri: string; chrome: boolean; lift: number; onTap: () => void }) {
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
        {/* A texture (not Android's default surface), so it moves and shrinks with your finger when dragged to close. */}
        <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" surfaceType="textureView" testID="viewer-video" />
      </Pressable>
      {(chrome || !playing) && (
        <Animated.View entering={fadeIn} exiting={fadeOut} pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Pressy onPress={toggle} label={playing ? t.pause : t.play} scale={0.9} testID="viewer-play">
            <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
            </View>
          </Pressy>
        </Animated.View>
      )}
      {chrome && (
        <Animated.View
          entering={fadeIn}
          exiting={fadeOut}
          // Over the Reply row (`lift`), or at the very bottom when there's none.
          style={{
            position: 'absolute',
            start: 0,
            end: 0,
            bottom: lift,
            height: VIDEO_BAR + (lift ? 0 : insets.bottom),
            paddingBottom: lift ? 0 : insets.bottom,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: DIM,
          }}
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
