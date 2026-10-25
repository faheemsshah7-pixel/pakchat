// (tabs)/calls.tsx: every call, newest first, like WhatsApp's Calls tab.
//
// Each row: who, whether it came in or went out (a red arrow for a missed
// one), when, and how long; calls in a row with the same person the same way
// are one row, "(3)". Tap the phone or camera on the end to call back; tap the
// row for Call info; hold it to remove it from the list. The list is only on
// this phone (core/calls.ts keeps it). Missed calls since I last looked are
// the number on the tab.
//
// Above it: my favourites (call them in one tap), scheduled calls coming up,
// and my call links (a call anyone with the link can join, which rings
// nobody). The 🔗 and 📅 at the top make them; the button at the bottom starts
// a new call, to a contact or to a number.
import { router, useFocusEffect } from 'expo-router';
import type { Chat } from '@pakchat/shared';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { clearCallLog, type CallLogEntry } from '../../core/calls';
import { grouped, type CallGroup } from '../../core/callGroups';
import { core } from '../../core/core';
import { useCallLinks, useCallLog, useFavouriteChats, useLinkCall, usePeople, useUpcomingPlans } from '../../core/hooks';
import type { PlanNote } from '../../core/plans';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { startCall } from '../../ui/CallBar';
import { duration, listTime, whenLabel } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Empty, Fab, Field, Glass, IconButton, Pressy, Screen, Section, Txt } from '../../ui/kit';
import { rise } from '../../ui/motion';
import { Dialog, Sheet, toast } from '../../ui/overlays';
import { ScheduleCallSheet } from '../../ui/ScheduleCallSheet';
import { isOffline } from '../../core/core';

export default function Calls() {
  const t = useT();
  const { theme } = useLook();
  const list = useCallLog();
  usePeople();
  const [holding, setHolding] = useState<CallGroup | null>(null);
  const [clearing, setClearing] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const plans = useUpcomingPlans();
  const [planning, setPlanning] = useState(false);
  const [making, setMaking] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [busy, setBusy] = useState(false);
  // My call links are chats of their own (kept out of the chat list).
  const linkRows = useCallLinks();
  const favs = useFavouriteChats();
  const groups = grouped(list ?? []);

  // Looking at Calls clears the missed-calls number on its tab.
  useFocusEffect(
    useCallback(() => {
      core.setSettings({ callsSeenAt: Date.now() });
      return () => core.setSettings({ callsSeenAt: Date.now() });
    }, []),
  );

  async function makeLink() {
    setBusy(true);
    try {
      const chat = await core.client.adopt(await core.server.createCallLink(linkTitle.trim() || t.callLinkWord));
      setMaking(false);
      setLinkTitle('');
      if (chat.inviteCode) router.push({ pathname: '/calllink/[code]', params: { code: chat.inviteCode } });
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  // Group names come from the chats (read once per group).
  const title = (e: CallLogEntry) => {
    if (!e.group) return core.name(e.with[0] ?? '') || '…';
    if (titles[e.chatId] === undefined) {
      void core.storage.getChat(e.chatId).then((c) => setTitles((old) => ({ ...old, [e.chatId]: c ? core.chatTitle(c) : t.groupWord })));
      return '…';
    }
    return titles[e.chatId];
  };

  return (
    <Screen bottom={false}>
      <View style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Txt size={27} weight="800" style={{ letterSpacing: -0.9, flex: 1 }}>
          {t.calls}
        </Txt>
        <IconButton icon="link" label={t.newCallLink} onPress={() => setMaking(true)} color={theme.muted} testID="new-call-link" />
        <IconButton icon="calendar" label={t.scheduleCall} onPress={() => setPlanning(true)} color={theme.muted} testID="schedule-call" />
        {!!list?.length && <IconButton icon="trash" label={t.clearCallLog} onPress={() => setClearing(true)} color={theme.muted} testID="clear-calls" />}
      </View>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        ListHeaderComponent={
          <>
            {/* Favourites, always with "Add favourite", like WhatsApp. */}
            <Section title={t.favourites} />
            {favs.map((c) => (
              <FavRow key={c.id} chat={c} />
            ))}
            <Pressy onPress={() => router.push({ pathname: '/new-call', params: { fav: '1' } })} label={t.addFavouriteCall} scale={0.98} testID="add-favourite">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10 }}>
                <View style={{ width: 50, height: 50, borderRadius: 17, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="heart" size={23} color={theme.accInk} />
                </View>
                <Txt size={16} weight="700">
                  {t.addFavouriteCall}
                </Txt>
              </View>
            </Pressy>
            {plans.length > 0 && (
              <>
                <Section title={t.upcomingCalls} />
                {plans.map((p) => (
                  <PlanRow key={`${p.chatId}:${p.id}`} p={p} />
                ))}
              </>
            )}
            {linkRows.length > 0 && (
              <>
                <Section title={t.callLinks} />
                {linkRows.map((c) => (
                  <LinkRow key={c.id} chat={c} />
                ))}
              </>
            )}
            {!!list?.length && <Section title={t.recentCalls} />}
          </>
        }
        ListEmptyComponent={list ? <Empty icon="calls" text={t.noCalls} /> : undefined}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 110 }}
        renderItem={({ item: g, index }) => {
          const e = g.first;
          return (
            <Animated.View entering={index < 12 ? rise(index * 25) : undefined}>
              <Pressy
                onPress={() => router.push({ pathname: '/call-info', params: { chat: e.chatId, ids: g.all.map((x) => x.id).join(',') } })}
                onLongPress={() => setHolding(g)}
                label={title(e)}
                scale={0.98}
                testID="call-row"
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10 }}>
                  <Avatar id={e.group ? e.chatId : (e.with[0] ?? e.chatId)} name={e.group ? '' : title(e).replace(/^~ /, '')} size={50} group={e.group} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Txt size={16} weight="700" lines={1} color={e.missed ? '#E5484D' : theme.text}>
                      {g.all.length > 1 ? `${title(e)} (${g.all.length})` : title(e)}
                    </Txt>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Icon name={e.direction === 'in' ? 'callIn' : 'callOut'} size={14} color={e.missed ? '#E5484D' : theme.online} />
                      <Txt size={13} color={theme.muted} lines={1}>
                        {[listTime(e.at, t), e.seconds ? duration(e.seconds * 1000) : e.missed ? t.missedWord : ''].filter(Boolean).join(' · ')}
                      </Txt>
                    </View>
                  </View>
                  <IconButton
                    icon={e.video ? 'video' : 'calls'}
                    label={fill(t.callBack, { name: title(e) })}
                    look="soft"
                    size={42}
                    iconSize={20}
                    onPress={() => void startCall(e.chatId, e.video, t)}
                    testID="call-back"
                  />
                </View>
              </Pressy>
            </Animated.View>
          );
        }}
      />
      <Fab icon="calls" label={t.newCall} onPress={() => router.push('/new-call')} testID="new-call" bottom={20} />
      <ScheduleCallSheet visible={planning} onClose={() => setPlanning(false)} />
      <Sheet visible={making} onClose={() => setMaking(false)} title={t.newCallLink}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Txt size={13.5} color={theme.muted}>
            {t.callLinkNote}
          </Txt>
          <Field value={linkTitle} onChangeText={setLinkTitle} placeholder={t.callName} maxLength={80} testID="call-link-title" />
          <Button title={t.makeLink} icon="link" busy={busy} onPress={() => void makeLink()} testID="call-link-make" />
        </View>
      </Sheet>
      <Dialog
        visible={holding !== null}
        onClose={() => setHolding(null)}
        title={t.removeCall}
        text={holding ? title(holding.first) : ''}
        buttons={[
          {
            label: t.delete,
            danger: true,
            testID: 'confirm-remove-call',
            onPress: () => {
              if (holding) void clearCallLog(holding.all.map((x) => x.id));
              setHolding(null);
            },
          },
          { label: t.cancel, onPress: () => setHolding(null) },
        ]}
      />
      <Dialog
        visible={clearing}
        onClose={() => setClearing(false)}
        title={t.clearCallLog}
        text={t.clearCallLogText}
        buttons={[
          {
            label: t.clearCallLog,
            danger: true,
            testID: 'confirm-clear-calls',
            onPress: () => {
              void clearCallLog();
              setClearing(false);
            },
          },
          { label: t.cancel, onPress: () => setClearing(false) },
        ]}
      />
    </Screen>
  );
}

