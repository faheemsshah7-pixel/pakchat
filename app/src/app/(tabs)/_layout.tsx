// (tabs)/_layout.tsx: the four tabs along the bottom (Chats, Status, Calls, You).
//
// The bar is our own: a soft pill sits behind the open tab and springs across
// when you pick another one (the other way in Urdu).
import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatList } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../../ui/icons';
import { Pressy, Txt } from '../../ui/kit';
import { smooth } from '../../ui/motion';

const TABS: { name: string; icon: IconName; label: 'chats' | 'status' | 'calls' | 'you' }[] = [
  { name: 'index', icon: 'chat', label: 'chats' },
  { name: 'status', icon: 'status', label: 'status' },
  { name: 'calls', icon: 'calls', label: 'calls' },
  { name: 'you', icon: 'you', label: 'you' },
];

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const t = useT();
  const { theme, rtl } = useLook();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const tabW = width / TABS.length;
  const x = useSharedValue(0);
  const rows = useChatList();
  const unreadChats = (rows ?? []).filter((r) => (r.chat.unread > 0 || r.prefs.markedUnread) && !r.prefs.archived).length;

  useEffect(() => {
    x.value = withSpring(state.index * tabW, smooth);
  }, [state.index, tabW, x]);

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
        return (
          <View key={tab.name} style={{ flex: 1 }}>
            <Pressy
              testID={`tab-${tab.name}`}
              label={t[tab.label]}
              scale={0.9}
              onPress={() => {
                // No vibration here: like WhatsApp, switching tabs is silent.
                if (on) return;
                navigateToTab(state.routes[i].key);
              }}
            >
              <View style={{ alignItems: 'center', gap: 3 }}>
                <View style={{ width: 58, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={tab.icon} size={22} color={color} stroke={on ? 2 : 1.8} />
                  {tab.name === 'index' && unreadChats > 0 && (
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
                      <Txt size={10} weight="700" color="#FFFFFF" align="center">
                        {unreadChats}
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
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      // No fade between tabs: the fade could get stuck half way when a settings
      // page opened on top, leaving a tab blank (dark) until you switched away and back.
      screenOptions={{ headerShown: false, animation: 'none', sceneStyle: { backgroundColor: theme.bg } }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
