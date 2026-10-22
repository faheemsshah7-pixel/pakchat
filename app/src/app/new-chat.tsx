// new-chat.tsx: start a chat. Type a friend's Gmail (or just the part before
// "@gmail.com") or number and PakChat finds them, or pick one of your contacts
// or someone you already chat with. Your phone's contacts can be checked too.
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { core, isOffline } from '../core/core';
import { findFromPhoneBook } from '../core/phoneBook';
import { usePeople } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Avatar, Button, Divider, Field, Glass, Pressy, Screen, Section, SettingRow, TopBar, Txt } from '../ui/kit';
import { rise } from '../ui/motion';
import { toast } from '../ui/overlays';

export default function NewChat() {
  const t = useT();
  const { theme } = useLook();
  const people = usePeople();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [found, setFound] = useState<{ id: string; name: string } | null>(null);

  const [syncing, setSyncing] = useState(false);

  // My contacts first (by the names I gave them), then others I chat with ("~ Name").
  const known = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(people)
      .filter((p) => p.id !== core.myId && p.name)
      .map((p) => ({ id: p.id, name: core.name(p.id), about: p.about, saved: core.isContact(p.id) }))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.saved) - Number(a.saved) || a.name.replace(/^~ /, '').localeCompare(b.name.replace(/^~ /, '')));
  }, [people, query]);

  async function phoneBook() {
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

  async function find() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setNote('');
    setFound(null);
    try {
      const p = await core.lookup(query);
      if (!p) setNote(t.notOnPakChat);
      else if (p.id === core.myId) setNote(t.ownAccount);
      else setFound(p);
    } catch (err) {
      setNote(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  // A second tap while the chat is opening does nothing (no second chat screen).
  const opening = useRef(false);
  async function open(userId: string) {
    if (opening.current) return;
    opening.current = true;
    try {
      const chat = await core.client.openDirect(userId);
      router.replace({ pathname: '/chat/[id]', params: { id: chat.id } });
    } catch (err) {
      setNote(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      opening.current = false;
    }
  }

  return (
    <Screen>
      <TopBar title={t.newChat} onBack={() => router.back()} />
      <View style={{ padding: 14, gap: 10 }}>
        <Field
          value={query}
          onChangeText={(q) => (setQuery(q), setFound(null), setNote(''))}
          placeholder={t.searchPeopleHint}
          icon="search"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="search"
          onSubmitEditing={find}
          autoFocus
          testID="find-field"
        />
        <Button title={t.find} onPress={find} busy={busy} disabled={!query.trim()} testID="find" />
        {!!note && (
          <Animated.View entering={FadeIn}>
            <Txt size={14} color={theme.muted} align="center" testID="find-note">
              {note}
            </Txt>
          </Animated.View>
        )}
        {found && (
          <Animated.View entering={rise()}>
            <Pressy onPress={() => open(found.id)} label={found.name} testID="found-person" scale={0.97}>
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20 }}>
                <Avatar id={found.id} name={found.name} size={48} />
                <View style={{ flex: 1 }}>
                  <Txt size={16} weight="700">
                    {core.name(found.id) || found.name}
                  </Txt>
                  <Txt size={13} color={theme.acc} weight="600">
                    {t.message}
                  </Txt>
                </View>
              </Glass>
            </Pressy>
          </Animated.View>
        )}
      </View>

      <Glass style={{ marginHorizontal: 12 }}>
        <SettingRow icon="group" title={t.newGroup} onPress={() => router.replace('/new-group')} testID="to-new-group" />
        <Divider />
        <SettingRow icon="userPlus" title={t.newContact} onPress={() => router.push('/contact')} testID="new-contact" />
        <Divider />
        <SettingRow icon="contacts" title={syncing ? t.connecting : t.findContacts} sub={t.findContactsNote} onPress={syncing ? undefined : phoneBook} testID="find-contacts" />
      </Glass>

      {known.length > 0 && <Section title={t.contacts} />}
      <FlatList
        data={known}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ marginHorizontal: 12, paddingBottom: 30 }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item, index }) => (
          <Animated.View entering={rise(Math.min(index, 10) * 25)}>
            <Pressy onPress={() => open(item.id)} label={item.name} scale={0.98} testID={`person-${item.name}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Avatar id={item.id} name={item.name} size={44} />
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="600">
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
          </Animated.View>
        )}
      />
    </Screen>
  );
}
