// info/[id].tsx: Contact info (one-to-one) or Group info.
//
// The big picture shrinks away as you scroll, and the name slides into the bar
// at the top. Admins can rename the group, add and remove people, and choose
// who may send.
import { roleOf } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, interpolate, LinearTransition, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { core } from '../../core/core';
import { useBlocked, useChat, useChatPrefs, usePeople, usePerson, usePresence } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { lastSeen, TIMERS, timerLabel } from '../../ui/format';
import { Icon, type IconName } from '../../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, Section, SettingRow, Toggle, Txt } from '../../ui/kit';
import { Dialog, MenuItem, Sheet, toast } from '../../ui/overlays';

export default function Info() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const chat = useChat(id);
  usePeople();
  const other = chat ? core.otherPerson(chat) : null;
  const person = usePerson(other);
  const presence = usePresence(other);
  const blocked = useBlocked();
  const prefs = useChatPrefs(id);
  const [member, setMember] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const y = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  const big = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, 120], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(y.value, [-80, 0, 140], [1.15, 1, 0.6], 'clamp') }, { translateY: interpolate(y.value, [0, 140], [0, 40], 'clamp') }],
  }));
  const small = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [110, 160], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(y.value, [110, 160], [10, 0], 'clamp') }],
  }));

  if (!chat) return <Screen>{null}</Screen>;

  const group = chat.kind === 'group';
  const title = core.chatTitle(chat);
  const amAdmin = group && roleOf(chat, core.myId) === 'admin';
  const isBlocked = !!other && !!blocked?.some((p) => p.id === other);
  const sub = group ? fill(t.members, { n: chat.members.length }) : lastSeen(presence, t);

  async function act(work: () => Promise<unknown>, done?: string) {
    try {
      await work();
      if (done) toast(done);
    } catch {
      toast(t.couldNot);
    }
  }

  const actions: { icon: IconName; label: string; on: () => void }[] = [
    { icon: 'chat', label: t.message, on: () => router.back() },
    { icon: 'calls', label: t.voiceCall, on: () => toast(t.callsSoon) },
    { icon: 'video', label: t.videoCall, on: () => toast(t.callsSoon) },
    { icon: 'search', label: t.search, on: () => router.push({ pathname: '/search', params: { chat: id } }) },
  ];

  const members = [...chat.members].sort(
    (a, b) => Number(b.userId === core.myId) - Number(a.userId === core.myId) || Number(b.role === 'admin') - Number(a.role === 'admin') || core.name(a.userId).localeCompare(core.name(b.userId)),
  );
  const picked = member ? chat.members.find((m) => m.userId === member) : null;

  return (
    <Screen>
      <Glass style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 10, marginTop: 10, padding: 6, zIndex: 2 }}>
        <IconButton icon="back" label={t.back} onPress={() => router.back()} flip size={42} iconSize={23} testID="back" />
        <Animated.View style={[{ flex: 1, paddingHorizontal: 4 }, small]}>
          <Txt size={17} weight="700" lines={1}>
            {title}
          </Txt>
        </Animated.View>
        {amAdmin && <IconButton icon="edit" label={t.groupName} size={42} onPress={() => (setName(chat.title ?? ''), setRenaming(true))} testID="rename-group" />}
      </Glass>

      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 40 }}>
        <Animated.View style={[{ alignItems: 'center', paddingTop: 18, gap: 6 }, big]}>
          <Avatar id={id} name={title} size={104} group={group} online={!!presence?.online} />
          <Txt size={24} weight="800" align="center" style={{ marginTop: 10 }} testID="info-title">
            {title}
          </Txt>
          {!!sub && (
            <Txt size={14} color={theme.muted} align="center">
              {sub}
            </Txt>
          )}
          {!group && !!person?.about && (
            <Txt size={14} color={theme.sectionText} align="center" style={{ paddingHorizontal: 30 }}>
              {person.about}
            </Txt>
          )}
          {group && !!chat.description && (
            <Txt size={14} color={theme.sectionText} align="center" style={{ paddingHorizontal: 30 }}>
              {chat.description}
            </Txt>
          )}
        </Animated.View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 18, paddingHorizontal: 14 }}>
          {actions.map((a, i) => (
            <Animated.View key={a.icon} entering={FadeInDown.delay(60 + i * 40).springify().damping(18)} style={{ flex: 1 }}>
              <Pressy onPress={a.on} label={a.label} scale={0.94}>
                <Glass style={{ alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 18 }}>
                  <Icon name={a.icon} size={21} color={theme.accInk} />
                  <Txt size={12} weight="600" color={theme.accInk} align="center">
                    {a.label}
                  </Txt>
                </Glass>
              </Pressy>
            </Animated.View>
          ))}
        </View>

        <Glass style={{ marginHorizontal: 12, marginTop: 16 }}>
          <SettingRow icon="photo" title={t.media} sub={t.comingSoon} onPress={() => toast(t.comingSoon)} />
          <Divider />
          <SettingRow icon="star" title={t.starred} onPress={() => router.push({ pathname: '/starred', params: { chat: id } })} />
        </Glass>

        <Glass style={{ marginHorizontal: 12, marginTop: 12 }}>
          <SettingRow icon="muted" title={t.mute} right={<Toggle on={!!prefs.muted} onChange={(on) => core.setPrefs(id, { muted: on })} label={t.mute} testID="mute-toggle" />} />
          <Divider />
          <SettingRow icon="timer" title={t.disappearing} sub={timerLabel(chat.timer ?? 0, t)} onPress={() => setTimerOpen(true)} testID="info-timer" />
          {!group && other && (
            <>
              <Divider />
              <SettingRow icon="shield" title={t.encryption} sub={t.encryptionNote} onPress={() => router.push({ pathname: '/verify/[id]', params: { id: other } })} testID="verify" />
            </>
          )}
          {group && amAdmin && (
            <>
              <Divider />
              <SettingRow
                icon="lock"
                title={t.onlyAdminsSend}
                right={<Toggle on={!!chat.onlyAdminsSend} onChange={(on) => void act(() => core.client.updateGroup(id, { onlyAdminsSend: on }))} label={t.onlyAdminsSend} />}
              />
            </>
          )}
        </Glass>

        {group && (
          <>
            <Section title={fill(t.members, { n: chat.members.length })} />
            <Glass style={{ marginHorizontal: 12 }}>
              {amAdmin && !chat.left && (
                <>
                  <SettingRow icon="userPlus" title={t.addMembers} onPress={() => router.push({ pathname: '/new-group', params: { add: id } })} testID="add-members" />
                  <Divider />
                </>
              )}
              {members.map((mb, i) => (
                <Animated.View key={mb.userId} layout={LinearTransition.springify().damping(22)}>
                  {i > 0 && <Divider />}
                  <Pressy onPress={() => mb.userId !== core.myId && setMember(mb.userId)} label={core.name(mb.userId)} scale={0.98} testID={`member-${core.name(mb.userId)}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                      <Avatar id={mb.userId} name={core.name(mb.userId)} size={42} />
                      <View style={{ flex: 1 }}>
                        <Txt size={15.5} weight="600" lines={1}>
                          {mb.userId === core.myId ? t.youWord : core.name(mb.userId) || '…'}
                        </Txt>
                      </View>
                      {mb.role === 'admin' && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.accSoft }}>
                          <Txt size={11.5} weight="700" color={theme.accInk}>
                            {t.admin}
                          </Txt>
                        </View>
                      )}
                    </View>
                  </Pressy>
                </Animated.View>
              ))}
            </Glass>
          </>
        )}

        <Glass style={{ marginHorizontal: 12, marginTop: 16 }}>
          {group ? (
            !chat.left && <SettingRow icon="leave" title={t.leaveGroup} danger chevron={false} onPress={() => setLeaving(true)} testID="leave-group" />
          ) : (
            other && (
              <SettingRow
                icon="flag"
                title={isBlocked ? t.unblock : fill(t.blockName, { name: title })}
                danger={!isBlocked}
                chevron={false}
                onPress={() => void act(() => core.block(other, !isBlocked), isBlocked ? t.unblocked : t.blocked)}
                testID="block"
              />
            )
          )}
        </Glass>
      </Animated.ScrollView>

      {/* One member: message them, and (admins) make admin or remove. */}
      <Sheet visible={!!member} onClose={() => setMember(null)} title={member ? core.name(member) : ''}>
        {picked && (
          <View style={{ paddingBottom: 6 }}>
            <MenuItem
              icon="chat"
              label={fill(t.messageName, { name: core.name(picked.userId) })}
              onPress={() => {
                setMember(null);
                void act(async () => {
                  const c = await core.client.openDirect(picked.userId);
                  router.push({ pathname: '/chat/[id]', params: { id: c.id } });
                });
              }}
            />
            {amAdmin && (
              <MenuItem
                icon="shield"
                label={picked.role === 'admin' ? t.removeAdmin : t.makeAdmin}
                onPress={() => {
                  setMember(null);
                  void act(() => core.client.setAdmin(id, picked.userId, picked.role !== 'admin'));
                }}
                testID="toggle-admin"
              />
            )}
            {amAdmin && (
              <MenuItem
                icon="leave"
                danger
                label={fill(t.removeName, { name: core.name(picked.userId) })}
                onPress={() => {
                  setMember(null);
                  void act(() => core.client.removeMember(id, picked.userId));
                }}
                testID="remove-member"
              />
            )}
          </View>
        )}
      </Sheet>

      <Sheet visible={renaming} onClose={() => setRenaming(false)} title={t.groupName}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Field value={name} onChangeText={setName} placeholder={t.groupName} maxLength={50} testID="group-name-field" />
          <Button
            title={t.save}
            disabled={!name.trim()}
            onPress={() => {
              setRenaming(false);
              void act(() => core.client.updateGroup(id, { title: name.trim() }));
            }}
            testID="group-name-save"
          />
        </View>
      </Sheet>

      <Sheet visible={timerOpen} onClose={() => setTimerOpen(false)} title={t.disappearing}>
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          {TIMERS.map((s) => (
            <MenuItem
              key={s}
              icon={(chat.timer ?? 0) === s ? 'check' : undefined}
              label={timerLabel(s, t)}
              onPress={() => {
                setTimerOpen(false);
                if ((chat.timer ?? 0) !== s) void act(() => core.client.setTimer(id, s));
              }}
            />
          ))}
        </View>
      </Sheet>

      <Dialog
        visible={leaving}
        onClose={() => setLeaving(false)}
        title={fill(t.leaveSure, { name: title })}
        buttons={[
          {
            label: t.leaveGroup,
            danger: true,
            testID: 'confirm-leave',
            onPress: () => {
              setLeaving(false);
              void act(() => core.client.removeMember(id, core.myId));
            },
          },
          { label: t.cancel, onPress: () => setLeaving(false) },
        ]}
      />
    </Screen>
  );
}
