// call.tsx: the call screen, for voice and video, one to one or a group.
//
// Ringing: the caller's name, with Decline and Answer. Calling: "Calling…", then
// "Ringing…" once their phone is actually ringing (it says so), like WhatsApp.
// In the call: the time, and the buttons (where the sound goes, camera,
// switch camera, mute, hang up). A video call fills the screen with the
// other person, with you small in the corner; a group call shows everyone in
// tiles. The call itself is in core/calls.ts, so going back to the chats
// doesn't hang up: a green bar there brings you back here.
//
// On a locked phone, this screen shows over the lock (CallLockScreen in the
// native module), but only this screen: leaving it puts the lock back.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FlatList, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fileModule, type AudioRoute } from '../../modules/pakchat-signal';
import { calls, MAX_IN_CALL, type CallView, type EndReason, type PeerView } from '../core/calls';
import { core } from '../core/core';
import { useCall, useChat, useNow, usePeople } from '../core/hooks';
import { fill, useT } from '../i18n';
import type { Strings } from '../i18n/strings';
import { duration } from '../ui/format';
import { Icon, type IconName } from '../ui/icons';
import { Avatar, Field, Pressy, Txt } from '../ui/kit';
import { smooth, tick } from '../ui/motion';
import { Sheet, toast } from '../ui/overlays';

const INK = '#FFFFFF';
const SOFT = 'rgba(255,255,255,0.72)';
const RED = '#E5484D';
const GREEN = '#22A35A';

export default function CallScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { id, answer } = useLocalSearchParams<{ id?: string; answer?: string }>();
  const call = useCall();
  const seen = useRef(false);
  const answered = useRef(false);
  const [adding, setAdding] = useState(false);

  // PakChat may have just been started by the ringing alert: bring the call back.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (calls.view()) return;
    void core.init().then(() => {
      if (!id || !calls.restore(id)) setGone(true);
    });
  }, [id]);

  // "Answer" on the alert: answer straight away.
  useEffect(() => {
    if (answer === '1' && !answered.current && call?.state === 'incoming' && call.id === id) {
      answered.current = true;
      void calls.answer();
    }
  }, [answer, call?.state, call?.id, id]);

  // Over the lock screen only while this screen shows.
  const video = !!call?.video;
  useFocusEffect(
    useCallback(() => {
      calls.setScreenOpen(true);
      fileModule().callShowOverLock(true, video);
      return () => {
        calls.setScreenOpen(false);
        fileModule().callShowOverLock(false, false);
      };
    }, [video]),
  );

  // Picture-in-picture, like WhatsApp: leaving PakChat during a video call keeps the
  // video going in a small window (only from this screen, so it never shows a chat).
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const sub = fileModule().addListener('pip', (e) => setSmall(e.on));
    return () => sub.remove();
  }, []);
  const pipOk = video && call?.state === 'active';
  useFocusEffect(
    useCallback(() => {
      fileModule().callPip(pipOk);
      return () => fileModule().callPip(false);
    }, [pipOk]),
  );

  // The call is over: "Call ended" shows for a moment, then back to where you
  // called from (the chat, or the Calls tab). This screen takes itself off
  // (not just whatever is on top), and if that didn't work for any reason,
  // it goes to the chat list rather than staying on an empty screen.
  const navigation = useNavigation();
  const closed = useRef(false);
  const check = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ended = call?.state === 'ended';
  useEffect(() => {
    if (call) seen.current = true;
    if (closed.current || !((seen.current && (!call || ended)) || gone)) return;
    const close = () => {
      if (closed.current) return;
      closed.current = true;
      if (navigation.canGoBack()) navigation.goBack();
      else router.replace('/');
      // Still showing a second later: go to the chat list.
      check.current = setTimeout(() => {
        if (navigation.isFocused()) router.replace('/');
      }, 1_000);
    };
    // Once the call is cleared away, at once; while "Call ended" shows, after a moment.
    const wait = setTimeout(close, call ? 1_200 : 0);
    return () => clearTimeout(wait);
  }, [call, ended, gone, navigation]);
  useEffect(
    () => () => {
      if (check.current) clearTimeout(check.current);
    },
    [],
  );

  if (!call) return <View style={{ flex: 1, backgroundColor: '#0B1424' }} />;
  // In the small window: only the video, no names or buttons.
  if (small && !ended) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B1424' }}>
        <StatusBar style="light" />
        {call.group ? <Tiles call={call} /> : <Picture call={call} small />}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#0B1424' }} testID="call-screen">
      <StatusBar style="light" />
      <LinearGradient colors={['#13233F', '#0B1424']} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} />
      {/* The video goes before the screen closes, so nothing is left behind on top. */}
      {!ended && <Picture call={call} />}
      <View style={{ flex: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 18 }} pointerEvents="box-none">
        <Header call={call} t={t} />
        {call.canAdd && call.state === 'active' && (
          // Top corner, like WhatsApp: add someone, and the call becomes a group call.
          <View style={{ position: 'absolute', top: insets.top + 4, end: 14 }}>
            <Pressy onPress={() => setAdding(true)} label={t.addPeople} scale={0.9} testID="call-add">
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="userPlus" size={21} color={INK} stroke={2} />
              </View>
            </Pressy>
          </View>
        )}
        {/* A group call shows everyone in tiles, in the space between the name and the buttons. */}
        {call.group && call.state === 'active' ? <Tiles call={call} /> : <View style={{ flex: 1 }} pointerEvents="none" />}
        {call.waiting && call.state !== 'ended' && <Waiting w={call.waiting} t={t} />}
        {call.state === 'incoming' ? <Ringing call={call} t={t} /> : <Controls call={call} t={t} />}
      </View>
      <AddPeople call={call} visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

