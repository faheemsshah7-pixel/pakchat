// (tabs)/_layout.tsx: the four tabs along the bottom (Chats, Status, Calls,
// Communities). Settings and you are in the chat list's ⋮ menu, as on WhatsApp.
//
// The bar is our own: a soft pill sits behind the open tab (on the other side in
// Urdu), and glides with the tabs as they move.
//
// Like WhatsApp, swipe sideways anywhere on a tab to go to the next one: the
// tabs sit side by side in a pager (react-native-tab-view) and move with your
// finger. Tapping a tab changes the page at once, as WhatsApp's does, and only the
// pill glides across (the owner, 26 Nov, after a recording of both). All four are made ready just after the chat list first
// shows, so none has to load when you get to it, and starting up draws the chat
// list first.
import { core } from '../../core/core';
import { TopTabs, type MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { markListShown, useChatList, useMissedCalls, useStatuses } from '../../core/hooks';
import { startTimer, stopTimer } from '../../core/speed';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { useUnderChat } from '../../ui/ScreenSlide';
import { Icon, type IconName } from '../../ui/icons';
import { Pressy, Txt } from '../../ui/kit';

const TABS: { name: string; icon: IconName; label: 'chats' | 'status' | 'calls' | 'communities' }[] = [
  { name: 'index', icon: 'chat', label: 'chats' },
  { name: 'status', icon: 'status', label: 'status' },
  { name: 'calls', icon: 'calls', label: 'calls' },
  { name: 'communities', icon: 'community', label: 'communities' },
];

function TabBar({ state, navigateToTab, position }: MaterialTopTabBarProps) {
  const t = useT();
  const { theme, rtl } = useLook();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const tabW = width / TABS.length;
  const rows = useChatList();
  const unreadChats = (rows ?? []).filter((r) => (r.chat.unread > 0 || r.prefs.markedUnread) && !r.prefs.archived).length;
  const missed = useMissedCalls();
  // A dot on Status when someone (not muted) has posted one I haven't watched, like WhatsApp's.
  const statuses = useStatuses();
  const newStatus = !!statuses?.others.some((p) => !p.seen && !p.muted);

  // A tap is timed until the tab is on screen (Settings › Help › Speed check).
  useEffect(() => {
    requestAnimationFrame(() => stopTimer('tab', 'tab'));
  }, [state.index]);

  // The pill follows the pager while a swipe moves it. A tap changes the page at once, like
  // WhatsApp's (the owner, 26 Nov), and the pill glides across to the new tab on its own.
  const last = TABS.length - 1;
  const [glide] = useState(() => new Animated.Value(state.index));
  const [gliding, setGliding] = useState(false);
  const goTo = (i: number) => {
    glide.stopAnimation();
    glide.setValue(state.index);
    setGliding(true);
    Animated.timing(glide, { toValue: i, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setGliding(false));
  };
  const across = { inputRange: [0, last], outputRange: [0, (rtl ? -1 : 1) * last * tabW], extrapolate: 'clamp' as const };
  const pill = { transform: [{ translateX: gliding ? glide.interpolate(across) : position.interpolate(across) }] };

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        // Edge to edge, with one thin line on top: a bar with gaps at the sides
        // and rounded corners looked uneven against the chat list behind it.
        flexDirection: 'row',
        paddingTop: 9,
        paddingBottom: insets.bottom + 10,
        backgroundColor: theme.dark ? 'rgb(22,23,26)' : 'rgb(255,255,255)',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: theme.glassLine,
      }}
    >
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 9, start: (tabW - 58) / 2, width: 58, height: 32, borderRadius: 12, backgroundColor: theme.accSoft }, pill]}
        />
      )}
      {TABS.map((tab, i) => {
        const on = state.index === i;
        const color = on ? theme.accInk : theme.muted;
        const badge = tab.name === 'index' ? unreadChats : tab.name === 'calls' ? missed : 0;
        return (
          <View key={tab.name} style={{ flex: 1 }}>
            <Pressy
              testID={`tab-${tab.name}`}
              label={t[tab.label]}
              scale={0.9}
              // The press shows only in the pill around the icon, like WhatsApp's, not the whole tab.
              rippleIn={{ width: 58, height: 32, top: 0, radius: 12 }}
              onPress={() => {
                // No vibration here: like WhatsApp, switching tabs is silent.
                // Tapping the tab you're on takes its list back to the top, like WhatsApp.
                if (on) return core.emit(`tabAgain:${tab.name}`);
                startTimer('tab');
                goTo(i);
                navigateToTab(state.routes[i].key);
              }}
            >
              <View style={{ alignItems: 'center', gap: 3 }}>
                <View style={{ width: 58, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={tab.icon} size={22} color={color} stroke={on ? 2 : 1.8} />
                  {tab.name === 'status' && newStatus && (
                    <View style={{ position: 'absolute', top: 3, end: 12, width: 9, height: 9, borderRadius: 5, backgroundColor: theme.acc }} testID="tab-dot-status" />
                  )}
                  {badge > 0 && (
                    <View
                      style={{
                        position: 'absolute',
                        top: 1,
                        end: 6,
                        minWidth: 17,
                        height: 17,
                        borderRadius: 9,
                        paddingHorizontal: 4,
                        backgroundColor: theme.acc,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Txt size={10} weight="700" color="#FFFFFF" align="center" testID={`tab-badge-${tab.name}`}>
                        {badge}
                      </Txt>
                    </View>
                  )}
                </View>
                {/* Like WhatsApp's: the tab you're on in bold, the others regular. */}
                <Txt size={14} weight={on ? '700' : '400'} color={color} align="center" lines={1}>
                  {t[tab.label]}
                </Txt>
              </View>
            </Pressy>
          </View>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useLook();
  // Under an open chat: moved a little aside as it comes in, and not drawn once it's covered.
  const under = useUnderChat();
  // The other tabs draw once the chat list has shown (useAfterStart); at the latest, after three seconds.
  useEffect(() => {
    const id = setTimeout(markListShown, 3_000);
    return () => clearTimeout(id);
  }, []);
  return (
    <Reanimated.View style={[{ flex: 1, backgroundColor: theme.bg }, under]}>
      <TopTabs
        tabBarPosition="bottom"
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{ swipeEnabled: true, animationEnabled: false, lazy: true, lazyPreloadDistance: 3, sceneStyle: { backgroundColor: theme.bg } }}
      >
        {TABS.map((tab) => (
          <TopTabs.Screen key={tab.name} name={tab.name} />
        ))}
      </TopTabs>
    </Reanimated.View>
  );
}
