// settings/help.tsx: Settings › Help. Which PakChat this is, how your chats
// stay private, and how long things took on this phone (Speed check).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { speedLog, type SpeedWhat } from '../../core/speed';
import { fill, useT, type Strings } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Glass, Screen, Section, TopBar, Txt } from '../../ui/kit';

export default function Help() {
  const t = useT();
  const { theme } = useLook();
  const version = Constants.expoConfig?.version ?? '';
  const [times] = useState(() => [...speedLog()]);
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

        {/* How long things took on this phone (core/speed.ts), to compare an older phone with a newer one. */}
        <Section title={t.speedCheck} />
        <Glass style={{ padding: 16, gap: 8 }} testID="speed-check">
          <Txt size={13} color={theme.muted}>
            {times.length ? t.speedNote : t.speedNone}
          </Txt>
          {times.map((x) => (
            <View key={`${x.at}-${x.what}`} style={{ flexDirection: 'row', gap: 12 }}>
              <Txt size={14} color={theme.sectionText} style={{ flex: 1 }}>
                {speedWords(x.what, t)}
              </Txt>
              <Txt size={14} weight="700" color={x.ms > 400 ? theme.danger : theme.accInk}>
                {`${x.ms} ms`}
              </Txt>
            </View>
          ))}
        </Glass>
      </ScrollView>
    </Screen>
  );
}

function speedWords(what: SpeedWhat, t: Strings) {
  switch (what) {
    case 'start':
      return t.speedStart;
    case 'chatDrawn':
      return t.speedChatDrawn;
    case 'chatIn':
      return t.speedChatIn;
    case 'tab':
      return t.speedTab;
    case 'send':
      return t.speedSend;
  }
}
