// settings/help.tsx: Settings › Help. Which PakChat this is, and how your chats
// stay private.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Glass, Screen, Section, TopBar, Txt } from '../../ui/kit';

export default function Help() {
  const t = useT();
  const { theme } = useLook();
  const version = Constants.expoConfig?.version ?? '';
  return (
    <Screen>
      <TopBar title={t.helpWord} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Section title={t.appInfo} />
        <Glass style={{ alignItems: 'center', padding: 22, gap: 6 }}>
          <Txt size={22} weight="800" color={theme.accInk}>
            PakChat
          </Txt>
          <Txt size={13.5} color={theme.muted} testID="app-version">
            {fill(t.versionWord, { v: version })}
          </Txt>
        </Glass>
        <Glass style={{ marginTop: 14, padding: 16, gap: 14 }}>
          {[
            { icon: 'lock' as const, text: t.helpPrivate },
            { icon: 'server' as const, text: t.helpServer },
          ].map((x) => (
            <View key={x.icon} style={{ flexDirection: 'row', gap: 12 }}>
              <Icon name={x.icon} size={22} color={theme.accInk} />
              <Txt size={14} color={theme.sectionText} style={{ flex: 1 }}>
                {x.text}
              </Txt>
            </View>
          ))}
        </Glass>
      </ScrollView>
    </Screen>
  );
}
