// media/[id].tsx: a chat's "Media, links and docs" (from its Info), as on WhatsApp.
//
//   Media   every photo and video, newest first, in a grid. Tap one to see it full screen.
//   Docs    documents and audio files. Tap to open (or download first).
//   Links   messages with a web address. Tap the address to open it in the browser.
// Each tab is grouped by month ("This month", "September", …).
//
// It's all read from the phone (sqliteStorage.ts, shared): the server never knows.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Linking, useWindowDimensions, View } from 'react-native';

import { core, isOffline } from '../../core/core';
import { Cancelled, download, FileBroken, FileGone, haveFile } from '../../core/files';
import { useChat } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { linksIn } from '../../data/sqliteStorage';
import { open } from '../../ui/chat/FileBody';
import { duration, fileSize, listTime, monthLabel } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Chip, Empty, Glass, Pressy, Screen, TopBar, Txt } from '../../ui/kit';
import { toast } from '../../ui/overlays';

type Tab = 'media' | 'docs' | 'links';

/** What the list shows: a month's name, then its things (a row of up to three in the grid). */
type Entry = { key: string; month: string } | { key: string; items: Message[] };

function byMonth(list: Message[], perRow: number, t: Parameters<typeof monthLabel>[1]): Entry[] {
  const out: Entry[] = [];
  let month = '';
  let row: Message[] = [];
  const flush = () => {
    if (row.length) out.push({ key: `${row[0].author}/${row[0].id}`, items: row });
    row = [];
  };
  for (const m of list) {
    const label = monthLabel(m.sentAt, t);
    if (label !== month) {
      flush();
      month = label;
      out.push({ key: `month:${label}`, month: label });
    }
    row.push(m);
    if (row.length === perRow) flush();
  }
  flush();
  return out;
}

export default function Media() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const chat = useChat(id);
  const [tab, setTab] = useState<Tab>('media');
  const [loaded, setLoaded] = useState<{ tab: Tab; list: Message[] } | null>(null);
  // Nothing shows until the tab picked has been read (not the last tab's list).
  const list = loaded?.tab === tab ? loaded.list : null;

  // Read again when the chat changes (a new photo, a download finishing).
  useEffect(() => {
    let alive = true;
    const load = () =>
      void core.storage
        .shared(id, tab)
        .then((l) => alive && setLoaded({ tab, list: l }))
        .catch(() => {});
    load();
    const off = core.on(`messages:${id}`, load);
    return () => {
      alive = false;
      off();
    };
  }, [id, tab]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'media', label: t.mediaTab },
    { key: 'docs', label: t.docsTab },
    { key: 'links', label: t.linksTab },
  ];

  return (
    <Screen>
      <TopBar title={chat ? core.chatTitle(chat) : t.media} onBack={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10 }}>
        {tabs.map((x) => (
          <Chip key={x.key} label={x.label} on={tab === x.key} onPress={() => setTab(x.key)} testID={`media-tab-${x.key}`} />
        ))}
      </View>
      {list && !list.length ? (
        <Empty icon={tab === 'media' ? 'photo' : tab === 'docs' ? 'doc' : 'link'} text={tab === 'media' ? t.noMedia : tab === 'docs' ? t.noDocs : t.noLinks} />
      ) : (
        <FlatList
          data={byMonth(list ?? [], tab === 'media' ? 3 : 1, t)}
          keyExtractor={(e) => e.key}
          contentContainerStyle={{ paddingHorizontal: tab === 'media' ? 3 : 12, paddingBottom: 30 }}
          renderItem={({ item }) =>
            'month' in item ? (
              <Txt size={13} weight="700" color={theme.muted} style={{ marginHorizontal: tab === 'media' ? 9 : 4, marginTop: 14, marginBottom: 8 }}>
                {item.month}
              </Txt>
            ) : tab === 'media' ? (
              <View style={{ flexDirection: 'row' }}>
                {item.items.map((m) => (
                  <Tile key={m.id} m={m} />
                ))}
              </View>
            ) : (
              <View style={{ marginBottom: 8 }}>{tab === 'docs' ? <DocRow m={item.items[0]} /> : <LinkRow m={item.items[0]} />}</View>
            )
          }
        />
      )}
    </Screen>
  );
}

/** A photo or video in the grid (three across). */
function Tile({ m }: { m: Message }) {
  const { theme } = useLook();
  const { width } = useWindowDimensions();
  const side = Math.floor((width - 6 - 9) / 3);
  const f = m.file!;
  const source = f.kind === 'image' && f.local ? { uri: f.local } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;
  return (
    <Pressy onPress={() => router.push({ pathname: '/viewer', params: { chat: m.chatId, author: m.author, id: m.id } })} label={f.kind} scale={0.96} testID="media-item">
      <View style={{ width: side, height: side, margin: 1.5, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.glass }}>
        {source && <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" blurRadius={f.local ? 0 : 4} />}
        {f.kind === 'video' && (
          <View style={{ position: 'absolute', start: 5, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="video" size={13} color="#FFFFFF" />
            {!!f.duration && (
              <Txt size={11} weight="600" color="#FFFFFF">
                {duration(f.duration)}
              </Txt>
            )}
          </View>
        )}
      </View>
    </Pressy>
  );
}

function DocRow({ m }: { m: Message }) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const here = haveFile(m);

  async function tap() {
    if (here) return open(m);
    try {
      await download(m);
    } catch (err) {
      if (err instanceof Cancelled) return;
      toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
    }
  }

  return (
    <Pressy onPress={() => void tap()} label={f.name ?? t.document} scale={0.98} testID="doc-item">
      <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16 }}>
        <View style={{ width: 42, height: 42, borderRadius: 11, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={f.kind === 'audio' ? 'music' : 'doc'} size={21} color={theme.accInk} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={15} weight="600" lines={2}>
            {f.name ?? t.document}
          </Txt>
          <Txt size={12.5} color={theme.muted}>
            {fileSize(f.size)} · {listTime(m.sentAt, t)}
          </Txt>
        </View>
        {!here && <Icon name="download" size={20} color={theme.muted} />}
      </Glass>
    </Pressy>
  );
}

function LinkRow({ m }: { m: Message }) {
  const t = useT();
  const { theme } = useLook();
  const links = linksIn(m.text ?? '');
  return (
    <Glass style={{ padding: 12, borderRadius: 16, gap: 6 }}>
      {links.map((l) => (
        <Pressy key={l} onPress={() => void Linking.openURL(l).catch(() => toast(t.couldNot))} label={l} scale={0.98} testID="link-item">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="link" size={18} color={theme.accInk} />
            </View>
            <Txt size={14.5} weight="600" color={theme.accInk} lines={2} style={{ flex: 1 }}>
              {l.replace(/^https?:\/\//, '')}
            </Txt>
          </View>
        </Pressy>
      ))}
      <Txt size={13} color={theme.muted} lines={3}>
        {m.text}
      </Txt>
      <Txt size={11.5} color={theme.faint}>
        {listTime(m.sentAt, t)}
      </Txt>
    </Glass>
  );
}
