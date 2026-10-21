// chat/[id].tsx: one chat.
//
// The messages come from the phone's database (useMessages) and new ones slide
// up from the bottom as they arrive. Hold a message to pick it (then reply,
// react, star, copy, edit, pin, forward or delete); swipe one to reply.
import type { Message, Ref } from '@pakchat/shared';
import { EDIT_MINUTES, UNSEND_HOURS, roleOf } from '@pakchat/shared';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, View, type ListViewToken } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedKeyboard, useAnimatedStyle, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core } from '../../core/core';
import { useChat, useMessages, useNow, usePeople, usePresence, useStarred, useTyping } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Bubble, DayLabel, TypingDots } from '../../ui/chat/Bubble';
import { Composer } from '../../ui/chat/Composer';
import { PollSheet } from '../../ui/chat/PollSheet';
import { dayLabel, lastSeen, sameDay, TIMERS, timerLabel } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Glass, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { thud, tick } from '../../ui/motion';
import { Dialog, MenuItem, Popup, Sheet, toast } from '../../ui/overlays';

type Item = { key: string; kind: 'msg'; m: Message; first: boolean } | { key: string; kind: 'day'; text: string } | { key: string; kind: 'typing' };

const keyOf = (m: Pick<Message, 'author' | 'id'>) => `${m.author}/${m.id}`;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const chat = useChat(id);
  const { list, more, hasMore } = useMessages(id);
  const typing = useTyping(id);
  const starred = useStarred();
  usePeople();
  const other = chat ? core.otherPerson(chat) : null;
  const presence = usePresence(other);

  const [picked, setPicked] = useState<Map<string, Message>>(new Map());
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menu, setMenu] = useState(false);
  const [pickMenu, setPickMenu] = useState(false);
  const [attach, setAttach] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const [timerOpen, setTimerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // When the newest messages were last on screen: anything from them after that is "unseen".
  const [bottomAt, setBottomAt] = useState(Date.now);
  // Only messages newer than opening the chat get the slide-in (not the ones already there).
  const [openedAt] = useState(Date.now);
  const now = useNow(15_000);
  const listRef = useRef<FlatList<Item>>(null);
  const focused = useRef(true);
  const selecting = picked.size > 0;

  // The keyboard pushes everything up, frame by frame, as it slides in.
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) }));

  // Reading the chat: blue ticks for them, and no more unread here.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      core.setPrefs(id, { markedUnread: false });
      return () => {
        focused.current = false;
      };
    }, [id]),
  );
  useEffect(() => {
    if (focused.current && chat && chat.unread > 0) void core.client.markRead(id).catch(() => {});
  }, [chat, id, list]);

  // Back first cancels picking, replying or editing.
  useEffect(() => {
    if (!selecting && !replyTo && !editing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicked(new Map());
      setReplyTo(null);
      setEditing(null);
      return true;
    });
    return () => sub.remove();
  }, [selecting, replyTo, editing]);

  const byKey = useMemo(() => new Map((list ?? []).map((m) => [keyOf(m), m])), [list]);

  // Newest first (the list is upside down, so the newest sits at the bottom), with day labels between days.
  const items = useMemo<Item[]>(() => {
    const ms = list ?? [];
    const out: Item[] = [];
    if (typing.length) out.push({ key: 'typing', kind: 'typing' });
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      const prev = ms[i - 1];
      const first = !prev || prev.author !== m.author || prev.kind === 'system' || !sameDay(prev.sentAt, m.sentAt) || m.sentAt - prev.sentAt > 5 * 60_000;
      out.push({ key: keyOf(m), kind: 'msg', m, first });
      if (!prev || !sameDay(prev.sentAt, m.sentAt)) out.push({ key: `day-${m.sentAt}`, kind: 'day', text: dayLabel(m.sentAt, t) });
    }
    return out;
  }, [list, typing.length, t]);

  const unseen = atBottom ? 0 : (list ?? []).filter((m) => m.kind !== 'system' && m.author !== core.myId && m.sentAt > bottomAt).length;

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const bottom = viewableItems.some((v) => v.index === 0 || v.index === 1);
    setAtBottom(bottom);
    if (bottom) setBottomAt(Date.now());
  }, []);

  const jumpTo = useCallback(
    (m: Pick<Message, 'author' | 'id'>) => {
      const index = items.findIndex((it) => it.key === keyOf(m));
      if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      else if (hasMore) more();
    },
    [items, hasMore, more],
  );

  // ---- Picking messages ----

  const toggle = useCallback((m: Message) => {
    tick();
    setPicked((old) => {
      const next = new Map(old);
      if (next.has(keyOf(m))) next.delete(keyOf(m));
      else next.set(keyOf(m), m);
      return next;
    });
  }, []);

  const onPress = useCallback((m: Message) => (picked.size ? toggle(m) : undefined), [picked.size, toggle]);
  const onLongPress = useCallback(
    (m: Message) => {
      if (m.kind === 'system') return;
      thud();
      toggle(m);
    },
    [toggle],
  );

  const pickedList = [...picked.values()];
  const one = pickedList.length === 1 ? pickedList[0] : null;
  const amAdmin = !!chat && chat.kind === 'group' && roleOf(chat, core.myId) === 'admin';
  const canEdit = !!one && one.author === core.myId && one.kind === 'text' && !one.deleted && now - one.sentAt < EDIT_MINUTES * 60_000;
  const canUnsend = pickedList.length > 0 && pickedList.every((m) => !m.deleted && m.seq !== null && (amAdmin || (m.author === core.myId && now - m.sentAt < UNSEND_HOURS * 3_600_000)));
  const allStarred = pickedList.length > 0 && pickedList.every((m) => core.isStarred(m));
  const done = () => {
    setPicked(new Map());
    setPickMenu(false);
  };

  const ref = (m: Message): Ref => ({ author: m.author, id: m.id });

  async function act(work: () => Promise<unknown>) {
    try {
      await work();
    } catch {
      toast(t.couldNot);
    }
  }

  function send(text: string, mentions: string[]) {
    if (editing) {
      const m = editing;
      setEditing(null);
      void act(() => core.client.edit(id, m.id, text, mentions.length ? mentions : undefined));
      return;
    }
    const reply = replyTo;
    setReplyTo(null);
    void act(() => core.client.sendText(id, text, { replyTo: reply ? ref(reply) : undefined, mentions }));
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

  const react = useCallback(
    (m: Message, emoji: string) => {
      const mine = m.reactions?.[core.myId];
      tick();
      void core.client.react(id, ref(m), mine === emoji ? null : emoji).catch(() => {});
      setPicked(new Map());
    },
    [id],
  );

  const vote = useCallback(
    (m: Message, option: number) => {
      if (!m.poll) return;
      tick();
      const mine = m.votes?.[core.myId] ?? [];
      const next = mine.includes(option) ? mine.filter((o) => o !== option) : m.poll.multi ? [...mine, option] : [option];
      void core.client.vote(id, ref(m), next).catch(() => {});
    },
    [id],
  );

  const retry = useCallback(
    (m: Message) => {
      void (async () => {
        await core.deleteForMe([m]);
        if (m.text) await core.client.sendText(id, m.text, { replyTo: m.replyTo, mentions: m.mentions });
      })().catch(() => {});
    },
    [id],
  );

  const reply = useCallback((m: Message) => {
    setEditing(null);
    setReplyTo(m);
  }, []);

  // ---- The header ----

  const title = chat ? core.chatTitle(chat) : '';
  const group = chat?.kind === 'group';
  const subtitle = typing.length
    ? group
      ? fill(t.nameTyping, { name: core.name(typing[0]) || '…' })
      : t.typing
    : group
      ? (chat?.members ?? [])
          .map((mb) => (mb.userId === core.myId ? t.youWord : core.name(mb.userId)))
          .filter(Boolean)
          .join(', ')
      : lastSeen(presence, t) || t.tapForInfo;

  const pinned = useMemo(() => [...(list ?? [])].reverse().find((m) => m.pinnedUntil && m.pinnedUntil > now && !m.deleted), [list, now]);
  const mayWrite = chat && !chat.left && !(group && chat.onlyAdminsSend && !amAdmin);
  const lastIsTheirs = (() => {
    const last = list?.at(-1);
    return !!last && last.kind !== 'system' && last.author !== core.myId;
  })();

  const header = selecting ? (
    <Animated.View key="pick" entering={FadeIn.duration(150)} exiting={FadeOut.duration(110)} style={{ marginHorizontal: 10, marginTop: 10 }}>
      <LinearGradient
        colors={theme.grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 22, boxShadow: `0 14px 30px -14px ${theme.acc}` }}
      >
        <IconButton icon="close" label={t.cancelSelection} look="onAccent" onPress={done} size={42} testID="cancel-pick" />
        <View style={{ flex: 1, paddingHorizontal: 4 }}>
          <Txt size={18} weight="700" color="#FFFFFF">
            {fill(t.selected, { n: picked.size })}
          </Txt>
        </View>
        {one && !one.deleted && mayWrite && <IconButton icon="reply" label={t.reply} look="onAccent" flip size={42} onPress={() => (reply(one), done())} testID="pick-reply" />}
        <IconButton
          icon={allStarred ? 'starFilled' : 'star'}
          label={allStarred ? t.unstar : t.star}
          look="onAccent"
          size={42}
          onPress={() => {
            core.setStarred(pickedList, !allStarred);
            toast(allStarred ? t.unstarred : t.starredNote);
            done();
          }}
          testID="pick-star"
        />
        <IconButton icon="trash" label={t.delete} look="onAccent" size={42} onPress={() => setDeleting(true)} testID="pick-delete" />
        <IconButton
          icon="forward"
          label={t.forward}
          look="onAccent"
          size={42}
          flip
          onPress={() => {
            const texts = pickedList.filter((m) => m.kind === 'text' && !m.deleted && m.text).map((m) => m.text!);
            done();
            if (texts.length) router.push({ pathname: '/forward', params: { texts: JSON.stringify(texts) } });
          }}
          testID="pick-forward"
        />
        <IconButton icon="more" label={t.moreOptions} look="onAccent" size={42} onPress={() => setPickMenu(true)} testID="pick-more" />
      </LinearGradient>
    </Animated.View>
  ) : (
    <Animated.View key="title" entering={FadeIn.duration(150)} exiting={FadeOut.duration(110)}>
      <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginHorizontal: 10, marginTop: 10, padding: 6 }}>
        <IconButton icon="back" label={t.back} onPress={() => router.back()} flip size={42} iconSize={23} testID="back" />
        <Pressy onPress={() => router.push({ pathname: '/info/[id]', params: { id } })} label={title} scale={0.98} style={{ flex: 1 }} testID="chat-header">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar id={id} name={title} size={40} online={!!presence?.online} group={group} />
            <View style={{ flex: 1 }}>
              <Txt size={16} weight="700" lines={1}>
                {title}
              </Txt>
              {!!subtitle && (
                <Animated.View key={subtitle} entering={FadeIn.duration(160)}>
                  <Txt size={12} weight="500" lines={1} color={typing.length || presence?.online ? theme.acc : theme.muted} testID="chat-subtitle">
                    {subtitle}
                  </Txt>
                </Animated.View>
              )}
            </View>
          </View>
        </Pressy>
        <IconButton icon="video" label={t.videoCall} look="soft" size={42} onPress={() => toast(t.callsSoon)} />
        <View style={{ width: 6 }} />
        <IconButton icon="calls" label={t.voiceCall} look="soft" size={42} iconSize={20} onPress={() => toast(t.callsSoon)} />
        <IconButton icon="more" label={t.moreOptions} size={42} onPress={() => setMenu(true)} testID="chat-menu" />
      </Glass>
    </Animated.View>
  );

  if (chat === null) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 }}>
          <Txt size={16} color={theme.muted} align="center">
            {t.chatGone}
          </Txt>
          <Button title={t.back} look="soft" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom={false}>
      <Animated.View style={[{ flex: 1 }, lift]}>
        <View style={{ minHeight: 62, zIndex: 2 }}>{header}</View>

        {pinned && !selecting && (
          <Animated.View entering={FadeInDown.springify().damping(20)} exiting={FadeOut}>
            <Pressy onPress={() => jumpTo(pinned)} label={t.pinnedMessage} scale={0.98}>
              <Glass style={{ marginHorizontal: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="pin" size={16} color={theme.accInk} />
                <View style={{ flex: 1 }}>
                  <Txt size={12} weight="700" color={theme.accInk}>
                    {t.pinnedMessage}
                  </Txt>
                  <Txt size={13} lines={1} color={theme.muted}>
                    {pinned.kind === 'poll' ? pinned.poll?.question : pinned.text}
                  </Txt>
                </View>
              </Glass>
            </Pressy>
          </Animated.View>
        )}

        <View style={{ flex: 1 }}>
          <Doodles />
          <FlatList
            ref={listRef}
            inverted
            data={items}
            keyExtractor={(it) => it.key}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
            onEndReached={more}
            onEndReachedThreshold={0.4}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={(info) => setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }), 250)}
            ListFooterComponent={
              list && !hasMore ? (
                <View style={{ alignSelf: 'center', maxWidth: '88%', marginVertical: 12, padding: 12, borderRadius: 14, backgroundColor: theme.glass, flexDirection: 'row', gap: 8 }}>
                  <Icon name="lock" size={15} color={theme.accInk} />
                  <View style={{ flexShrink: 1 }}>
                    <Txt size={12.5} color={theme.sectionText}>
                      {t.lockedNote}
                    </Txt>
                  </View>
                </View>
              ) : undefined
            }
            ListHeaderComponent={
              list && list.length === 0 && mayWrite ? (
                <Animated.View entering={ZoomIn.springify().damping(16).delay(150)} style={{ alignSelf: 'center', marginVertical: 20 }}>
                  <Button title={t.sayHi} look="soft" onPress={() => send(t.salam, [])} testID="say-hi" />
                </Animated.View>
              ) : undefined
            }
            renderItem={({ item }) => {
              if (item.kind === 'day') return <DayLabel text={item.text} />;
              if (item.kind === 'typing') return <TypingDots name={group ? core.name(typing[0]) : undefined} />;
              const m = item.m;
              const isNew = m.sentAt > openedAt;
              const k = keyOf(m);
              const showBar = one !== null && keyOf(one) === k && !m.deleted;
              return (
                <Animated.View entering={isNew ? FadeInDown.springify().damping(17).stiffness(230) : undefined}>
                  <Bubble
                    m={m}
                    group={!!group}
                    quoted={m.replyTo ? (byKey.get(keyOf(m.replyTo)) ?? null) : null}
                    first={item.first}
                    now={now}
                    starred={!!starred[`${m.chatId}/${m.author}/${m.id}`]}
                    selecting={selecting}
                    selected={picked.has(k)}
                    onPress={onPress}
                    onLongPress={onLongPress}
                    onReply={reply}
                    onVote={vote}
                    onReaction={react}
                    onQuote={jumpTo}
                    onRetry={retry}
                    above={showBar ? <ReactionBar mine={m.author === core.myId} current={m.reactions?.[core.myId]} onPick={(e) => react(m, e)} /> : undefined}
                  />
                </Animated.View>
              );
            }}
          />

          {/* Back to the newest, when you've scrolled up. */}
          {!atBottom && (
            <Animated.View entering={ZoomIn.springify().damping(15)} exiting={ZoomOut.duration(140)} style={{ position: 'absolute', end: 16, bottom: 12 }}>
              <Pressy onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} label={t.newest} scale={0.9} testID="to-bottom">
                <Glass strong style={{ width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="down" size={22} color={theme.accInk} />
                  {unseen > 0 && (
                    <View style={{ position: 'absolute', top: -6, end: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt size={11} weight="700" color="#FFFFFF" align="center">
                        {unseen}
                      </Txt>
                    </View>
                  )}
                </Glass>
              </Pressy>
            </Animated.View>
          )}
        </View>

        {chat &&
          (mayWrite ? (
            <Composer
              key={editing ? `edit-${editing.id}` : chat.id}
              chat={chat}
              replyTo={replyTo}
              editing={editing}
              quick={lastIsTheirs}
              onCancel={() => (setReplyTo(null), setEditing(null))}
              onSend={send}
              onAttach={() => setAttach(true)}
            />
          ) : (
            <Glass style={{ margin: 10, padding: 14, borderRadius: 18 }}>
              <Txt size={14} color={theme.muted} align="center">
                {chat.left ? t.notInGroup : t.onlyAdminsNote}
              </Txt>
            </Glass>
          ))}
      </Animated.View>

      {/* The ⋮ menu of the chat. */}
      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem icon="info" label={group ? t.groupInfo : t.contactInfo} onPress={() => (setMenu(false), router.push({ pathname: '/info/[id]', params: { id } }))} />
        <MenuItem icon="search" label={t.search} onPress={() => (setMenu(false), router.push({ pathname: '/search', params: { chat: id } }))} />
        <MenuItem
          icon={core.prefs[id]?.muted ? 'bell' : 'muted'}
          label={core.prefs[id]?.muted ? t.unmute : t.mute}
          onPress={() => {
            setMenu(false);
            core.setPrefs(id, { muted: !core.prefs[id]?.muted });
          }}
        />
        <MenuItem icon="timer" label={t.disappearing} onPress={() => (setMenu(false), setTimerOpen(true))} testID="menu-timer" />
        <MenuItem icon="trash" label={t.clearChat} danger onPress={() => (setMenu(false), setClearing(true))} />
      </Popup>

      {/* The ⋮ menu while messages are picked. */}
      <Popup visible={pickMenu} onClose={() => setPickMenu(false)} top={70}>
        {one && one.author === core.myId && (
          <MenuItem
            icon="info"
            label={t.info}
            onPress={() => {
              done();
              router.push({ pathname: '/message-info', params: { chat: id, author: one.author, id: one.id } });
            }}
          />
        )}
        {pickedList.some((m) => m.text && !m.deleted) && (
          <MenuItem
            icon="copy"
            label={t.copy}
            onPress={() => {
              void Clipboard.setStringAsync(
                pickedList
                  .filter((m) => m.text && !m.deleted)
                  .map((m) => m.text)
                  .join('\n'),
              );
              toast(t.copied);
              done();
            }}
            testID="pick-copy"
          />
        )}
        {canEdit && <MenuItem icon="edit" label={t.edit} onPress={() => (setEditing(one), setReplyTo(null), done())} testID="pick-edit" />}
        {one && !one.deleted && mayWrite && (
          <MenuItem
            icon="pin"
            label={one.pinnedUntil && one.pinnedUntil > now ? t.unpin : t.pin}
            onPress={() => {
              const on = one.pinnedUntil && one.pinnedUntil > now;
              void act(() => core.client.pin(id, ref(one), on ? null : Date.now() + 7 * 86_400_000));
              done();
            }}
            testID="pick-pin"
          />
        )}
        <MenuItem icon="select" label={t.selectAll} onPress={() => (setPicked(new Map((list ?? []).filter((m) => m.kind !== 'system').map((m) => [keyOf(m), m]))), setPickMenu(false))} />
      </Popup>

      {/* Deleting picked messages. */}
      <Dialog
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={fill(t.deleteMessages, { n: picked.size })}
        buttons={[
          ...(canUnsend
            ? [
                {
                  label: t.deleteForEveryone,
                  danger: true,
                  testID: 'delete-everyone',
                  onPress: () => {
                    const all = pickedList;
                    setDeleting(false);
                    done();
                    void act(async () => {
                      for (const m of all) await core.client.deleteForEveryone(id, ref(m));
                    });
                  },
                },
              ]
            : []),
          {
            label: t.deleteForMe,
            danger: true,
            testID: 'delete-me',
            onPress: () => {
              const all = pickedList;
              setDeleting(false);
              done();
              void core.deleteForMe(all);
            },
          },
          { label: t.cancel, onPress: () => setDeleting(false) },
        ]}
      />

      <Dialog
        visible={clearing}
        onClose={() => setClearing(false)}
        title={t.clearChat}
        text={t.clearChatNote}
        buttons={[
          {
            label: t.clearChat,
            danger: true,
            onPress: () => {
              setClearing(false);
              void core.deleteChatHere(id);
            },
          },
          { label: t.cancel, onPress: () => setClearing(false) },
        ]}
      />

      {/* "+": things to send. Photos and files come with the next update. */}
      <Sheet visible={attach} onClose={() => setAttach(false)} title={t.attach}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 8, gap: 6 }}>
          {[
            { icon: 'poll' as const, label: t.pollWord, on: () => (setAttach(false), setPollKey((k) => k + 1), setTimeout(() => setPollOpen(true), 200)), testID: 'attach-poll' },
            { icon: 'photo' as const, label: t.gallery, on: () => toast(t.comingSoon), testID: 'attach-photo' },
            { icon: 'camera' as const, label: t.camera, on: () => toast(t.comingSoon), testID: 'attach-camera' },
            { icon: 'doc' as const, label: t.document, on: () => toast(t.comingSoon), testID: 'attach-doc' },
          ].map((a, i) => (
            <Animated.View key={a.icon} entering={ZoomIn.delay(60 + i * 40).springify().damping(15)} style={{ width: '23%', alignItems: 'center' }}>
              <Pressy onPress={a.on} label={a.label} testID={a.testID} scale={0.9}>
                <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 19, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={a.icon} size={24} color={theme.accInk} />
                  </View>
                  <Txt size={12.5} weight="600" align="center">
                    {a.label}
                  </Txt>
                </View>
              </Pressy>
            </Animated.View>
          ))}
        </View>
      </Sheet>

      <PollSheet
        key={pollKey}
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onSend={(q, options, multi) => {
          setPollOpen(false);
          void act(() => core.client.sendPoll(id, q, options, multi));
        }}
      />

      {/* Disappearing messages. */}
      <Sheet visible={timerOpen} onClose={() => setTimerOpen(false)} title={t.disappearing}>
        <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 4 }}>
          <Txt size={14} color={theme.muted} style={{ marginHorizontal: 4, marginBottom: 6 }}>
            {t.disappearingNote}
          </Txt>
          {TIMERS.map((s) => {
            const on = (chat?.timer ?? 0) === s;
            return (
              <Pressy
                key={s}
                label={timerLabel(s, t)}
                testID={`timer-${s}`}
                scale={0.98}
                onPress={() => {
                  setTimerOpen(false);
                  if (!on) void act(() => core.client.setTimer(id, s));
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 14, backgroundColor: on ? theme.accSoft : 'transparent' }}>
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight={on ? '700' : '500'} color={on ? theme.accInk : theme.text}>
                      {timerLabel(s, t)}
                    </Txt>
                  </View>
                  {on && <Icon name="check" size={20} color={theme.accInk} stroke={2.4} />}
                </View>
              </Pressy>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}

/** The six quick reactions over a held message. They pop in one after another. */
function ReactionBar({ mine, current, onPick }: { mine: boolean; current?: string; onPick: (emoji: string) => void }) {
  const { theme } = useLook();
  return (
    <Animated.View entering={ZoomIn.springify().damping(16)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginBottom: 6, zIndex: 3 }}>
      <Glass strong style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 3, borderRadius: 26, boxShadow: `0 16px 34px -14px ${theme.shadow}` }}>
        {REACTIONS.map((e, i) => (
          <Animated.View key={e} entering={ZoomIn.delay(30 + i * 30).springify().damping(12)}>
            <Pressy onPress={() => onPick(e)} label={e} scale={0.8} testID={`react-${e}`}>
              <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: current === e ? theme.accSoft : 'transparent' }}>
                <Txt size={24} align="center">
                  {e}
                </Txt>
              </View>
            </Pressy>
          </Animated.View>
        ))}
      </Glass>
    </Animated.View>
  );
}

/** Faint drawings behind the messages: a moon, a kite, a cup of chai, a star. */
function Doodles() {
  const { theme } = useLook();
  const color = theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(37,99,235,0.08)';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, direction: 'ltr' }}>
      <View style={{ position: 'absolute', left: 24, top: 40 }}>
        <Icon name="moon" size={42} color={color} stroke={1.3} />
      </View>
      <View style={{ position: 'absolute', right: 30, top: 130 }}>
        <Icon name="star" size={40} color={color} stroke={1.3} />
      </View>
      <View style={{ position: 'absolute', left: 34, top: 310 }}>
        <Icon name="heart" size={40} color={color} stroke={1.3} />
      </View>
      <View style={{ position: 'absolute', right: 44, top: 440 }}>
        <Icon name="sun" size={38} color={color} stroke={1.3} />
      </View>
    </View>
  );
}
