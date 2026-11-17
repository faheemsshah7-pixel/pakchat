// status/[id].tsx: watching statuses, one person after another.
//
// Bars at the top fill as each status shows (words and photos for 5 seconds,
// a video to its end, up to a minute). Tap the right side for the next, the left
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
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, TextInput, View, useWindowDimensions, type TextInputInstance } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { core, isOffline } from '../../core/core';
import { download, haveFile } from '../../core/files';
import { useStatuses, usePeople } from '../../core/hooks';
import { replyToStatus, STATUS_BG, STATUS_FONTS, STATUS_SHOW_MS, STATUS_VIDEO_MAX_MS, STATUS_VOICE_MAX_MS, voiceColour, type StatusPerson } from '../../core/status';
import { barsOf } from '../../core/voice';
import { stopAll } from '../../core/player';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { RichWords } from '../../ui/chat/RichText';
import { listTime, whenLabel } from '../../ui/format';
import { ReportSheet } from '../../ui/ReportSheet';
import { Icon } from '../../ui/icons';
import { Avatar, fontStyle, IconButton, Pressy, Txt } from '../../ui/kit';
import { tick } from '../../ui/motion';
import { Dialog, MenuItem, Popup, Sheet, toast } from '../../ui/overlays';

/** WhatsApp's quick replies to a status, in its order. */
const QUICK = ['😍', '😂', '😮', '😢', '🙏', '👏', '🎉', '💯'];

