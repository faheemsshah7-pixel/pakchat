// archived.tsx: chats you archived. They stay out of the way until someone
// writes; swipe one left (or hold it) to bring it back.
import { router } from 'expo-router';
import { FlatList } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { core } from '../core/core';
import { useAllTyping, useChatList } from '../core/hooks';
import { useT } from '../i18n';
import { ChatRow } from '../ui/ChatRow';
import { Empty, Screen, TopBar } from '../ui/kit';
import { toast } from '../ui/overlays';

export default function Archived() {
  const t = useT();
  const rows = (useChatList() ?? []).filter((r) => r.prefs.archived);
  const typing = useAllTyping();

  const unarchive = (id: string) => {
    core.setPrefs(id, { archived: false });
    toast(t.unarchived);
  };

  return (
    <Screen>
      <TopBar title={t.archived} onBack={() => router.back()} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.chat.id}
        contentContainerStyle={{ padding: 10 }}
        ListEmptyComponent={<Empty icon="archive" text={t.noArchived} />}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 25).springify().damping(22)} exiting={FadeOut} style={{ marginBottom: 4 }}>
            <ChatRow
              row={item}
              typing={Object.keys(typing[item.chat.id] ?? {}).filter((id) => id !== core.myId)}
              online={false}
              selecting={false}
              selected={false}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.chat.id } })}
              onLongPress={() => unarchive(item.chat.id)}
              onPin={() => unarchive(item.chat.id)}
              onArchive={() => unarchive(item.chat.id)}
            />
          </Animated.View>
        )}
      />
    </Screen>
  );
}
