// settings/lists.tsx: Settings › Lists, like WhatsApp's. Your own lists (each is
// a chip above the chats), with how many chats are in each; tap one to change
// it, or make a new one.
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useLists } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Divider, Glass, Section, Screen, SettingRow, TopBar, Txt } from '../../ui/kit';

export default function Lists() {
  const t = useT();
  const { theme } = useLook();
  const lists = useLists();
  return (
    <Screen>
      <TopBar title={t.listsWord} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Txt size={13.5} color={theme.muted} style={{ marginHorizontal: 10, marginTop: 4 }}>
          {t.listsNote}
        </Txt>
        <Glass style={{ marginTop: 14 }}>
          <SettingRow icon="plus" title={t.newList} onPress={() => router.push('/list')} testID="lists-new" />
        </Glass>
        {lists.length > 0 && <Section title={t.yourLists} />}
        {lists.length > 0 && (
          <Glass>
            {lists.map((l, i) => (
              <View key={l.id}>
                {i > 0 && <Divider />}
                <SettingRow
                  icon="lists"
                  title={l.name}
                  sub={fill(t.nChatsInList, { n: l.chatIds.length })}
                  onPress={() => router.push({ pathname: '/list', params: { id: l.id } })}
                  testID={`lists-${l.name}`}
                />
              </View>
            ))}
          </Glass>
        )}
      </ScrollView>
    </Screen>
  );
}
