// community/[id].tsx: one community, like WhatsApp's community page.
//
// Its name, its members count and what it's for; then its announcements and
// the groups I'm in; then the groups I can join (or ask to join, when a
// group's admins approve who joins). Its members, with its admins and owner.
//
// Its admins: share its invite link, add their groups or make a new one,
// approve or reject groups others suggested, take a group out (hold it),
// make someone a community admin or remove them (from the community and all
// its groups), change its name, and choose who can add groups. Anyone else
// can suggest a group when its admins allow it. Anyone can exit it (which
// takes them out of its announcements and its groups too). Its owner can
// deactivate it: its groups go on, on their own.
import { REQUESTED, type CommunityGroup, type GroupSuggestion } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core, isOffline } from '../../core/core';
import { useChat, useChatList, type ChatRow } from '../../core/hooks';
import { defaultTimer } from '../../core/timer';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { GroupLine } from '../../ui/GroupLine';
import { GroupPicker } from '../../ui/GroupPicker';
import { Icon, type IconName } from '../../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, Section, SettingRow, TopBar, Txt } from '../../ui/kit';
import { thud } from '../../ui/motion';
import { Dialog, MenuItem, Sheet, toast } from '../../ui/overlays';
import { ReportSheet } from '../../ui/ReportSheet';
import { CameraBadge, PhotoSheet } from '../../ui/PhotoSheet';

/** How many members show before "View all". */
const SOME = 6;

