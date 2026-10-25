// SettingsSearch.tsx: search in Settings, like WhatsApp's. Type a few letters
// ("tone", "last seen", "backup") and every setting that matches shows, with
// the page it's on; tap one to go there.
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { settingsMatching } from '../core/settingsIndex';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Divider, Empty, Pressy, Txt } from './kit';

/** The results, under the search box. `onHere`: a setting on the Settings page itself (the search closes, showing it). */
export function SettingsResults({ query, onHere }: { query: string; onHere: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const found = settingsMatching(query, t);
  if (!query.trim()) return null;
  return (
    <FlatList
      data={found}
      keyExtractor={(e) => `${e.where}:${e.title}`}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={<Empty icon="search" text={t.noResults} />}
      renderItem={({ item }) => (
        <Pressy onPress={() => (item.to ? router.push(item.to) : onHere())} label={item.title} scale={0.98} testID="settings-result">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, paddingVertical: 12 }}>
            <Icon name={item.icon} size={21} color={theme.accInk} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt size={15.5} weight="600" lines={1}>
                {item.title}
              </Txt>
              <Txt size={12.5} color={theme.muted} lines={1}>
                {item.where}
              </Txt>
            </View>
            <Icon name="chevron" size={16} color={theme.faint} flip />
          </View>
        </Pressy>
      )}
    />
  );
}
