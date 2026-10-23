// poll-votes.tsx: "View votes" on a poll, as on WhatsApp: each answer with
// how many picked it and who they are. (Votes are locked like messages, so
// only the people in the chat can see them.)
import type { Message } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../core/core';
import { usePeople } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Divider, Glass, Screen, TopBar, Txt } from '../ui/kit';

export default function PollVotes() {
  const { chat: chatId, author, id } = useLocalSearchParams<{ chat: string; author: string; id: string }>();
  const t = useT();
  const { theme } = useLook();
  usePeople();
  const [m, setM] = useState<Message | null>(null);

  // Votes keep coming in while the screen is open.
  useEffect(() => {
    const load = () =>
      void core.storage
        .getMessage(chatId, author, id)
        .then(setM)
        .catch(() => {});
    load();
    return core.on(`messages:${chatId}`, load);
  }, [chatId, author, id]);

  const poll = m?.poll;
  const votes = Object.entries(m?.votes ?? {});
  const voters = votes.filter(([, v]) => v.length > 0).length;

  return (
    <Screen>
      <TopBar title={t.pollVotes} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 30 }}>
        {poll && (
          <View style={{ paddingHorizontal: 6, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="poll" size={18} color={theme.accInk} />
              <Txt size={18} weight="800" style={{ flex: 1 }}>
                {poll.question}
              </Txt>
            </View>
            <Txt size={13} color={theme.muted}>
              {fill(t.votes, { n: voters })}
            </Txt>
          </View>
        )}
        {poll?.options.map((o, i) => {
          // Me first, then by name.
          const who = votes
            .filter(([, v]) => v.includes(i))
            .map(([u]) => u)
            .sort((a, b) => (a === core.myId ? -1 : b === core.myId ? 1 : core.name(a).localeCompare(core.name(b))));
          return (
            <Glass key={i} style={{ borderRadius: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Txt size={15.5} weight="700" style={{ flex: 1 }}>
                  {o}
                </Txt>
                <Txt size={13} weight="600" color={theme.muted}>
                  {fill(t.voteCount, { n: who.length })}
                </Txt>
              </View>
              {who.map((u) => (
                <View key={u}>
                  <Divider />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                    <Avatar id={u} name={core.name(u)} size={36} />
                    <Txt size={15} weight="600" lines={1} style={{ flex: 1 }}>
                      {u === core.myId ? t.youWord : core.name(u) || '…'}
                    </Txt>
                  </View>
                </View>
              ))}
            </Glass>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
