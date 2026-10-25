// info/[id].tsx: Contact info (one-to-one) or Group info.
//
// The big picture shrinks away as you scroll, and the name slides into the bar
// at the top. Admins can rename the group, add and remove people, choose
// who may send, edit its info or add people (Group permissions), and approve
// who joins (and let in those waiting). A community's announcements group has
// "Exit community" instead of leaving. Someone's info also shows the groups
// you're both in, and Add to Favourites and Add to list, like WhatsApp's.
import { formatPhone, roleOf } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { interpolate, LinearTransition, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { core } from '../../core/core';
import { defaultTimer } from '../../core/timer';
import { useBlocked, useChat, useChatList, useChatPrefs, usePeople, usePerson, usePresence } from '../../core/hooks';
import { ChatLockSheet } from '../../ui/ChatLockSheet';
import { AddToListSheet } from '../../ui/AddToListSheet';
import { ExportSheet } from '../../ui/ExportSheet';
import { TonePicker, toneName } from '../../ui/TonePicker';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { lastSeen, TIMERS, timerLabel } from '../../ui/format';
import { Icon, type IconName } from '../../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, Section, SettingRow, Toggle, Txt } from '../../ui/kit';
import { Dialog, MenuItem, Sheet, toast } from '../../ui/overlays';
import { rise } from '../../ui/motion';
import { startCall } from '../../ui/CallBar';
import { ReportSheet } from '../../ui/ReportSheet';
import { LeftGroupChoices } from '../../ui/DeleteChats';
import { CameraBadge, PhotoSheet } from '../../ui/PhotoSheet';
import { MuteSheet, mutedLine } from '../../ui/MuteSheet';

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
  const [toneOpen, setToneOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [member, setMember] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [leftChoices, setLeftChoices] = useState<'left' | 'ask' | null>(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [muting, setMuting] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [requests, setRequests] = useState<{ userId: string; at: number }[]>([]);
  const community = useChat(chat?.communityId ?? '');
  const rows = useChatList();
  const y = useSharedValue(0);

  // Who is waiting to join, for its admins (and again whenever someone asks).
  const seesRequests = chat?.kind === 'group' && !chat.announcements && !chat.left && roleOf(chat, core.myId) === 'admin';
  useEffect(() => {
    if (!seesRequests) return;
    const load = () =>
      core.server
        .joinRequests(id)
        .then((list) => {
          setRequests(list);
          list.forEach((r) => void core.person(r.userId).catch(() => {}));
        })
        .catch(() => {});
    void load();
    return core.on(`notice:${id}`, () => void load());
  }, [id, seesRequests]);

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
  // A community's announcements: its people come and go with the community.
  const ann = group && !!chat.announcements;
  const title = core.chatTitle(chat);
  const amAdmin = group && roleOf(chat, core.myId) === 'admin';
  // Group permissions: with them on, anyone in it may edit its info, or add people.
  const canEditInfo = group && !ann && !chat.left && (amAdmin || !!chat.membersEdit);
  const canAdd = group && !ann && !chat.left && (amAdmin || !!chat.membersAdd);
  // Groups we're both in (not ones I left), like WhatsApp's "Groups in common".
  const common = !group && other && other !== core.myId ? (rows ?? []).filter((r) => r.chat.kind === 'group' && !r.chat.left && r.chat.members.some((m) => m.userId === other)) : [];
  const isBlocked = !!other && !!blocked?.some((p) => p.id === other);
  // Messaging myself: no calls, blocking or reporting, like WhatsApp.
  const self = core.isSelfChat(chat);
  const sub = group ? fill(t.members, { n: chat.members.length }) : self ? t.messageYourself : lastSeen(presence, t);

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
    ...(self
      ? []
      : [
          { icon: 'calls' as const, label: t.voiceCall, on: () => void startCall(id, false, t) },
          { icon: 'video' as const, label: t.videoCall, on: () => void startCall(id, true, t) },
        ]),
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
        {canEditInfo && <IconButton icon="edit" label={t.groupName} size={42} onPress={() => (setName(chat.title ?? ''), setRenaming(true))} testID="rename-group" />}
      </Glass>

      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 40 }}>
        <Animated.View style={[{ alignItems: 'center', paddingTop: 18, gap: 6 }, big]}>
          {/* Admins change the group's photo (Announcements has its community's: change it there). */}
          {canEditInfo ? (
            <Pressy onPress={() => setPhotoOpen(true)} label={t.profilePhoto} scale={0.95} testID="group-photo">
              <Avatar id={id} name={title} size={104} group />
              <CameraBadge size={32} />
            </Pressy>
          ) : (
            // Tap to see it full screen, or "No profile photo", like WhatsApp.
            <Pressy onPress={() => router.push({ pathname: '/photo', params: { id, title } })} label={t.profilePhoto} scale={0.95} testID="info-photo">
              <Avatar id={id} name={title} size={104} group={group} online={!!presence?.online} />
            </Pressy>
          )}
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
            <Animated.View key={a.icon} entering={rise(60 + i * 40)} style={{ flex: 1 }}>
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

        {!group && other && other !== core.myId && (
          <Glass style={{ marginHorizontal: 12, marginTop: 16 }}>
            <SettingRow
              icon="userPlus"
              title={core.contacts[other] ? t.editContact : t.saveContact}
              sub={[core.contacts[other]?.phone && formatPhone(core.contacts[other].phone), core.contacts[other]?.email].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push({ pathname: '/contact', params: { id: other } })}
              testID="info-contact"
            />
          </Glass>
        )}

        {!group && other && other !== core.myId && (
          <Glass style={{ marginHorizontal: 12, marginTop: 12 }}>
            <SettingRow
              icon="heart"
              title={prefs.favourite ? t.removeFavourite : t.addFavourite}
              onPress={() => {
                core.setPrefs(id, { favourite: !prefs.favourite });
                toast(prefs.favourite ? t.removedFavourite : t.addedFavourite);
              }}
              testID="info-favourite"
            />
            <Divider />
            <SettingRow icon="text" title={t.addToList} onPress={() => setListOpen(true)} testID="info-add-to-list" />
          </Glass>
        )}

        <Glass style={{ marginHorizontal: 12, marginTop: 16 }}>
          <SettingRow icon="photo" title={t.media} onPress={() => router.push({ pathname: '/media/[id]', params: { id } })} testID="info-media" />
          <Divider />
          <SettingRow icon="star" title={t.starred} onPress={() => router.push({ pathname: '/starred', params: { chat: id } })} />
          <Divider />
          <SettingRow icon="export" title={t.exportChat} onPress={() => setExportOpen(true)} testID="info-export" />
        </Glass>

        <Glass style={{ marginHorizontal: 12, marginTop: 12 }}>
          <SettingRow
            icon="muted"
            title={t.muteNotifications}
            sub={mutedLine(prefs, t) || undefined}
            chevron={false}
            right={<Toggle on={!!prefs.muted} onChange={(on) => (on ? setMuting(true) : core.unmute(id))} label={t.mute} testID="mute-toggle" />}
          />
          <Divider />
          <SettingRow icon="tone" title={t.notificationTone} sub={toneName(prefs.tone, t)} onPress={() => setToneOpen(true)} testID="info-tone" />
          <Divider />
          <SettingRow icon="wallpaper" title={t.wallpaper} onPress={() => router.push({ pathname: '/wallpaper', params: { chat: id } })} testID="info-wallpaper" />
          <Divider />
          <SettingRow
            icon="lock"
            title={t.chatLock}
            sub={prefs.lock === 'folder' ? t.chatLockFolder : prefs.lock === 'list' ? t.chatLockList : t.chatLockOff}
            onPress={() => setLockOpen(true)}
            testID="info-lock"
          />
          <Divider />
          <SettingRow icon="timer" title={t.disappearing} sub={timerLabel(chat.timer ?? 0, t)} onPress={() => setTimerOpen(true)} testID="info-timer" />
          {!group && other && !self && (
            <>
              <Divider />
              <SettingRow icon="shield" title={t.encryption} sub={t.encryptionNote} onPress={() => router.push({ pathname: '/verify/[id]', params: { id: other } })} testID="verify" />
            </>
          )}
          {group && amAdmin && !ann && (
            <>
              <Divider />
              <SettingRow
                icon="lock"
                title={t.onlyAdminsSend}
                right={<Toggle on={!!chat.onlyAdminsSend} onChange={(on) => void act(() => core.client.updateGroup(id, { onlyAdminsSend: on }))} label={t.onlyAdminsSend} />}
              />
              <Divider />
              <SettingRow
                icon="edit"
                title={t.membersEditInfo}
                sub={t.membersEditInfoSub}
                right={<Toggle on={!!chat.membersEdit} onChange={(on) => void act(() => core.client.updateGroup(id, { membersEdit: on }))} label={t.membersEditInfo} testID="members-edit-toggle" />}
              />
              <Divider />
              <SettingRow
                icon="group"
                title={t.membersAddOthers}
                sub={t.membersAddOthersSub}
                right={<Toggle on={!!chat.membersAdd} onChange={(on) => void act(() => core.client.updateGroup(id, { membersAdd: on }))} label={t.membersAddOthers} testID="members-add-toggle" />}
              />
              <Divider />
              <SettingRow
                icon="userPlus"
                title={t.approveMembers}
                sub={t.approveMembersSub}
                right={
                  <Toggle on={!!chat.joinApproval} onChange={(on) => void act(() => core.client.updateGroup(id, { joinApproval: on }))} label={t.approveMembers} testID="approve-toggle" />
                }
              />
            </>
          )}
        </Glass>

        {seesRequests && (chat.joinApproval || requests.length > 0) && (
          <>
            <Section title={`${t.pendingRequests} · ${requests.length}`} />
            <Glass style={{ marginHorizontal: 12 }}>
              {requests.map((r, i) => (
                <View key={r.userId}>
                  {i > 0 && <Divider />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                    <Avatar id={r.userId} name={core.name(r.userId)} size={42} />
                    <Txt size={15.5} weight="600" lines={1} style={{ flex: 1 }}>
                      {core.name(r.userId) || '…'}
                    </Txt>
                    <IconButton
                      icon="close"
                      label={t.rejectWord}
                      look="glass"
                      size={38}
                      onPress={() => void act(async () => (await core.server.answerJoinRequest(id, r.userId, false), setRequests((old) => old.filter((o) => o.userId !== r.userId))))}
                      testID={`request-no-${i}`}
                    />
                    <IconButton
                      icon="tick"
                      label={t.approveWord}
                      look="soft"
                      size={38}
                      onPress={() => void act(async () => (await core.server.answerJoinRequest(id, r.userId, true), setRequests((old) => old.filter((o) => o.userId !== r.userId))))}
                      testID={`request-yes-${i}`}
                    />
                  </View>
                </View>
              ))}
              {!requests.length && (
                <Txt size={13.5} color={theme.muted} style={{ padding: 14 }}>
                  {t.noPending}
                </Txt>
              )}
            </Glass>
          </>
        )}

        {common.length > 0 && (
          <>
            <Section title={fill(common.length === 1 ? t.oneGroupInCommon : t.groupsInCommon, { n: common.length })} />
            <Glass style={{ marginHorizontal: 12 }}>
              {common.map((r, i) => (
                <View key={r.chat.id}>
                  {i > 0 && <Divider />}
                  <Pressy onPress={() => router.push({ pathname: '/chat/[id]', params: { id: r.chat.id } })} label={r.title} scale={0.98} testID={`common-${r.title}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                      <Avatar id={r.chat.id} name={r.title} size={42} group />
                      <View style={{ flex: 1 }}>
                        <Txt size={15.5} weight="600" lines={1}>
                          {r.title}
                        </Txt>
                        <Txt size={13} color={theme.muted} lines={1}>
                          {r.chat.members.map((m) => (m.userId === core.myId ? t.youWord : core.name(m.userId))).filter(Boolean).join(', ')}
                        </Txt>
                      </View>
                    </View>
                  </Pressy>
                </View>
              ))}
            </Glass>
          </>
        )}

        {group && !!chat.communityId && (
          <Glass style={{ marginHorizontal: 12, marginTop: 12 }}>
            <SettingRow icon="community" title={community?.title ?? t.community} sub={ann ? t.announcementsExitNote : t.partOfCommunity} onPress={() => router.push({ pathname: '/community/[id]', params: { id: chat.communityId! } })} testID="info-community" />
          </Glass>
        )}

        {group && (
          <>
            <Section title={fill(t.members, { n: chat.members.length })} />
            <Glass style={{ marginHorizontal: 12 }}>
              {canAdd && (
                <>
                  <SettingRow icon="userPlus" title={t.addMembers} onPress={() => router.push({ pathname: '/new-group', params: { add: id } })} testID="add-members" />
                  <Divider />
                </>
              )}
              {amAdmin && !chat.left && !ann && (
                <>
                  <SettingRow icon="link" title={t.inviteLink} sub={t.inviteViaLink} onPress={() => router.push({ pathname: '/invite/[id]', params: { id } })} testID="invite-link" />
                  <Divider />
                </>
              )}
              {members.map((mb, i) => (
                <Animated.View key={mb.userId} layout={LinearTransition.springify().damping(30).stiffness(210)}>
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
          {(group || (other && other !== core.myId)) && (
            <>
              <SettingRow icon="warning" title={group ? t.reportGroup : fill(t.reportName, { name: title })} danger chevron={false} onPress={() => setReporting(true)} testID="report" />
              <Divider />
            </>
          )}
          {group ? (
            chat.left ? (
              // Left: delete it or clear it, like WhatsApp's "Delete group".
              <SettingRow icon="trash" title={t.deleteGroup} danger chevron={false} onPress={() => setLeftChoices('ask')} testID="delete-group" />
            ) : (
              <SettingRow icon="leave" title={ann ? t.leaveCommunity : t.leaveGroup} danger chevron={false} onPress={() => setLeaving(true)} testID={ann ? 'exit-community' : 'leave-group'} />
            )
          ) : (
            other &&
            !self && (
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
                  const c = await core.client.openDirect(picked.userId, defaultTimer());
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

      <TonePicker visible={toneOpen} value={prefs.tone} forChat onPick={(tone) => core.setPrefs(id, { tone })} onClose={() => setToneOpen(false)} />
      <ExportSheet visible={exportOpen} chatId={id} onClose={() => setExportOpen(false)} />
      <ChatLockSheet visible={lockOpen} chatId={id} onClose={() => setLockOpen(false)} />
      <AddToListSheet visible={listOpen} chatIds={[id]} onClose={() => setListOpen(false)} />
      <ReportSheet visible={reporting} chatId={id} group={group} userId={group ? null : other} onClose={() => setReporting(false)} />
      <MuteSheet visible={muting} onClose={() => setMuting(false)} onPick={(ms) => core.mute(id, ms)} />
      <PhotoSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} has={!!chat.photo} chatId={id} title={title} />

      {/* Announcements: nobody leaves them alone, they exit the community (and its groups), as on WhatsApp. */}
      <Dialog
        visible={leaving && ann}
        onClose={() => setLeaving(false)}
        title={t.leaveCommunity}
        text={fill(t.leaveCommunityNote, {
          name: community?.title ?? '',
          n: (rows ?? []).filter((r) => r.chat.communityId === chat.communityId && !r.chat.announcements && !r.chat.left).length,
        })}
        buttons={[
          {
            label: t.leaveCommunity,
            danger: true,
            testID: 'confirm-exit-community',
            onPress: () => {
              setLeaving(false);
              void act(async () => {
                await core.client.removeMember(chat.communityId!, core.myId);
                await core.client.syncChats().catch(() => {});
                router.back();
              });
            },
          },
          { label: t.cancel, onPress: () => setLeaving(false) },
        ]}
      />
      <Dialog
        visible={leaving && !ann}
        onClose={() => setLeaving(false)}
        title={fill(t.leaveSure, { name: title })}
        buttons={[
          {
            label: t.leaveGroup,
            danger: true,
            testID: 'confirm-leave',
            onPress: () => {
              setLeaving(false);
              void act(async () => {
                await core.client.removeMember(id, core.myId);
                setLeftChoices('left');
              });
            },
          },
          { label: t.cancel, onPress: () => setLeaving(false) },
        ]}
      />
      <LeftGroupChoices chatId={id} name={title} visible={leftChoices !== null} justLeft={leftChoices === 'left'} onClose={() => setLeftChoices(null)} />
    </Screen>
  );
}
