// (tabs)/index.tsx: the chat list, PakChat's home.
//
// Everything here comes from the phone's database first (useChatList), so it
// shows instantly, even with no internet. Hold a chat to pick several (then pin,
// archive, …); swiping sideways goes to the next tab, like WhatsApp.
import KV from 'expo-sqlite/kv-store';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { findBackup } from '../../core/backup';
import { handOffMedia, type Picked } from '../../core/files';
import { chatOpen, FOLDER, leftFolder, unlockChat } from '../../core/lock';
import { core } from '../../core/core';
import { useAllPresence, useAllTyping, useAuth, useChatList, useCommunities, useConnected, useCore, useLists, useSettings, warmChats, type ChatRow as Row } from '../../core/hooks';
import { fill, useT, type Strings } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { AlertsCard } from '../../ui/AlertsCard';
import { ChatRow } from '../../ui/ChatRow';
import { fromGallery } from '../../ui/chat/attachments';
import { MuteSheet } from '../../ui/MuteSheet';
import { DeleteChats } from '../../ui/DeleteChats';
import { PhotoPeek } from '../../ui/PhotoPeek';
import { CameraSheet } from '../../ui/chat/CameraSheet';
import { Icon } from '../../ui/icons';
import { Chip, Empty, Fab, Glass, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { listLayout, rise, thud, tick } from '../../ui/motion';
import { Dialog, MenuItem, Popup, toast } from '../../ui/overlays';
import { AddToListSheet } from '../../ui/AddToListSheet';
import { ChatLockSheet } from '../../ui/ChatLockSheet';

// The chips above the chats. `list:<id>` is one of your own lists.
type Filter = 'all' | 'unread' | 'favourites' | 'groups' | `list:${string}`;

/** A chat in the list, or the name of a community over its groups. */
type Item = { kind: 'row'; row: Row } | { kind: 'community'; id: string; title: string };

/** The "Locked chats" row's height: the list starts scrolled down this much, hiding it. */
const LOCKED_ROW = 52;

export default function Chats() {
  const t = useT();
  const { theme } = useLook();
  const { myId } = useAuth();
  const rows = useChatList();
  const lists = useLists();
  const typing = useAllTyping();
  const presence = useAllPresence();
  const connected = useConnected();
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [pickMenu, setPickMenu] = useState(false);
  const [muting, setMuting] = useState(false);
  const [chatAction, setChatAction] = useState<'delete' | 'clear' | null>(null);
  const [peek, setPeek] = useState<Row | null>(null);
  // The list whose chip you held down (for Edit / Delete), and the one being deleted.
  const [heldList, setHeldList] = useState<string | null>(null);
  const [deletingList, setDeletingList] = useState<string | null>(null);
  const selecting = picked.size > 0;
  // The 📷 at the top: take a photo or video, then choose the chat (send-to.tsx).
  const [camera, setCamera] = useState(false);
  const sendTaken = (list: Picked[]) => {
    // Nothing picked in the gallery: back to the camera.
    if (!list.length) return;
    setCamera(false);
    handOffMedia(list);
    router.push('/send-to');
  };
  const settings = useSettings();
  const prefsAll = useCore(['prefs'], () => core.prefs);
  const lockedCount = Object.values(prefsAll).filter((p) => p.lock === 'folder').length;
  // "Locked chats" sits just above the first chat, scrolled out of sight, like
  // WhatsApp: pulling the list down slides it into view. The list is always at
  // least a row taller than the screen, so there's room to hide it.
  const lockedRow = lockedCount > 0 && !settings.lockedHidden && filter === 'all' && !selecting;
  const list = useRef<FlatList<Row>>(null);
  const [listHeight, setListHeight] = useState(0);
  const scrolled = useRef(0);
  // Only near the top: coming back to a list scrolled further down leaves it where it was.
  /**
   * A locked chat (or the Locked chats folder): the fingerprint is asked here,
   * on the list, and then it slides in like any chat.
   */
  async function openLocked(key: string, path?: '/locked') {
    if (!chatOpen(key)) {
      const r = await unlockChat(key, t.unlockChat, t.cancel);
      if (r === 'failed') toast(t.notRecognised);
      else if (r === 'wait') toast(t.waitABit);
      else if (r === 'unavailable') toast(t.biometricsGone);
      if (r !== 'ok') return;
    }
    if (path) router.push(path);
    else router.push({ pathname: '/chat/[id]', params: { id: key } });
  }

  const hideLocked = useCallback(() => {
    if (lockedRow && scrolled.current < LOCKED_ROW) requestAnimationFrame(() => list.current?.scrollToOffset({ offset: LOCKED_ROW, animated: false }));
  }, [lockedRow]);
  useFocusEffect(hideLocked);
  // Back on the list from Locked chats: the folder locks again, like WhatsApp's.
  useFocusEffect(useCallback(() => leftFolder(), []));
  useEffect(() => {
    if (listHeight) hideLocked();
  }, [listHeight, hideLocked]);

  // The first time on this phone, a quick "what should people call you?".
  // On a phone just signed in to, an offer to restore the chats from a backup comes first (on top).
  useEffect(() => {
    if (!myId) return;
    if (!KV.getItemSync(`welcomed:${myId}`)) router.push('/profile');
    if (KV.getItemSync(`offerRestore:${myId}`)) {
      void findBackup()
        .then((b) => (b ? router.push('/restore') : KV.removeItemSync(`offerRestore:${myId}`)))
        .catch(() => {});
    }
  }, [myId]);

  // The chats at the top are read ahead of time, so opening one is instant.
  const top = (rows ?? [])
    .slice(0, 8)
    .map((r) => r.chat.id)
    .join(',');
  useEffect(() => {
    if (!top) return;
    const wait = setTimeout(() => warmChats(top.split(',')), 600);
    return () => clearTimeout(wait);
  }, [top]);

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
    if (filter.startsWith('list:')) {
      const list = lists.find((l) => `list:${l.id}` === filter);
      return list ? live.filter((r) => list.chatIds.includes(r.chat.id)) : live;
    }
    return live;
  }, [rows, filter, lists]);

  // A community's groups sit together, under its name, where the newest of them
  // would be (like WhatsApp). A pinned group stays pinned on its own.
  const communities = useCommunities();
  const items = useMemo<Item[]>(() => {
    const names = new Map((communities ?? []).map((c) => [c.community.id, core.chatTitle(c.community)]));
    if ((filter !== 'all' && filter !== 'groups') || !names.size) return visible.map((row) => ({ kind: 'row', row }));
    const inOne = (r: Row) => !!r.chat.communityId && names.has(r.chat.communityId) && !r.prefs.pinnedAt;
    const out: Item[] = [];
    const done = new Set<string>();
    for (const r of visible) {
      if (!inOne(r)) {
        out.push({ kind: 'row', row: r });
        continue;
      }
      const id = r.chat.communityId!;
      if (done.has(id)) continue;
      done.add(id);
      out.push({ kind: 'community', id, title: names.get(id)! });
      for (const g of visible) if (inOne(g) && g.chat.communityId === id) out.push({ kind: 'row', row: g });
    }
    return out;
  }, [visible, communities, filter]);

  const archivedCount = (rows ?? []).filter((r) => r.prefs.archived).length;
  // Like WhatsApp: how many archived chats have something unread.
  const archivedUnread = (rows ?? []).filter((r) => r.prefs.archived && (r.chat.unread > 0 || r.prefs.markedUnread)).length;
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
  // One chat picked: its own things (View contact, Lock chat, Block), like WhatsApp's ⋮.
  const onePicked = pickedRows.length === 1 ? pickedRows[0] : null;
  const onePerson = onePicked?.chat.kind === 'direct' && onePicked.other && onePicked.other !== myId ? onePicked.other : null;
  const [listFor, setListFor] = useState<string[] | null>(null);
  const [lockFor, setLockFor] = useState<string | null>(null);
  const [blockFor, setBlockFor] = useState<string | null>(null);

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
        <IconButton icon="muted" label={allMuted ? t.unmute : t.mute} look="onAccent" onPress={() => (allMuted ? forPicked((r) => core.unmute(r.chat.id)) : setMuting(true))} />
        <IconButton icon="archive" label={t.archive} look="onAccent" onPress={() => (archive(pickedRows, t), setPicked(new Set()))} testID="archive-picked" />
        <IconButton icon="trash" label={t.delete} look="onAccent" onPress={() => setChatAction('delete')} />
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
      <IconButton icon="camera" label={t.camera} look="glass" onPress={() => setCamera(true)} testID="list-camera" />
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

      {/* The chips slide sideways when they don't all fit (big text, or Urdu),
          instead of the last one being cut off at the edge. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}
      >
        <Chip label={t.all} on={filter === 'all'} onPress={() => setFilter('all')} testID="filter-all" />
        <Chip label={t.unread} on={filter === 'unread'} onPress={() => setFilter('unread')} count={unreadCount} testID="filter-unread" />
        <Chip label={t.favourites} on={filter === 'favourites'} onPress={() => setFilter('favourites')} testID="filter-favourites" />
        <Chip label={t.groups} on={filter === 'groups'} onPress={() => setFilter('groups')} testID="filter-groups" />
        {lists.map((l) => (
          <Chip
            key={l.id}
            label={l.name}
            on={filter === `list:${l.id}`}
            onPress={() => setFilter(`list:${l.id}`)}
            onLongPress={() => {
              thud();
              setHeldList(l.id);
            }}
            testID={`filter-list-${l.name}`}
          />
        ))}
        {/* ＋ makes a new list, like WhatsApp's Lists. */}
        <Chip label={t.newList} icon="plus" on={false} onPress={() => router.push('/list')} testID="new-list" />
      </ScrollView>

      {!connected && (
        <Animated.View entering={rise()} exiting={FadeOut} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginBottom: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.faint }} />
          <Txt size={12.5} weight="500" color={theme.muted} testID="connecting">
            {t.connecting}
          </Txt>
        </Animated.View>
      )}

      {/* The chats run edge to edge, like WhatsApp, so they line up with the tab bar below. */}
      <View style={{ flex: 1, paddingHorizontal: 4 }}>
        <Animated.FlatList
          data={items}
          extraData={[picked, typing, presence]}
          keyExtractor={(it) => (it.kind === 'row' ? it.row.chat.id : `community-${it.id}`)}
          itemLayoutAnimation={listLayout}
          ref={list}
          onLayout={(e) => setListHeight(Math.round(e.nativeEvent.layout.height))}
          onScroll={(e) => {
            scrolled.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={64}
          contentContainerStyle={{ paddingBottom: 96, minHeight: lockedRow && listHeight ? listHeight + LOCKED_ROW : undefined }}
          ListHeaderComponent={
            <>
              {lockedRow && (
                <View>
                  <Pressy onPress={() => void openLocked(FOLDER, '/locked')} label={t.lockedChats} scale={0.98} testID="open-locked">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, height: LOCKED_ROW }}>
                      <View style={{ width: 50, alignItems: 'center' }}>
                        <Icon name="lock" size={22} color={theme.accInk} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt size={15.5} weight="600">
                          {t.lockedChats}
                        </Txt>
                      </View>
                      <Icon name="chevron" size={18} color={theme.faint} />
                    </View>
                  </Pressy>
                </View>
              )}
              {/* Realme, Xiaomi and the like: turn on Autostart, or alerts don't come. */}
              {filter === 'all' && !selecting && <AlertsCard />}
              {archivedCount > 0 && filter === 'all' ? (
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
                    {archivedUnread > 0 && (
                      <Txt size={13} weight="700" color={theme.acc} testID="archived-unread">
                        {archivedUnread}
                      </Txt>
                    )}
                  </View>
                </Pressy>
              ) : null}
            </>
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
          renderItem={({ item: it, index }) =>
            it.kind === 'community' ? (
              <Pressy onPress={() => router.push({ pathname: '/community/[id]', params: { id: it.id } })} label={it.title} scale={0.98} testID={`list-community-${it.title}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 }}>
                  <Icon name="community" size={16} color={theme.accInk} />
                  <Txt size={13} weight="700" color={theme.sectionText} lines={1} style={{ flexShrink: 1 }}>
                    {it.title}
                  </Txt>
                  <Icon name="chevron" size={14} color={theme.faint} flip />
                </View>
              </Pressy>
            ) : (
              <Animated.View exiting={FadeOut.duration(160)}>
                <ChatRow
                  row={it.row}
                  typing={Object.keys(typing[it.row.chat.id] ?? {}).filter((id) => id !== myId)}
                  online={!!(it.row.other && presence[it.row.other]?.online)}
                  selecting={selecting}
                  selected={picked.has(it.row.chat.id)}
                  onPress={() => (selecting ? togglePick(it.row.chat.id) : it.row.prefs.lock ? void openLocked(it.row.chat.id) : router.push({ pathname: '/chat/[id]', params: { id: it.row.chat.id } }))}
                  onLongPress={() => {
                    thud();
                    togglePick(it.row.chat.id);
                  }}
                  onAvatar={it.row.prefs.lock ? undefined : () => setPeek(it.row)}
                />
              </Animated.View>
            )
          }
        />
      </View>

      {!selecting && <Fab icon="newChat" label={t.newChat} onPress={() => router.push('/new-chat')} testID="new-chat" bottom={20} />}

      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem icon="group" label={t.newGroup} onPress={() => (setMenu(false), router.push('/new-group'))} testID="menu-new-group" />
        <MenuItem icon="community" label={t.newCommunity} onPress={() => (setMenu(false), router.push('/new-community'))} testID="menu-new-community" />
        <MenuItem icon="broadcast" label={t.broadcastLists} onPress={() => (setMenu(false), router.push('/broadcasts'))} testID="menu-broadcasts" />
        <MenuItem icon="archive" label={t.archived} onPress={() => (setMenu(false), router.push('/archived'))} />
        <MenuItem icon="star" label={t.starred} onPress={() => (setMenu(false), router.push('/starred'))} />
        <MenuItem icon="select" label={t.selectChats} onPress={() => (setMenu(false), visible[0] && togglePick(visible[0].chat.id))} />
        <MenuItem icon="unread" label={t.markAllRead} onPress={() => (setMenu(false), (rows ?? []).forEach((r) => markRead(r)))} />
        <MenuItem icon="settings" label={t.settings} onPress={() => (setMenu(false), router.push('/settings'))} testID="menu-settings" />
      </Popup>

      <Popup visible={pickMenu} onClose={() => setPickMenu(false)} top={70}>
        <MenuItem
          icon="unread"
          label={anyUnread ? t.markRead : t.markUnread}
          onPress={() => forPicked((r) => (anyUnread ? markRead(r) : core.setPrefs(r.chat.id, { markedUnread: true })))}
        />
        <MenuItem icon="heart" label={allFav ? t.removeFavourite : t.addFavourite} onPress={() => forPicked((r) => core.setPrefs(r.chat.id, { favourite: !allFav }))} />
        <MenuItem
          icon="text"
          label={t.addToList}
          onPress={() => {
            setListFor(pickedRows.map((r) => r.chat.id));
            setPicked(new Set());
            setPickMenu(false);
          }}
          testID="picked-add-to-list"
        />
        {onePerson && (
          <MenuItem
            icon="info"
            label={t.viewContact}
            onPress={() => {
              const id = onePicked!.chat.id;
              setPicked(new Set());
              setPickMenu(false);
              router.push({ pathname: '/info/[id]', params: { id } });
            }}
            testID="picked-view-contact"
          />
        )}
        {onePicked && !onePicked.chat.left && (
          <MenuItem
            icon="lock"
            label={t.lockChat}
            onPress={() => {
              setLockFor(onePicked.chat.id);
              setPicked(new Set());
              setPickMenu(false);
            }}
            testID="picked-lock"
          />
        )}
        {onePerson && (
          <MenuItem
            icon="flag"
            label={t.block}
            danger
            onPress={() => {
              setBlockFor(onePerson);
              setPicked(new Set());
              setPickMenu(false);
            }}
            testID="picked-block"
          />
        )}
        <MenuItem
          icon="select"
          label={t.selectAll}
          onPress={() => {
            setPicked(new Set(visible.map((r) => r.chat.id)));
            setPickMenu(false);
          }}
        />
        <MenuItem icon="trash" label={t.clearChat} onPress={() => (setPickMenu(false), setChatAction('clear'))} testID="clear-picked" />
      </Popup>

      <Popup visible={heldList !== null} onClose={() => setHeldList(null)} top={200}>
        <MenuItem
          icon="edit"
          label={t.editList}
          onPress={() => {
            const id = heldList;
            setHeldList(null);
            if (id) router.push({ pathname: '/list', params: { id } });
          }}
          testID="edit-list"
        />
        <MenuItem
          icon="trash"
          label={t.deleteList}
          danger
          onPress={() => {
            setDeletingList(heldList);
            setHeldList(null);
          }}
          testID="delete-list"
        />
      </Popup>

      <Dialog
        visible={deletingList !== null}
        onClose={() => setDeletingList(null)}
        title={t.deleteList}
        text={t.deleteListNote}
        buttons={[
          {
            label: t.delete,
            danger: true,
            testID: 'confirm-delete-list',
            onPress: () => {
              if (deletingList) core.deleteList(deletingList);
              if (filter === `list:${deletingList}`) setFilter('all');
              setDeletingList(null);
            },
          },
          { label: t.cancel, onPress: () => setDeletingList(null) },
        ]}
      />

      <DeleteChats
        rows={pickedRows}
        mode={chatAction}
        onClose={(done) => {
          setChatAction(null);
          if (done) setPicked(new Set());
        }}
      />
      <CameraSheet visible={camera} onClose={() => setCamera(false)} onTaken={sendTaken} onGallery={() => void fromGallery().then(sendTaken).catch(() => setCamera(false))} />
      <PhotoPeek row={peek} onClose={() => setPeek(null)} />
      <AddToListSheet visible={!!listFor} chatIds={listFor ?? []} onClose={() => setListFor(null)} />
      {lockFor && <ChatLockSheet visible chatId={lockFor} onClose={() => setLockFor(null)} />}
      <Dialog
        visible={!!blockFor}
        onClose={() => setBlockFor(null)}
        title={fill(t.blockName, { name: blockFor ? core.plainName(blockFor) : '' })}
        buttons={[
          {
            label: t.block,
            danger: true,
            testID: 'confirm-block-picked',
            onPress: () => {
              const who = blockFor;
              setBlockFor(null);
              if (who)
                void core
                  .block(who, true)
                  .then(() => toast(t.blocked))
                  .catch(() => toast(t.couldNot));
            },
          },
          { label: t.cancel, onPress: () => setBlockFor(null) },
        ]}
      />
      <MuteSheet visible={muting} onClose={() => setMuting(false)} onPick={(ms) => forPicked((r) => core.mute(r.chat.id, ms))} />
    </Screen>
  );
}

function pinAll(r: Row, on: boolean) {
  core.setPrefs(r.chat.id, { pinnedAt: on ? (r.prefs.pinnedAt ?? Date.now()) : undefined });
}

/** Archives (or brings back) chats, with Undo on the note, like WhatsApp. */
function archive(r: Row | Row[], t: Strings) {
  const list = Array.isArray(r) ? r : [r];
  if (!list.length) return;
  const back = !!list[0].prefs.archived;
  const was = list.map((x) => ({ id: x.chat.id, archived: x.prefs.archived, pinnedAt: x.prefs.pinnedAt }));
  list.forEach((x) => core.setPrefs(x.chat.id, { archived: !back, pinnedAt: undefined }));
  toast(back ? t.unarchived : list.length > 1 ? fill(t.chatsArchived, { n: list.length }) : t.archivedNote, {
    label: t.undoWord,
    onPress: () => was.forEach(({ id, ...prefs }) => core.setPrefs(id, prefs)),
    testID: 'undo-archive',
  });
}

function markRead(r: Row) {
  core.setPrefs(r.chat.id, { markedUnread: false });
  if (r.chat.unread > 0) void core.client.markRead(r.chat.id).catch(() => {});
}
