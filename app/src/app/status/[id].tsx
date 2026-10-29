// status/[id].tsx: watching statuses, one person after another.
//
// Bars at the top fill as each status shows (words and photos for 5 seconds,
// a video to its end, up to 30). Tap the right side for the next, the left
// for the one before; hold to pause (everything over it fades away); swipe
// down to close. After someone's last status comes the next person's.
//
// Someone else's: watching sends them a read receipt (their "seen by" list),
// the ❤️ likes it (their phone says "liked your status"), and the box sends a
// reply to your chat with them. Tapping the box dims the status and shows
// WhatsApp's eight quick emoji: one tap sends that emoji as the reply.
// Mine: the 👁 shows who saw it (and who liked it), and it can be forwarded
// to chats (like WhatsApp's) or deleted.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { core, isOffline } from '../../core/core';
import { download, haveFile } from '../../core/files';
import { useStatuses, usePeople } from '../../core/hooks';
import { replyToStatus, STATUS_BG, STATUS_SHOW_MS, STATUS_VIDEO_MAX_MS, type StatusPerson } from '../../core/status';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { listTime } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Avatar, fontStyle, IconButton, Pressy, Txt } from '../../ui/kit';
import { tick } from '../../ui/motion';
import { Dialog, Sheet, toast } from '../../ui/overlays';

/** WhatsApp's quick replies to a status, in its order. */
const QUICK = ['😍', '😂', '😮', '😢', '🙏', '👏', '🎉', '💯'];

