// settings/notifications.tsx: whether PakChat can alert you when it's closed.
// The alert only ever says "New message": never who, never what.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { pushState, startPush, type PushState } from '../../core/push';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Glass, Screen, TopBar, Txt } from '../../ui/kit';

export default function NotificationsScreen() {
  const t = useT();
  const { theme } = useLook();
  const [state, setState] = useState<PushState>(pushState);

  useEffect(() => {
    void startPush().then(() => setState(pushState()));
  }, []);

  return (
    <Screen>
      <TopBar title={t.notifications} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        <Glass style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
          <Icon name="bell" size={22} color={theme.accInk} />
          <View style={{ flex: 1 }}>
            <Txt size={14} color={theme.sectionText}>
              {t.notificationsNote}
            </Txt>
          </View>
        </Glass>
        <Glass style={{ padding: 14, gap: 10 }}>
          <Txt size={15.5} weight="700" color={state === 'blocked' ? theme.danger : theme.text} testID="push-state">
            {state === 'on' ? t.notificationsOn : state === 'blocked' ? t.notificationsOff : t.notificationsUnavailable}
          </Txt>
          <Button title={t.openSettings} look="soft" onPress={() => void Linking.openSettings()} />
        </Glass>
      </ScrollView>
    </Screen>
  );
}