/** Call waiting, like WhatsApp: someone else is calling. End this call and answer, or decline theirs. */
function Waiting({ w, t }: { w: NonNullable<CallView['waiting']>; t: Strings }) {
  const chat = useChat(w.chatId);
  const name = w.group && chat ? core.chatTitle(chat) : core.name(w.from) || t.unknownCaller;
  return (
    <View style={{ marginHorizontal: 16, marginBottom: 18, padding: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', gap: 12 }} testID="call-waiting">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar id={w.group ? w.chatId : w.from} name={name} size={44} group={w.group} />
        <View style={{ flex: 1 }}>
          <Txt size={16} weight="700" color={INK} lines={1}>
            {name}
          </Txt>
          <Txt size={13.5} color={SOFT} lines={1}>
            {w.video ? t.incomingVideo : t.incomingVoice}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressy onPress={() => void calls.declineWaiting()} label={t.decline} scale={0.96} style={{ flex: 1 }} testID="waiting-decline">
          <View style={{ height: 44, borderRadius: 22, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={15} weight="700" color={INK}>
              {t.decline}
            </Txt>
          </View>
        </Pressy>
        <Pressy onPress={() => void calls.acceptWaiting()} label={t.endAndAccept} scale={0.96} style={{ flex: 1 }} testID="waiting-accept">
          <View style={{ height: 44, borderRadius: 22, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={15} weight="700" color={INK}>
              {t.endAndAccept}
            </Txt>
          </View>
        </Pressy>
      </View>
    </View>
  );
}

/** Everyone in the call but me: the chat's other people and anyone added. */
function othersIn(call: CallView, chat: ReturnType<typeof useChat>) {
  const inChat = chat ? chat.members.map((m) => m.userId).filter((u) => u !== core.myId) : [];
  return [...new Set([...inChat, ...call.extra])];
}

/** Pick someone to add to the call: their phone rings, and they join everyone here. */
function AddPeople({ call, visible, onClose }: { call: CallView; visible: boolean; onClose: () => void }) {
  const t = useT();
  const people = usePeople();
  const chat = useChat(call.chatId);
  const [query, setQuery] = useState('');
  const inCall = new Set([core.myId, ...othersIn(call, chat)]);
  const q = query.trim().toLowerCase();
  const list = Object.values(people)
    .filter((p) => p.name && !inCall.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const full = inCall.size >= MAX_IN_CALL;

  async function add(id: string, name: string) {
    onClose();
    setQuery('');
    tick();
    if (await calls.add([id])) toast(fill(t.ringingPerson, { name }));
    else toast(t.couldNot);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={t.addToCallTitle}>
      {full ? (
        <Txt size={14.5} align="center" style={{ padding: 24 }}>
          {fill(t.callIsFull, { count: String(MAX_IN_CALL) })}
        </Txt>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ paddingHorizontal: 16 }}>
            <Field icon="search" value={query} onChangeText={setQuery} placeholder={t.search} testID="call-add-search" />
          </View>
          <FlatList
            data={list}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 380 }}
            ListEmptyComponent={
              <Txt size={14} align="center" style={{ padding: 20, opacity: 0.7 }}>
                {t.noOneToAdd}
              </Txt>
            }
            renderItem={({ item }) => (
              <Pressy onPress={() => void add(item.id, item.name)} label={item.name} scale={0.98} testID="call-add-person">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 8 }}>
                  <Avatar id={item.id} name={item.name} size={42} />
                  <Txt size={16} weight="600" lines={1} style={{ flex: 1 }}>
                    {item.name}
                  </Txt>
                  <Icon name="userPlus" size={20} color="#22A35A" />
                </View>
              </Pressy>
            )}
          />
        </View>
      )}
    </Sheet>
  );
}

/** Name, and how the call is going ("Calling…", then "Ringing…" once their phone rings, "02:15", "Call ended"). */
function Header({ call, t }: { call: CallView; t: Strings }) {
  const chat = useChat(call.chatId);
  const now = useNow(1000);
  // Someone was added: everyone's names ("Sara, Bilal").
  const title = call.extra.length ? othersIn(call, chat).map((u) => core.name(u) || '…').join(', ') : chat ? core.chatTitle(chat) : '';
  const showAvatar = !call.video || call.state !== 'active' || call.group;
  const line =
    call.state === 'ended'
      ? endText(call.endReason, t)
      : call.state === 'incoming'
        ? call.video
          ? t.incomingVideo
          : t.incomingVoice
        : call.state === 'outgoing'
          ? call.ringing
            ? t.ringingWord
            : t.callingWord
          : call.state === 'connecting'
            ? t.connectingWord
            : call.peers.some((p) => p.state === 'reconnecting')
              ? t.reconnecting
              : duration(now - (call.startedAt ?? now));
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 60 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="lock" size={13} color={SOFT} />
        <Txt size={12.5} color={SOFT}>
          {t.callLocked}
        </Txt>
      </View>
      {showAvatar && !call.group && call.state !== 'active' && (
        <Pulse>
          <Avatar id={call.direction === 'in' ? call.from : ((chat && core.otherPerson(chat)) ?? call.chatId)} name={title} size={110} />
        </Pulse>
      )}
      {showAvatar && call.group && call.state !== 'active' && <Avatar id={call.chatId} name={title} size={96} group />}
      <Txt size={26} weight="800" color={INK} align="center" lines={2} testID="call-title">
        {title}
      </Txt>
      <Txt size={15} color={SOFT} align="center" testID="call-state">
        {line}
      </Txt>
    </View>
  );
}

