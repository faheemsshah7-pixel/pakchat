// settings/two-step.tsx: Settings › Account › Two-step verification, like WhatsApp's.
// Off: what it is, and Turn on. Turning on (or Change PIN): make a 6-digit PIN, then type
// it again. On: Change PIN and Turn off. The server keeps only a scrambled copy and asks
// for it when the account signs in on a new phone (sign-in-pin.tsx).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';

import { core, isOffline, reasonOf } from '../../core/core';
import { useAuth } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { GoogleG } from '../../ui/GoogleG';
import { Icon } from '../../ui/icons';
import { Button, Divider, Glass, Screen, SettingRow, TopBar, Txt } from '../../ui/kit';
import { BigIcon, PinBoxes, ShowPin } from '../../ui/Pin';
import { Dialog, toast } from '../../ui/overlays';

// Change PIN and Turn off first ask for the PIN it has now ("current"); the server checks it too.
type Step = { kind: 'current'; then: 'change' | 'off' } | { kind: 'make'; current?: string } | { kind: 'again'; first: string; current?: string };

export default function TwoStep() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const [step, setStep] = useState<Step | null>(null);
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offering, setOffering] = useState(false);

  function go(next: Step) {
    setPin('');
    setError('');
    setStep(next);
  }

  /** What went wrong, under the boxes. */
  function said(err: unknown) {
    const why = reasonOf(err);
    setError(why === 'wrong_current' ? t.pinCurrentWrong : why === 'rate_limited' ? t.pinTooMany : isOffline(err) ? t.serverError : t.couldNot);
  }

  async function typed(value: string) {
    if (!step || busy) return;
    if (step.kind === 'make') return go({ kind: 'again', first: value, current: step.current });
    setBusy(true);
    try {
      if (step.kind === 'current') {
        if (step.then === 'off') {
          await core.removePin(value);
          toast(t.pinIsOff);
          setStep(null);
          setPin('');
        } else if (await core.checkPin(value)) go({ kind: 'make', current: value });
        else {
          setPin('');
          setError(t.pinCurrentWrong);
        }
        return;
      }
      if (value !== step.first) {
        setPin('');
        setStep({ kind: 'make', current: step.current });
        setError(t.pinDiffer);
        return;
      }
      await core.setPin(value, step.current);
      toast(step.current ? t.pinChanged : t.pinIsOn);
      setStep(null);
      setPin('');
    } catch (err) {
      setPin('');
      said(err);
    } finally {
      setBusy(false);
    }
  }

  // Back from making a PIN goes back to the page it came from, not out of Settings.
  const back = () => {
    if (step) {
      setStep(null);
      setPin('');
      setError('');
    } else router.back();
  };

  // The phone's Back button too, while making a PIN.
  useEffect(() => {
    if (!step) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep(null);
      setPin('');
      setError('');
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const both = !!me?.email && !!me?.phone;

  return (
    <Screen>
      <TopBar title={t.twoStep} onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 34, gap: 14 }} keyboardShouldPersistTaps="handled">
        {step ? (
          <View style={{ gap: 14 }} testID={`pin-${step.kind}`}>
            <Txt size={22} weight="700" align="center">
              {step.kind === 'current' ? t.pinCurrentTitle : step.kind === 'make' ? t.pinMakeTitle : t.pinAgainTitle}
            </Txt>
            <Txt size={15} color={theme.muted} align="center" style={{ marginBottom: 12 }}>
              {step.kind === 'current' ? (step.then === 'off' ? t.pinCurrentOffText : t.pinCurrentText) : step.kind === 'make' ? t.pinMakeText : t.pinAgainText}
            </Txt>
            <PinBoxes
              key={step.kind}
              value={pin}
              onChange={(v) => {
                setPin(v);
                if (v) setError('');
              }}
              onDone={(v) => void typed(v)}
              show={show}
              error={!!error}
              disabled={busy}
              label={step.kind === 'current' ? t.pinCurrentTitle : step.kind === 'make' ? t.pinMakeTitle : t.pinAgainTitle}
              testID="pin-field"
            />
            {!!error && (
              <Txt size={14} weight="500" color={theme.danger} align="center" testID="pin-error">
                {error}
              </Txt>
            )}
            <ShowPin show={show} onToggle={() => setShow((s) => !s)} t={t} />
          </View>
        ) : me?.pin ? (
          <>
            <BigIcon name="shield" green />
            <Txt size={22} weight="700" align="center" style={{ marginTop: 10 }}>
              {t.pinOnTitle}
            </Txt>
            <Txt size={15} color={theme.muted} align="center" style={{ marginBottom: 8 }}>
              {t.pinOnText}
            </Txt>
            <Glass>
              <SettingRow icon="pinCode" title={t.pinChange} chevron={false} onPress={() => go({ kind: 'current', then: 'change' })} testID="pin-change" />
              <Divider />
              <SettingRow icon="ban" title={t.pinTurnOff} danger chevron={false} onPress={() => setOffering(true)} testID="pin-off" />
            </Glass>
          </>
        ) : (
          <>
            <BigIcon name="lock" />
            <Txt size={22} weight="700" align="center" style={{ marginTop: 10 }}>
              {t.pinIntroTitle}
            </Txt>
            <Txt size={15} color={theme.muted} align="center" style={{ marginBottom: 8 }}>
              {t.pinIntroText}
            </Txt>
            <Glass>
              <SettingRow icon="clock" title={t.pinNowAndThen} sub={t.pinNowAndThenSub} chevron={false} />
              <Divider />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                  {both ? <GoogleG size={20} /> : <Icon name="clock" size={20} color={theme.accInk} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="600">
                    {t.pinForgotIt}
                  </Txt>
                  <Txt size={13} color={theme.muted}>
                    {both ? t.pinForgotItGoogle : t.pinForgotItWait}
                  </Txt>
                </View>
              </View>
            </Glass>
            <Button title={t.pinTurnOn} onPress={() => go({ kind: 'make' })} style={{ marginTop: 10 }} testID="pin-turn-on" />
          </>
        )}
      </ScrollView>

      <Dialog
        visible={offering}
        onClose={() => setOffering(false)}
        title={t.pinTurnOffSure}
        text={t.pinTurnOffText}
        buttons={[
          {
            label: t.pinTurnOff,
            danger: true,
            testID: 'confirm-pin-off',
            onPress: () => {
              setOffering(false);
              // Once the pop-up has gone, so the PIN boxes get the keyboard.
              setTimeout(() => go({ kind: 'current', then: 'off' }), 300);
            },
          },
          { label: t.cancel, onPress: () => setOffering(false) },
        ]}
      />
    </Screen>
  );
}
