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
import { View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fileModule, type AudioRoute } from '../../modules/pakchat-signal';
import { calls, type CallView, type EndReason, type PeerView } from '../core/calls';
import { core } from '../core/core';
import { useCall, useChat, useNow } from '../core/hooks';
import { useT } from '../i18n';
import type { Strings } from '../i18n/strings';
import { duration } from '../ui/format';
import { Icon, type IconName } from '../ui/icons';
import { Avatar, Pressy, Txt } from '../ui/kit';
import { tick } from '../ui/motion';

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
  return (
    <View style={{ flex: 1, backgroundColor: '#0B1424' }} testID="call-screen">
      <StatusBar style="light" />
      <LinearGradient colors={['#13233F', '#0B1424']} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} />
      {/* The video goes before the screen closes, so nothing is left behind on top. */}
      {!ended && <Picture call={call} />}
      <View style={{ flex: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 18 }} pointerEvents="box-none">
        <Header call={call} t={t} />
        <View style={{ flex: 1 }} pointerEvents="none" />
        {call.state === 'incoming' ? <Ringing call={call} t={t} /> : <Controls call={call} t={t} />}
      </View>
    </View>
  );
}

/** Name, and how the call is going ("Calling…", then "Ringing…" once their phone rings, "02:15", "Call ended"). */
function Header({ call, t }: { call: CallView; t: Strings }) {
  const chat = useChat(call.chatId);
  const now = useNow(1000);
  const title = chat ? core.chatTitle(chat) : '';
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
    <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 20 }}>
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

/** A soft ring growing out of the picture while it rings. */
function Pulse({ children }: { children: ReactNode }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
  }, [v]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - v.value), transform: [{ scale: 1 + v.value * 0.5 }] }));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 18 }}>
      <Animated.View style={[{ position: 'absolute', width: 110, height: 110, borderRadius: 40, backgroundColor: INK }, ring]} />
      {children}
    </View>
  );
}

/** The video: the other person full screen and me in the corner, or everyone in tiles. */
function Picture({ call }: { call: CallView }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!call.video && !call.group) return null;
  const peers = call.peers;
  if (call.group && call.state !== 'incoming') {
    // Tiles: me plus everyone, two across.
    const tiles: (PeerView | 'me')[] = ['me', ...peers];
    const rows = Math.ceil(tiles.length / 2);
    const top = insets.top + 130;
    const bottom = insets.bottom + 120;
    const tileH = Math.max(110, (height - top - bottom) / Math.max(1, rows) - 8);
    const tileW = tiles.length === 1 ? width - 24 : (width - 32) / 2;
    return (
      <View style={{ position: 'absolute', top, start: 12, end: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tiles.map((p) => (
          <Tile key={p === 'me' ? 'me' : p.key} call={call} peer={p} w={tileW} h={tileH} />
        ))}
      </View>
    );
  }
  const other = peers.find((p) => p.stream && p.video);
  return (
    <>
      {other?.stream && <RTCView streamURL={other.stream} objectFit="cover" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} zOrder={0} />}
      {call.local && call.state !== 'incoming' && (
        <Animated.View entering={FadeIn} style={{ position: 'absolute', top: insets.top + 110, end: 14, width: 110, height: 160, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}>
          <RTCView streamURL={call.local} objectFit="cover" mirror={call.front} style={{ flex: 1 }} zOrder={1} />
        </Animated.View>
      )}
      {call.local && call.state === 'incoming' && <RTCView streamURL={call.local} objectFit="cover" mirror={call.front} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, opacity: 0.5 }} zOrder={0} />}
    </>
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
      {stream ? <RTCView streamURL={stream} objectFit="cover" mirror={me && call.front} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} zOrder={me ? 1 : 0} /> : <Avatar id={userId} name={name.replace(/^~ /, '')} size={Math.min(72, h * 0.45)} />}
      <View style={{ position: 'absolute', start: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
        {muted && <Icon name="micOff" size={13} color={INK} />}
        <Txt size={12} weight="600" color={INK} lines={1}>
          {name}
        </Txt>
        {!me && peer.state !== 'connected' && (
          <Txt size={11} color={SOFT}>
            {' · '}
            {peer.state === 'reconnecting' ? t.reconnecting : t.connectingWord}
          </Txt>
        )}
      </View>
    </View>
  );
}

/** Decline and Answer. */
function Ringing({ call, t }: { call: CallView; t: Strings }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 30 }}>
      <Round icon="endCall" color={RED} label={t.decline} onPress={() => void calls.decline()} testID="call-decline" big />
      <Round icon={call.video ? 'video' : 'calls'} color={GREEN} label={t.answer} onPress={() => void calls.answer()} testID="call-answer" big />
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
  return (
    <View style={{ gap: 22, opacity: over ? 0.5 : 1 }} pointerEvents={over ? 'none' : 'auto'}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        <Round icon={ROUTE_ICON[call.route]} on={speakerOn} label={`${t.speaker}: ${routeName(call.route, t)}`} onPress={() => calls.setRoute(nextRoute())} testID="call-speaker" />
        {call.video && <Round icon={call.camera ? 'video' : 'videoOff'} on={!call.camera} label={call.camera ? t.cameraOff : t.cameraOn} onPress={() => calls.setCamera(!call.camera)} testID="call-camera" />}
        {call.video && call.camera && <Round icon="flipCamera" label={t.flipCamera} onPress={() => calls.flipCamera()} testID="call-flip" />}
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