function endText(r: EndReason | null, t: Strings) {
  switch (r) {
    case 'busy':
      return t.callBusy;
    case 'declined':
      return t.callDeclined;
    case 'noAnswer':
      return t.callNoAnswer;
    case 'missed':
      return t.missedVoiceCall;
    case 'failed':
      return t.callFailed;
    case 'offline':
      return t.offline;
    case 'full':
      return t.callFull;
    case 'permission':
      return t.callNeedsMic;
    case 'elsewhere':
      return t.callElsewhere;
    default:
      return t.callEnded;
  }
}

/** The picture while it rings (it used to pulse; now nothing moves, like WhatsApp). */
function Pulse({ children }: { children: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 18 }}>
      {children}
    </View>
  );
}

/**
 * The video of a one-to-one call: the other person full screen and me in the
 * corner. (A group call's tiles are in Tiles.) Before anyone answers, my own
 * camera shows dimmed behind the name, as when it rings.
 */
function Picture({ call, small }: { call: CallView; small?: boolean }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Tap the small picture to swap it with the big one; drag it to any corner (WhatsApp does both).
  const [swapped, setSwapped] = useState(false);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const from = useSharedValue({ x: 0, y: 0 });
  // How far it can go from the top corner it starts in: across, and down to above the buttons.
  const across = -(width - 28 - SELF_W);
  const down = Math.max(0, height - insets.top - insets.bottom - 110 - SELF_H - 250);
  const drag = usePanGesture({
    activeOffsetX: [-8, 8],
    activeOffsetY: [-8, 8],
    onActivate: () => {
      'worklet';
      from.value = { x: x.value, y: y.value };
    },
    onUpdate: (e) => {
      'worklet';
      x.value = from.value.x + e.translationX;
      y.value = from.value.y + e.translationY;
    },
    onDeactivate: (e) => {
      'worklet';
      // To the nearest corner, helped along by how it was thrown.
      const nx = x.value + e.velocityX * 0.1;
      const ny = y.value + e.velocityY * 0.1;
      x.value = withSpring(nx < across / 2 ? across : 0, smooth);
      y.value = withSpring(ny > down / 2 ? down : 0, smooth);
    },
  });
  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));

  if (!call.video) return null;
  const waiting = call.state !== 'active';
  if (call.group && !waiting) return null;
  const other = call.peers.find((p) => p.stream && p.video);
  const flip = swapped && !!other?.stream && !!call.local;
  const full = { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 } as const;
  return (
    <>
      {/* A shared screen shows whole; a face fills the screen. */}
      {!waiting && flip && call.local && <RTCView key="me-big" streamURL={call.local} objectFit="cover" mirror={call.front} style={full} zOrder={0} />}
      {!waiting && !flip && other?.stream && <RTCView key={`${other.key}:${other.rev}`} streamURL={other.stream} objectFit={other.screen ? 'contain' : 'cover'} style={full} zOrder={0} />}
      {call.local && !waiting && !small && (
        <GestureDetector gesture={drag}>
          <Animated.View style={[{ position: 'absolute', top: insets.top + 110, end: 14, width: SELF_W, height: SELF_H, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }, moved]}>
            <Pressy onPress={() => other?.stream && setSwapped((v) => !v)} label={t.swapVideo} scale={0.96} style={{ flex: 1 }} testID="call-self-view">
              {flip && other?.stream ? (
                <RTCView key={`small-${other.key}:${other.rev}`} streamURL={other.stream} objectFit={other.screen ? 'contain' : 'cover'} style={{ flex: 1 }} zOrder={1} />
              ) : (
                <RTCView key="me-small" streamURL={call.local} objectFit="cover" mirror={call.front} style={{ flex: 1 }} zOrder={1} />
              )}
            </Pressy>
          </Animated.View>
        </GestureDetector>
      )}
      {call.local && waiting && <RTCView streamURL={call.local} objectFit="cover" mirror={call.front} style={{ ...full, opacity: 0.5 }} zOrder={0} />}
    </>
  );
}