export default function StatusViewer() {
  const t = useT();
  const { lang, rtl } = useLook();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // `at`: start at this one of mine (from the My status page).
  const { id, at: startAt } = useLocalSearchParams<{ id: string; at?: string }>();
  const all = useStatuses();
  usePeople();

  // Who to show, in the Status tab's order, starting with the one tapped.
  const order = useMemo(() => {
    if (!all) return [] as StatusPerson[];
    if (all.mine?.chat.id === id) return [all.mine];
    const fresh = all.others.filter((p) => !p.seen && !p.muted);
    const seen = all.others.filter((p) => p.seen && !p.muted);
    const muted = all.others.filter((p) => p.muted);
    // Muted people's statuses never play by themselves, like WhatsApp's: only when one of them is tapped
    // (and then only the muted ones).
    return all.others.find((p) => p.chat.id === id)?.muted ? muted : [...fresh, ...seen];
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
    () =>
      person && !mine
        ? Math.max(0, person.items.findIndex((m) => m.seq === null || m.seq > person.chat.readUpTo))
        : Math.max(0, person?.items.findIndex((m) => m.id === startAt) ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, loaded],
  );
  const at = Math.min(index ?? initial, Math.max(0, items.length - 1));
  const item: Message | null = items[at] ?? null;

  const [holding, setHolding] = useState(false);
  // Held down (not just tapped): everything over the picture fades away, as on WhatsApp, and back when let go.
  const ui = useSharedValue(1);
  const [hidden, setHidden] = useState(false);
  const hide = (on: boolean) => {
    setHidden(on);
    ui.set(withTiming(on ? 0 : 1, { duration: 150 }));
  };
  const uiStyle = useAnimatedStyle(() => ({ opacity: ui.value }));
  const [typing, setTyping] = useState(false);
  const [seenBy, setSeenBy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  // A video's sound, on or off (kept for the next video too, like WhatsApp's).
  const [quiet, setQuiet] = useState(false);
  const replyBox = useRef<TextInputInstance>(null);
  const [ready, setReady] = useState(false);
  const [reply, setReply] = useState('');
  // Forwarding it: the chats to send to show over it, so it waits until back here.
  const [away, setAway] = useState(false);
  useFocusEffect(useCallback(() => setAway(false), []));
  const paused = holding || typing || seenBy || deleting || away || menu || reporting || !ready;

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
  const length =
    item?.file?.kind === 'video'
      ? Math.min(STATUS_VIDEO_MAX_MS, item.file.duration || 15_000)
      : item?.file?.kind === 'voice'
        ? Math.min(STATUS_VOICE_MAX_MS, item.file.duration || STATUS_SHOW_MS)
        : STATUS_SHOW_MS;
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

  /** The next (or the one before) person, by a swipe sideways. */
  function nextPerson(step: 1 | -1) {
    if (!person) return;
    const i = order.findIndex((p) => p.chat.id === person.chat.id);
    const to = order[i + step];
    if (!to) return step > 0 ? close() : undefined;
    setChatId(to.chat.id);
    setIndex(null);
    setReady(false);
  }
  function swipedUp() {
    if (mine) setSeenBy(true);
    else replyBox.current?.focus();
  }

  // Swipe down to close; up for the reply box (theirs) or who saw it (mine); sideways to the next
  // or last person, with a turn like WhatsApp's.
  const pull = useSharedValue(0);
  const side = useSharedValue(0);
  const axis = useSharedValue(0); // 0 not yet, 1 up and down, 2 sideways
  const pan = usePanGesture({
    activeOffsetY: [-18, 18],
    activeOffsetX: [-18, 18],
    onUpdate: (e) => {
      if (!axis.value) axis.value = Math.abs(e.translationX) > Math.abs(e.translationY) ? 2 : 1;
      if (axis.value === 1) pull.value = Math.max(0, e.translationY);
      else side.value = e.translationX;
    },
    onDeactivate: (e) => {
      if (axis.value === 1) {
        if (e.translationY > 120) scheduleOnRN(close);
        else if (e.translationY < -80) scheduleOnRN(swipedUp);
      } else if (axis.value === 2) {
        if (e.translationX < -80) scheduleOnRN(nextPerson, (rtl ? -1 : 1) as 1 | -1);
        else if (e.translationX > 80) scheduleOnRN(nextPerson, (rtl ? 1 : -1) as 1 | -1);
      }
      axis.value = 0;
      pull.value = withTiming(0);
      side.value = withTiming(0, { duration: 180 });
    },
  });
  const pullStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateY: pull.value },
      { translateX: side.value * 0.6 },
      { rotateY: `${interpolate(side.value, [-width, 0, width], [28, 0, -28])}deg` },
    ],
    opacity: 1 - Math.min(0.5, pull.value / 600) - Math.min(0.3, Math.abs(side.value) / 1200),
  }));

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
            <Shown key={key} m={item} playing={!paused} quiet={quiet} onReady={() => setReady(true)} />
          </Pressable>
          {/* Replying: the status dims behind the box (a tap on it puts the keyboard away). */}
          {typing && (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
              <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => Keyboard.dismiss()} accessible={false} />
            </Animated.View>
          )}

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
              {(item.file?.kind === 'video' || item.file?.kind === 'voice') && (
                <IconButton icon={quiet ? 'speakerOff' : 'speaker'} label={quiet ? t.soundOn : t.soundOff} onPress={() => setQuiet(!quiet)} color="#FFFFFF" testID="status-sound" />
              )}
              {mine && <IconButton icon="forward" label={t.forward} onPress={forward} color="#FFFFFF" flip testID="status-forward" />}
              {mine && <IconButton icon="trash" label={t.deleteStatus} onPress={() => setDeleting(true)} color="#FFFFFF" testID="status-delete" />}
              {!mine && <IconButton icon="more" label={t.moreOptions} onPress={() => setMenu(true)} color="#FFFFFF" testID="status-menu" />}
            </View>
          </Animated.View>

          {/* Mine: who saw it. Theirs: reply and like. (Faded, not removed, while held, so the picture doesn't jump.) */}
          <Animated.View style={[{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 10 }, uiStyle]} pointerEvents={hidden ? 'none' : 'auto'}>
            {mine ? (
              <Pressy ripple="light" onPress={() => setSeenBy(true)} label={t.seenBy} scale={0.95} testID="status-seen">
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
                  <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(120)} style={{ flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 18 }} testID="status-quick">
                    {QUICK.map((e) => (
                      <Pressy key={e} onPress={() => void sendReply(e)} label={fill(t.replyWithEmoji, { emoji: e })} style={{ width: '25%' }} testID={`status-quick-${e}`}>
                        <Txt size={36} align="center" style={{ paddingVertical: 10 }}>
                          {e}
                        </Txt>
                      </Pressy>
                    ))}
                  </Animated.View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <TextInput
                    ref={replyBox}
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
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="600" lines={1}>
                    {core.name(u) || '…'}
                  </Txt>
                  {/* When they saw it, like WhatsApp's ("Today, 10:42"). */}
                  {!!item.readTimes?.[u] && (
                    <Txt size={13} style={{ opacity: 0.65 }}>
                      {whenLabel(item.readTimes[u], t)}
                    </Txt>
                  )}
                </View>
                {item.reactions?.[u] && <Txt size={18}>{item.reactions[u]}</Txt>}
              </View>
            ))
          ) : (
            <Txt size={14} align="center" style={{ padding: 20, opacity: 0.7 }}>
              {t.noViewsYet}
            </Txt>
          )}
        </Sheet>
        <Popup visible={menu} onClose={() => setMenu(false)}>
          <MenuItem
            icon="muted"
            label={person.muted ? t.unmute : t.mute}
            onPress={() => {
              setMenu(false);
              core.setPrefs(person.chat.id, { muted: !person.muted });
              toast(person.muted ? t.unmute : t.mute);
            }}
            testID="status-menu-mute"
          />
          <MenuItem
            icon="chat"
            label={t.message}
            onPress={() => {
              setMenu(false);
              void core.client.openDirect(person.owner).then((c) => router.replace({ pathname: '/chat/[id]', params: { id: c.id } })).catch(() => toast(t.couldNot));
            }}
            testID="status-menu-message"
          />
          <MenuItem
            icon="user"
            label={t.viewContact}
            onPress={() => {
              setMenu(false);
              void core.client.openDirect(person.owner).then((c) => router.replace({ pathname: '/info/[id]', params: { id: c.id } })).catch(() => toast(t.couldNot));
            }}
            testID="status-menu-contact"
          />
          <MenuItem icon="flag" label={t.report} onPress={() => (setMenu(false), setReporting(true))} testID="status-menu-report" />
        </Popup>
        <ReportSheet visible={reporting} chatId={person.chat.id} group={false} userId={person.owner} message={item} onClose={() => setReporting(false)} />
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
function Shown({ m, playing, quiet, onReady }: { m: Message; playing: boolean; quiet: boolean; onReady: () => void }) {
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
        <Txt size={(m.text?.length ?? 0) > 120 ? 22 : 30} weight="700" color="#FFFFFF" align="center" style={m.font ? STATUS_FONTS[m.font] : undefined}>
          {/* A web address can be tapped. */}
          <RichWords text={m.text ?? ''} color="#FFFFFF" mine />
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
        <StatusVideo uri={f.local!} playing={playing} quiet={quiet} onReady={ready} />
      ) : f.kind === 'voice' || f.kind === 'audio' ? (
        <StatusVoice m={m} uri={f.local!} playing={playing} quiet={quiet} onReady={ready} />
      ) : (
        <Image source={{ uri: f.local }} style={{ flex: 1 }} contentFit="contain" onLoad={ready} onError={ready} />
      )}
      {!!m.text && (
        <View style={{ position: 'absolute', bottom: 16, start: 16, end: 16, alignItems: 'center' }}>
          <Txt size={15.5} color="#FFFFFF" align="center" style={{ backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
            <RichWords text={m.text} color="#FFFFFF" mine />
          </Txt>
        </View>
      )}
    </View>
  );
}

