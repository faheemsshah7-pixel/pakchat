// locked.tsx: the Locked chats folder (Chat lock, WhatsApp's way). It opens
// with your fingerprint or face, or by the secret code typed in search when
// the folder is hidden. A chat opened from here doesn't ask again. The folder
// locks again once you leave it.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../core/core';
import { useAllPresence, useAllTyping, useCore, useLockedChats } from '../core/hooks';
import { chatOpen, FOLDER, leftChat, openWith } from '../core/lock';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { ChatRow } from '../ui/ChatRow';
import { Empty, Screen, TopBar, Txt } from '../ui/kit';
import { LockedGate } from '../ui/LockedGate';

export default function Locked() {
  const open = useCore(['lock'], () => chatOpen(FOLDER));
  useEffect(() => () => leftChat(FOLDER), []);
  if (!open) return <LockedGate chatId={FOLDER} />;
  return <Folder />;
}

function Folder() {
  const t = useT();
  const { theme } = useLook();
  const rows = useLockedChats();
  const typing = useAllTyping();
  const presence = useAllPresence();
  return (
    <Screen>
      <TopBar title={t.lockedChats} onBack={() => router.back()} />
      <Txt size={13} color={theme.muted} style={{ paddingHorizontal: 22, paddingVertical: 8 }}>
        {t.lockedChatsNote}
      </Txt>
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.chat.id}
        contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 40 }}
        ListEmptyComponent={rows ? <Empty icon="lock" text={t.noLockedChats} /> : undefined}
        renderItem={({ item, index }) => (
          <Animated.View>
            <View>
              <ChatRow
                row={item}
                typing={Object.keys(typing[item.chat.id] ?? {}).filter((id) => id !== core.myId)}
                online={!!(item.other && presence[item.other]?.online)}
                selecting={false}
                selected={false}
                onPress={() => {
                  openWith(item.chat.id);
                  router.push({ pathname: '/chat/[id]', params: { id: item.chat.id } });
                }}
                onLongPress={() => {}}
                onPin={() => core.setPrefs(item.chat.id, { pinnedAt: item.prefs.pinnedAt ? undefined : Date.now() })}
                onArchive={() => {}}
              />
            </View>
          </Animated.View>
        )}
      />
    </Screen>
  );
}
