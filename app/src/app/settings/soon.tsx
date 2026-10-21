// settings/soon.tsx: a setting that arrives in a later update.
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { useT } from '../../i18n';
import { Empty, Screen, TopBar } from '../../ui/kit';

export default function Soon() {
  const { title } = useLocalSearchParams<{ title?: string }>();
  const t = useT();
  return (
    <Screen>
      <TopBar title={title ?? ''} onBack={() => router.back()} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Empty icon="sun" text={t.comingSoon} />
      </View>
    </Screen>
  );
}
