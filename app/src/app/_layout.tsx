// _layout.tsx: the frame around every screen.
//
// It opens the core (the phone's database and the PakChat client), keeps the
// splash screen up until we know whether you're signed in, and then shows
// either the sign-in screens or the app. Screens slide in from the right
// (from the left in Urdu, which reads right to left).
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { core } from '../core/core';
import { useAuth } from '../core/hooks';
import { ThemeProvider, useLook } from '../theme/ThemeProvider';
import { ToastHost } from '../ui/overlays';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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

  useEffect(() => {
    void core.init().catch(() => {});
  }, []);

  useEffect(() => {
    if (state !== 'loading') void SplashScreen.hideAsync().catch(() => {});
  }, [state]);

  // The window behind the screens matches the look, so nothing flashes white in Graphite.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
  }, [theme.bg]);

  if (state === 'loading') return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, direction: rtl ? 'rtl' : 'ltr' }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: rtl ? 'ios_from_left' : 'ios_from_right',
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Protected guard={state === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="info/[id]" />
          <Stack.Screen name="verify/[id]" />
          <Stack.Screen name="new-chat" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="new-group" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="search" options={{ animation: 'fade' }} />
          <Stack.Screen name="archived" />
          <Stack.Screen name="starred" />
          <Stack.Screen name="forward" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="message-info" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="settings/privacy" />
          <Stack.Screen name="settings/language" />
          <Stack.Screen name="settings/blocked" />
          <Stack.Screen name="settings/soon" />
        </Stack.Protected>
        <Stack.Protected guard={state === 'signedOut'}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
      <ToastHost />
    </View>
  );
}