export default function Community() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const community = useChat(id);
  const rows = useChatList();
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [making, setMaking] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [holding, setHolding] = useState<ChatRow | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState(false);
  const [choosingAdds, setChoosingAdds] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Its groups and the suggestions waiting, from the server (unchanged while
  // offline). Again after each change here, and whenever someone suggests a group.
  const [round, setRound] = useState(0);
  const load = () => setRound((n) => n + 1);
  useEffect(() => {
    let alive = true;
    const fetch = async () => {
      try {
        const r = await core.server.communityGroups(id);
        await core.client.adopt(r.community);
        const waiting = await core.server.groupSuggestions(id);
        if (!alive) return;
        setGroups(r.groups);
        setSuggestions(waiting);
      } catch {
        // Offline, or I'm not in it any more.
      }
    };
    void fetch();
    const off = core.on(`notice:${id}`, () => void fetch());
    return () => {
      alive = false;
      off();
    };
  }, [id, round]);

  if (!community) return <Screen>{null}</Screen>;
  const name = community.title ?? '';
  const admin = community.members.some((m) => m.userId === core.myId && m.role === 'admin');
  const owner = community.createdBy === core.myId;
  const maySuggest = !admin && !!community.groupsByMembers;
  const mine = (rows ?? []).filter((r) => r.chat.communityId === id && !r.chat.left).sort((a, b) => Number(!!b.chat.announcements) - Number(!!a.chat.announcements));
  const others = groups.filter((g) => !g.joined && !g.announcements);
  // Me first, then its owner and admins, then everyone else by name.
  const rank = (u: string) => (u === core.myId ? 0 : u === community.createdBy ? 1 : community.members.find((m) => m.userId === u)?.role === 'admin' ? 2 : 3);
  const members = community.members.map((m) => m.userId).sort((a, b) => rank(a) - rank(b) || core.name(a).localeCompare(core.name(b)));
  const isAdmin = (u: string) => community.members.some((m) => m.userId === u && m.role === 'admin');

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(null);
    }
  }

  const addGroups = () =>
    run('add', async () => {
      await core.server.addCommunityGroups(id, picked);
      await core.client.syncChats();
      setAdding(false);
      setPicked([]);
      load();
    });

  const makeGroup = () =>
    run('make', async () => {
      const groupId = await core.server.addCommunityGroups(id, [], { title: newTitle.trim() });
      setMaking(false);
      setNewTitle('');
      if (groupId) {
        await core.client.adopt(await core.server.chat(groupId));
        router.push({ pathname: '/chat/[id]', params: { id: groupId } });
      }
      load();
    });

  const suggest = () =>
    run('suggest', async () => {
      await core.server.suggestGroups(id, picked, newTitle);
      setSuggesting(false);
      setPicked([]);
      setNewTitle('');
      toast(t.suggestionSent);
      load();
    });

  const answer = (s: GroupSuggestion, yes: boolean) =>
    run(`s-${s.id}`, async () => {
      await core.server.answerSuggestion(id, s.id, yes);
      setSuggestions((old) => old.filter((o) => o.id !== s.id));
      if (yes) await core.client.syncChats();
      load();
    });

  const join = (g: CommunityGroup) =>
    run(`join-${g.id}`, async () => {
      const got = await core.server.joinCommunityGroup(id, g.id);
      if (got === REQUESTED) {
        toast(t.requestSent);
        setGroups((old) => old.map((o) => (o.id === g.id ? { ...o, requested: true } : o)));
        return;
      }
      const chat = await core.client.adopt(got);
      setGroups((old) => old.map((o) => (o.id === g.id ? { ...o, joined: true } : o)));
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    });

  const unrequest = (g: CommunityGroup) =>
    run(`join-${g.id}`, async () => {
      await core.server.answerJoinRequest(g.id, core.myId, false);
      setGroups((old) => old.map((o) => (o.id === g.id ? { ...o, requested: false } : o)));
    });

  const takeOut = (row: ChatRow) =>
    run('remove', async () => {
      setHolding(null);
      await core.server.removeCommunityGroup(id, row.chat.id);
      await core.client.adopt(await core.server.chat(row.chat.id));
      load();
    });

  const save = () =>
    run('save', async () => {
      await core.client.updateGroup(id, { title: title.trim(), description: about.trim() });
      setEditing(false);
    });

  const whoAdds = (everyone: boolean) =>
    run('adds', async () => {
      setChoosingAdds(false);
      await core.client.updateGroup(id, { groupsByMembers: everyone });
    });

  const message = (userId: string) =>
    run('message', async () => {
      setPerson(null);
      const chat = await core.client.openDirect(userId, defaultTimer());
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    });

  const remove = (userId: string) =>
    run('person', async () => {
      setRemoving(null);
      await core.client.removeMember(id, userId);
      await core.client.syncChats().catch(() => {});
    });

  const leave = () =>
    run('leave', async () => {
      setLeaving(false);
      await core.client.removeMember(id, core.myId);
      await core.client.syncChats().catch(() => {});
      router.back();
    });

  const deactivate = () =>
    run('deactivate', async () => {
      setDeactivating(false);
      await core.server.deactivateCommunity(id);
      await core.client.syncChats().catch(() => {});
      toast(t.communityDeactivated);
      router.back();
    });

  const shown = allMembers ? members : members.slice(0, SOME);

  return (
    <Screen>
      <TopBar
        title={t.community}
        onBack={() => router.back()}
        right={
          admin ? (
            <IconButton
              icon="edit"
              label={t.editCommunity}
              onPress={() => {
                setTitle(name);
                setAbout(community.description ?? '');
                setEditing(true);
              }}
              testID="community-edit"
            />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
        <Animated.View style={{ alignItems: 'center', gap: 6, paddingVertical: 12 }}>
          {admin ? (
            <Pressy onPress={() => setPhotoOpen(true)} label={t.profilePhoto} scale={0.95} testID="community-photo">
              <Avatar id={id} name={name} size={88} group square />
              <CameraBadge size={30} />
            </Pressy>
          ) : (
            <Pressy onPress={() => router.push({ pathname: '/photo', params: { id, title: name } })} label={t.profilePhoto} scale={0.95} testID="community-photo-view">
              <Avatar id={id} name={name} size={88} group square />
            </Pressy>
          )}
          <Txt size={22} weight="800" align="center" testID="community-name">
            {name}
          </Txt>
          <Txt size={13.5} color={theme.muted}>
            {fill(t.communityMembers, { n: community.members.length })}
          </Txt>
          {!!community.description && (
            <Txt size={14} color={theme.sectionText} align="center" style={{ paddingHorizontal: 20 }}>
              {community.description}
            </Txt>
          )}
        </Animated.View>

        {(admin || maySuggest) && (
          <Animated.View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
            {admin && <Action icon="link" label={t.inviteLink} onPress={() => router.push({ pathname: '/invite/[id]', params: { id } })} testID="community-invite" />}
            {admin && <Action icon="plus" label={t.addGroups} onPress={() => setAdding(true)} testID="community-add" />}
            {admin && <Action icon="group" label={t.newGroupHere} onPress={() => setMaking(true)} testID="community-new-group" />}
            {maySuggest && <Action icon="plus" label={t.suggestGroup} onPress={() => setSuggesting(true)} testID="community-suggest" />}
          </Animated.View>
        )}

        {/* Groups waiting: all of them for its admins, my own for anyone else. */}
        {suggestions.length > 0 && (
          <Glass style={{ marginTop: 12 }}>
            <SettingRow
              icon="group"
              title={admin ? t.groupSuggestions : t.yourSuggestions}
              sub={admin ? String(suggestions.length) : t.waitingForAdmins}
              onPress={() => setReviewing(true)}
              right={
                <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={12.5} weight="700" color="#FFFFFF">
                    {suggestions.length}
                  </Txt>
                </View>
              }
              testID="community-suggestions"
            />
          </Glass>
        )}

        <Section title={t.groupsYouAreIn} />
        <Glass style={{ paddingVertical: 4 }}>
          {mine.map((r, i) => (
            <View key={r.chat.id}>
              {i > 0 && <Divider />}
              <GroupLine row={r} onLongPress={admin && !r.chat.announcements ? () => (thud(), setHolding(r)) : undefined} />
            </View>
          ))}
          {!mine.length && (
            <Txt size={13.5} color={theme.muted} style={{ padding: 14 }}>
              {t.noGroupsYet}
            </Txt>
          )}
        </Glass>

        {others.length > 0 && (
          <>
            <Section title={t.groupsToJoin} />
            <Glass style={{ paddingVertical: 4 }}>
              {others.map((g, i) => (
                <View key={g.id}>
                  {i > 0 && <Divider />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                    <Avatar id={g.id} name={g.title} size={40} group />
                    <View style={{ flex: 1 }}>
                      <Txt size={15} weight="700" lines={1}>
                        {g.title}
                      </Txt>
                      <Txt size={12.5} color={theme.muted} lines={1}>
                        {g.description || fill(t.groupMembers, { n: g.members })}
                      </Txt>
                    </View>
                    {g.requested ? (
                      <Button title={t.requestedWord} look="soft" busy={busy === `join-${g.id}`} onPress={() => void unrequest(g)} testID={`community-requested-${g.title}`} />
                    ) : (
                      <Button title={g.approval ? t.requestWord : t.joinWord} look="soft" busy={busy === `join-${g.id}`} onPress={() => void join(g)} testID={`community-join-${g.title}`} />
                    )}
                  </View>
                </View>
              ))}
            </Glass>
          </>
        )}

        <Section title={`${t.membersTitle} · ${members.length}`} />
        <Glass style={{ paddingVertical: 4 }}>
          {shown.map((u, i) => (
            <View key={u}>
              {i > 0 && <Divider />}
              <Pressy onPress={() => u !== core.myId && setPerson(u)} label={core.name(u)} scale={0.98} testID={`community-member-${i}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Avatar id={u} name={core.name(u)} size={40} />
                  <Txt size={15} weight="600" lines={1} style={{ flex: 1 }}>
                    {u === core.myId ? t.youWord : core.name(u)}
                  </Txt>
                  {(u === community.createdBy || isAdmin(u)) && (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: theme.accSoft }}>
                      <Txt size={11.5} weight="700" color={theme.accInk}>
                        {u === community.createdBy ? t.ownerWord : t.communityAdmin}
                      </Txt>
                    </View>
                  )}
                </View>
              </Pressy>
            </View>
          ))}
          {members.length > SOME && !allMembers && (
            <>
              <Divider />
              <SettingRow title={t.viewAll} onPress={() => setAllMembers(true)} testID="community-all-members" />
            </>
          )}
        </Glass>

        {admin && (
          <>
            <Section title={t.communitySettings} />
            <Glass>
              <SettingRow
                icon="settings"
                title={t.whoCanAddGroups}
                sub={community.groupsByMembers ? t.everyoneSuggests : t.onlyCommunityAdmins}
                onPress={() => setChoosingAdds(true)}
                testID="community-who-adds"
              />
            </Glass>
          </>
        )}

        <Glass style={{ marginTop: 18 }}>
          <SettingRow icon="flag" title={t.report} danger chevron={false} onPress={() => setReporting(true)} testID="community-report" />
          <Divider />
          <SettingRow icon="leave" title={t.leaveCommunity} danger chevron={false} onPress={() => setLeaving(true)} testID="community-leave" />
          {owner && (
            <>
              <Divider />
              <SettingRow icon="close" title={t.deactivateCommunity} danger chevron={false} onPress={() => setDeactivating(true)} testID="community-deactivate" />
            </>
          )}
        </Glass>
      </ScrollView>

      <Sheet visible={adding} onClose={() => setAdding(false)} title={t.addGroups}>
        <ScrollView style={{ maxHeight: 420 }}>
          <GroupPicker picked={picked} onToggle={(g) => setPicked((old) => (old.includes(g) ? old.filter((x) => x !== g) : [...old, g]))} />
        </ScrollView>
        <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
          <Button title={t.addGroups} busy={busy === 'add'} disabled={!picked.length} onPress={() => void addGroups()} testID="community-add-yes" />
        </View>
      </Sheet>

      <Sheet visible={making} onClose={() => setMaking(false)} title={t.newGroupHere}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Field value={newTitle} onChangeText={setNewTitle} placeholder={t.groupName} maxLength={50} autoFocus testID="community-group-title" />
          <Button title={t.createGroup} busy={busy === 'make'} disabled={!newTitle.trim()} onPress={() => void makeGroup()} testID="community-group-create" />
        </View>
      </Sheet>

      {/* Suggesting: a new group by its name, and/or groups of mine. */}
      <Sheet visible={suggesting} onClose={() => setSuggesting(false)} title={t.suggestGroup}>
        <View style={{ paddingHorizontal: 18, paddingTop: 2, gap: 10 }}>
          <Txt size={13.5} color={theme.muted}>
            {t.suggestNote}
          </Txt>
          <Field value={newTitle} onChangeText={setNewTitle} placeholder={t.suggestNewGroup} maxLength={50} testID="community-suggest-title" />
        </View>
        <ScrollView style={{ maxHeight: 300 }}>
          <GroupPicker picked={picked} onToggle={(g) => setPicked((old) => (old.includes(g) ? old.filter((x) => x !== g) : [...old, g]))} />
        </ScrollView>
        <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
          <Button title={t.suggestGroup} busy={busy === 'suggest'} disabled={!picked.length && !newTitle.trim()} onPress={() => void suggest()} testID="community-suggest-yes" />
        </View>
      </Sheet>

      <Sheet visible={reviewing} onClose={() => setReviewing(false)} title={admin ? t.groupSuggestions : t.yourSuggestions}>
        <ScrollView style={{ maxHeight: 460 }}>
          {suggestions.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10 }}>
              <Avatar id={s.id} name={s.title} size={42} group />
              <View style={{ flex: 1 }}>
                <Txt size={15} weight="700" lines={1}>
                  {s.title}
                </Txt>
                <Txt size={12.5} color={theme.muted} lines={1}>
                  {s.isNew ? fill(t.newGroupBy, { name: core.name(s.suggestedBy) }) : fill(t.groupBy, { n: s.members, name: core.name(s.suggestedBy) })}
                </Txt>
              </View>
              {admin ? (
                <>
                  <IconButton icon="close" label={t.rejectWord} look="glass" size={38} onPress={() => void answer(s, false)} testID={`suggestion-no-${s.title}`} />
                  <IconButton icon="tick" label={t.approveWord} look="soft" size={38} onPress={() => void answer(s, true)} testID={`suggestion-yes-${s.title}`} />
                </>
              ) : (
                <Button title={t.cancel} look="soft" busy={busy === `s-${s.id}`} onPress={() => void answer(s, false)} testID={`suggestion-cancel-${s.title}`} />
              )}
            </View>
          ))}
          {!suggestions.length && (
            <Txt size={14} color={theme.muted} align="center" style={{ padding: 20 }}>
              {t.noPending}
            </Txt>
          )}
        </ScrollView>
      </Sheet>

      {/* Someone in it: message them, and (admins) make them an admin or remove them. */}
      <Sheet visible={person !== null} onClose={() => setPerson(null)} title={person ? core.name(person) : ''}>
        {person && (
          <>
            <MenuItem icon="chat" label={fill(t.messageName, { name: core.name(person) })} onPress={() => void message(person)} testID="community-person-message" />
            {admin && person !== community.createdBy && (
              <MenuItem
                icon="key"
                label={isAdmin(person) ? t.dismissCommunityAdmin : t.makeCommunityAdmin}
                onPress={() => {
                  const u = person;
                  setPerson(null);
                  void run('person', async () => void (await core.client.setAdmin(id, u, !isAdmin(u))));
                }}
                testID="community-person-admin"
              />
            )}
            {admin && person !== community.createdBy && (
              <MenuItem
                icon="leave"
                label={t.removePerson}
                danger
                onPress={() => {
                  setRemoving(person);
                  setPerson(null);
                }}
                testID="community-person-remove"
              />
            )}
          </>
        )}
      </Sheet>

      <Sheet visible={choosingAdds} onClose={() => setChoosingAdds(false)} title={t.whoCanAddGroups}>
        <MenuItem icon={community.groupsByMembers ? 'tick' : undefined} label={t.everyoneSuggests} onPress={() => void whoAdds(true)} testID="community-adds-everyone" />
        <MenuItem icon={community.groupsByMembers ? undefined : 'tick'} label={t.onlyCommunityAdmins} onPress={() => void whoAdds(false)} testID="community-adds-admins" />
      </Sheet>

      <Sheet visible={editing} onClose={() => setEditing(false)} title={t.editCommunity}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Field value={title} onChangeText={setTitle} placeholder={t.communityName} maxLength={50} testID="community-edit-title" />
          <Field value={about} onChangeText={setAbout} placeholder={t.communityAbout} maxLength={500} testID="community-edit-about" />
          <Button title={t.save} busy={busy === 'save'} disabled={!title.trim()} onPress={() => void save()} testID="community-edit-save" />
        </View>
      </Sheet>

      <Dialog
        visible={holding !== null}
        onClose={() => setHolding(null)}
        title={t.removeFromCommunity}
        text={holding ? fill(t.removeFromCommunityNote, { name: holding.title }) : ''}
        buttons={[
          { label: t.removeWord, danger: true, onPress: () => holding && void takeOut(holding), testID: 'community-remove-yes' },
          { label: t.cancel, onPress: () => setHolding(null) },
        ]}
      />
      <Dialog
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={t.removePerson}
        text={removing ? fill(t.removePersonNote, { name: core.name(removing) }) : ''}
        buttons={[
          { label: t.removeWord, danger: true, onPress: () => removing && void remove(removing), testID: 'community-person-remove-yes' },
          { label: t.cancel, onPress: () => setRemoving(null) },
        ]}
      />
      <Dialog
        visible={leaving}
        onClose={() => setLeaving(false)}
        title={t.leaveCommunity}
        text={fill(t.leaveCommunityNote, { name, n: mine.filter((r) => !r.chat.announcements).length })}
        buttons={[
          { label: t.leaveCommunity, danger: true, onPress: () => void leave(), testID: 'community-leave-yes' },
          { label: t.cancel, onPress: () => setLeaving(false) },
        ]}
      />
      <Dialog
        visible={deactivating}
        onClose={() => setDeactivating(false)}
        title={t.deactivateCommunity}
        text={t.deactivateNote}
        buttons={[
          { label: t.deactivateCommunity, danger: true, onPress: () => void deactivate(), testID: 'community-deactivate-yes' },
          { label: t.cancel, onPress: () => setDeactivating(false) },
        ]}
      />
      <ReportSheet visible={reporting} onClose={() => setReporting(false)} chatId={id} group userId={null} />
      <PhotoSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} has={!!community.photo} chatId={id} title={name} />
    </Screen>
  );
}

/** One of the buttons under the community's name. */
function Action({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  const { theme } = useLook();
  return (
    <View style={{ flex: 1 }}>
      <Pressy onPress={onPress} label={label} scale={0.95} testID={testID}>
        <Glass style={{ alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 18 }}>
          <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={19} color={theme.accInk} />
          </View>
          <Txt size={12.5} weight="700" color={theme.accInk} align="center" lines={1}>
            {label}
          </Txt>
        </Glass>
      </Pressy>
    </View>
  );
}
