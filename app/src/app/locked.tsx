// locked.tsx: the Locked chats folder (Chat lock, WhatsApp's way). It opens
// with your fingerprint or face, or by the secret code typed in search when
// the folder is hidden. A chat opened from here doesn't ask again. The folder
// locks again once you leave it. A long press picks chats: Unlock (with your fingerprint
// again), Delete or Mute them, like WhatsApp.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { core } from '../core/core';
import { useAllPresence, useAllTyping, useCore, useLockedChats, useStable, type ChatRow as Row } from '../core/hooks';
import { authenticate, chatOpen, FOLDER, leftChat, openWith } from '../core/lock';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { ChatRow } from '../ui/ChatRow';
import { DeleteChats } from '../ui/DeleteChats';
import { Empty, IconButton, Screen, TopBar, Txt } from '../ui/kit';
import { LockedGate } from '../ui/LockedGate';
import { MuteSheet } from '../ui/MuteSheet';
import { toast } from '../ui/overlays';

export default function Locked() {
  const open = useCore(['lock'], () => chatOpen(FOLDER));
  useEffect(() => () => leftChat(FOLDER), []);
  if (!open) return <LockedGate chatId={FOLDER} />;
  return <Folder />;
}

function Folder() {
  const t = useT();
  const { theme } = useLook();
  const rows = useLockedChats();
  const typing = useAllTyping();
  const presence = useAllPresence();
  // A long press picks chats, like WhatsApp: then Unlock, Delete or Mute them.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [muting, setMuting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selecting = picked.size > 0;
  const toggle = (row: Row) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(row.chat.id)) next.delete(row.chat.id);
      else next.add(row.chat.id);
      return next;
    });
  const openRow = useStable((row: Row) => {
    if (selecting) return toggle(row);
    openWith(row.chat.id);
    router.push({ pathname: '/chat/[id]', params: { id: row.chat.id } });
  });
  const pickRow = useStable(toggle);
  const pickedRows = (rows ?? []).filter((r) => picked.has(r.chat.id));
  const allMuted = pickedRows.length > 0 && pickedRows.every((r) => r.prefs.muted);

  // Back stops picking first, instead of leaving the folder.
  useFocusEffect(
    useCallback(() => {
      if (!selecting) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setPicked(new Set());
        return true;
      });
      return () => sub.remove();
    }, [selecting]),
  );

  // Taking the lock off asks for your fingerprint or face again, as from the chat's info.
  async function unlock() {
    const r = await authenticate(t.confirmFingerprint, t.cancel);
    if (r === 'failed') return toast(t.notRecognised);
    if (r === 'wait') return toast(t.waitABit);
    if (r === 'unavailable') return toast(t.biometricsGone);
    if (r !== 'ok') return;
    pickedRows.forEach((row) => core.setPrefs(row.chat.id, { lock: undefined }));
    setPicked(new Set());
    toast(t.chatsUnlocked);
  }

  return (
    <Screen>
      {selecting ? (
        <View style={{ marginHorizontal: 10, marginTop: 10 }}>
          <LinearGradient colors={theme.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 22 }}>
            <IconButton icon="back" label={t.cancelSelection} look="onAccent" flip onPress={() => setPicked(new Set())} testID="locked-cancel-pick" />
            <View style={{ flex: 1, paddingHorizontal: 4 }}>
              <Txt size={18} weight="700" color="#FFFFFF">
                {fill(t.selected, { n: picked.size })}
              </Txt>
            </View>
            <IconButton icon="lock" label={t.unlockChats} look="onAccent" onPress={() => void unlock()} testID="locked-unlock" />
            <IconButton icon="trash" label={t.delete} look="onAccent" onPress={() => setDeleting(true)} testID="locked-delete" />
            <IconButton
              icon="muted"
              label={allMuted ? t.unmute : t.mute}
              look="onAccent"
              onPress={() => (allMuted ? (pickedRows.forEach((r) => core.unmute(r.chat.id)), setPicked(new Set())) : setMuting(true))}
              testID="locked-mute"
            />
          </LinearGradient>
        </View>
      ) : (
        <TopBar title={t.lockedChats} onBack={() => router.back()} />
      )}
      <Txt size={13} color={theme.muted} style={{ paddingHorizontal: 22, paddingVertical: 8 }}>
        {t.lockedChatsNote}
      </Txt>
      {/* A recycling list: rows that scroll away are reused for the ones coming in. */}
      <FlashList
        maintainVisibleContentPosition={{ disabled: true }}
        data={rows ?? []}
        extraData={picked}
        keyExtractor={(r) => r.chat.id}
        contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 40 }}
        ListEmptyComponent={rows ? <Empty icon="lock" text={t.noLockedChats} /> : undefined}
        renderItem={({ item }) => (
          <ChatRow
            row={item}
            typing={Object.keys(typing[item.chat.id] ?? {}).filter((id) => id !== core.myId)}
            online={!!(item.other && presence[item.other]?.online)}
            selecting={selecting}
            selected={picked.has(item.chat.id)}
            onPress={openRow}
            onLongPress={pickRow}
          />
        )}
      />
      <MuteSheet
        visible={muting}
        onClose={() => setMuting(false)}
        onPick={(ms) => {
          pickedRows.forEach((r) => core.mute(r.chat.id, ms));
          setPicked(new Set());
        }}
      />
      <DeleteChats
        rows={pickedRows}
        mode={deleting ? 'delete' : null}
        onClose={(done) => {
          setDeleting(false);
          if (done) setPicked(new Set());
        }}
      />
    </Screen>
  );
}
