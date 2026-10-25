// _layout.tsx: the frame around every screen.
//
// It opens the core (the phone's database and the PakChat client), keeps the
// splash screen up until we know whether you're signed in, and then shows
// either the sign-in screens or the app. Screens slide in from the right
// (from the left in Urdu, which reads right to left).
import { router, SplashScreen, Stack, useRootNavigationState, type ErrorBoundaryProps } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { core } from '../core/core';
import { useAppLocked, useAuth, useCall } from '../core/hooks';
import { LockScreen } from '../ui/LockScreen';
import { calls, takeTappedCall, watchCallTaps } from '../core/calls';
import { LIKE_ALERT, PLAN_ALERT, takeTapped, watchTaps } from '../core/push';
import { ThemeProvider, useLook } from '../theme/ThemeProvider';
import { CallBar } from '../ui/CallBar';
import { ToastHost } from '../ui/overlays';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* When the phone's "Remove animations" is on, Reanimated skips animations, and screens
          that slide in after a short wait (sign-in's buttons) could stay invisible. The emulator
          test caught it. So our animations always play; they're short and soft anyway. */}
      <ReducedMotionConfig mode={ReduceMotion.Never} />
      <SafeAreaProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function App() {
  const { theme, rtl } = useLook();
  const { state } = useAuth();
  const appLocked = useAppLocked();
  const call = useCall();

  // If starting up fails, or takes far too long, say so on screen instead of staying blank.
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    core.init().catch((err: unknown) => setProblem(describe(err)));
    const id = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(id);
  }, []);

  const stuck = state === 'loading' && (problem !== null || slow);

  useEffect(() => {
    console.log(`[pakchat] screen: ${state}${stuck ? ' (stuck)' : ''}${problem ? ` ${problem}` : ''}`);
  }, [state, stuck, problem]);

  useEffect(() => {
    if (state !== 'loading' || stuck) void SplashScreen.hideAsync().catch(() => {});
  }, [state, stuck]);

  // Tapping a message alert opens its chat, even when the tap started PakChat.
  const tappedPlain = Notifications.useLastNotificationResponse();
  const nav = useRootNavigationState();
  const [taps, setTaps] = useState(0);
  useEffect(() => watchTaps(() => setTaps((n) => n + 1)), []);
  useEffect(() => watchCallTaps(() => setTaps((n) => n + 1)), []);
  useEffect(() => {
    if (state !== 'signedIn' || !nav?.key) return;
    // The plain "New message" alert just opens PakChat; "liked your status" opens the Status tab.
    if (tappedPlain) {
      Notifications.clearLastNotificationResponse();
      if (tappedPlain.notification.request.identifier.startsWith(LIKE_ALERT)) {
        router.navigate('/(tabs)/status');
        return;
      }
      // A scheduled call starting: its chat (Join is on its message there).
      const planned = tappedPlain.notification.request.identifier.startsWith(PLAN_ALERT) ? (tappedPlain.notification.request.content.data as { chatId?: string } | null)?.chatId : undefined;
      if (planned && planned !== core.viewing) {
        router.push({ pathname: '/chat/[id]', params: { id: planned } });
        return;
      }
    }
    // A ringing call's alert (or its Answer button): the call screen.
    const call = takeTappedCall();
    if (call) {
      if (!calls.screenOpen) router.push({ pathname: '/call', params: { id: call.id, ...(call.answer ? { answer: '1' } : {}) } });
      else if (call.answer && calls.view()?.state === 'incoming') void calls.answer();
      return;
    }
    // A message alert: that chat. From inside another chat it takes that chat's
    // place, so Back still lands on the chat list, like WhatsApp.
    const chatId = takeTapped();
    if (!chatId || chatId === core.viewing) return;
    const go = core.viewing ? router.replace : router.push;
    go({ pathname: '/chat/[id]', params: { id: chatId } });
  }, [taps, tappedPlain, state, nav?.key]);

  // The window behind the screens matches the look, so nothing flashes white in Graphite.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
  }, [theme.bg]);

  if (stuck) {
    return (
      <Problem
        text={problem ?? `Still ${core.step}…`}
        onRetry={() => {
          setProblem(null);
          setSlow(false);
          core.retry().catch((err: unknown) => setProblem(describe(err)));
          setTimeout(() => setSlow(true), 10_000);
        }}
      />
    );
  }
  if (state === 'loading') return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, direction: rtl ? 'rtl' : 'ltr' }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          // On Android, the phone's own way of opening a screen (what WhatsApp uses):
          // the new screen fades in almost at once while sliding in a little.
          animation: Platform.OS === 'android' ? 'default' : rtl ? 'ios_from_left' : 'ios_from_right',
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Protected guard={state === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="info/[id]" />
          <Stack.Screen name="verify/[id]" />
          <Stack.Screen name="new-chat" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="new-call" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="call-info" />
          <Stack.Screen name="new-group" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="list" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="search" options={{ animation: 'fade' }} />
          <Stack.Screen name="archived" />
          <Stack.Screen name="starred" />
          <Stack.Screen name="forward" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="message-info" />
          <Stack.Screen name="poll-votes" />
          <Stack.Screen name="media/[id]" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="settings/privacy" />
          <Stack.Screen name="settings/language" />
          <Stack.Screen name="settings/blocked" />
          <Stack.Screen name="settings/soon" />
          <Stack.Screen name="settings/account" />
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/storage" />
          <Stack.Screen name="settings/backup" />
          <Stack.Screen name="restore" />
          <Stack.Screen name="contact" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="viewer" options={{ animation: 'fade' }} />
          <Stack.Screen name="photo" options={{ animation: 'fade' }} />
          <Stack.Screen name="call" options={{ animation: 'slide_from_bottom', contentStyle: { backgroundColor: '#0B1424' } }} />
          <Stack.Screen name="status/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000000' } }} />
          <Stack.Screen name="status-new" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="settings/status-privacy" />
          <Stack.Screen name="once" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000000' } }} />
          <Stack.Screen name="invite/[id]" />
          <Stack.Screen name="join/[code]" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="settings/index" />
          <Stack.Screen name="community/[id]" />
          <Stack.Screen name="new-community" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="broadcasts" />
          <Stack.Screen name="broadcast/[id]" />
          <Stack.Screen name="broadcast-edit" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="wallpaper" />
          <Stack.Screen name="locked" />
          <Stack.Screen name="settings/lock" />
          <Stack.Screen name="calllink/[code]" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="send-to" options={{ animation: 'fade_from_bottom' }} />
        </Stack.Protected>
        <Stack.Protected guard={state === 'signedOut'}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
      {state === 'signedIn' && <CallBar />}
      {/* App lock covers everything, except a call (you can answer, as on WhatsApp). */}
      {state === 'signedIn' && appLocked && !(call && call.state !== 'ended') && <LockScreen />}
      <ToastHost />
    </View>
  );
}

