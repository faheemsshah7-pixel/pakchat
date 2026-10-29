// locked.tsx: the Locked chats folder (Chat lock, WhatsApp's way). It opens
// with your fingerprint or face, or by the secret code typed in search when
// the folder is hidden. A chat opened from here doesn't ask again. The folder
// locks again once you leave it.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList } from 'react-native';

import { core } from '../core/core';
import { useAllPresence, useAllTyping, useCore, useLockedChats, useStable, type ChatRow as Row } from '../core/hooks';
import { chatOpen, FOLDER, leftChat, openWith } from '../core/lock';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { ChatRow } from '../ui/ChatRow';
import { Empty, Screen, TopBar, Txt } from '../ui/kit';
import { LockedGate } from '../ui/LockedGate';

const nothing = () => {};

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
  const openRow = useStable((row: Row) => {
    openWith(row.chat.id);
    router.push({ pathname: '/chat/[id]', params: { id: row.chat.id } });
  });
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
        renderItem={({ item }) => (
          <ChatRow
            row={item}
            typing={Object.keys(typing[item.chat.id] ?? {}).filter((id) => id !== core.myId)}
            online={!!(item.other && presence[item.other]?.online)}
            selecting={false}
            selected={false}
            onPress={openRow}
            onLongPress={nothing}
          />
        )}
      />
    </Screen>
  );
}
