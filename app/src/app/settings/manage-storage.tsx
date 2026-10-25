// settings/manage-storage.tsx: Storage and data › Manage storage, like WhatsApp's.
//
//   The phone's space: how much PakChat's files take, how much is free.
//   Review and delete: files larger than 5 MB.
//   Chats: each chat's files, biggest first.
// Tap one to see its files in a grid; tap files to pick them, then Delete
// (they go from this phone, with their messages, as "Delete for me" does).
// Locked chats aren't listed (their names stay hidden).
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, ScrollView, useWindowDimensions, View } from 'react-native';

import { core } from '../../core/core';
import { useChatList } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration, fileSize } from '../../ui/format';
import { Icon, type IconName } from '../../ui/icons';
import { Avatar, Chip, Divider, Empty, Glass, Pressy, Screen, Section, TopBar, Txt } from '../../ui/kit';
import { tick } from '../../ui/motion';
import { Dialog, toast } from '../../ui/overlays';

const BIG = 5 * 1024 * 1024;

const iconOf = (m: Message): IconName => (m.file?.kind === 'video' ? 'video' : m.file?.kind === 'image' ? 'photo' : m.file?.kind === 'voice' || m.file?.kind === 'audio' ? 'music' : 'doc');
const keyOf = (m: Pick<Message, 'chatId' | 'author' | 'id'>) => `${m.chatId}/${m.author}/${m.id}`;

export default function ManageStorage() {
  const { chat, big } = useLocalSearchParams<{ chat?: string; big?: string }>();
  if (chat || big) return <Files chatId={chat} big={!!big} />;
  return <Overview />;
}

