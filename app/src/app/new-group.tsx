// new-group.tsx: make a group (or, from Group info, add people to one).
//
// Step 1: pick people. Each one you pick pops into the row at the top.
// Step 2: give the group a name, and (like WhatsApp) set its disappearing
// messages and Group permissions before it's made, then Create.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, ScrollView, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { core, isOffline, type Person } from '../core/core';
import { defaultTimer } from '../core/timer';
import { useChat, usePeople } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { TIMERS, timerLabel } from '../ui/format';
import { Avatar, Button, Divider, Field, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt, useKeyboardLift } from '../ui/kit';
import { fadeIn, fadeOut, popIn, popOut } from '../ui/motion';
import { MenuItem, Sheet, toast } from '../ui/overlays';

export default function NewGroup() {
  const { add } = useLocalSearchParams<{ add?: string }>();
  const t = useT();
  const { theme } = useLook();
  const people = usePeople();
  const existing = useChat(add ?? '');
  const [picked, setPicked] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const lift = useKeyboardLift();
  const [title, setTitle] = useState('');
  // Its settings, set before it's made: the timer starts at the default one (Settings › Privacy).
  const [onlyAdminsSend, setOnlyAdminsSend] = useState(false);
  const [membersEdit, setMembersEdit] = useState(false);
  const [membersAdd, setMembersAdd] = useState(false);
  const [joinApproval, setJoinApproval] = useState(false);
  const [timer, setTimer] = useState(defaultTimer);
  const [sheet, setSheet] = useState<'timer' | 'permissions' | null>(null);
  const [busy, setBusy] = useState(false);

  const inGroup = new Set(existing?.members.map((m) => m.userId) ?? []);
  const list = useMemo(
    () =>
      Object.values(people)
        .filter((p) => p.id !== core.myId && p.name && !inGroup.has(p.id))
        .filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, query, existing],
  );

  // On the name step, Android's back goes to picking people again (not out of the screen).
  useEffect(() => {
    if (step !== 2) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep(1);
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const isPicked = (id: string) => picked.some((p) => p.id === id);
  const toggle = (p: Person) => setPicked((old) => (old.some((x) => x.id === p.id) ? old.filter((x) => x.id !== p.id) : [...old, p]));

  // Someone not in your chats yet: find them by Gmail.
  async function findByGmail() {
    if (!query.includes('@') && query.trim().length < 3) return;
    try {
      const p = await core.lookup(query);
      if (!p) return toast(t.notOnPakChat);
      if (p.id === core.myId) return toast(t.ownAccount);
      if (!isPicked(p.id)) setPicked((old) => [...old, { id: p.id, name: p.name }]);
      setQuery('');
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      // Someone whose privacy (Settings › Privacy › Groups) doesn't let me add them is left out: say so, like WhatsApp.
      const missing = (members: { userId: string }[]) => picked.filter((p) => !members.some((m) => m.userId === p.id));
      if (add) {
        const chat = await core.client.addMembers(add, picked.map((p) => p.id));
        const left = missing(chat.members);
        if (left.length) toast(fill(t.couldntAdd, { names: left.map((p) => p.name).join(', ') }), undefined, 5000);
        router.back();
      } else {
        const chat = await core.client.createGroup(title.trim(), picked.map((p) => p.id), { onlyAdminsSend, membersEdit, membersAdd, joinApproval, defaultTimer: timer });
        const left = missing(chat.members);
        if (left.length) toast(fill(t.couldntAdd, { names: left.map((p) => p.name).join(', ') }), undefined, 5000);
        router.replace({ pathname: '/chat/[id]', params: { id: chat.id } });
      }
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  if (step === 2) {
    return (
      <Screen>
        <TopBar title={t.newGroup} onBack={() => setStep(1)} />
        <Animated.View style={{ padding: 16, gap: 14 }}>
          <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <View>
              <Avatar id={title || 'new'} name={title} size={96} group />
            </View>
          </View>
          <Field value={title} onChangeText={setTitle} placeholder={t.groupName} maxLength={50} autoFocus testID="group-title" />
          <Glass style={{ borderRadius: 18 }}>
            <SettingRow icon="timer" title={t.disappearing} sub={timerLabel(timer, t)} onPress={() => setSheet('timer')} testID="group-timer" />
            <Divider />
            <SettingRow icon="shield" title={t.groupPermissions} onPress={() => setSheet('permissions')} testID="group-permissions" />
          </Glass>
          <Txt size={13} weight="700" color={theme.sectionText}>
            {t.members.replace('{n}', String(picked.length + 1))}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {picked.map((p) => (
              <View key={p.id} style={{ alignItems: 'center', width: 64, gap: 4 }}>
                <Avatar id={p.id} name={p.name} size={46} />
                <Txt size={11.5} lines={1} align="center">
                  {p.name}
                </Txt>
              </View>
            ))}
          </View>
          <Button title={t.createGroup} onPress={finish} busy={busy} disabled={!title.trim()} testID="create-group" />
        </Animated.View>

        <Sheet visible={sheet === 'timer'} onClose={() => setSheet(null)} title={t.disappearing}>
          <View style={{ paddingHorizontal: 16, gap: 4 }}>
            {TIMERS.map((s) => (
              <MenuItem
                key={s}
                icon={timer === s ? 'check' : undefined}
                label={timerLabel(s, t)}
                onPress={() => {
                  setTimer(s);
                  setSheet(null);
                }}
                testID={`group-timer-${s}`}
              />
            ))}
          </View>
        </Sheet>
        <Sheet visible={sheet === 'permissions'} onClose={() => setSheet(null)} title={t.groupPermissions}>
          <View style={{ paddingHorizontal: 4 }}>
            <SettingRow icon="lock" title={t.onlyAdminsSend} right={<Toggle on={onlyAdminsSend} onChange={setOnlyAdminsSend} label={t.onlyAdminsSend} testID="group-only-admins" />} />
            <Divider />
            <SettingRow
              icon="edit"
              title={t.membersEditInfo}
              sub={t.membersEditInfoSub}
              right={<Toggle on={membersEdit} onChange={setMembersEdit} label={t.membersEditInfo} testID="group-members-edit" />}
            />
            <Divider />
            <SettingRow
              icon="group"
              title={t.membersAddOthers}
              sub={t.membersAddOthersSub}
              right={<Toggle on={membersAdd} onChange={setMembersAdd} label={t.membersAddOthers} testID="group-members-add" />}
            />
            <Divider />
            <SettingRow
              icon="userPlus"
              title={t.approveMembers}
              sub={t.approveMembersSub}
              right={<Toggle on={joinApproval} onChange={setJoinApproval} label={t.approveMembers} testID="group-approve" />}
            />
          </View>
        </Sheet>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={add ? t.addMembers : t.newGroup} subtitle={t.pickPeople} onBack={() => router.back()} />

      {/* The people picked, in a row at the top: each pops in as you tick them and the rest close up
          when one goes, like WhatsApp's. */}
      {picked.length > 0 && (
        <Animated.View entering={fadeIn} exiting={fadeOut}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
            {picked.map((p) => (
              <Animated.View key={p.id} entering={popIn} exiting={popOut} layout={LinearTransition.duration(180)}>
                <Pressy onPress={() => toggle(p)} label={p.name} scale={0.9}>
                  <View style={{ alignItems: 'center', width: 62, gap: 4 }}>
                    <View>
                      <Avatar id={p.id} name={p.name} size={48} />
                      <View style={{ position: 'absolute', end: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.faint, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="close" size={11} color="#FFFFFF" stroke={3} />
                      </View>
                    </View>
                    <Txt size={11.5} lines={1} align="center">
                      {p.name}
                    </Txt>
                  </View>
                </Pressy>
              </Animated.View>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      <View style={{ padding: 14 }}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder={t.findPerson}
          icon="search"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={findByGmail}
          testID="group-find"
        />
      </View>
      {query.includes('@') && (
        <Button title={t.find} look="soft" onPress={findByGmail} style={{ marginHorizontal: 14, marginBottom: 6 }} testID="group-find-button" />
      )}

      {list.length > 0 && <Section title={t.onPakChat} />}
      <FlatList
        data={list}
        extraData={picked}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ marginHorizontal: 12, paddingBottom: 110 }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item, index }) => {
          const on = isPicked(item.id);
          return (
            <View>
              <Pressy onPress={() => toggle(item)} label={item.name} scale={0.98} testID={`pick-${item.name}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: on ? theme.selected : 'transparent' }}>
                  <Avatar id={item.id} name={item.name} size={44} />
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight="600">
                      {item.name}
                    </Txt>
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: on ? theme.acc : theme.faint,
                      backgroundColor: on ? theme.acc : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on && (
                      <Animated.View entering={popIn} exiting={popOut}>
                        <Icon name="check" size={14} color="#FFFFFF" stroke={3} />
                      </Animated.View>
                    )}
                  </View>
                </View>
              </Pressy>
            </View>
          );
        }}
      />

      {picked.length > 0 && (
        <Animated.View style={[{ position: 'absolute', start: 16, end: 16 }, lift]}>
          <Button title={add ? t.addMembers : t.continue} icon={add ? 'userPlus' : 'forwardArrow'} onPress={() => (add ? finish() : setStep(2))} busy={busy} testID="group-next" />
        </Animated.View>
      )}
    </Screen>
  );
}
