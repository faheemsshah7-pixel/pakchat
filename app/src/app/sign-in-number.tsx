// sign-in-number.tsx: "Enter your phone number", its own screen, like WhatsApp's.
//
// The country starts at Pakistan (+92); tap it to pick another. Type the number
// (with or without the 0 in front), tap Next, and say Yes to "Is this the right
// number?". Then sign-in-verify.tsx checks it with WhatsApp.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { formatPhone } from '@pakchat/shared';

import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { COUNTRIES, PAKISTAN, flag, fullNumber, type Country } from '../ui/countries';
import { Icon } from '../ui/icons';
import { Button, Field, Glass, Pressy, Screen, TopBar, Txt, useKeyboardLift } from '../ui/kit';
import { Dialog, Sheet } from '../ui/overlays';

export default function SignInNumber() {
  const t = useT();
  const { theme } = useLook();
  const lift = useKeyboardLift();
  const [country, setCountry] = useState<Country>(PAKISTAN);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState('');
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);

  function next() {
    const r = fullNumber(country, typed);
    if ('problem' in r) return setProblem(r.problem === 'pkMobile' ? t.numberPkMobile : t.numberBad);
    setProblem('');
    setAsking(r.phone);
  }

  function yes() {
    const phone = asking;
    setAsking(null);
    if (phone) router.push({ pathname: '/sign-in-verify', params: { phone } });
  }

  return (
    <Screen>
      <TopBar title={t.numberTitle} onBack={() => router.back()} />
      <View style={{ paddingHorizontal: 22, paddingTop: 22, gap: 18 }}>
        <Txt size={15} color={theme.muted} align="center">
          {t.numberText}
        </Txt>

        {/* The country, like WhatsApp's: its name, with a little arrow to change it. */}
        <Pressy onPress={() => setPicking(true)} label={t.chooseCountry} testID="country">
          <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, paddingHorizontal: 16, borderRadius: 16 }}>
            <Txt size={20}>{flag(country.code)}</Txt>
            <Txt size={16} weight="600" style={{ flex: 1 }} lines={1}>
              {country.name}
            </Txt>
            <Icon name="down" size={18} color={theme.muted} />
          </Glass>
        </Pressy>

        <View style={{ flexDirection: 'row', gap: 10, direction: 'ltr' }}>
          <Pressy onPress={() => setPicking(true)} label={t.chooseCountry}>
            <Glass style={{ height: 52, minWidth: 84, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={16} weight="600">{`+${country.dial}`}</Txt>
            </Glass>
          </Pressy>
          <View style={{ flex: 1 }}>
            <Field
              value={typed}
              onChangeText={(v) => (setTyped(v), setProblem(''))}
              placeholder={country.code === 'PK' ? '300 1234567' : t.numberPlaceholder}
              keyboardType="phone-pad"
              autoComplete="tel"
              autoFocus
              returnKeyType="next"
              onSubmitEditing={next}
              testID="phone-field"
            />
          </View>
        </View>

        {!!problem && (
          <Txt size={14} weight="500" color={theme.danger} align="center" testID="number-problem">
            {problem}
          </Txt>
        )}
      </View>

      <Animated.View style={[{ position: 'absolute', start: 22, end: 22 }, lift]}>
        <Button title={t.numberNext} onPress={next} disabled={!typed.replace(/\D/g, '')} testID="number-next" />
      </Animated.View>

      <Dialog
        visible={asking !== null}
        onClose={() => setAsking(null)}
        title={t.confirmNumberTitle}
        text={fill(t.confirmNumberText, { phone: formatPhone(asking ?? '') })}
        buttons={[
          { label: t.numberYes, onPress: yes, testID: 'number-yes' },
          { label: t.numberEdit, onPress: () => setAsking(null), testID: 'number-edit' },
        ]}
      />

      <CountrySheet visible={picking} onClose={() => setPicking(false)} onPick={(c) => (setCountry(c), setPicking(false), setProblem(''))} />
    </Screen>
  );
}

/** "Choose a country": a search box and every country, with its flag and code. */
function CountrySheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: Country) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [find, setFind] = useState('');
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.startsWith(q));
  }, [find]);

  return (
    <Sheet visible={visible} onClose={onClose} title={t.chooseCountry}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Field value={find} onChangeText={setFind} placeholder={t.searchCountries} icon="search" autoCorrect={false} testID="country-search" />
      </View>
      <FlatList
        style={{ height: 420 }}
        data={shown}
        keyExtractor={(c) => c.code}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        ListEmptyComponent={
          <Txt size={14} color={theme.muted} align="center" style={{ padding: 20 }}>
            {t.noCountry}
          </Txt>
        }
        renderItem={({ item }) => (
          <Pressy onPress={() => (setFind(''), onPick(item))} label={item.name} testID={`country-${item.code}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 12 }}>
              <Txt size={22}>{flag(item.code)}</Txt>
              <Txt size={16} style={{ flex: 1 }} lines={1}>
                {item.name}
              </Txt>
              <Txt size={15} color={theme.muted}>{`+${item.dial}`}</Txt>
            </View>
          </Pressy>
        )}
      />
    </Sheet>
  );
}