/** Shown if a screen crashes while drawing, instead of a blank screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <Problem text={describe(error)} onRetry={() => void retry()} />;
}

function describe(err: unknown): string {
  if (err instanceof Error) return [`${err.name}: ${err.message}`, ...(err.stack ?? '').split('\n').slice(1, 6)].join('\n');
  return String(err);
}

/**
 * "PakChat couldn't start", with what went wrong in words you can copy and
 * send. Plain colours on purpose: it must work even if the rest of the app doesn't.
 */
function Problem({ text, onRetry }: { text: string; onRetry: () => void }) {
  const dark = useColorScheme() === 'dark';
  const ink = dark ? '#ECEEF2' : '#0B1B36';
  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#111214' : '#EAF2FE', padding: 24, paddingTop: 80, gap: 14 }}>
      <Text style={{ color: ink, fontSize: 22, fontWeight: '700' }}>PakChat couldn&apos;t start</Text>
      <Text style={{ color: ink, fontSize: 15, opacity: 0.75 }}>Take a screenshot of this and send it, then tap Try again.</Text>
      <ScrollView style={{ maxHeight: 320, borderRadius: 14, backgroundColor: dark ? '#1E2026' : '#FFFFFF' }} contentContainerStyle={{ padding: 14 }}>
        <Text selectable style={{ color: ink, fontSize: 13, fontFamily: 'monospace' }} testID="start-problem">
          {text}
        </Text>
      </ScrollView>
      <Pressable onPress={onRetry} accessibilityRole="button" style={{ height: 50, borderRadius: 16, backgroundColor: '#2F6BFF', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}
