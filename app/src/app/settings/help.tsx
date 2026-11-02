// settings/help.tsx: Settings › Help. Which PakChat this is, how your chats
// stay private, the Terms and the Privacy Policy (Phase 11), and how long things
// took on this phone (Speed check).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { onBuiltInServer, pageUrl } from '../../core/core';
import { SPEED_OK, speedLog, type SpeedWhat } from '../../core/speed';
import { fill, useT, type Strings } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Divider, Glass, Screen, Section, SettingRow, TopBar, Txt } from '../../ui/kit';

export default function Help() {
  const t = useT();
  const { theme, lang } = useLook();
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
            // The live server is never named; a test server (a Mac on the Wi-Fi) says where to change it.
            { icon: 'server' as const, text: onBuiltInServer() ? t.helpServerLive : t.helpServer },
          ].map((x) => (
            <View key={x.icon} style={{ flexDirection: 'row', gap: 12 }}>
              <Icon name={x.icon} size={22} color={theme.accInk} />
              <Txt size={14} color={theme.sectionText} style={{ flex: 1 }}>
                {x.text}
              </Txt>
            </View>
          ))}
        </Glass>

        <Glass style={{ marginTop: 14 }}>
          <SettingRow icon="doc" title={t.termsWord} onPress={() => void Linking.openURL(pageUrl('terms', lang)).catch(() => {})} testID="open-terms" />
          <Divider />
          <SettingRow icon="shield" title={t.privacyPolicyWord} onPress={() => void Linking.openURL(pageUrl('privacy', lang)).catch(() => {})} testID="open-privacy" />
        </Glass>

        {/* How long things took on this phone (core/speed.ts), to compare an older phone with a newer one. */}
        <Section title={t.speedCheck} />
        <Glass style={{ padding: 16, gap: 8 }} testID="speed-check">
          <Txt size={13} color={theme.muted}>
            {times.length ? t.speedNote : t.speedNone}
          </Txt>
          {times.map((x) => (
            <View key={`${x.at}-${x.what}-${x.ms}`} style={{ flexDirection: 'row', gap: 12 }}>
              <Txt size={14} color={theme.sectionText} style={{ flex: 1 }}>
                {fill(speedWords(x.what, t), { where: place(x.where, t) })}
              </Txt>
              <Txt size={14} weight="700" color={x.ms > SPEED_OK[x.what] ? theme.danger : theme.accInk}>
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
    case 'pageMoving':
      return t.speedPageMoving;
    case 'pageIn':
      return t.speedPageIn;
    case 'back':
      return t.speedBack;
    case 'busy':
      return t.speedBusy;
  }
}

/** A screen's name in a few plain words (its address in the app, tidied): "settings › privacy". */
function place(where: string | undefined, t: Strings) {
  if (!where || where === '(tabs)') return t.speedChatList;
  return where
    .replace(/\/\[[a-z]+\]$/, '')
    .replace(/\/index$/, '')
    .replace(/\//g, ' › ')
    .replace(/-/g, ' ');
}
