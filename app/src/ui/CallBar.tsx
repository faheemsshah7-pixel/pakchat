// CallBar.tsx: the green "back to the call" bar, and starting a call.
//
// While a call goes on and you look at your chats, a small green bar at the
// top shows who you're with and for how long; tap it to go back to the call.
import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { calls } from '../core/calls';
import { core } from '../core/core';
import { useCall, useChat, useNow } from '../core/hooks';
import { useT } from '../i18n';
import type { Strings } from '../i18n/strings';
import { duration } from './format';
import { Icon } from './icons';
import { Pressy, Txt } from './kit';
import { toast } from './overlays';

export function CallBar() {
  const t = useT();
  const call = useCall();
  const insets = useSafeAreaInsets();
  const chat = useChat(call?.chatId ?? '');
  const now = useNow(1000);
  if (!call || call.state === 'ended' || calls.screenOpen) return null;
  // Someone was added to a one-to-one call: everyone's names.
  const others = chat ? chat.members.map((m) => m.userId).filter((u) => u !== core.myId) : [];
  const title = call.extra.length ? [...new Set([...others, ...call.extra])].map((u) => core.name(u) || '…').join(', ') : chat ? core.chatTitle(chat) : '';
  const line = call.state === 'active' && call.startedAt ? duration(now - call.startedAt) : call.state === 'incoming' ? t.answer : call.state === 'connecting' ? t.connectingWord : call.ringing ? t.ringingWord : t.callingWord;
  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={{ position: 'absolute', top: insets.top + 6, start: 0, end: 0, alignItems: 'center' }} pointerEvents="box-none">
      <Pressy onPress={() => router.push({ pathname: '/call', params: { id: call.id } })} label={t.backToCall} scale={0.96} testID="call-bar">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#22A35A', boxShadow: '0 6px 18px -6px rgba(0,0,0,0.35)' }}>
          <Icon name={call.video ? 'video' : 'calls'} size={16} color="#FFFFFF" stroke={2} />
          <Txt size={13.5} weight="700" color="#FFFFFF" lines={1} style={{ maxWidth: 180 }}>
            {title}
          </Txt>
          <Txt size={13} color="rgba(255,255,255,0.85)">
            {line}
          </Txt>
        </View>
      </Pressy>
    </Animated.View>
  );
}

/** The call buttons (chat header, Calls tab, contact page): start, and open the call screen. */
/** Calls a chat. `invite`: a new group call's others, rung once the first one answers. */
export async function startCall(chatId: string, video: boolean, t: Strings, invite?: string[]) {
  if (calls.live) {
    const now = calls.view();
    if (now?.chatId === chatId) router.push({ pathname: '/call', params: { id: now.id } });
    else toast(t.alreadyInCall);
    return;
  }
  if (!core.connected) return toast(t.offline);
  // The screen opens straight away, showing "Calling…" (then "Ringing…" once their phone rings).
  // A call link joins the call going on there (or starts one, which rings nobody).
  const open = (id: string) => router.push({ pathname: '/call', params: { id } });
  const link = (await core.storage.getChat(chatId))?.callLink;
  const r = link ? await calls.joinLink(chatId, video, open) : await calls.start(chatId, video, open, invite);
  if (r === 'permission') toast(t.callNeedsMic);
  else if (r === 'offline') toast(t.offline);
  else if (r === 'busy') toast(t.alreadyInCall);
}
