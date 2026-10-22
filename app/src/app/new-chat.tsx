// new-chat.tsx: start a chat. Type a friend's Gmail (or just the part before
// "@gmail.com") and PakChat finds them, or pick someone you already chat with.
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { core, isOffline } from '../core/core';
import { usePeople } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Avatar, Button, Divider, Field, Glass, Pressy, Screen, Section, SettingRow, TopBar, Txt } from '../ui/kit';
import { rise } from '../ui/motion';

export default function NewChat() {
  const t = useT();
  const { theme } = useLook();
  const people = usePeople();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [found, setFound] = useState<{ id: string; name: string } | null>(null);

  const known = useMemo(
    () =>
      Object.values(people)
        .filter((p) => p.id !== core.myId && p.name)
        .filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people, query],
  );

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
          placeholder={t.findPerson}
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
                    {found.name}
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
      </Glass>

      {known.length > 0 && <Section title={t.onPakChat} />}
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
