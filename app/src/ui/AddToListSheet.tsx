// AddToListSheet.tsx: "Add to list", like WhatsApp's: tick the lists a chat (or
// the picked chats) belongs in, or start a new list with them in it. From a
// chat's ⋮, its info, and the chat list's ⋮ while picking chats.
import { router } from 'expo-router';
import { View } from 'react-native';

import { core } from '../core/core';
import { useLists } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Divider, Pressy, Txt } from './kit';
import { tick } from './motion';
import { Sheet, toast, whenOpened } from './overlays';

export const AddToListSheet = whenOpened(function AddToListSheet({ visible, chatIds, onClose }: { visible: boolean; chatIds: string[]; onClose: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const lists = useLists();

  const toggle = (id: string) => {
    const list = lists.find((l) => l.id === id);
    if (!list) return;
    tick();
    const all = chatIds.every((c) => list.chatIds.includes(c));
    const next = all ? list.chatIds.filter((c) => !chatIds.includes(c)) : [...new Set([...list.chatIds, ...chatIds])];
    core.saveList({ ...list, chatIds: next });
    toast(all ? `${t.removedFromList} ${list.name}` : `${t.addedToList} ${list.name}`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t.addToList}>
      <View style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
        {lists.map((l, i) => {
          const on = chatIds.length > 0 && chatIds.every((c) => l.chatIds.includes(c));
          return (
            <View key={l.id}>
              {i > 0 && <Divider />}
              <Pressy onPress={() => toggle(l.id)} label={l.name} scale={0.98} testID={`add-to-list-${l.name}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 14 }}>
                  <Icon name="lists" size={20} color={theme.accInk} />
                  <Txt size={15.5} weight="600" style={{ flex: 1 }}>
                    {l.name}
                  </Txt>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      borderWidth: 2,
                      borderColor: on ? theme.acc : theme.faint,
                      backgroundColor: on ? theme.acc : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on && <Icon name="check" size={15} color="#FFFFFF" stroke={2.6} />}
                  </View>
                </View>
              </Pressy>
            </View>
          );
        })}
        {lists.length > 0 && <Divider />}
        <Pressy
          onPress={() => {
            onClose();
            router.push({ pathname: '/list', params: { chats: JSON.stringify(chatIds) } });
          }}
          label={t.newList}
          scale={0.98}
          testID="add-to-new-list"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 14 }}>
            <Icon name="plus" size={20} color={theme.accInk} />
            <Txt size={15.5} weight="600" color={theme.accInk}>
              {t.newList}
            </Txt>
          </View>
        </Pressy>
      </View>
    </Sheet>
  );
});
