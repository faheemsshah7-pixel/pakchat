// search.tsx: find chats, contacts and old messages. It searches the phone's own
// database (the "search" table in sqliteStorage.ts), so it's instant, works
// offline, and nothing you type ever leaves the phone. The chips under the box
// (Unread, Photos, Videos, Links, GIFs, Audio, Docs, Polls) narrow it down, like
// WhatsApp's. A message found opens its chat right at that message.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, SectionList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../core/core';
import { useChatList, usePeople, useSearch } from '../core/hooks';
import { plainText } from '../core/richText';
import { defaultTimer } from '../core/timer';
import { isSecretCode, openFolderByCode } from '../core/lock';
import type { Found } from '../data/sqliteStorage';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { bodyLine, listTime } from '../ui/format';
import { Icon } from '../ui/icons';
import { Avatar, Chip, Empty, Field, IconButton, Pressy, Screen, Txt, fontStyle } from '../ui/kit';

type Row = { kind: 'chat'; id: string; title: string; group: boolean } | { kind: 'person'; id: string; name: string; about?: string } | { kind: 'msg'; f: Found & { thumb?: string } };

type Filter = 'unread' | 'image' | 'video' | 'links' | 'gif' | 'audio' | 'doc' | 'poll';

export default function Search() {
  const { chat: only } = useLocalSearchParams<{ chat?: string }>();
  const t = useT();
  const { theme, lang } = useLook();
  const [query, setQuery] = useState('');
  const rows = useChatList();
  const found = useSearch(query);
  const people = usePeople();
  const [filter, setFilter] = useState<Filter | null>(null);
  // A filter's messages from every chat (not statuses, nor locked chats' words).
  const [ofKind, setOfKind] = useState<Message[]>([]);
  useEffect(() => {
    if (!filter || filter === 'unread') return;
    let alive = true;
    void (async () => {
      const list = await core.storage.allOf(filter, 300);
      const hidden = new Set((await core.client.chats()).filter((c) => c.kind === 'status' || !!core.prefs[c.id]?.lock).map((c) => c.id));
      if (alive) setOfKind(list.filter((m) => !hidden.has(m.chatId) && (!only || m.chatId === only)));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [filter, only]);

  // The secret code (Chat lock), typed here, shows the hidden Locked chats folder
  // at the top of the results, like WhatsApp; tapping it opens the folder.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const secret = !only && codeFor === query;
  useEffect(() => {
    if (only || !core.settings.lockedHidden) return;
    let alive = true;
    const wait = setTimeout(() => {
      void isSecretCode(query).then((yes) => {
        if (alive && yes) setCodeFor(query);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(wait);
    };
  }, [query, only]);

  const q = query.trim().toLowerCase();
  const chats = useMemo(() => {
    if (only || (filter && filter !== 'unread') || (!q && filter !== 'unread')) return [];
    return (rows ?? [])
      .filter((r) => r.title.toLowerCase().includes(q) && (filter !== 'unread' || r.chat.unread > 0 || r.prefs.markedUnread))
      .map((r): Row => ({ kind: 'chat', id: r.chat.id, title: r.title, group: r.chat.kind === 'group' }));
  }, [rows, q, only, filter]);
  // My contacts whose names match, that I don't have a chat with yet (those show under Chats).
  const contacts = useMemo(() => {
    if (!q || only || filter) return [];
    const chatting = new Set((rows ?? []).map((r) => (r.chat.kind === 'direct' ? core.otherPerson(r.chat) : null)).filter(Boolean));
    return Object.values(people)
      .filter((p) => p.id !== core.myId && core.isContact(p.id) && !chatting.has(p.id) && core.name(p.id).toLowerCase().includes(q))
      .sort((a, b) => core.name(a.id).localeCompare(core.name(b.id)))
      .map((p): Row => ({ kind: 'person', id: p.id, name: core.name(p.id), about: p.about ?? undefined }));
  }, [people, rows, q, only, filter]);
  const messages = useMemo((): Row[] => {
    if (filter === 'unread') return [];
    if (filter) {
      return ofKind
        .map((m) => ({ m, text: m.kind === 'text' ? plainText(m.text ?? '') : bodyLine(m, t) }))
        .filter(({ text }) => !q || text.toLowerCase().includes(q))
        .map(({ m, text }) => ({ kind: 'msg', f: { chatId: m.chatId, author: m.author, id: m.id, text, sentAt: m.sentAt, thumb: m.file?.thumb ?? undefined } }));
    }
    return found.filter((f) => !only || f.chatId === only).map((f) => ({ kind: 'msg', f: { ...f, text: plainText(f.text) } }));
  }, [filter, ofKind, found, only, q, t]);
  const titles = useMemo(() => new Map((rows ?? []).map((r) => [r.chat.id, r.title])), [rows]);

  // Searching inside a chat goes back to that same chat (not a second copy of it on top).
  // A message opens its chat at that message ("jump").
  const openChat = (chatId: string, jump?: string) =>
    only === chatId ? router.dismissTo({ pathname: '/chat/[id]', params: { id: chatId, jump } }) : router.replace({ pathname: '/chat/[id]', params: { id: chatId, jump } });
  const openPerson = (userId: string) =>
    void core.client
      .openDirect(userId, defaultTimer())
      .then((c) => router.replace({ pathname: '/chat/[id]', params: { id: c.id } }))
      .catch(() => {});

  const sections = [
    ...(chats.length ? [{ title: t.chats, data: chats }] : []),
    ...(contacts.length ? [{ title: t.contacts, data: contacts }] : []),
    ...(messages.length ? [{ title: fill(t.messagesFound, { n: messages.length }), data: messages }] : []),
  ];
  const filters: { key: Filter; label: string }[] = [
    { key: 'unread', label: t.unread },
    { key: 'image', label: t.photosWord },
    { key: 'video', label: t.videosWord },
    { key: 'links', label: t.linksTab },
    { key: 'gif', label: t.gifsWord },
    { key: 'audio', label: t.audioWord },
    { key: 'doc', label: t.docsWord },
    { key: 'poll', label: t.pollsWord },
  ];
  const showing = !!q || !!filter;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 10 }}>
        <IconButton icon="back" label={t.back} onPress={() => router.back()} flip look="glass" testID="back" />
        <View style={{ flex: 1 }}>
          <Field value={query} onChangeText={setQuery} placeholder={only ? t.searchInChat : t.searchHint} icon="search" autoFocus returnKeyType="search" testID="search-field" />
        </View>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
          {filters
            .filter((f) => !only || f.key !== 'unread')
            .map((f) => (
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(filter === f.key ? null : f.key)} testID={`search-filter-${f.key}`} />
            ))}
        </ScrollView>
      </View>

      {secret && (
        <Animated.View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
          <Pressy
            onPress={() => {
              openFolderByCode();
              router.replace('/locked');
            }}
            label={t.lockedChats}
            scale={0.98}
            testID="found-locked"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="lock" size={21} color={theme.accInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt size={15.5} weight="600">
                  {t.lockedChats}
                </Txt>
              </View>
              <Icon name="chevron" size={18} color={theme.faint} />
            </View>
          </Pressy>
        </Animated.View>
      )}
      {secret && sections.length === 0 ? null : !showing ? (
        <View>
          <Empty icon="lock" text={t.searchLocal} />
        </View>
      ) : sections.length === 0 ? (
        <Empty icon="search" text={t.noResults} />
      ) : (
        <SectionList
          sections={sections}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(r) => (r.kind === 'chat' ? `c-${r.id}` : r.kind === 'person' ? `p-${r.id}` : `m-${r.f.chatId}-${r.f.author}-${r.f.id}`)}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30 }}
          renderSectionHeader={({ section }) => (
            <Txt size={13} weight="700" color={theme.sectionText} style={{ marginTop: 16, marginBottom: 6, marginHorizontal: 10 }}>
              {section.title}
            </Txt>
          )}
          renderItem={({ item, index }) => (
            <View>
              {item.kind === 'chat' ? (
                <Pressy onPress={() => openChat(item.id)} label={item.title} scale={0.98}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                    <Avatar id={item.id} name={item.title} size={44} group={item.group} />
                    <Txt size={15.5} weight="600">
                      {item.title}
                    </Txt>
                  </View>
                </Pressy>
              ) : item.kind === 'person' ? (
                <Pressy onPress={() => openPerson(item.id)} label={item.name} scale={0.98} testID={`found-person-${item.name}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                    <Avatar id={item.id} name={item.name} size={44} />
                    <View style={{ flex: 1 }}>
                      <Txt size={15.5} weight="600" lines={1}>
                        {item.name}
                      </Txt>
                      {!!item.about && (
                        <Txt size={13} color={theme.muted} lines={1}>
                          {item.about}
                        </Txt>
                      )}
                    </View>
                  </View>
                </Pressy>
              ) : (
                <Pressy onPress={() => openChat(item.f.chatId, `${item.f.author}/${item.f.id}`)} label={item.f.text} scale={0.98} testID={`found-${item.f.text}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: theme.glass, marginBottom: 6 }}>
                    {item.f.thumb ? (
                      <Image source={{ uri: `data:image/jpeg;base64,${item.f.thumb}` }} style={{ width: 44, height: 44, borderRadius: 10 }} />
                    ) : (
                      <Avatar id={item.f.chatId} name={titles.get(item.f.chatId) ?? ''} size={44} />
                    )}
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
            </View>
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
