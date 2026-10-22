// search.tsx: find chats and old messages. It searches the phone's own
// database (the "search" table in sqliteStorage.ts), so it's instant, works
// offline, and nothing you type ever leaves the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { core } from '../core/core';
import { useChatList, useSearch } from '../core/hooks';
import type { Found } from '../data/sqliteStorage';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { listTime } from '../ui/format';
import { Avatar, Empty, Field, IconButton, Pressy, Screen, Txt, fontStyle } from '../ui/kit';

type Row = { kind: 'chat'; id: string; title: string; group: boolean } | { kind: 'msg'; f: Found };

export default function Search() {
  const { chat: only } = useLocalSearchParams<{ chat?: string }>();
  const t = useT();
  const { theme, lang } = useLook();
  const [query, setQuery] = useState('');
  const rows = useChatList();
  const found = useSearch(query);

  const q = query.trim().toLowerCase();
  const chats = useMemo(
    () => (!q || only ? [] : (rows ?? []).filter((r) => r.title.toLowerCase().includes(q)).map((r): Row => ({ kind: 'chat', id: r.chat.id, title: r.title, group: r.chat.kind === 'group' }))),
    [rows, q, only],
  );
  const messages = found.filter((f) => !only || f.chatId === only).map((f): Row => ({ kind: 'msg', f }));
  const titles = useMemo(() => new Map((rows ?? []).map((r) => [r.chat.id, r.title])), [rows]);

  // Searching inside a chat goes back to that same chat (not a second copy of it on top).
  const openChat = (chatId: string) =>
    only === chatId ? router.dismissTo({ pathname: '/chat/[id]', params: { id: chatId } }) : router.replace({ pathname: '/chat/[id]', params: { id: chatId } });

  const sections = [
    ...(chats.length ? [{ title: t.chats, data: chats }] : []),
    ...(messages.length ? [{ title: fill(t.messagesFound, { n: messages.length }), data: messages }] : []),
  ];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 10 }}>
        <IconButton icon="back" label={t.back} onPress={() => router.back()} flip look="glass" testID="back" />
        <View style={{ flex: 1 }}>
          <Field value={query} onChangeText={setQuery} placeholder={only ? t.searchInChat : t.searchHint} icon="search" autoFocus returnKeyType="search" testID="search-field" />
        </View>
      </View>

      {!q ? (
        <Animated.View entering={FadeIn.delay(100)}>
          <Empty icon="lock" text={t.searchLocal} />
        </Animated.View>
      ) : sections.length === 0 ? (
        <Empty icon="search" text={t.noResults} />
      ) : (
        <SectionList
          sections={sections}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(r) => (r.kind === 'chat' ? `c-${r.id}` : `m-${r.f.chatId}-${r.f.author}-${r.f.id}`)}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30 }}
          renderSectionHeader={({ section }) => (
            <Txt size={13} weight="700" color={theme.sectionText} style={{ marginTop: 16, marginBottom: 6, marginHorizontal: 10 }}>
              {section.title}
            </Txt>
          )}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 20).springify().damping(22)}>
              {item.kind === 'chat' ? (
                <Pressy onPress={() => openChat(item.id)} label={item.title} scale={0.98}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                    <Avatar id={item.id} name={item.title} size={44} group={item.group} />
                    <Txt size={15.5} weight="600">
                      {item.title}
                    </Txt>
                  </View>
                </Pressy>
              ) : (
                <Pressy onPress={() => openChat(item.f.chatId)} label={item.f.text} scale={0.98} testID={`found-${item.f.text}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: theme.glass, marginBottom: 6 }}>
                    <Avatar id={item.f.chatId} name={titles.get(item.f.chatId) ?? ''} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Txt size={14} weight="700" lines={1}>
                            {item.f.author === core.myId ? t.youWord : core.name(item.f.author) || titles.get(item.f.chatId) || '…'}
                          </Txt>
                        </View>
                        <Txt size={12} color={theme.muted}>
                          {listTime(item.f.sentAt, t)}
                        </Txt>
                      </View>
                      <Text numberOfLines={2} style={[fontStyle(item.f.text, lang, 14, '400'), { color: theme.muted }]}>
                        <Marked text={item.f.text} query={q} color={theme.accInk} />
                      </Text>
                    </View>
                  </View>
                </Pressy>
              )}
            </Animated.View>
          )}
        />
      )}
    </Screen>
  );
}

/** The words you searched for, in bold accent colour. */
function Marked({ text, query, color }: { text: string; query: string; color: string }) {
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        words.some((w) => w.toLowerCase() === part.toLowerCase()) ? (
          <Text key={i} style={{ color, fontWeight: '700' }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}
