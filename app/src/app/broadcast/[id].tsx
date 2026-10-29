// broadcast/[id].tsx: one broadcast list. What I sent to it, each with how many
// have read it ("12 of 20 read"; tap it to see who), and a box to send more:
// words, or photos, videos and files (the editor opens first, as in a chat).
// Hold a message for Info, Copy, Edit (words, for 15 minutes) and Delete: for
// everyone takes back every copy, like WhatsApp; for me only clears it here.
import { EDIT_MINUTES, UNSEND_HOURS, type Message } from '@pakchat/shared';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { dropBroadcast, editBroadcast, forgetBroadcastSent, sendBroadcastFiles, sendBroadcastText, unsendBroadcast } from '../../core/broadcasts';
import { core, isOffline } from '../../core/core';
import { loadLimits, TooBig, type Picked } from '../../core/files';
import { useBroadcast, useBroadcastSent, usePeople } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { fromGallery } from '../../ui/chat/attachments';
import { MediaComposer, type Ready } from '../../ui/chat/MediaComposer';
import { bodyLine, clock, fileSize } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, TopBar, Txt } from '../../ui/kit';
import { Dialog, MenuItem, Popup, Sheet, toast } from '../../ui/overlays';

type Item = ReturnType<typeof useBroadcastSent>[number];

