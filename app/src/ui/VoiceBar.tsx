// VoiceBar.tsx: a voice note still playing after you leave its chat shows a little bar at
// the top, like WhatsApp's: who it's from, how far it's got, pause or play, and ✕ to stop.
// Tap it to go back to the chat. A locked chat's voice note stops once the chat locks again.
import { router, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { calls } from '../core/calls';
import { core } from '../core/core';
import { useCall } from '../core/hooks';
import { chatOpen } from '../core/lock';
import { pause, resume, stopAll, useAnyVoice } from '../core/player';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { duration } from './format';
import { Icon } from './icons';
import { Pressy, Txt } from './kit';

export function VoiceBar() {
  const t = useT();
  const { theme } = useLook();
  const now = useAnyVoice();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const call = useCall();
  const [chatId, author] = (now.key ?? '').split('/');
  // Not in its own chat (the bubble is right there), and only while it's on (playing or paused part way).
  const here = path === `/chat/${chatId}`;
  // A locked chat that has locked again: its voice note stops, and nothing of it shows outside.
  const lockedAway = !!now.key && !!core.prefs[chatId]?.lock && !here && !chatOpen(chatId);
  useEffect(() => {
    if (lockedAway) stopAll();
  }, [lockedAway]);
  const shown = !!now.key && !lockedAway && (now.playing || now.position > 0) && !here && !path.startsWith('/call');
  if (!shown) return null;
  // Under the call bar when there's one.
  const callShown = !!call && call.state !== 'ended' && !calls.screenOpen;
  const who = author === core.myId ? t.youWord : core.name(author) || '…';
  const share = now.duration ? Math.min(1, now.position / now.duration) : 0;
  return (
    <Animated.View
      entering={FadeInUp.duration(200).easing(Easing.out(Easing.cubic))}
      exiting={FadeOutUp.duration(150)}
      style={{ position: 'absolute', top: insets.top + (callShown ? 48 : 6), start: 0, end: 0, alignItems: 'center' }}
      pointerEvents="box-none"
    >
      <Pressy onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chatId } })} label={who} scale={0.97} testID="voice-bar">
        <View style={{ width: 300, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: theme.dark ? '#1E2633' : '#FFFFFF', boxShadow: '0 6px 18px -6px rgba(0,0,0,0.35)' }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 }}>
            <Pressy onPress={() => (now.playing ? pause() : resume())} label={now.playing ? t.pause : t.play} round testID="voice-bar-play">
              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accSoft }}>
                <Icon name={now.playing ? 'pause' : 'play'} size={17} color={theme.accInk} />
              </View>
            </Pressy>
            <Icon name="mic" size={15} color={theme.muted} />
            <Txt size={14} weight="600" lines={1} style={{ flex: 1 }}>
              {who}
            </Txt>
            <Txt size={12.5} color={theme.muted}>
              {duration(now.position)}
            </Txt>
            <Pressy onPress={stopAll} label={t.close} round testID="voice-bar-close">
              <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={17} color={theme.muted} />
              </View>
            </Pressy>
          </View>
          <View style={{ height: 2, backgroundColor: theme.glassLine }}>
            <View style={{ height: 2, width: `${share * 100}%`, backgroundColor: theme.acc }} />
          </View>
        </View>
      </Pressy>
    </Animated.View>
  );
}