/** Turns a voice status's sound off or on. */
function voiceOff(player: AudioPlayer, quiet: boolean) {
  player.muted = quiet;
}

/** A voice status: its sender's photo on a colour, the bars of the recording, and it plays. */
function StatusVoice({ m, uri, playing, quiet, onReady }: { m: Message; uri: string; playing: boolean; quiet: boolean; onReady: () => void }) {
  const player = useAudioPlayer({ uri });
  const bars = useMemo(() => barsOf(m.file?.waveform, 32), [m.file?.waveform]);
  // Once, as it shows: any voice note playing elsewhere stops.
  useEffect(() => {
    stopAll();
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useEffect(() => voiceOff(player, quiet), [quiet, player]);
  return (
    <View pointerEvents="none" style={{ flex: 1, backgroundColor: voiceColour(m.id), alignItems: 'center', justifyContent: 'center', gap: 28 }}>
      <View>
        <Avatar id={m.author} name={core.name(m.author)} size={120} />
        <View style={{ position: 'absolute', end: -4, bottom: -4, width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mic" size={22} color={voiceColour(m.id)} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 60 }}>
        {bars.map((b, i) => (
          <View key={i} style={{ width: 4, height: Math.max(6, b * 60), borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' }} />
        ))}
      </View>
    </View>
  );
}

/** Turns a player's sound off or on. */
function soundOff(player: VideoPlayer, quiet: boolean) {
  player.muted = quiet;
}

function StatusVideo({ uri, playing, quiet, onReady }: { uri: string; playing: boolean; quiet: boolean; onReady: () => void }) {
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
  useEffect(() => soundOff(player, quiet), [quiet, player]);
  // The video itself never takes the touch, so holding pauses it (and hides
  // everything over it) just like a photo: Android's video view kept it before.
  return (
    <View pointerEvents="none" style={{ flex: 1 }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />
    </View>
  );
}