export default function BroadcastPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const list = useBroadcast(id);
  const sent = useBroadcastSent(id);
  usePeople();
  const [text, setText] = useState('');
  const [outgoing, setOutgoing] = useState<Picked[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [looking, setLooking] = useState<Item | null>(null);
  const [held, setHeld] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editText, setEditText] = useState('');
  const [removing, setRemoving] = useState<Item | null>(null);
  const [now] = useState(() => Date.now());
  const listRef = useRef<FlatList<Item>>(null);

  if (list === undefined) return <Screen>{null}</Screen>;
  if (!list) {
    return (
      <Screen>
        <TopBar title={t.broadcastLists} onBack={() => router.back()} />
      </Screen>
    );
  }
  const title = list.name || fill(t.nRecipients, { n: list.members.length });

  async function choose(): Promise<Picked[]> {
    try {
      const picked = await fromGallery();
      const limit = await loadLimits();
      const ok = picked.filter((p) => !p.size || p.size <= limit || (p.kind === 'video' && !p.gif));
      if (ok.length < picked.length) toast(fill(t.fileTooBig, { mb: Math.floor(limit / 1024 / 1024) }));
      return ok;
    } catch {
      toast(t.couldNot);
      return [];
    }
  }

  function sendText() {
    const words = text.trim();
    if (!words) return;
    setText('');
    void sendBroadcastText(id, words)
      .then(() => setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 200))
      .catch((err: unknown) => toast(isOffline(err) ? t.offline : t.couldNot));
  }

  function sendFiles(items: Ready[]) {
    setOutgoing(null);
    if (items.some((p) => p.kind === 'video' && !p.gif && !p.hd)) toast(t.videoGettingReady);
    void sendBroadcastFiles(id, items).catch((err: unknown) =>
      toast(err instanceof TooBig ? fill(t.fileTooBig, { mb: Math.floor(Number(err.message) / 1024 / 1024) }) : isOffline(err) ? t.offline : t.couldNot),
    );
  }

  return (
    <Screen>
      <TopBar
        title={title}
        subtitle={fill(t.nRecipients, { n: list.members.length })}
        onBack={() => router.back()}
        right={<IconButton icon="more" label={t.moreOptions} onPress={() => setMenu(true)} testID="broadcast-menu" />}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={sent}
          keyExtractor={(s) => s.sent.id}
          contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1, justifyContent: sent.length ? 'flex-end' : 'center' }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Txt size={14} color={theme.muted} align="center" style={{ paddingHorizontal: 30 }}>
              {fill(t.broadcastEmpty, { names: list.members.map((m) => core.name(m) || '…').join(', ') })}
            </Txt>
          }
          renderItem={({ item, index }) => (
            <View>
              <Sent item={item} onPress={() => setLooking(item)} onLongPress={() => setHeld(item)} />
            </View>
          )}
        />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8 }}>
          <Glass style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 25, minHeight: 50, paddingHorizontal: 6 }}>
            <IconButton icon="attach" label={t.attachFile} onPress={() => void choose().then((ok) => ok.length && setOutgoing(ok))} color={theme.muted} testID="broadcast-attach" />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t.message}
              placeholderTextColor={theme.muted}
              selectionColor={theme.acc}
              cursorColor={theme.acc}
              multiline
              maxLength={4000}
              style={{ flex: 1, color: theme.text, fontSize: 16, paddingVertical: 13, paddingHorizontal: 4, maxHeight: 140 }}
              testID="broadcast-text"
            />
          </Glass>
          <Pressy onPress={sendText} label={t.send} scale={0.9} disabled={!text.trim()} testID="broadcast-send">
            <LinearGradient
              colors={theme.grad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', opacity: text.trim() ? 1 : 0.5 }}
            >
              <Icon name="send" size={21} color="#FFFFFF" />
            </LinearGradient>
          </Pressy>
        </View>
      </KeyboardAvoidingView>

      {outgoing && <MediaComposer items={outgoing} to={title} onClose={() => setOutgoing(null)} onMore={choose} onSend={sendFiles} />}

      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem icon="edit" label={t.editBroadcast} onPress={() => (setMenu(false), router.push({ pathname: '/broadcast-edit', params: { id } }))} testID="broadcast-edit" />
        <MenuItem icon="trash" label={t.deleteBroadcast} onPress={() => (setMenu(false), setDeleting(true))} testID="broadcast-delete" />
      </Popup>
      <Dialog
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={t.deleteBroadcast}
        text={t.deleteBroadcastNote}
        buttons={[
          {
            label: t.delete,
            danger: true,
            testID: 'broadcast-delete-yes',
            onPress: () => {
              setDeleting(false);
              void dropBroadcast(id).then(() => router.back());
            },
          },
          { label: t.cancel, onPress: () => setDeleting(false) },
        ]}
      />
      {/* Holding a sent message, like WhatsApp's. */}
      <Popup visible={!!held} onClose={() => setHeld(null)} top={200}>
        {held && (
          <>
            <MenuItem icon="info" label={t.info} onPress={() => (setLooking(held), setHeld(null))} />
            {!!held.message?.text && !held.message.deleted && (
              <MenuItem
                icon="copy"
                label={t.copy}
                onPress={() => {
                  void Clipboard.setStringAsync(held.message?.text ?? '').then(() => toast(t.copied));
                  setHeld(null);
                }}
              />
            )}
            {mayEdit(held, now) && (
              <MenuItem icon="edit" label={t.edit} onPress={() => (setEditText(held.message?.text ?? ''), setEditing(held), setHeld(null))} testID="broadcast-sent-edit" />
            )}
            <MenuItem icon="trash" label={t.delete} danger onPress={() => (setRemoving(held), setHeld(null))} testID="broadcast-sent-delete" />
          </>
        )}
      </Popup>
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={t.edit}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Field value={editText} onChangeText={setEditText} placeholder={t.message} multiline maxLength={4000} autoFocus testID="broadcast-edit-field" />
          <Button
            title={t.save}
            disabled={!editText.trim() || editText.trim() === editing?.message?.text}
            onPress={() => {
              const it = editing;
              setEditing(null);
              if (it) void editBroadcast(it.sent, editText).catch((err: unknown) => toast(isOffline(err) ? t.offline : t.couldNot));
            }}
            testID="broadcast-edit-save"
          />
        </View>
      </Sheet>
      <Dialog
        visible={!!removing}
        onClose={() => setRemoving(null)}
        title={t.deleteOneMessage}
        buttons={[
          ...(removing && mayUnsend(removing, now)
            ? [
                {
                  label: t.deleteForEveryone,
                  danger: true,
                  testID: 'broadcast-delete-everyone',
                  onPress: () => {
                    const it = removing;
                    setRemoving(null);
                    void unsendBroadcast(it.sent).catch((err: unknown) => toast(isOffline(err) ? t.offline : t.couldNot));
                  },
                },
              ]
            : []),
          {
            label: t.deleteForMe,
            danger: true,
            testID: 'broadcast-delete-me',
            onPress: () => {
              const it = removing;
              setRemoving(null);
              if (it) void forgetBroadcastSent(it.sent);
            },
          },
          { label: t.cancel, onPress: () => setRemoving(null) },
        ]}
      />
      <Sheet visible={!!looking} onClose={() => setLooking(null)} title={looking ? fill(t.readOf, { n: looking.read, total: looking.total }) : ''}>
        <View style={{ paddingHorizontal: 12 }}>
          {(looking?.who ?? []).map((w, i) => (
            <View key={w.userId}>
              {i > 0 && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 9 }}>
                <Avatar id={w.userId} name={core.name(w.userId)} size={38} />
                <Txt size={15} weight="600" style={{ flex: 1 }} lines={1}>
                  {core.name(w.userId) || '…'}
                </Txt>
                <Txt size={12.5} color={w.status === 'read' ? theme.accInk : theme.muted}>
                  {w.status === 'read' ? t.readWord : w.status === 'delivered' ? t.deliveredWord : w.status === 'gone' ? t.deletedWord : w.status === 'failed' ? t.notSent : t.sentWord}
                </Txt>
              </View>
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

/** Words I sent can be changed for 15 minutes, as in a chat. */
function mayEdit(it: Item, now: number) {
  const m = it.message;
  return !!m && m.kind === 'text' && !m.deleted && now - it.sent.at < EDIT_MINUTES * 60_000;
}

/** Delete for everyone: while it's not too old (as in a chat), and some copy is still there. */
function mayUnsend(it: Item, now: number) {
  return now - it.sent.at < UNSEND_HOURS * 3_600_000 && it.who.some((w) => w.status !== 'gone');
}

/** One message I sent to the list: like my own bubble, with its read count under it. */
function Sent({ item, onPress, onLongPress }: { item: Item; onPress: () => void; onLongPress: () => void }) {
  const t = useT();
  const { theme } = useLook();
  // Deleted for everyone: shown as deleted, like in a chat.
  const m: Message | null = item.message && !item.message.deleted ? item.message : null;
  const f = m?.file;
  const picture = f && (f.kind === 'image' || f.kind === 'video' || f.kind === 'sticker') ? (f.kind === 'image' || f.kind === 'sticker' ? f.local : f.poster) : undefined;
  const allRead = item.total > 0 && item.read === item.total;
  return (
    <Pressy onPress={onPress} onLongPress={onLongPress} label={fill(t.readOf, { n: item.read, total: item.total })} scale={0.98} testID="broadcast-sent" style={{ alignSelf: 'flex-end', maxWidth: '82%' }}>
      <LinearGradient colors={theme.bubbleMine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 20, borderBottomEndRadius: 6, padding: 6, gap: 4 }}>
        {picture ? (
          <Image source={{ uri: picture }} style={{ width: 220, height: 220 * (f?.height && f.width ? Math.min(1.3, f.height / f.width) : 0.75), borderRadius: 14 }} contentFit="cover" />
        ) : f ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6 }}>
            <Icon name={f.kind === 'voice' || f.kind === 'audio' ? 'music' : 'doc'} size={20} color={theme.bubbleMineText} />
            <Txt size={14} weight="600" color={theme.bubbleMineText} lines={1}>
              {f.name ?? bodyLine(m!, t)} · {fileSize(f.size)}
            </Txt>
          </View>
        ) : null}
        {!!m?.text && (
          <Txt size={15.5} color={theme.bubbleMineText} style={{ paddingHorizontal: 8, paddingTop: picture ? 2 : 4 }}>
            {m.text}
          </Txt>
        )}
        {!m && (
          <Txt size={14} color={theme.bubbleMineText} style={{ paddingHorizontal: 8, paddingTop: 4, fontStyle: 'italic' }}>
            {t.deleted}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, paddingHorizontal: 8, paddingBottom: 2 }}>
          <Txt size={11.5} color={theme.bubbleMineText} style={{ opacity: 0.8 }}>
            {m?.editedAt ? `${t.edited} · ` : ''}
            {fill(t.readOf, { n: item.read, total: item.total })} · {clock(item.sent.at)}
          </Txt>
          <Icon name={item.delivered ? 'ticks' : 'tick'} size={15} color={allRead ? '#7FE0FF' : theme.bubbleMineText} />
        </View>
      </LinearGradient>
    </Pressy>
  );
}
