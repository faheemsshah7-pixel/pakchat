// new-group.tsx: make a group (or, from Group info, add people to one).
//
// Step 1: pick people. Each one you pick pops into the row at the top.
// Step 2: give the group a name, then Create.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInRight, LinearTransition, ZoomOut } from 'react-native-reanimated';

import { core, isOffline, type Person } from '../core/core';
import { defaultTimer } from '../core/timer';
import { useChat, usePeople } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Button, Divider, Field, Glass, Pressy, Screen, Section, Toggle, TopBar, Txt, useKeyboardLift } from '../ui/kit';
import { toast } from '../ui/overlays';
import { pop, rise } from '../ui/motion';

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
  const [onlyAdmins, setOnlyAdmins] = useState(false);
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
      if (add) {
        await core.client.addMembers(add, picked.map((p) => p.id));
        router.back();
      } else {
        const chat = await core.client.createGroup(title.trim(), picked.map((p) => p.id), { onlyAdminsSend: onlyAdmins, defaultTimer: defaultTimer() });
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
        <Animated.View entering={FadeInRight.springify().damping(18).stiffness(110)} style={{ padding: 16, gap: 14 }}>
          <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <Animated.View entering={pop()}>
              <Avatar id={title || 'new'} name={title} size={96} group />
            </Animated.View>
          </View>
          <Field value={title} onChangeText={setTitle} placeholder={t.groupName} maxLength={50} autoFocus testID="group-title" />
          <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 }}>
            <View style={{ flex: 1 }}>
              <Txt size={15} weight="600">
                {t.onlyAdminsSend}
              </Txt>
            </View>
            <Toggle on={onlyAdmins} onChange={setOnlyAdmins} label={t.onlyAdminsSend} />
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
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={add ? t.addMembers : t.newGroup} subtitle={t.pickPeople} onBack={() => router.back()} />

      {picked.length > 0 && (
        <Animated.View entering={FadeIn}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
            {picked.map((p) => (
              <Animated.View key={p.id} entering={pop()} exiting={ZoomOut.duration(140)} layout={LinearTransition.springify().damping(30).stiffness(210)}>
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
            <Animated.View entering={rise(Math.min(index, 10) * 25)}>
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
                      <Animated.View entering={pop()}>
                        <Icon name="check" size={14} color="#FFFFFF" stroke={3} />
                      </Animated.View>
                    )}
                  </View>
                </View>
              </Pressy>
            </Animated.View>
          );
        }}
      />

      {picked.length > 0 && (
        <Animated.View entering={rise()} style={[{ position: 'absolute', start: 16, end: 16 }, lift]}>
          <Button title={add ? t.addMembers : t.continue} icon={add ? 'userPlus' : 'forwardArrow'} onPress={() => (add ? finish() : setStep(2))} busy={busy} testID="group-next" />
        </Animated.View>
      )}
    </Screen>
  );
}
