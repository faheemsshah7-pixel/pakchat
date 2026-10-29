// settings/blocked.tsx: people you've blocked. Tap Unblock to let them reach you again.
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { core } from '../../core/core';
import { useBlocked } from '../../core/hooks';
import { useT } from '../../i18n';
import { Avatar, Button, Divider, Empty, Glass, Screen, TopBar, Txt } from '../../ui/kit';
import { toast } from '../../ui/overlays';

export default function Blocked() {
  const t = useT();
  const blocked = useBlocked();
  return (
    <Screen>
      <TopBar title={t.blocked} onBack={() => router.back()} />
      <FlatList
        data={blocked ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={blocked ? <Empty icon="flag" text={t.noBlocked} /> : undefined}
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => (
          <View>
            <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }}>
              <Avatar id={item.id} name={item.name} size={42} />
              <View style={{ flex: 1 }}>
                <Txt size={15.5} weight="600">
                  {item.name}
                </Txt>
              </View>
              <Button
                title={t.unblock}
                look="soft"
                style={{ minWidth: 110 }}
                onPress={() => void core.block(item.id, false).then(() => toast(t.unblocked), () => toast(t.couldNot))}
              />
            </Glass>
          </View>
        )}
      />
    </Screen>
  );
}