const SELF_W = 110;
const SELF_H = 160;

/**
 * Everyone in a group call (me first), filling the space it's given: two
 * people one above the other, more in two columns. Sized to its own space,
 * so it never runs under the name or the buttons.
 */
function Tiles({ call }: { call: CallView }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const tiles: (PeerView | 'me')[] = ['me', ...call.peers];
  const cols = tiles.length <= 2 ? 1 : 2;
  const rows = Math.ceil(tiles.length / cols);
  const gap = 8;
  const w = (box.w - gap * (cols - 1)) / cols;
  const h = (box.h - gap * (rows - 1)) / rows;
  return (
    <View style={{ flex: 1, marginTop: 18, marginBottom: 22, marginHorizontal: 12 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box.h > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {tiles.map((p) => (
            <Tile key={p === 'me' ? 'me' : p.key} call={call} peer={p} w={w} h={h} />
          ))}
        </View>
      )}
    </View>
  );
}

function Tile({ call, peer, w, h }: { call: CallView; peer: PeerView | 'me'; w: number; h: number }) {
  const t = useT();
  const me = peer === 'me';
  const userId = me ? core.myId : peer.userId;
  const name = me ? t.youWord : core.name(userId) || '…';
  const stream = me ? call.local : peer.video ? peer.stream : null;
  const muted = me ? call.muted : !peer.audio;
  return (
    <View style={{ width: w, height: h, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }} testID="call-tile">
      {me && call.sharing ? (
        <Icon name="screenShare" size={Math.min(40, h * 0.3)} color={INK} />
      ) : stream ? (
        <RTCView key={me ? 'me' : `${peer.key}:${peer.rev}`} streamURL={stream} objectFit={!me && peer.screen ? 'contain' : 'cover'} mirror={me && call.front} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} zOrder={me ? 1 : 0} />
      ) : (
        <Avatar id={userId} name={name.replace(/^~ /, '')} size={Math.min(72, h * 0.45)} />
      )}
      {/* The name stays inside the tile, however long. */}
      <View style={{ position: 'absolute', start: 8, bottom: 8, maxWidth: w - 16, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
        {muted && <Icon name="micOff" size={13} color={INK} />}
        <Txt size={12} weight="600" color={INK} lines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        {!me && peer.state !== 'connected' && (
          <Txt size={11} color={SOFT} lines={1}>
            {' · '}
            {peer.state === 'reconnecting' ? t.reconnecting : t.connectingWord}
          </Txt>
        )}
      </View>
    </View>
  );
}

/** Decline and Answer, and (one to one) Message: decline with a quick reply, like WhatsApp. */
function Ringing({ call, t }: { call: CallView; t: Strings }) {
  const [replying, setReplying] = useState(false);
  const [own, setOwn] = useState('');
  const quick = [t.declineQuick1, t.declineQuick2, t.declineQuick3, t.declineQuick4];
  const declineWith = (text: string) => {
    const words = text.trim();
    setReplying(false);
    void calls.decline();
    if (words) void core.client.sendText(call.chatId, words).catch(() => toast(t.couldNot));
  };
  return (
    <View style={{ gap: 26 }}>
      {!call.group && (
        <View style={{ alignItems: 'center' }}>
          <Pressy onPress={() => setReplying(true)} label={t.declineWithMessage} scale={0.94} testID="call-decline-message">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <Icon name="chat" size={18} color={INK} />
              <Txt size={14} weight="600" color={INK}>
                {t.message}
              </Txt>
            </View>
          </Pressy>
        </View>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 30 }}>
        <Round icon="endCall" color={RED} label={t.decline} onPress={() => void calls.decline()} testID="call-decline" big />
        <Round icon={call.video ? 'video' : 'calls'} color={GREEN} label={t.answer} onPress={() => void calls.answer()} testID="call-answer" big />
      </View>
      <Sheet visible={replying} onClose={() => setReplying(false)} title={t.declineWithMessage}>
        <View style={{ paddingHorizontal: 16, gap: 6, paddingBottom: 6 }}>
          {quick.map((q, i) => (
            <Pressy key={q} onPress={() => declineWith(q)} label={q} scale={0.98} testID={`decline-quick-${i}`}>
              <View style={{ paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14 }}>
                <Txt size={15.5}>{q}</Txt>
              </View>
            </Pressy>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field value={own} onChangeText={setOwn} placeholder={t.writeYourOwn} returnKeyType="send" onSubmitEditing={() => declineWith(own)} testID="decline-own" />
            </View>
            <Pressy onPress={() => declineWith(own)} label={t.send} scale={0.9} disabled={!own.trim()} testID="decline-own-send">
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', opacity: own.trim() ? 1 : 0.5 }}>
                <Icon name="send" size={20} color={INK} />
              </View>
            </Pressy>
          </View>
        </View>
      </Sheet>
    </View>
  );
}

const ROUTE_ICON: Record<AudioRoute, IconName> = { earpiece: 'calls', speaker: 'speaker', headset: 'headset', bluetooth: 'bluetooth' };

/** The buttons during a call. */
function Controls({ call, t }: { call: CallView; t: Strings }) {
  const over = call.state === 'ended';
  // The sound button: speaker on and off, or through the headphones and Bluetooth when they're there.
  const nextRoute = (): AudioRoute => {
    const order: AudioRoute[] = ['earpiece', 'speaker', 'headset', 'bluetooth'];
    const have = order.filter((r) => call.routes.includes(r));
    if (have.length <= 1) return call.route === 'speaker' ? 'earpiece' : 'speaker';
    return have[(have.indexOf(call.route) + 1) % have.length];
  };
  const speakerOn = call.route !== 'earpiece';
  // Share screen, like WhatsApp: in a video call once it's on.
  const canShare = call.video && call.state === 'active';
  return (
    <View style={{ gap: 22, opacity: over ? 0.5 : 1 }} pointerEvents={over ? 'none' : 'auto'}>
      {call.sharing && (
        <Animated.View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingStart: 14, paddingEnd: 6, paddingVertical: 6, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)' }} testID="call-sharing">
            <Icon name="screenShare" size={18} color={INK} />
            <Txt size={13.5} weight="600" color={INK}>
              {t.sharingScreen}
            </Txt>
            <Pressy onPress={() => calls.stopSharing()} label={t.stopSharing} scale={0.94} testID="call-stop-sharing">
              <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: RED }}>
                <Txt size={13} weight="700" color={INK}>
                  {t.stopSharing}
                </Txt>
              </View>
            </Pressy>
          </View>
        </Animated.View>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: canShare ? 12 : 18 }}>
        <Round icon={ROUTE_ICON[call.route]} on={speakerOn} label={`${t.speaker}: ${routeName(call.route, t)}`} onPress={() => calls.setRoute(nextRoute())} testID="call-speaker" />
        {/* In a voice call it shows once the call is on, and turns it into a video call. */}
        {(call.video || call.state === 'active') && (
          <Round
            icon={call.camera || !call.video ? 'video' : 'videoOff'}
            on={call.video && !call.camera}
            label={call.camera ? t.cameraOff : t.cameraOn}
            onPress={() => void calls.setCamera(!call.camera).then((ok) => !ok && !call.camera && toast(t.couldNot))}
            testID="call-camera"
          />
        )}
        {call.video && call.camera && !call.sharing && <Round icon="flipCamera" label={t.flipCamera} onPress={() => calls.flipCamera()} testID="call-flip" />}
        {canShare && <Round icon="screenShare" on={call.sharing} label={call.sharing ? t.stopSharing : t.shareScreen} onPress={() => (call.sharing ? calls.stopSharing() : void calls.shareScreen())} testID="call-share-screen" />}
        <Round icon={call.muted ? 'micOff' : 'mic'} on={call.muted} label={call.muted ? t.unmute : t.muteMic} onPress={() => (tick(), calls.setMuted(!call.muted))} testID="call-mute" />
      </View>
      <View style={{ alignItems: 'center' }}>
        <Round icon="endCall" color={RED} label={t.hangUp} onPress={() => void calls.hangUp()} testID="call-hangup" big />
      </View>
    </View>
  );
}

function routeName(r: AudioRoute, t: Strings) {
  return r === 'speaker' ? t.speaker : r === 'headset' ? t.headphones : r === 'bluetooth' ? t.bluetooth : t.phoneEar;
}

function Round({ icon, label, onPress, color, on, big, testID }: { icon: IconName; label: string; onPress: () => void; color?: string; on?: boolean; big?: boolean; testID?: string }) {
  const size = big ? 70 : 58;
  return (
    <Pressy onPress={onPress} label={label} scale={0.9} testID={testID}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? (on ? INK : 'rgba(255,255,255,0.16)'),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={big ? 30 : 24} color={color ? INK : on ? '#0B1424' : INK} stroke={2} />
      </View>
    </Pressy>
  );
}
