// media/[id].tsx: a chat's "Media, links and docs" (from its Info), as on WhatsApp.
//
//   Media   every photo and video, newest first, in a grid. Tap one to see it full screen.
//   Docs    documents and audio files. Tap to open (or download first).
//   Links   messages with a web address. Tap the address to open it in the browser.
// Each tab is grouped by month ("This month", "September", …). Swipe between
// the tabs, or tap one, like WhatsApp; the line under them follows your finger.
//
// It's all read from the phone (sqliteStorage.ts, shared): the server never knows.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Linking, StyleSheet, useWindowDimensions, View, type HostInstance } from 'react-native';
import { TabView, type NavigationState, type SceneRendererProps } from 'react-native-tab-view';

import { core, isOffline } from '../../core/core';
import { Cancelled, download, FileBroken, FileGone, haveFile } from '../../core/files';
import { useChat } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { linksIn } from '../../data/sqliteStorage';
import { open } from '../../ui/chat/FileBody';
import { duration, fileSize, listTime, monthLabel } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Empty, Glass, Pressy, Screen, TopBar, Txt } from '../../ui/kit';
import { toast } from '../../ui/overlays';
import { openViewer } from '../../ui/zoom';

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
  const chat = useChat(id);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const routes = useMemo(
    () => [
      { key: 'media' as Tab, title: t.mediaTab },
      { key: 'docs' as Tab, title: t.docsTab },
      { key: 'links' as Tab, title: t.linksTab },
    ],
    [t],
  );

  return (
    <Screen>
      <TopBar title={chat ? core.chatTitle(chat) : t.media} onBack={() => router.back()} />
      {/* Like WhatsApp: swipe between Media, Docs and Links, or tap one; the line under them follows. */}
      <TabView
        navigationState={{ index, routes }}
        onIndexChange={setIndex}
        initialLayout={{ width }}
        lazy
        renderScene={({ route }) => <Shared chatId={id} tab={route.key} />}
        renderTabBar={(p) => <Tabs {...p} />}
      />
    </Screen>
  );
}

/** Media, Docs and Links across the top, with the line under the one showing (it moves with your finger). */
function Tabs({ navigationState, position, jumpTo }: SceneRendererProps & { navigationState: NavigationState<{ key: Tab; title: string }> }) {
  const { theme, rtl } = useLook();
  const [width, setWidth] = useState(0);
  const each = width / navigationState.routes.length;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', marginTop: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.glassLine }}
    >
      {navigationState.routes.map((r, i) => (
        <Pressy key={r.key} style={{ flex: 1 }} onPress={() => jumpTo(r.key)} label={r.title} testID={`media-tab-${r.key}`}>
          <View style={{ height: 46, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={14.5} weight="700" color={navigationState.index === i ? theme.accInk : theme.muted}>
              {r.title}
            </Txt>
          </View>
        </Pressy>
      ))}
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', bottom: 0, start: 0, width: each, height: 3, paddingHorizontal: each * 0.18, transform: [{ translateX: Animated.multiply(position, rtl ? -each : each) }] }}
        >
          <View style={{ flex: 1, borderRadius: 2, backgroundColor: theme.acc }} />
        </Animated.View>
      )}
    </View>
  );
}

/** One tab's things, by month. Read again when the chat changes (a new photo, a download finishing). */
function Shared({ chatId, tab }: { chatId: string; tab: Tab }) {
  const t = useT();
  const { theme } = useLook();
  const [list, setList] = useState<Message[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void core.storage
        .shared(chatId, tab)
        .then((l) => alive && setList(l))
        .catch(() => {});
    load();
    const off = core.on(`messages:${chatId}`, load);
    return () => {
      alive = false;
      off();
    };
  }, [chatId, tab]);

  if (list && !list.length) return <Empty icon={tab === 'media' ? 'photo' : tab === 'docs' ? 'doc' : 'link'} text={tab === 'media' ? t.noMedia : tab === 'docs' ? t.noDocs : t.noLinks} />;
  return (
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
  );
}

/** A photo or video in the grid (three across). */
function Tile({ m }: { m: Message }) {
  const { theme } = useLook();
  const { width } = useWindowDimensions();
  const side = Math.floor((width - 6 - 9) / 3);
  const f = m.file!;
  const source = f.kind === 'image' && f.local ? { uri: f.local } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;
  const spot = useRef<HostInstance>(null);
  return (
    <Pressy onPress={() => void openViewer(m, spot.current)} label={f.kind} scale={0.96} testID="media-item">
      <View ref={spot} collapsable={false} style={{ width: side, height: side, margin: 1.5, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.glass }}>
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
