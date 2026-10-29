// (tabs)/_layout.tsx: the four tabs along the bottom (Chats, Status, Calls,
// Communities). Settings and you are in the chat list's ⋮ menu, as on WhatsApp.
//
// The bar is our own: a soft pill sits behind the open tab (on the other side in
// Urdu). It moves at once, with no animation.
//
// Like WhatsApp, swipe sideways anywhere on a tab to go to the next one: the
// tabs sit side by side in a pager (react-native-tab-view) and move with your
// finger. Tapping a tab switches at once (no sliding), and all four are made
// ready just after the chat list first shows, so none has to load when you get
// to it, and starting up draws the chat list first.
import { TopTabs, type MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { markListShown, useChatList, useMissedCalls } from '../../core/hooks';
import { startTimer, stopTimer } from '../../core/speed';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../../ui/icons';
import { Pressy, Txt } from '../../ui/kit';

const TABS: { name: string; icon: IconName; label: 'chats' | 'status' | 'calls' | 'communities' }[] = [
  { name: 'index', icon: 'chat', label: 'chats' },
  { name: 'status', icon: 'status', label: 'status' },
  { name: 'calls', icon: 'calls', label: 'calls' },
  { name: 'communities', icon: 'community', label: 'communities' },
];

function TabBar({ state, navigateToTab }: MaterialTopTabBarProps) {
  const t = useT();
  const { theme, rtl } = useLook();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const tabW = width / TABS.length;
  const x = useSharedValue(0);
  const rows = useChatList();
  const unreadChats = (rows ?? []).filter((r) => (r.chat.unread > 0 || r.prefs.markedUnread) && !r.prefs.archived).length;
  const missed = useMissedCalls();

  useEffect(() => {
    x.value = state.index * tabW;
  }, [state.index, tabW, x]);
  // A tap is timed until the tab is on screen (Settings › Help › Speed check).
  useEffect(() => {
    requestAnimationFrame(() => stopTimer('tab', 'tab'));
  }, [state.index]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: rtl ? -x.value : x.value }] }));

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
              onPress={() => {
                // No vibration here: like WhatsApp, switching tabs is silent.
                if (on) return;
                startTimer('tab');
                navigateToTab(state.routes[i].key);
              }}
            >
              <View style={{ alignItems: 'center', gap: 3 }}>
                <View style={{ width: 58, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={tab.icon} size={22} color={color} stroke={on ? 2 : 1.8} />
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
                <Txt size={11} weight="600" color={color} align="center">
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
  // The other tabs draw once the chat list has shown (useAfterStart); at the latest, after three seconds.
  useEffect(() => {
    const id = setTimeout(markListShown, 3_000);
    return () => clearTimeout(id);
  }, []);
  return (
    <TopTabs
      tabBarPosition="bottom"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ swipeEnabled: true, animationEnabled: false, lazy: true, lazyPreloadDistance: 3, sceneStyle: { backgroundColor: theme.bg } }}
    >
      {TABS.map((tab) => (
        <TopTabs.Screen key={tab.name} name={tab.name} />
      ))}
    </TopTabs>
  );
}
