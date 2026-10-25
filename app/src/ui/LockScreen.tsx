// LockScreen.tsx: App lock's cover. It sits over every screen until your
// fingerprint or face unlocks PakChat, and asks for it as soon as it shows.
// After a failed try, the button waits 30 seconds. Back leaves PakChat.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { lockWaitUntil, unlockApp } from '../core/lock';
import { useNow } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Button, Txt } from './kit';
import { pop } from './motion';

export function LockScreen() {
  const t = useT();
  const { theme } = useLook();
  const now = useNow(1_000);
  const [note, setNote] = useState<string | null>(null);
  const wait = Math.max(0, Math.ceil((lockWaitUntil() - now) / 1000));

  async function unlock(again = true) {
    const r = await unlockApp(t.unlockPakChat, t.cancel);
    // Android closed the prompt on its own (PakChat was still coming to the front): ask once more.
    if (r === 'interrupted' && again) return void setTimeout(() => void unlock(false), 400);
    if (r === 'failed') setNote(t.notRecognised);
    else if (r === 'unavailable') setNote(t.biometricsGone);
    else setNote(null);
  }

  // Ask straight away once PakChat is fully in front (asking while Android is
  // still bringing it back gets the prompt closed), and keep Back from
  // reaching the screens underneath.
  useEffect(() => {
    let ask: ReturnType<typeof setTimeout> | undefined;
    const askSoon = () => {
      clearTimeout(ask);
      ask = setTimeout(() => void unlock(), 350);
    };
    if (AppState.currentState === 'active') askSoon();
    const moved = AppState.addEventListener('change', (s) => s === 'active' && askSoon());
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => {
      clearTimeout(ask);
      moved.remove();
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]} testID="app-lock">
      <LinearGradient colors={theme.dark ? ['#0B1424', '#141B2E'] : ['#EAF2FF', '#F7F9FF']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 }}>
        <Animated.View entering={pop()}>
          <LinearGradient colors={theme.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 92, height: 92, borderRadius: 32, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={42} color="#FFFFFF" stroke={2} />
          </LinearGradient>
        </Animated.View>
        <Txt size={22} weight="800" align="center">
          {t.pakChatLocked}
        </Txt>
        <Txt size={14} color={theme.muted} align="center">
          {t.pakChatLockedSub}
        </Txt>
        {!!note && (
          <Txt size={13.5} color={theme.danger} align="center" testID="app-lock-note">
            {note}
          </Txt>
        )}
        <View style={{ alignSelf: 'stretch', marginTop: 10 }}>
          <Button title={wait ? fill(t.tryAgainIn, { n: wait }) : t.unlock} icon="fingerprint" disabled={wait > 0} onPress={() => void unlock()} testID="app-unlock" />
        </View>
      </LinearGradient>
    </Animated.View>
  );
}
