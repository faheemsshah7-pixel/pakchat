// list.tsx: make your own chat list (like WhatsApp's Lists), or change one.
// You give it a name and tick the chats that belong in it; it then shows as a
// chip above the chat list. Lists live only on this phone.
//
// Opened with no id from the ＋ chip (a new list), or with ?id= to edit one.
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

import { core } from '../core/core';
import { useChatList, useLists } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Button, Divider, Field, Pressy, Screen, TopBar, Txt, useKeyboardLift } from '../ui/kit';

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const t = useT();
  const { theme } = useLook();
  const old = useLists().find((l) => l.id === id);
  const rows = (useChatList() ?? []).filter((r) => !r.chat.left);
  const [name, setName] = useState(old?.name ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set(old?.chatIds ?? []));
  const lift = useKeyboardLift();

  function toggle(chatId: string) {
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  function save() {
    core.saveList({ id: old?.id ?? Crypto.randomUUID(), name: name.trim(), chatIds: [...picked] });
    router.back();
  }

  return (
    <Screen>
      <TopBar title={old ? t.editList : t.newList} onBack={() => router.back()} />
      <FlatList
        data={rows}
        extraData={picked}
        keyExtractor={(r) => r.chat.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 110 }}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 10 }}>
            <Field value={name} onChangeText={setName} placeholder={t.listName} maxLength={30} autoFocus={!old} testID="list-name" />
            <Txt size={13} weight="700" color={theme.sectionText}>
              {t.listChats}
            </Txt>
          </View>
        }
        renderItem={({ item, index }) => {
          const on = picked.has(item.chat.id);
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 25).springify().damping(22)}>
              <Pressy onPress={() => toggle(item.chat.id)} label={item.title} scale={0.98} testID={`list-pick-${item.title}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: on ? theme.selected : 'transparent' }}>
                  <Avatar id={item.chat.id} name={item.title} size={44} group={item.chat.kind === 'group'} />
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight="600">
                      {item.title}
                    </Txt>
                  </View>
                  {on && (
                    <Animated.View entering={ZoomIn.springify().damping(12)} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={14} color="#FFFFFF" stroke={3} />
                    </Animated.View>
                  )}
                </View>
              </Pressy>
            </Animated.View>
          );
        }}
      />
      <Animated.View style={[{ position: 'absolute', start: 16, end: 16 }, lift]}>
        <Button title={t.saveList} icon="check" onPress={save} disabled={!name.trim()} testID="save-list" />
      </Animated.View>
    </Screen>
  );
}