/** A favourite: call them in one tap. */
function FavRow({ chat }: { chat: Chat }) {
  const t = useT();
  const title = core.chatTitle(chat);
  return (
    <Pressy onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })} label={title} scale={0.98} testID="fav-row">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Avatar id={chat.id} name={title.replace(/^~ /, '')} size={50} group={chat.kind === 'group'} />
        <Txt size={16} weight="700" lines={1} style={{ flex: 1 }}>
          {title}
        </Txt>
        <IconButton icon="calls" label={t.voiceCall} look="soft" size={42} iconSize={20} onPress={() => void startCall(chat.id, false, t)} testID="fav-voice" />
        <IconButton icon="video" label={t.videoCall} look="soft" size={42} iconSize={20} onPress={() => void startCall(chat.id, true, t)} testID="fav-video" />
      </View>
    </Pressy>
  );
}

/** A scheduled call coming up: its name, when, and the chat it's in. */
function PlanRow({ p }: { p: PlanNote }) {
  const t = useT();
  const { theme } = useLook();
  return (
    <Pressy onPress={() => router.push({ pathname: '/chat/[id]', params: { id: p.chatId } })} label={p.title} scale={0.98} testID="plan-row">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10 }}>
        <View style={{ width: 50, height: 50, borderRadius: 17, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="calendar" size={23} color={theme.accInk} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt size={16} weight="700" lines={1}>
            {p.title}
          </Txt>
          <Txt size={13} color={theme.muted} lines={1}>
            {[whenLabel(p.at, t), p.video ? t.videoCall : t.voiceCall].join(' · ')}
          </Txt>
        </View>
        <Icon name="chevron" size={18} color={theme.faint} />
      </View>
    </Pressy>
  );
}

/** One of my call links, with who's in its call now. */
function LinkRow({ chat }: { chat: Chat }) {
  const t = useT();
  const { theme } = useLook();
  const now = useLinkCall(chat.id);
  const open = () => chat.inviteCode && router.push({ pathname: '/calllink/[code]', params: { code: chat.inviteCode } });
  return (
    <Pressy onPress={open} label={core.chatTitle(chat)} scale={0.98} testID="call-link-row">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10 }}>
        <View style={{ width: 50, height: 50, borderRadius: 17, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="link" size={23} color={theme.accInk} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt size={16} weight="700" lines={1}>
            {core.chatTitle(chat)}
          </Txt>
          <Txt size={13} color={now ? theme.online : theme.muted} lines={1}>
            {now ? fill(t.nInCall, { n: now.people.length }) : t.callLinkWord}
          </Txt>
        </View>
        {now && (
          <Glass style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 }}>
            <Txt size={13} weight="700" color={theme.accInk}>
              {t.joinWord}
            </Txt>
          </Glass>
        )}
      </View>
    </Pressy>
  );
}
