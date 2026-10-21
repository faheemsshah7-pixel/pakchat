// (tabs)/index.tsx: the chat list, PakChat's home.
//
// Everything here comes from the phone's database first (useChatList), so it
// shows instantly, even with no internet. Hold a chat to pick several; swipe
// one to pin or archive it.
import KV from 'expo-sqlite/kv-store';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { core } from '../../core/core';
import { useAllTyping, useAuth, useChatList, useConnected, type ChatRow as Row } from '../../core/hooks';
import { fill, useT, type Strings } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { ChatRow } from '../../ui/ChatRow';
import { Icon } from '../../ui/icons';
import { Chip, Empty, Fab, Glass, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { listLayout, thud, tick } from '../../ui/motion';
import { Dialog, MenuItem, Popup, toast } from '../../ui/overlays';

type Filter = 'all' | 'unread' | 'favourites' | 'groups';

export default function Chats() {
  const t = useT();
  const { theme } = useLook();
  const { myId } = useAuth();
  const rows = useChatList();
  const typing = useAllTyping();
  const connected = useConnected();
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [pickMenu, setPickMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selecting = picked.size > 0;

  // The first time on this phone, a quick "what should people call you?".
  useEffect(() => {
    if (myId && !KV.getItemSync(`welcomed:${myId}`)) router.push('/profile');
  }, [myId]);

  // Back cancels picking, instead of leaving the app.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicked(new Set());
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  const visible = useMemo(() => {
    const live = (rows ?? []).filter((r) => !r.prefs.archived);
    if (filter === 'unread') return live.filter((r) => r.chat.unread > 0 || r.prefs.markedUnread);
    if (filter === 'favourites') return live.filter((r) => r.prefs.favourite);
    if (filter === 'groups') return live.filter((r) => r.chat.kind === 'group');
    return live;
  }, [rows, filter]);

  const archivedCount = (rows ?? []).filter((r) => r.prefs.archived).length;
  const unreadCount = (rows ?? []).filter((r) => !r.prefs.archived && (r.chat.unread > 0 || r.prefs.markedUnread)).length;

  // Online dots for the people in the first chats on screen.
  const others = useMemo(
    () =>
      visible
        .slice(0, 25)
        .map((r) => r.other)
        .filter((id): id is string => !!id && id !== myId),
    [visible, myId],
  );
  const othersKey = others.join(',');
  useEffect(() => {
    const ids = othersKey ? othersKey.split(',') : [];
    ids.forEach((id) => core.watch(id));
    return () => ids.forEach((id) => core.unwatch(id));
  }, [othersKey]);

  const togglePick = useCallback((id: string) => {
    tick();
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);


  const pickedRows = (rows ?? []).filter((r) => picked.has(r.chat.id));
  const allPinned = pickedRows.length > 0 && pickedRows.every((r) => r.prefs.pinnedAt);
  const allMuted = pickedRows.length > 0 && pickedRows.every((r) => r.prefs.muted);
  const allFav = pickedRows.length > 0 && pickedRows.every((r) => r.prefs.favourite);
  const anyUnread = pickedRows.some((r) => r.chat.unread > 0 || r.prefs.markedUnread);

  function forPicked(fn: (r: Row) => void) {
    pickedRows.forEach(fn);
    setPicked(new Set());
    setPickMenu(false);
  }

  const header = selecting ? (
    <Animated.View key="picking" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ marginHorizontal: 10, marginTop: 10 }}>
      <LinearGradient
        colors={theme.grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 22, boxShadow: `0 14px 30px -14px ${theme.acc}` }}
      >
        <IconButton icon="close" label={t.cancelSelection} look="onAccent" onPress={() => setPicked(new Set())} testID="cancel-pick" />
        <View style={{ flex: 1, paddingHorizontal: 4 }}>
          <Txt size={18} weight="700" color="#FFFFFF">
            {fill(t.selected, { n: picked.size })}
          </Txt>
        </View>
        <IconButton icon="pin" label={allPinned ? t.unpinChat : t.pinChat} look="onAccent" onPress={() => forPicked((r) => pinAll(r, !allPinned))} />
        <IconButton icon="muted" label={allMuted ? t.unmute : t.mute} look="onAccent" onPress={() => forPicked((r) => core.setPrefs(r.chat.id, { muted: !allMuted }))} />
        <IconButton icon="archive" label={t.archive} look="onAccent" onPress={() => forPicked((r) => core.setPrefs(r.chat.id, { archived: true, pinnedAt: undefined }))} testID="archive-picked" />
        <IconButton icon="trash" label={t.delete} look="onAccent" onPress={() => setConfirmDelete(true)} />
        <IconButton icon="more" label={t.moreOptions} look="onAccent" onPress={() => setPickMenu(true)} />
      </LinearGradient>
    </Animated.View>
  ) : (
    <Animated.View key="title" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingStart: 20, paddingEnd: 14 }}>
      <View style={{ flex: 1 }}>
        <Txt size={27} weight="800" style={{ letterSpacing: -0.9 }}>
          {t.appName}
        </Txt>
      </View>
      <IconButton icon="camera" label={t.camera} look="glass" onPress={() => toast(t.comingSoon)} />
      <IconButton icon="more" label={t.moreOptions} look="glass" onPress={() => setMenu(true)} testID="chats-menu" />
    </Animated.View>
  );

  return (
    <Screen bottom={false}>
      <View style={{ minHeight: selecting ? 66 : 62 }}>{header}</View>

      <Pressy onPress={() => router.push('/search')} label={t.search} scale={0.98} testID="open-search">
        <Glass style={{ marginHorizontal: 14, marginTop: 16, height: 46, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
          <Icon name="search" size={19} color={theme.muted} />
          <Txt size={15} color={theme.muted}>
            {t.searchHint}
          </Txt>
        </Glass>
      </Pressy>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
        <Chip label={t.all} on={filter === 'all'} onPress={() => setFilter('all')} testID="filter-all" />
        <Chip label={t.unread} on={filter === 'unread'} onPress={() => setFilter('unread')} count={unreadCount} testID="filter-unread" />
        <Chip label={t.favourites} on={filter === 'favourites'} onPress={() => setFilter('favourites')} testID="filter-favourites" />
        <Chip label={t.groups} on={filter === 'groups'} onPress={() => setFilter('groups')} testID="filter-groups" />
      </View>

      {!connected && (
        <Animated.View entering={FadeInDown.springify().damping(20)} exiting={FadeOut} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginBottom: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.faint }} />
          <Txt size={12.5} weight="500" color={theme.muted} testID="connecting">
            {t.connecting}
          </Txt>
        </Animated.View>
      )}

      <View
        style={{
          flex: 1,
          marginHorizontal: 10,
          padding: 6,
          paddingBottom: 0,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          backgroundColor: theme.dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.78)',
          borderWidth: 1,
          borderBottomWidth: 0,
          borderColor: theme.glassLine,
          boxShadow: theme.dark ? undefined : `0 10px 30px -18px ${theme.shadow}`,
          overflow: 'hidden',
        }}
      >
        <Animated.FlatList
          data={visible}
          keyExtractor={(r) => r.chat.id}
          itemLayoutAnimation={listLayout}
          contentContainerStyle={{ paddingBottom: 96 }}
          ListHeaderComponent={
            archivedCount > 0 && filter === 'all' ? (
              <Pressy onPress={() => router.push('/archived')} label={t.archived} scale={0.98} testID="open-archived">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, height: 52 }}>
                  <View style={{ width: 50, alignItems: 'center' }}>
                    <Icon name="archive" size={22} color={theme.accInk} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight="600">
                      {t.archived}
                    </Txt>
                  </View>
                  <Txt size={13} weight="600" color={theme.accInk}>
                    {archivedCount}
                  </Txt>
                </View>
              </Pressy>
            ) : undefined
          }
          ListEmptyComponent={
            rows === null ? undefined : (
              <Empty icon={filter === 'unread' ? 'check' : 'chat'} text={filter === 'unread' ? t.noUnread : rows.length ? t.nothingHere : t.noChats} />
            )
          }
          ListFooterComponent={
            visible.length > 0 && visible.length < 4 && !selecting ? (
              <Animated.View entering={FadeIn.delay(400)}>
                <Txt size={12.5} color={theme.muted} align="center" style={{ marginTop: 18, paddingHorizontal: 30 }}>
                  {t.swipeHint}
                </Txt>
              </Animated.View>
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={rows && index < 12 ? FadeInDown.delay(index * 28).springify().damping(22) : undefined} exiting={FadeOut.duration(160)}>
              <ChatRow
                row={item}
                typing={Object.keys(typing[item.chat.id] ?? {}).filter((id) => id !== myId)}
                online={!!(item.other && core.presence[item.other]?.online)}
                selecting={selecting}
                selected={picked.has(item.chat.id)}
                onPress={() => (selecting ? togglePick(item.chat.id) : router.push({ pathname: '/chat/[id]', params: { id: item.chat.id } }))}
                onLongPress={() => {
                  thud();
                  togglePick(item.chat.id);
                }}
                onPin={() => pin(item)}
                onArchive={() => archive(item, t)}
              />
            </Animated.View>
          )}
        />
      </View>

      {!selecting && <Fab icon="newChat" label={t.newChat} onPress={() => router.push('/new-chat')} testID="new-chat" bottom={20} />}

      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem icon="group" label={t.newGroup} onPress={() => (setMenu(false), router.push('/new-group'))} testID="menu-new-group" />
        <MenuItem icon="archive" label={t.archived} onPress={() => (setMenu(false), router.push('/archived'))} />
        <MenuItem icon="star" label={t.starred} onPress={() => (setMenu(false), router.push('/starred'))} />
        <MenuItem icon="select" label={t.selectChats} onPress={() => (setMenu(false), visible[0] && togglePick(visible[0].chat.id))} />
        <MenuItem icon="unread" label={t.markAllRead} onPress={() => (setMenu(false), (rows ?? []).forEach((r) => markRead(r)))} />
        <MenuItem icon="palette" label={t.settings} onPress={() => (setMenu(false), router.navigate('/you'))} />
      </Popup>

      <Popup visible={pickMenu} onClose={() => setPickMenu(false)} top={70}>
        <MenuItem
          icon="unread"
          label={anyUnread ? t.markRead : t.markUnread}
          onPress={() => forPicked((r) => (anyUnread ? markRead(r) : core.setPrefs(r.chat.id, { markedUnread: true })))}
        />
        <MenuItem icon="heart" label={allFav ? t.removeFavourite : t.addFavourite} onPress={() => forPicked((r) => core.setPrefs(r.chat.id, { favourite: !allFav }))} />
        <MenuItem
          icon="select"
          label={t.selectAll}
          onPress={() => {
            setPicked(new Set(visible.map((r) => r.chat.id)));
            setPickMenu(false);
          }}
        />
      </Popup>

      <Dialog
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={fill(t.deleteChats, { n: picked.size })}
        text={t.deleteChatsNote}
        buttons={[
          {
            label: t.delete,
            danger: true,
            testID: 'confirm-delete-chats',
            onPress: () => {
              setConfirmDelete(false);
              forPicked((r) => void core.deleteChatHere(r.chat.id));
            },
          },
          { label: t.cancel, onPress: () => setConfirmDelete(false) },
        ]}
      />
    </Screen>
  );
}

function pin(r: Row) {
  core.setPrefs(r.chat.id, { pinnedAt: r.prefs.pinnedAt ? undefined : Date.now() });
}

function pinAll(r: Row, on: boolean) {
  core.setPrefs(r.chat.id, { pinnedAt: on ? (r.prefs.pinnedAt ?? Date.now()) : undefined });
}

function archive(r: Row, t: Strings) {
  core.setPrefs(r.chat.id, { archived: !r.prefs.archived, pinnedAt: undefined });
  toast(r.prefs.archived ? t.unarchived : t.archivedNote);
}

function markRead(r: Row) {
  core.setPrefs(r.chat.id, { markedUnread: false });
  if (r.chat.unread > 0) void core.client.markRead(r.chat.id).catch(() => {});
}