export default function StatusViewer() {
  const t = useT();
  const { lang } = useLook();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const all = useStatuses();
  usePeople();

  // Who to show, in the Status tab's order, starting with the one tapped.
  const order = useMemo(() => {
    if (!all) return [] as StatusPerson[];
    if (all.mine?.chat.id === id) return [all.mine];
    const fresh = all.others.filter((p) => !p.seen && !p.muted);
    const seen = all.others.filter((p) => p.seen && !p.muted);
    const muted = all.others.filter((p) => p.muted);
    return [...fresh, ...seen, ...muted];
  }, [all, id]);
  const [chatId, setChatId] = useState(id);
  const person = order.find((p) => p.chat.id === chatId) ?? null;
  const mine = person?.owner === core.myId;
  const items = useMemo(() => person?.items ?? [], [person]);

  // Start at the first one not seen yet (mine: the first), worked out once per person:
  // watching marks them seen, and that mustn't move what's showing.
  const [index, setIndex] = useState<number | null>(null);
  const loaded = person !== null;
  const initial = useMemo(
    () => (person && !mine ? Math.max(0, person.items.findIndex((m) => m.seq === null || m.seq > person.chat.readUpTo)) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, loaded],
  );
  const at = Math.min(index ?? initial, Math.max(0, items.length - 1));
  const item: Message | null = items[at] ?? null;

  const [holding, setHolding] = useState(false);
  // Held down (not just tapped): everything over the picture goes, as on WhatsApp (at once).
  const ui = useSharedValue(1);
  const [hidden, setHidden] = useState(false);
  const hide = (on: boolean) => {
    setHidden(on);
    ui.value = on ? 0 : 1;
  };
  const uiStyle = useAnimatedStyle(() => ({ opacity: ui.value }));
  const [typing, setTyping] = useState(false);
  const [seenBy, setSeenBy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ready, setReady] = useState(false);
  const [reply, setReply] = useState('');
  // Forwarding it: the chats to send to show over it, so it waits until back here.
  const [away, setAway] = useState(false);
  useFocusEffect(useCallback(() => setAway(false), []));
  const paused = holding || typing || seenBy || deleting || away || !ready;

  // Nothing (left) to show: close.
  useEffect(() => {
    if (all && (!person || !items.length)) close();
  }, [all, person, items.length]);

  // Watched: a read receipt to its owner.
  useEffect(() => {
    if (!item || mine || !person || item.seq === null || item.seq <= person.chat.readUpTo) return;
    void core.client.markRead(person.chat.id, item.seq).catch(() => {});
  }, [item, mine, person]);

  function close() {
    if (router.canGoBack()) router.back();
  }

  function next() {
    if (!person) return;
    if (at < items.length - 1) return go(at + 1);
    const i = order.findIndex((p) => p.chat.id === person.chat.id);
    const after = order[i + 1];
    if (!after) return close();
    setChatId(after.chat.id);
    setIndex(null);
    setReady(false);
  }

  function prev() {
    if (!person) return;
    if (at > 0) return go(at - 1);
    const i = order.findIndex((p) => p.chat.id === person.chat.id);
    const before = order[i - 1];
    if (!before) return go(0);
    setChatId(before.chat.id);
    setIndex(Math.max(0, before.items.length - 1));
    setReady(false);
  }

  function go(i: number) {
    setIndex(i);
    setReady(false);
  }

  // The bar for the one showing fills over its time; when full, the next.
  const progress = useSharedValue(0);
  const length = item?.file?.kind === 'video' ? Math.min(STATUS_VIDEO_MAX_MS, item.file.duration || 15_000) : STATUS_SHOW_MS;
  const key = item ? `${item.chatId}/${item.id}` : '';
  useEffect(() => {
    progress.value = 0;
  }, [key, progress]);
  useEffect(() => {
    if (!item || paused) {
      cancelAnimation(progress);
      return;
    }
    const left = Math.max(0, 1 - progress.value) * length;
    progress.value = withTiming(1, { duration: left, easing: Easing.linear }, (done) => {
      if (done) scheduleOnRN(next);
    });
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, paused, length]);

  // Swipe down to close.
  const pull = useSharedValue(0);
  const pan = usePanGesture({
    activeOffsetY: [-1000, 18],
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      pull.value = Math.max(0, e.translationY);
    },
    onDeactivate: (e) => {
      if (e.translationY > 120) scheduleOnRN(close);
      pull.value = withTiming(0);
    },
  });
  const pullStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }], opacity: 1 - Math.min(0.5, pull.value / 600) }));

  async function sendReply(quick?: string) {
    const words = quick ?? reply.trim();
    if (!words || !item) return;
    if (quick) Keyboard.dismiss();
    else setReply('');
    setTyping(false);
    try {
      await replyToStatus(item, words);
      toast(t.replySent);
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  /** Mine, to chats: a photo or video as itself (with its words), words on a colour as a message. */
  function forward() {
    if (!item) return;
    if (item.file && !haveFile(item)) return toast(t.couldNot);
    setAway(true);
    const files = item.file ? [[item.chatId, item.author, item.id]] : [];
    const texts = item.file ? [] : [item.text ?? ''];
    router.push({ pathname: '/forward', params: { texts: JSON.stringify(texts), files: JSON.stringify(files) } });
  }

  function like() {
    if (!item) return;
    const on = item.reactions?.[core.myId] === '❤️';
    tick();
    void core.client.react(item.chatId, { author: item.author, id: item.id }, on ? null : '❤️').catch(() => toast(t.couldNot));
  }

  if (!person || !item) return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
  const name = mine ? t.myStatus : core.name(person.owner) || '…';
  const liked = item.reactions?.[core.myId] === '❤️';
  const viewers = (item.readBy ?? []).filter((u) => u !== core.myId);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, backgroundColor: '#000000' }, pullStyle]} testID="status-viewer">
        <StatusBar style="light" />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <Pressable
            style={{ flex: 1 }}
            onPressIn={() => setHolding(true)}
            onPressOut={() => {
              setHolding(false);
              if (hidden) hide(false);
            }}
            onPress={(e) => (e.nativeEvent.locationX < width / 3 ? prev() : next())}
            delayLongPress={250}
            onLongPress={() => hide(true)}
            accessibilityLabel={t.nextStatus}
            testID="status-tap"
          >
            <Shown key={key} m={item} playing={!paused} onReady={() => setReady(true)} />
          </Pressable>
          {/* Replying: the status dims behind the box (a tap on it puts the keyboard away). */}
          {typing && <Pressable style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => Keyboard.dismiss()} accessible={false} />}

          {/* Bars, who, when. */}
          <Animated.View style={[{ position: 'absolute', top: insets.top + 8, start: 10, end: 10, gap: 10 }, uiStyle]} pointerEvents={hidden ? 'none' : 'box-none'}>
            <View style={{ flexDirection: 'row', gap: 4 }} pointerEvents="none">
              {items.map((m, i) => (
                <Bar key={m.id} state={i < at ? 1 : i > at ? 0 : null} progress={progress} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <IconButton icon="back" label={t.back} onPress={close} color="#FFFFFF" flip size={38} />
              <Avatar id={person.owner} name={(mine ? (core.me?.name ?? '') : name).replace(/^~ /, '')} size={36} />
              <View style={{ flex: 1 }}>
                <Txt size={15} weight="700" color="#FFFFFF" lines={1}>
                  {name}
                </Txt>
                <Txt size={12} color="rgba(255,255,255,0.75)">
                  {listTime(item.sentAt, t)}
                </Txt>
              </View>
              {mine && <IconButton icon="forward" label={t.forward} onPress={forward} color="#FFFFFF" flip testID="status-forward" />}
              {mine && <IconButton icon="trash" label={t.deleteStatus} onPress={() => setDeleting(true)} color="#FFFFFF" testID="status-delete" />}
            </View>
          </Animated.View>

          {/* Mine: who saw it. Theirs: reply and like. (Faded, not removed, while held, so the picture doesn't jump.) */}
          <Animated.View style={[{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 10 }, uiStyle]} pointerEvents={hidden ? 'none' : 'auto'}>
            {mine ? (
              <Pressy onPress={() => setSeenBy(true)} label={t.seenBy} scale={0.95} testID="status-seen">
                <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Icon name="eye" size={18} color="#FFFFFF" />
                  <Txt size={14} weight="700" color="#FFFFFF">
                    {String(viewers.length)}
                  </Txt>
                </View>
              </Pressy>
            ) : (
              <>
                {typing && !reply && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 18 }} testID="status-quick">
                    {QUICK.map((e) => (
                      <Pressy key={e} onPress={() => void sendReply(e)} label={fill(t.replyWithEmoji, { emoji: e })} style={{ width: '25%' }} testID={`status-quick-${e}`}>
                        <Txt size={36} align="center" style={{ paddingVertical: 10 }}>
                          {e}
                        </Txt>
                      </Pressy>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <TextInput
                    value={reply}
                    onChangeText={setReply}
                    onFocus={() => setTyping(true)}
                    onBlur={() => setTyping(false)}
                    placeholder={t.replyToStatus}
                    placeholderTextColor="rgba(255,255,255,0.65)"
                    multiline
                    maxLength={4000}
                    cursorColor="#FFFFFF"
                    style={[fontStyle(reply || null, lang, 15.5, '400'), { flex: 1, color: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', paddingHorizontal: 16, paddingVertical: 10, maxHeight: 110 }]}
                    testID="status-reply"
                  />
                  {reply.trim() ? (
                    <IconButton icon="send" label={t.send} onPress={() => void sendReply()} color="#FFFFFF" flip testID="status-reply-send" />
                  ) : (
                    <IconButton icon="heart" label={t.likeStatus} onPress={like} color={liked ? '#E5484D' : '#FFFFFF'} testID="status-like" />
                  )}
                </View>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>

        <Sheet visible={seenBy} onClose={() => setSeenBy(false)} title={fill(t.seenByCount, { n: viewers.length })}>
          {viewers.length ? (
            viewers.map((u) => (
              <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 8 }}>
                <Avatar id={u} name={core.name(u).replace(/^~ /, '')} size={40} />
                <Txt size={15.5} weight="600" style={{ flex: 1 }} lines={1}>
                  {core.name(u) || '…'}
                </Txt>
                {item.reactions?.[u] && <Txt size={18}>{item.reactions[u]}</Txt>}
              </View>
            ))
          ) : (
            <Txt size={14} align="center" style={{ padding: 20, opacity: 0.7 }}>
              {t.noViewsYet}
            </Txt>
          )}
        </Sheet>
        <Dialog
          visible={deleting}
          onClose={() => setDeleting(false)}
          title={t.deleteStatus}
          text={t.deleteStatusText}
          buttons={[
            {
              label: t.delete,
              danger: true,
              testID: 'confirm-delete-status',
              onPress: () => {
                setDeleting(false);
                void core.client.deleteForEveryone(item.chatId, { author: item.author, id: item.id }).catch(() => toast(t.couldNot));
              },
            },
            { label: t.cancel, onPress: () => setDeleting(false) },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** One bar: full (seen), empty (to come), or filling (this one). */
function Bar({ state, progress }: { state: number | null; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ width: `${(state ?? progress.value) * 100}%` }));
  return (
    <View style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
      <Animated.View style={[{ height: '100%', backgroundColor: '#FFFFFF' }, style]} />
    </View>
  );
}

/** The status itself: words on a colour, a photo, or a video. */
function Shown({ m, playing, onReady }: { m: Message; playing: boolean; onReady: () => void }) {
  const t = useT();
  const f = m.file;
  const here = !!f && haveFile(m);
  const [failed, setFailed] = useState(false);
  const told = useRef(false);
  const ready = () => {
    if (told.current) return;
    told.current = true;
    onReady();
  };

  // A photo or video that hasn't downloaded yet: get it now.
  useEffect(() => {
    if (!f) {
      ready();
      return;
    }
    if (here) return;
    download(m).catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here]);

  if (!f) {
    return (
      <View style={{ flex: 1, backgroundColor: STATUS_BG[m.bg ?? 0] ?? STATUS_BG[0], alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <Txt size={(m.text?.length ?? 0) > 120 ? 22 : 30} weight="700" color="#FFFFFF" align="center">
          {m.text}
        </Txt>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      {!here ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {f.thumb && <Image source={{ uri: `data:image/jpeg;base64,${f.thumb}` }} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} blurRadius={8} contentFit="cover" />}
          {failed ? (
            <Txt size={14} color="#FFFFFF">
              {t.couldNot}
            </Txt>
          ) : (
            <ActivityIndicator color="#FFFFFF" size="large" />
          )}
        </View>
      ) : f.kind === 'video' ? (
        <StatusVideo uri={f.local!} playing={playing} onReady={ready} />
      ) : (
        <Image source={{ uri: f.local }} style={{ flex: 1 }} contentFit="contain" onLoad={ready} onError={ready} />
      )}
      {!!m.text && (
        <View style={{ position: 'absolute', bottom: 16, start: 16, end: 16, alignItems: 'center' }}>
          <Txt size={15.5} color="#FFFFFF" align="center" style={{ backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
            {m.text}
          </Txt>
        </View>
      )}
    </View>
  );
}

function StatusVideo({ uri, playing, onReady }: { uri: string; playing: boolean; onReady: () => void }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' || status === 'error') onReady();
    });
    if (player.status === 'readyToPlay') onReady();
    return () => sub.remove();
  }, [player, onReady]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />;
}
