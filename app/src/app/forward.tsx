// forward.tsx: send picked messages on to other chats. They arrive marked
// "Forwarded", and each one is locked again for its new chat.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../core/core';
import { useChatList } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Button, Divider, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';
import { pop, rise } from '../ui/motion';

export default function Forward() {
  const { texts } = useLocalSearchParams<{ texts: string }>();
  const t = useT();
  const { theme } = useLook();
  const rows = (useChatList() ?? []).filter((r) => !r.chat.left);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const words: string[] = (() => {
    try {
      return JSON.parse(texts ?? '[]');
    } catch {
      return [];
    }
  })();

  function toggle(id: string) {
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [busy, setBusy] = useState(false);
  async function send() {
    // One tap sends once, even if the button is tapped again while sending.
    if (busy) return;
    setBusy(true);
    try {
      for (const chatId of picked) for (const w of words) await core.client.sendText(chatId, w, { forwarded: true });
      toast(t.forwardedNote);
      if (picked.size === 1) router.replace({ pathname: '/chat/[id]', params: { id: [...picked][0] } });
      else router.back();
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={t.forwardTo} subtitle={fill(t.selected, { n: picked.size })} onBack={() => router.back()} />
      <FlatList
        data={rows}
        extraData={picked}
        keyExtractor={(r) => r.chat.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 110 }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item, index }) => {
          const on = picked.has(item.chat.id);
          return (
            <Animated.View entering={rise(Math.min(index, 10) * 25)}>
              <Pressy onPress={() => toggle(item.chat.id)} label={item.title} scale={0.98} testID={`forward-${item.title}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: on ? theme.selected : 'transparent' }}>
                  <Avatar id={item.chat.id} name={item.title} size={44} group={item.chat.kind === 'group'} />
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight="600">
                      {item.title}
                    </Txt>
                  </View>
                  {on && (
                    <Animated.View entering={pop()} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={14} color="#FFFFFF" stroke={3} />
                    </Animated.View>
                  )}
                </View>
              </Pressy>
            </Animated.View>
          );
        }}
      />
      {picked.size > 0 && (
        <Animated.View entering={rise()} style={{ position: 'absolute', start: 16, end: 16, bottom: 24 }}>
          <Button title={t.send} icon="send" onPress={send} busy={busy} testID="forward-send" />
        </Animated.View>
      )}
    </Screen>
  );
}
