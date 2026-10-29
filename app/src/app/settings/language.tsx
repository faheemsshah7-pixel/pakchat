// settings/language.tsx: English or اردو. Urdu turns every screen right to left
// at once (no restart): the layout flips, and arrows and swipes point the other way.
import { router } from 'expo-router';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useT } from '../../i18n';
import { useLook, type Lang } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Glass, Pressy, Screen, TopBar, Txt } from '../../ui/kit';
import { tick } from '../../ui/motion';

export default function Language() {
  const t = useT();
  const { theme, lang, setPrefs } = useLook();
  const options: { key: Lang; label: string; sample: string }[] = [
    { key: 'en', label: 'English', sample: 'Salam! How are you?' },
    { key: 'ur', label: 'اردو', sample: 'سلام! آپ کیسے ہیں؟' },
  ];
  return (
    <Screen>
      <TopBar title={t.language} onBack={() => router.back()} />
      <View style={{ padding: 12, gap: 10 }}>
        {options.map((o) => {
          const on = lang === o.key;
          return (
            <Pressy key={o.key} onPress={() => (tick(), setPrefs({ lang: o.key }))} label={o.label} scale={0.97} testID={`lang-${o.key}`}>
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, borderWidth: 2, borderColor: on ? theme.acc : theme.glassLine }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt size={18} weight="700">
                    {o.label}
                  </Txt>
                  <Txt size={14} color={theme.muted}>
                    {o.sample}
                  </Txt>
                </View>
                {on && (
                  <Animated.View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={16} color="#FFFFFF" stroke={3} />
                  </Animated.View>
                )}
              </Glass>
            </Pressy>
          );
        })}
      </View>
    </Screen>
  );
}
