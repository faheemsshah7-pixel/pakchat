// broadcasts.ts: my broadcast lists (from the chat list's ⋮ menu). A list
// sends one message to many people, each in our own chat (core/broadcasts.ts).
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { core } from '../core/core';
import { useBroadcasts, usePeople } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Divider, Empty, Fab, Glass, Pressy, Screen, TopBar, Txt } from '../ui/kit';

export default function Broadcasts() {
  const t = useT();
  const { theme } = useLook();
  const lists = useBroadcasts();
  usePeople();

  return (
    <Screen>
      <TopBar title={t.broadcastLists} onBack={() => router.back()} />
      <Txt size={13} color={theme.muted} style={{ paddingHorizontal: 22, paddingTop: 6, paddingBottom: 10 }}>
        {t.broadcastNote}
      </Txt>
      {lists && !lists.length ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty icon="broadcast" text={t.noBroadcasts} />
        </View>
      ) : (
        <FlatList
          data={lists ?? []}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 110 }}
          renderItem={({ item: b, index }) => (
            <View>
              <Glass style={{ marginBottom: 8, borderRadius: 20 }}>
                <Pressy onPress={() => router.push({ pathname: '/broadcast/[id]', params: { id: b.id } })} label={b.name} scale={0.98} testID="broadcast-row">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                    <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="broadcast" size={23} color={theme.accInk} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt size={16} weight="700" lines={1}>
                        {b.name || fill(t.nRecipients, { n: b.members.length })}
                      </Txt>
                      <Txt size={13} color={theme.muted} lines={1}>
                        {b.members.map((m) => core.name(m) || '…').join(', ')}
                      </Txt>
                    </View>
                  </View>
                </Pressy>
              </Glass>
            </View>
          )}
          ItemSeparatorComponent={() => <Divider />}
        />
      )}
      <Fab icon="plus" label={t.newBroadcast} onPress={() => router.push('/broadcast-edit')} testID="new-broadcast" />
    </Screen>
  );
}
