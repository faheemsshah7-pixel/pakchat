// message-info.tsx: who has my message, and who has read it.
// (Read ticks only show for people who leave "Read receipts" on.)
import type { Message } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../core/core';
import { useChat, usePeople } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Ticks } from '../ui/ChatRow';
import { clock, listTime } from '../ui/format';
import { Avatar, Divider, Glass, Screen, Section, TopBar, Txt } from '../ui/kit';

export default function MessageInfo() {
  const { chat: chatId, author, id } = useLocalSearchParams<{ chat: string; author: string; id: string }>();
  const t = useT();
  const { theme } = useLook();
  const chat = useChat(chatId);
  usePeople();
  const [m, setM] = useState<Message | null>(null);

  useEffect(() => {
    const load = () =>
      void core.storage
        .getMessage(chatId, author, id)
        .then(setM)
        .catch(() => {});
    load();
    return core.on(`messages:${chatId}`, load);
  }, [chatId, author, id]);

  const others = (chat?.members ?? []).filter((mb) => mb.userId !== core.myId).map((mb) => mb.userId);
  const read = chat?.kind === 'group' ? (m?.readBy ?? []) : m?.status === 'read' ? others : [];
  const delivered = chat?.kind === 'group' ? (m?.deliveredTo ?? []).filter((u) => !read.includes(u)) : m?.status === 'delivered' ? others : [];

  const people = (ids: string[]) =>
    ids.map((u, i) => (
      <View key={u}>
        {i > 0 && <Divider />}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
          <Avatar id={u} name={core.name(u)} size={40} />
          <Txt size={15} weight="600">
            {core.name(u) || '…'}
          </Txt>
        </View>
      </View>
    ));

  return (
    <Screen>
      <TopBar title={t.messageInfo} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        {m && (
          <Glass style={{ padding: 14, borderRadius: 20, gap: 6 }}>
            <Txt size={15.5}>{m.kind === 'poll' ? m.poll?.question : m.text}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' }}>
              <Txt size={12} color={theme.muted}>
                {listTime(m.sentAt, t)} · {clock(m.sentAt)}
              </Txt>
              <Ticks status={m.status} />
            </View>
          </Glass>
        )}
        <Section title={t.readBy} />
        <Glass>{read.length ? people(read) : <Txt size={14} color={theme.muted} style={{ padding: 14 }}>{t.nobodyYet}</Txt>}</Glass>
        <Section title={t.deliveredTo} />
        <Glass>{delivered.length ? people(delivered) : <Txt size={14} color={theme.muted} style={{ padding: 14 }}>{t.nobodyYet}</Txt>}</Glass>
      </ScrollView>
    </Screen>
  );
}
