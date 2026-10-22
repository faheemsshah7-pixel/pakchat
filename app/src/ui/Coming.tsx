// Coming.tsx: a calm "coming in a later update" page for tabs and settings not built yet.
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import type { IconName } from './icons';
import { Empty, Screen, Txt } from './kit';
import { rise } from './motion';

export function Coming({ tab, title }: { tab?: 'status' | 'calls'; title?: string }) {
  const t = useT();
  const { theme } = useLook();
  const icon: IconName = tab === 'status' ? 'status' : tab === 'calls' ? 'calls' : 'sun';
  const heading = tab === 'status' ? t.status : tab === 'calls' ? t.calls : (title ?? '');
  const text = tab === 'status' ? t.statusSoon : tab === 'calls' ? t.callsSoon : t.comingSoon;
  return (
    <Screen bottom={!tab}>
      {!!tab && (
        <View style={{ paddingTop: 18, paddingHorizontal: 20 }}>
          <Txt size={27} weight="800" style={{ letterSpacing: -0.9 }}>
            {heading}
          </Txt>
        </View>
      )}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Empty icon={icon} text={text}>
          <Animated.View entering={rise(200)}>
            <Txt size={13} weight="600" color={theme.accInk} align="center">
              {t.comingSoon}
            </Txt>
          </Animated.View>
        </Empty>
      </View>
    </Screen>
  );
}