function Overview() {
  const t = useT();
  const { theme } = useLook();
  const rows = useChatList();
  const [byChat, setByChat] = useState<{ chatId: string; bytes: number; count: number }[] | null>(null);
  const [bigOnes, setBigOnes] = useState<{ bytes: number; count: number }>({ bytes: 0, count: 0 });
  const [space, setSpace] = useState<{ free: number; total: number } | null>(null);

  useEffect(() => {
    const load = () => {
      void core.storage.keptByChat().then(setByChat);
      void core.storage.keptFiles({ atLeast: BIG, limit: 2000 }).then((l) => setBigOnes({ bytes: l.reduce((a, m) => a + (m.file?.size ?? 0), 0), count: l.length }));
      setTimeout(() => {
        try {
          setSpace({ free: Paths.availableDiskSpace, total: Paths.totalDiskSpace });
        } catch {
          setSpace(null);
        }
      }, 0);
    };
    load();
    return core.on('chats', load);
  }, []);

  const titles = new Map((rows ?? []).map((r) => [r.chat.id, r]));
  const shown = (byChat ?? []).filter((c) => titles.has(c.chatId));
  const used = shown.reduce((a, c) => a + c.bytes, 0);
  const total = space?.total ?? 0;
  const other = space ? Math.max(0, total - space.free - used) : 0;
  const pct = (n: number) => (total > 0 ? Math.max(n > 0 ? 1 : 0, (n / total) * 100) : 0);

  return (
    <Screen>
      <TopBar title={t.manageStorage} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Glass style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Txt size={22} weight="700" color={theme.accInk}>
                {fileSize(used)}
              </Txt>
              <Txt size={12.5} color={theme.muted}>
                {t.usedByPakchat}
              </Txt>
            </View>
            {space && (
              <View style={{ alignItems: 'flex-end' }}>
                <Txt size={16} weight="700">
                  {fileSize(space.free)}
                </Txt>
                <Txt size={12.5} color={theme.muted}>
                  {t.freeWord}
                </Txt>
              </View>
            )}
          </View>
          {space && (
            <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.faint, flexDirection: 'row', overflow: 'hidden' }} testID="storage-bar">
              <View style={{ width: `${pct(used)}%`, backgroundColor: theme.acc }} />
              <View style={{ width: `${pct(other)}%`, backgroundColor: theme.muted, opacity: 0.5 }} />
            </View>
          )}
        </Glass>

        <Section title={t.reviewAndDelete} />
        <Glass>
          <Pressy onPress={() => router.push({ pathname: '/settings/manage-storage', params: { big: '1' } })} label={t.largerThan5} scale={0.98} testID="storage-big">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <Icon name="doc" size={22} color={theme.accInk} />
              <View style={{ flex: 1 }}>
                <Txt size={15.5} weight="600">
                  {t.largerThan5}
                </Txt>
                <Txt size={13} color={theme.muted}>
                  {bigOnes.count ? `${fill(t.nItems, { n: bigOnes.count })} · ${fileSize(bigOnes.bytes)}` : t.nothingHere}
                </Txt>
              </View>
              <Icon name="chevron" size={18} color={theme.faint} />
            </View>
          </Pressy>
        </Glass>

        <Section title={t.chats} />
        {byChat && shown.length === 0 ? (
          <Empty icon="photo" text={t.noFilesKept} />
        ) : (
          <Glass>
            {shown.map((c, i) => {
              const r = titles.get(c.chatId)!;
              return (
                <View key={c.chatId}>
                  {i > 0 && <Divider />}
                  <Pressy onPress={() => router.push({ pathname: '/settings/manage-storage', params: { chat: c.chatId } })} label={r.title} scale={0.98} testID={`storage-chat-${r.title}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                      <Avatar id={r.other ?? r.chat.id} name={r.chat.kind === 'group' ? '' : r.title} size={42} group={r.chat.kind === 'group'} />
                      <View style={{ flex: 1 }}>
                        <Txt size={15.5} weight="600" lines={1}>
                          {r.title}
                        </Txt>
                        <Txt size={13} color={theme.muted}>
                          {fill(t.nItems, { n: c.count })}
                        </Txt>
                      </View>
                      <Txt size={14} weight="600" color={theme.muted}>
                        {fileSize(c.bytes)}
                      </Txt>
                    </View>
                  </Pressy>
                </View>
              );
            })}
          </Glass>
        )}
      </ScrollView>
    </Screen>
  );
}

function Files({ chatId, big }: { chatId?: string; big: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const rows = useChatList();
  const { width } = useWindowDimensions();
  const [list, setList] = useState<Message[] | null>(null);
  const [order, setOrder] = useState<'big' | 'new' | 'old'>('big');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const load = () => void core.storage.keptFiles({ chatId, atLeast: big ? BIG : 0, limit: 2000 }).then(setList);
    load();
    return core.on(chatId ? `messages:${chatId}` : 'chats', load);
  }, [chatId, big]);

  const allowed = new Set((rows ?? []).map((r) => r.chat.id));
  const title = chatId ? ((rows ?? []).find((r) => r.chat.id === chatId)?.title ?? '') : t.largerThan5;
  const files = (list ?? [])
    .filter((m) => allowed.has(m.chatId))
    .sort((a, b) => (order === 'big' ? (b.file?.size ?? 0) - (a.file?.size ?? 0) : order === 'new' ? b.sentAt - a.sentAt : a.sentAt - b.sentAt));
  const chosen = files.filter((m) => picked.has(keyOf(m)));
  const chosenBytes = chosen.reduce((a, m) => a + (m.file?.size ?? 0), 0);
  const size = Math.floor((width - 24 - 8) / 3);

  const flip = (m: Message) => {
    tick();
    const next = new Set(picked);
    if (next.has(keyOf(m))) next.delete(keyOf(m));
    else next.add(keyOf(m));
    setPicked(next);
  };

  const remove = async () => {
    setAsking(false);
    const gone = chosen;
    setPicked(new Set());
    await core.deleteForMe(gone).catch(() => toast(t.couldNot));
    toast(fill(t.freedSpace, { size: fileSize(gone.reduce((a, m) => a + (m.file?.size ?? 0), 0)) }));
  };

  return (
    <Screen>
      <TopBar
        title={chosen.length ? fill(t.nSelected, { n: chosen.length }) : title}
        subtitle={chosen.length ? fileSize(chosenBytes) : list ? fileSize(files.reduce((a, m) => a + (m.file?.size ?? 0), 0)) : undefined}
        onBack={() => (chosen.length ? setPicked(new Set()) : router.back())}
        right={
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {files.length > 0 && (
              <Pressy onPress={() => setPicked(chosen.length === files.length ? new Set() : new Set(files.map(keyOf)))} label={t.selectAll} testID="storage-select-all">
                <View style={{ padding: 10 }}>
                  <Icon name="check" size={21} color={chosen.length === files.length ? theme.acc : theme.text} />
                </View>
              </Pressy>
            )}
            {chosen.length > 0 && (
              <Pressy onPress={() => setAsking(true)} label={t.delete} testID="storage-delete">
                <View style={{ padding: 10 }}>
                  <Icon name="trash" size={21} color={theme.danger} />
                </View>
              </Pressy>
            )}
          </View>
        }
      />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
        <Chip label={t.largestWord} on={order === 'big'} onPress={() => setOrder('big')} testID="storage-largest" />
        <Chip label={t.newestWord} on={order === 'new'} onPress={() => setOrder('new')} testID="storage-newest" />
        <Chip label={t.oldestWord} on={order === 'old'} onPress={() => setOrder('old')} testID="storage-oldest" />
      </View>
      <FlatList
        data={files}
        keyExtractor={keyOf}
        numColumns={3}
        columnWrapperStyle={{ gap: 4 }}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 4, paddingBottom: 30 }}
        ListEmptyComponent={list ? <Empty icon="photo" text={t.noFilesKept} /> : undefined}
        renderItem={({ item: m }) => {
          const on = picked.has(keyOf(m));
          const thumb = m.file?.thumb ? `data:image/jpeg;base64,${m.file.thumb}` : m.file?.kind === 'image' ? m.file.local : undefined;
          return (
            <Pressy onPress={() => flip(m)} label={m.file?.name ?? iconOf(m)} scale={0.95} testID="storage-file">
              <View style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
                {thumb ? (
                  <Image source={{ uri: thumb }} style={{ position: 'absolute', inset: 0 }} contentFit="cover" />
                ) : (
                  <View style={{ alignItems: 'center', gap: 4, padding: 6 }}>
                    <Icon name={iconOf(m)} size={26} color={theme.accInk} />
                    {!!m.file?.name && (
                      <Txt size={11} color={theme.muted} lines={2} align="center">
                        {m.file.name}
                      </Txt>
                    )}
                  </View>
                )}
                <View style={{ position: 'absolute', start: 4, bottom: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                  <Txt size={10.5} weight="600" color="#FFFFFF">
                    {m.file?.kind === 'video' && m.file.duration ? `${duration(m.file.duration)} · ` : ''}
                    {fileSize(m.file?.size ?? 0)}
                  </Txt>
                </View>
                {on && <View style={{ position: 'absolute', inset: 0, backgroundColor: theme.acc, opacity: 0.28 }} />}
                <View
                  style={{
                    position: 'absolute',
                    top: 6,
                    end: 6,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                    backgroundColor: on ? theme.acc : 'rgba(0,0,0,0.25)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on && <Icon name="check" size={12} color="#FFFFFF" stroke={3} />}
                </View>
              </View>
            </Pressy>
          );
        }}
      />
      <Dialog
        visible={asking}
        onClose={() => setAsking(false)}
        title={fill(t.deleteNItems, { n: chosen.length })}
        text={t.deleteItemsNote}
        buttons={[
          { label: t.delete, danger: true, onPress: () => void remove(), testID: 'storage-confirm-delete' },
          { label: t.cancel, onPress: () => setAsking(false) },
        ]}
      />
    </Screen>
  );
}
