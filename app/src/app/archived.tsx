// archived.tsx: chats you archived, like WhatsApp's Archived. A note at the
// top says whether they stay here when someone writes ("Keep chats
// archived", also in ⋮ and Settings › Chats); tap it to change. Swipe one to
// bring it back; hold one to pick several, then Unarchive, Mute or Delete
// them from the bar at the top (Unarchive has Undo), like the main list.
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, FlatList, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { core } from '../core/core';
import { useAllTyping, useChatList, useSettings, type ChatRow as Row } from '../core/hooks';
import { fill, useT, type Strings } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { MuteSheet } from '../ui/MuteSheet';
import { DeleteChats } from '../ui/DeleteChats';
import { PhotoPeek } from '../ui/PhotoPeek';
import { ChatRow } from '../ui/ChatRow';
import { Empty, IconButton, Pressy, Screen, SettingRow, Toggle, TopBar, Txt } from '../ui/kit';
import { Dialog, MenuItem, Popup, Sheet, toast } from '../ui/overlays';
import { tick } from '../ui/motion';

export default function Archived() {
  const t = useT();
  const { theme } = useLook();
  const all = useChatList();
  const settings = useSettings();
  const rows = (all ?? []).filter((r) => r.prefs.archived);
  const typing = useAllTyping();
  const [menu, setMenu] = useState(false);
  const [options, setOptions] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickMenu, setPickMenu] = useState(false);
  const [muting, setMuting] = useState(false);
  const [chatAction, setChatAction] = useState<'delete' | 'clear' | null>(null);
  const [peek, setPeek] = useState<Row | null>(null);
  const selecting = picked.size > 0;

  // Back cancels picking, instead of leaving.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicked(new Set());
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  function togglePick(id: string) {
    tick();
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pickedRows = rows.filter((r) => picked.has(r.chat.id));
  const allMuted = pickedRows.length > 0 && pickedRows.every((r) => r.prefs.muted);
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
          <Txt size={18} weight="700" color="#FFFFFF" testID="archived-picked-count">
            {fill(t.selected, { n: picked.size })}
          </Txt>
        </View>
        <IconButton icon="archive" label={t.unarchive} look="onAccent" onPress={() => (unarchive(pickedRows, t), setPicked(new Set()))} testID="unarchive-picked" />
        <IconButton icon="muted" label={allMuted ? t.unmute : t.mute} look="onAccent" onPress={() => (allMuted ? forPicked((r) => core.unmute(r.chat.id)) : setMuting(true))} />
        <IconButton icon="trash" label={t.delete} look="onAccent" onPress={() => setChatAction('delete')} />
        <IconButton icon="more" label={t.moreOptions} look="onAccent" onPress={() => setPickMenu(true)} />
      </LinearGradient>
    </Animated.View>
  ) : (
    <TopBar key="title" title={t.archived} onBack={() => router.back()} right={<IconButton icon="more" label={t.moreOptions} onPress={() => setMenu(true)} testID="archived-menu" />} />
  );

  return (
    <Screen>
      <View style={{ minHeight: 62 }}>{header}</View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.chat.id}
        extraData={[picked, typing]}
        contentContainerStyle={{ padding: 10 }}
        ListHeaderComponent={
          <Pressy onPress={() => setOptions(true)} label={t.archiveSettings} scale={0.98} testID="archived-note">
            <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
              <Txt size={13} color={theme.muted} align="center">
                {settings.keepArchived ? t.archivedStayNote : t.archivedLeaveNote}
              </Txt>
            </View>
          </Pressy>
        }
        ListEmptyComponent={all ? <Empty icon="archive" text={t.noArchived} /> : undefined}
        renderItem={({ item, index }) => (
          <Animated.View exiting={FadeOut} style={{ marginBottom: 4 }}>
            <ChatRow
              row={item}
              typing={Object.keys(typing[item.chat.id] ?? {}).filter((id) => id !== core.myId)}
              online={false}
              selecting={selecting}
              selected={picked.has(item.chat.id)}
              onPress={() => (selecting ? togglePick(item.chat.id) : router.push({ pathname: '/chat/[id]', params: { id: item.chat.id } }))}
              onLongPress={() => togglePick(item.chat.id)}
              onPin={() => unarchive(item, t)}
              onArchive={() => unarchive(item, t)}
              onAvatar={item.prefs.lock ? undefined : () => setPeek(item)}
            />
          </Animated.View>
        )}
      />

      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem icon="select" label={t.selectChats} onPress={() => (setMenu(false), rows[0] && togglePick(rows[0].chat.id))} />
        <MenuItem icon="settings" label={t.archiveSettings} onPress={() => (setMenu(false), setOptions(true))} testID="archived-settings" />
      </Popup>
      <Popup visible={pickMenu} onClose={() => setPickMenu(false)} top={70}>
        <MenuItem icon="unread" label={anyUnread ? t.markRead : t.markUnread} onPress={() => forPicked((r) => (anyUnread ? markRead(r) : core.setPrefs(r.chat.id, { markedUnread: true })))} />
        <MenuItem
          icon="select"
          label={t.selectAll}
          onPress={() => {
            setPicked(new Set(rows.map((r) => r.chat.id)));
            setPickMenu(false);
          }}
        />
        <MenuItem icon="trash" label={t.clearChat} onPress={() => (setPickMenu(false), setChatAction('clear'))} testID="clear-picked" />
      </Popup>
      <Sheet visible={options} onClose={() => setOptions(false)} title={t.archiveSettings}>
        <SettingRow
          title={t.keepArchived}
          sub={t.keepArchivedSub}
          chevron={false}
          right={<Toggle on={settings.keepArchived} onChange={(on) => core.setSettings({ keepArchived: on })} label={t.keepArchived} testID="archived-keep" />}
        />
      </Sheet>
      <DeleteChats
        rows={pickedRows}
        mode={chatAction}
        onClose={(done) => {
          setChatAction(null);
          if (done) setPicked(new Set());
        }}
      />
      <PhotoPeek row={peek} onClose={() => setPeek(null)} />
      <MuteSheet visible={muting} onClose={() => setMuting(false)} onPick={(ms) => forPicked((r) => core.mute(r.chat.id, ms))} />
    </Screen>
  );
}

/** Brings chats back to the main list, with Undo. */
function unarchive(r: Row | Row[], t: Strings) {
  const list = Array.isArray(r) ? r : [r];
  if (!list.length) return;
  list.forEach((x) => core.setPrefs(x.chat.id, { archived: false }));
  toast(list.length > 1 ? fill(t.chatsUnarchived, { n: list.length }) : t.unarchived, {
    label: t.undoWord,
    onPress: () => list.forEach((x) => core.setPrefs(x.chat.id, { archived: true, pinnedAt: undefined })),
    testID: 'undo-unarchive',
  });
}

function markRead(r: Row) {
  core.setPrefs(r.chat.id, { markedUnread: false });
  if (r.chat.unread > 0) void core.client.markRead(r.chat.id).catch(() => {});
}
