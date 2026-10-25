// starred.tsx: messages you starred (kept on this phone only), newest first.
// Opened from a chat's info, it shows just that chat's.
import type { Message } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../core/core';
import { useStarred } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { listTime } from '../ui/format';
import { Avatar, Empty, Glass, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { rise } from '../ui/motion';

export default function Starred() {
  const { chat: only } = useLocalSearchParams<{ chat?: string }>();
  const t = useT();
  const { theme } = useLook();
  const starred = useStarred();
  const [list, setList] = useState<Message[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Message[] = [];
      for (const key of Object.keys(starred)) {
        const [chatId, author, ...rest] = key.split('/');
        if (only && chatId !== only) continue;
        // A locked chat's starred messages show only inside it.
        if (!only && core.prefs[chatId]?.lock) continue;
        const m = await core.storage.getMessage(chatId, author, rest.join('/'));
        if (m && !m.deleted) out.push(m);
      }
      out.sort((a, b) => b.sentAt - a.sentAt);
      if (alive) setList(out);
    })();
    return () => {
      alive = false;
    };
  }, [starred, only]);

  return (
    <Screen>
      <TopBar title={t.starred} onBack={() => router.back()} />
      <FlatList
        data={list ?? []}
        keyExtractor={(m) => `${m.chatId}/${m.author}/${m.id}`}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={list ? <Empty icon="star" text={t.noStarred} /> : undefined}
        renderItem={({ item, index }) => (
          <Animated.View entering={rise(Math.min(index, 10) * 25)}>
            <Pressy
              onPress={() =>
                // From a chat's info: back to that chat, not a second copy of it.
                only === item.chatId ? router.dismissTo({ pathname: '/chat/[id]', params: { id: item.chatId } }) : router.push({ pathname: '/chat/[id]', params: { id: item.chatId } })
              } label={item.text ?? ''} scale={0.98}>
              <Glass style={{ padding: 12, borderRadius: 18, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar id={item.author} name={core.name(item.author)} size={30} />
                  <View style={{ flex: 1 }}>
                    <Txt size={13.5} weight="700" lines={1}>
                      {item.author === core.myId ? t.youWord : core.name(item.author) || '…'}
                    </Txt>
                  </View>
                  <Txt size={12} color={theme.muted}>
                    {listTime(item.sentAt, t)}
                  </Txt>
                </View>
                <Txt size={15}>{item.kind === 'poll' ? `${t.poll} ${item.poll?.question ?? ''}` : (item.text ?? '')}</Txt>
              </Glass>
            </Pressy>
          </Animated.View>
        )}
      />
    </Screen>
  );
}
