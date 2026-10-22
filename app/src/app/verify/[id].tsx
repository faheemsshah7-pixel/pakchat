// verify/[id].tsx: the safety number for you and one person.
//
// Both phones work out the same 60 digits from your two identity keys. Read
// them to each other when you meet: if they match, nobody is in the middle.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Share, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../../core/core';
import { usePerson } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Glass, Screen, TopBar, Txt } from '../../ui/kit';
import { pop, rise } from '../../ui/motion';

export default function Verify() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const person = usePerson(id);
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    core.client
      .safetyNumber(id)
      .then(setCode)
      .catch(() => setFailed(true));
  }, [id]);

  const name = person?.name ?? '…';
  const groups = code ? (code.match(/.{1,5}/g) ?? []) : [];

  return (
    <Screen>
      <TopBar title={t.encryption} onBack={() => router.back()} />
      <View style={{ padding: 22, gap: 18, alignItems: 'center' }}>
        <Animated.View entering={pop()}>
          <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={40} color={theme.accInk} stroke={1.7} />
          </View>
        </Animated.View>
        <Txt size={20} weight="800" align="center">
          {fill(t.verifyTitle, { name })}
        </Txt>
        <Txt size={14.5} color={theme.muted} align="center">
          {fill(t.verifyNote, { name })}
        </Txt>
        <Glass style={{ alignSelf: 'stretch', padding: 18, borderRadius: 24, minHeight: 170, justifyContent: 'center' }} testID="safety-number">
          {code ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, direction: 'ltr' }}>
              {groups.map((g, i) => (
                <Animated.View key={i} entering={rise(i * 35)} style={{ width: '25%', alignItems: 'center' }}>
                  <Txt size={20} weight="600" align="center" style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>
                    {g}
                  </Txt>
                </Animated.View>
              ))}
            </View>
          ) : failed ? (
            <Txt size={14} color={theme.muted} align="center">
              {t.verifyOffline}
            </Txt>
          ) : (
            <ActivityIndicator color={theme.acc} />
          )}
        </Glass>
        {code && <Button title={t.share} look="soft" icon="forward" onPress={() => void Share.share({ message: groups.join(' ') })} style={{ alignSelf: 'stretch' }} />}
      </View>
    </Screen>
  );
}
