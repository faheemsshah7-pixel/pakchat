// broadcast-edit.tsx: make a broadcast list, or change who's on one (`id`).
// Pick people, give it a name if you like, then Create (or Save).
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { MAX_BROADCAST, saveBroadcast } from '../core/broadcasts';
import { core } from '../core/core';
import { useBroadcast, usePeople } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Button, Divider, Field, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';

export default function BroadcastEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const t = useT();
  const { theme } = useLook();
  const people = usePeople();
  const old = useBroadcast(id ?? '');
  const [name, setName] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  // Changing a list: start from what it has.
  const chosen = picked ?? old?.members ?? [];
  const title = name ?? old?.name ?? '';

  const list = useMemo(
    () =>
      Object.values(people)
        .filter((p) => p.id !== core.myId && p.name && !core.blocked?.some((b) => b.id === p.id))
        .filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people, query],
  );

  const toggle = (userId: string) => {
    if (!chosen.includes(userId) && chosen.length >= MAX_BROADCAST) return toast(fill(t.broadcastMax, { n: MAX_BROADCAST }));
    setPicked(chosen.includes(userId) ? chosen.filter((x) => x !== userId) : [...chosen, userId]);
  };

  async function save() {
    setBusy(true);
    try {
      const b = await saveBroadcast(title, chosen, id);
      if (id) router.back();
      else router.replace({ pathname: '/broadcast/[id]', params: { id: b.id } });
    } catch {
      toast(t.couldNot);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={id ? t.editBroadcast : t.newBroadcast} subtitle={fill(t.nSelected, { n: chosen.length })} onBack={() => router.back()} />
      <View style={{ padding: 14, gap: 10 }}>
        <Field value={title} onChangeText={setName} placeholder={t.broadcastName} maxLength={50} icon="broadcast" testID="broadcast-name" />
        <Field value={query} onChangeText={setQuery} placeholder={t.search} icon="search" autoCorrect={false} testID="broadcast-find" />
      </View>
      <FlatList
        data={list}
        extraData={chosen}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ marginHorizontal: 12, paddingBottom: 110 }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item, index }) => {
          const on = chosen.includes(item.id);
          return (
            <View>
              <Pressy onPress={() => toggle(item.id)} label={item.name} scale={0.98} testID={`pick-${item.name}`}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: on ? theme.selected : 'transparent' }}
                >
                  <Avatar id={item.id} name={item.name} size={44} />
                  <Txt size={15.5} weight="600" style={{ flex: 1 }}>
                    {item.name}
                  </Txt>
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
                    {on && <Icon name="check" size={14} color="#FFFFFF" stroke={3} />}
                  </View>
                </View>
              </Pressy>
            </View>
          );
        }}
      />
      <View style={{ position: 'absolute', start: 16, end: 16, bottom: 24 }}>
        <Button title={id ? t.save : t.createBroadcast} busy={busy} disabled={chosen.length < 2} onPress={() => void save()} testID="broadcast-save" />
      </View>
    </Screen>
  );
}
