// new-chat.tsx: start a chat, like WhatsApp's "Select contact". It opens on your
// contacts (no keyboard), with New group, New contact and New community at the top,
// then the people on PakChat, then phone contacts who aren't, with Invite.
//
// 🔍 turns the top bar into a search box that filters the list. A number or a Gmail
// (or just the part before "@gmail.com") that none of them match gets a "Find on
// PakChat" row: found, a sheet offers Message (straight away, as before) or Add to
// contacts (New contact, filled in; once saved, the chat opens). Not on PakChat: Invite.
// ⋮ has Refresh contacts (pulling the list down does it too), Invite a friend and help.
import { formatPhone } from '@pakchat/shared';
import { Contact, ContactField, getPermissionsAsync } from 'expo-contacts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Share, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { core, isOffline } from '../core/core';
import { defaultTimer } from '../core/timer';
import { findFromPhoneBook } from '../core/phoneBook';
import { usePeople, usePerson } from '../core/hooks';
import { lookupKind, type LookupKind } from '../core/lookupKind';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon, type IconName } from '../ui/icons';
import { Avatar, Button, Field, IconButton, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { Dialog, MenuItem, Popup, Sheet, toast } from '../ui/overlays';

type Item =
  | { kind: 'head'; title: string }
  | { kind: 'action'; icon: IconName; title: string; go: () => void; testID: string; qr?: boolean }
  | { kind: 'me' }
  | { kind: 'find'; what: LookupKind; shown: string }
  | { kind: 'none' }
  | { kind: 'person'; id: string; name: string; about?: string | null }
  | { kind: 'invite'; name: string; number: string };

/** What the Find row found: someone on PakChat, or nobody. */
type Found = { what: LookupKind; shown: string; person: { id: string; name: string } | null };

export default function NewChat() {
  const t = useT();
  const { theme } = useLook();
  const people = usePeople();
  // null: not searching (the list, no keyboard). A string: the search box is open.
  const [query, setQuery] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [helping, setHelping] = useState(false);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [syncing, setSyncing] = useState(false);
  const myName = usePerson(core.myId)?.name ?? '';
  const q = (query ?? '').trim().toLowerCase();

  // My contacts first (by the names I gave them), then others I chat with ("~ Name").
  const everyone = useMemo(
    () =>
      Object.values(people)
        .filter((p) => p.id !== core.myId && p.name)
        .map((p) => ({ id: p.id, name: core.name(p.id), about: p.about, saved: core.isContact(p.id) }))
        .sort((a, b) => Number(b.saved) - Number(a.saved) || a.name.replace(/^~ /, '').localeCompare(b.name.replace(/^~ /, ''))),
    [people],
  );
  const known = useMemo(() => (q ? everyone.filter((p) => p.name.toLowerCase().includes(q)) : everyone), [everyone, q]);
  const showMe = !q || myName.toLowerCase().includes(q);

  // Phone contacts not on PakChat, with an Invite button, like WhatsApp (only once PakChat may
  // see the contacts; nothing is sent anywhere, the list is only shown here).
  const [phone, setPhone] = useState<{ name: string; number: string }[]>([]);
  useEffect(() => {
    if (syncing) return;
    let gone = false;
    void (async () => {
      if (!(await getPermissionsAsync()).granted) return;
      const all = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES] as const);
      if (gone) return;
      const out = all
        .map((c) => ({ name: (c.fullName ?? '').trim(), number: c.phones?.find((p) => p.number)?.number ?? '' }))
        .filter((c) => c.name && c.number)
        .sort((a, b) => a.name.localeCompare(b.name));
      setPhone(out);
    })().catch(() => {});
    return () => {
      gone = true;
    };
  }, [syncing]);
  const invites = useMemo(() => {
    const onApp = new Set(Object.values(people).map((p) => core.name(p.id).replace(/^~ /, '').toLowerCase()));
    const seen = new Set<string>();
    return phone.filter((c) => {
      const k = c.name.toLowerCase();
      if (onApp.has(k) || seen.has(k) || (q && !k.includes(q))) return false;
      seen.add(k);
      return true;
    });
  }, [phone, people, q]);

  // A number or a Gmail that nobody in the list matches: offer to find it on PakChat.
  const what = q && known.length === 0 ? lookupKind(q) : null;
  const shown = what ? (what.kind === 'phone' ? formatPhone(what.phone) : what.email) : '';

  const items: Item[] = [
    ...(q
      ? []
      : ([
          { kind: 'action', icon: 'group', title: t.newGroup, go: () => router.replace('/new-group'), testID: 'to-new-group' },
          { kind: 'action', icon: 'userPlus', title: t.newContact, go: () => router.push('/contact'), testID: 'new-contact', qr: true },
          { kind: 'action', icon: 'community', title: t.newCommunity, go: () => router.replace('/new-community'), testID: 'to-new-community' },
        ] as const)),
    ...(what ? [{ kind: 'find' as const, what, shown }] : []),
    { kind: 'head', title: t.contactsOnPakChat },
    ...(showMe ? [{ kind: 'me' as const }] : []),
    ...known.map((p) => ({ kind: 'person' as const, ...p })),
    ...(q && !showMe && known.length === 0 ? [{ kind: 'none' as const }] : []),
    ...(invites.length ? [{ kind: 'head' as const, title: t.inviteSection }, ...invites.map((c) => ({ kind: 'invite' as const, ...c }))] : []),
  ];

  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    try {
      const n = await findFromPhoneBook();
      toast(n === null ? t.noContactsAccess : fill(t.foundContacts, { n }));
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setSyncing(false);
    }
  }

  async function find(item: { what: LookupKind; shown: string }) {
    if (finding) return;
    setFinding(true);
    try {
      const person = await core.lookup(item.what.kind === 'phone' ? item.what.phone : item.what.email);
      setFound({ ...item, person });
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setFinding(false);
    }
  }

  // A second tap while the chat is opening does nothing (no second chat screen).
  const opening = useRef(false);
  const open = useCallback(
    async (userId: string) => {
      if (opening.current) return;
      opening.current = true;
      try {
        const chat = await core.client.openDirect(userId, defaultTimer());
        router.replace({ pathname: '/chat/[id]', params: { id: chat.id } });
      } catch (err) {
        toast(isOffline(err) ? t.offline : t.couldNot);
      } finally {
        opening.current = false;
      }
    },
    [t],
  );

  // Add to contacts: New contact, filled in. Back here once it's saved, the chat opens.
  const adding = useRef<string | null>(null);
  function addToContacts(f: Found) {
    if (!f.person) return;
    adding.current = f.person.id;
    setFound(null);
    router.push({ pathname: '/contact', params: { name: f.person.name, ...(f.what.kind === 'phone' ? { phone: f.what.phone } : { email: f.what.email }) } });
  }

  // Back here (from New contact, or anywhere): opens the chat of someone just saved. Back
  // (the phone's button) closes the search first, instead of leaving.
  const searching = query !== null;
  useFocusEffect(
    useCallback(() => {
      const just = adding.current;
      adding.current = null;
      if (just && core.isContact(just)) void open(just);
      if (!searching) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setQuery(null);
        return true;
      });
      return () => sub.remove();
    }, [searching, open]),
  );

  function invite(f: Found) {
    setFound(null);
    const link =
      f.what.kind === 'phone'
        ? `sms:${f.what.phone}?body=${encodeURIComponent(t.inviteMessage)}`
        : `mailto:${f.what.email}?subject=${encodeURIComponent(t.appName)}&body=${encodeURIComponent(t.inviteMessage)}`;
    void Linking.openURL(link).catch(() => toast(t.couldNot));
  }
  const shareInvite = () => void Share.share({ message: t.inviteMessage }).catch(() => {});

  const row = { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 9 } as const;
  const circle = { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' } as const;
  const name = found?.person ? core.name(found.person.id) || `~ ${found.person.name}` : '';
  const about = found?.person ? people[found.person.id]?.about : null;

  return (
    <Screen>
      {searching ? (
        <TopBar onBack={() => setQuery(null)} right={query ? <IconButton icon="close" label={t.close} onPress={() => setQuery('')} color={theme.muted} testID="search-clear" /> : undefined}>
          <View style={{ flex: 1, paddingHorizontal: 2 }}>
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder={t.searchPeopleHint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => what && void find({ what, shown })}
              autoFocus
              testID="find-field"
            />
          </View>
        </TopBar>
      ) : (
        <TopBar
          title={t.selectContact}
          subtitle={fill(t.nContacts, { n: everyone.length })}
          onBack={() => router.back()}
          right={
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="search" label={t.search} onPress={() => setQuery('')} color={theme.muted} testID="open-search" />
              <IconButton icon="more" label={t.moreOptions} onPress={() => setMenu(true)} color={theme.muted} testID="new-chat-menu" />
            </View>
          }
        />
      )}

      {/* A recycling list: rows that scroll away are reused for the ones coming in. */}
      <FlashList
        maintainVisibleContentPosition={{ disabled: true }}
        data={items}
        keyExtractor={(p, i) => (p.kind === 'person' ? p.id : p.kind === 'action' ? p.testID : p.kind === 'head' ? `head-${p.title}` : p.kind === 'invite' ? `invite-${i}` : p.kind)}
        getItemType={(p) => p.kind}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={syncing}
        onRefresh={() => void refresh()}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 30 }}
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'head':
              return (
                <Txt size={13.5} weight="600" color={theme.sectionText} style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
                  {item.title}
                </Txt>
              );
            case 'action':
              return (
                <Pressy onPress={item.go} label={item.title} scale={0.98} testID={item.testID}>
                  <View style={row}>
                    <View style={circle}>
                      <Icon name={item.icon} size={22} color={theme.accInk} />
                    </View>
                    <Txt size={16} weight="600" lines={1} style={{ flex: 1 }}>
                      {item.title}
                    </Txt>
                    {item.qr && (
                      <Pressy onPress={() => router.push({ pathname: '/qr', params: { tab: 'scan' } })} label={t.scanCode} hitSlop={8} testID="new-contact-qr">
                        <Icon name="qr" size={23} color={theme.accInk} />
                      </Pressy>
                    )}
                  </View>
                </Pressy>
              );
            case 'find':
              return (
                <Pressy onPress={() => void find(item)} label={fill(t.findOnPakChat, { q: item.shown })} scale={0.98} testID="find-on-pakchat">
                  <View style={row}>
                    <View style={circle}>{finding ? <ActivityIndicator color={theme.accInk} /> : <Icon name="search" size={22} color={theme.accInk} />}</View>
                    <View style={{ flex: 1 }}>
                      <Txt size={16} weight="600" lines={2}>
                        {fill(t.findOnPakChat, { q: item.shown })}
                      </Txt>
                      <Txt size={13} color={theme.muted}>
                        {t.notInContacts}
                      </Txt>
                    </View>
                  </View>
                </Pressy>
              );
            case 'none':
              return (
                <Txt size={14} color={theme.muted} style={{ paddingHorizontal: 16, paddingVertical: 8 }} testID="no-contacts-match">
                  {t.noContactsMatch}
                </Txt>
              );
            case 'me':
              // Messaging myself first, like WhatsApp: notes, links and files to keep.
              return (
                <Pressy onPress={() => void open(core.myId)} label={t.messageYourself} scale={0.98} testID="message-yourself">
                  <View style={row}>
                    <Avatar id={core.myId} name={myName} size={44} />
                    <View style={{ flex: 1 }}>
                      <Txt size={16} weight="600" lines={1}>
                        {`${myName} (${t.youWord})`}
                      </Txt>
                      <Txt size={13} color={theme.muted} lines={1}>
                        {t.messageYourself}
                      </Txt>
                    </View>
                  </View>
                </Pressy>
              );
            case 'invite':
              return (
                <View style={row} testID={`invite-${item.name}`}>
                  <Avatar id={`phone:${item.number}`} name={item.name} size={44} />
                  <Txt size={16} weight="600" lines={1} style={{ flex: 1 }}>
                    {item.name}
                  </Txt>
                  <Pressy onPress={() => void Linking.openURL(`sms:${item.number.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(t.inviteMessage)}`).catch(() => toast(t.couldNot))} label={t.inviteWord} hitSlop={8}>
                    <Txt size={15} weight="700" color={theme.acc}>
                      {t.inviteWord}
                    </Txt>
                  </Pressy>
                </View>
              );
            case 'person':
              return (
                <Pressy onPress={() => void open(item.id)} label={item.name} scale={0.98} testID={`person-${item.name}`}>
                  <View style={row}>
                    <Avatar id={item.id} name={item.name} size={44} />
                    <View style={{ flex: 1 }}>
                      <Txt size={16} weight="600" lines={1}>
                        {item.name}
                      </Txt>
                      {!!item.about && (
                        <Txt size={13} color={theme.muted} lines={1}>
                          {item.about}
                        </Txt>
                      )}
                    </View>
                  </View>
                </Pressy>
              );
          }
        }}
      />

      {/* Found (or not) on PakChat. */}
      <Sheet visible={!!found} onClose={() => setFound(null)}>
        {found && (
          <View style={{ paddingHorizontal: 18, paddingBottom: 8, gap: 18 }} testID={found.person ? 'found-sheet' : 'not-found-sheet'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {found.person ? <Avatar id={found.person.id} name={name} size={60} /> : <Avatar id={`find:${found.shown}`} name={found.shown} size={60} />}
              <View style={{ flex: 1 }}>
                <Txt size={18.5} weight="700" lines={1}>
                  {found.person ? name : found.shown}
                </Txt>
                <Txt size={13.5} color={theme.muted} lines={1}>
                  {found.person ? found.shown : t.notOnPakChatYet}
                </Txt>
                {!!about && (
                  <Txt size={13.5} color={theme.sectionText} lines={1}>
                    {about}
                  </Txt>
                )}
              </View>
            </View>
            {found.person ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button title={t.message} onPress={() => (setFound(null), void open(found.person!.id))} testID="found-message" />
                  </View>
                  {!core.isContact(found.person.id) && found.person.id !== core.myId && (
                    <View style={{ flex: 1 }}>
                      <Button title={t.addToContacts} look="soft" onPress={() => addToContacts(found)} testID="found-add" />
                    </View>
                  )}
                </View>
                {!core.isContact(found.person.id) && found.person.id !== core.myId && (
                  <Txt size={12.5} color={theme.muted} align="center">
                    {fill(t.savedNameNote, { name })}
                  </Txt>
                )}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title={found.what.kind === 'phone' ? t.inviteBySms : t.inviteByEmail} onPress={() => invite(found)} testID="found-invite" />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title={t.shareLink} look="soft" onPress={() => (setFound(null), shareInvite())} testID="found-share" />
                </View>
              </View>
            )}
          </View>
        )}
      </Sheet>

      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem label={t.refreshContacts} onPress={() => (setMenu(false), void refresh())} testID="refresh-contacts" />
        <MenuItem label={t.inviteFriend} onPress={() => (setMenu(false), shareInvite())} testID="menu-invite" />
        <MenuItem label={t.contactsHelp} onPress={() => (setMenu(false), setHelping(true))} testID="contacts-help" />
      </Popup>
      <Dialog visible={helping} onClose={() => setHelping(false)} title={t.contactsHelp} text={t.contactsHelpText} buttons={[{ label: t.okWord, onPress: () => setHelping(false) }]} />
    </Screen>
  );
}
