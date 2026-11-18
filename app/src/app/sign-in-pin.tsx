// sign-in-pin.tsx: "Enter your PIN", after the number (or Google) checked out, when the
// account has two-step verification (settings/two-step.tsx). Like WhatsApp's: five wrong
// tries are free, then each wait is longer (the server counts them, so a new install
// doesn't start again). "Forgot PIN?": the Google account linked to PakChat proves it's
// them (only when they came in by number), or they wait 7 days and sign in without it.
// Until the PIN is right the account stays signed in on its old phone.
import { pinRefused } from '@pakchat/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core, isOffline, reasonOf } from '../core/core';
import { googleIdToken } from '../core/google';
import { useCore } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { whenLabel } from '../ui/format';
import { GoogleG } from '../ui/GoogleG';
import { Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { Sheet } from '../ui/overlays';
import { BigIcon, PinBoxes, pinWrongText, waitClock } from '../ui/Pin';

export default function SignInPin() {
  const t = useT();
  const { theme } = useLook();
  const step = useCore(['pin'], () => core.pinStep);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [forgot, setForgot] = useState(false);

  // Opened without a sign-in waiting (PakChat was closed meanwhile): nothing to do here.
  useEffect(() => {
    if (!step && router.canGoBack()) router.back();
  }, [step]);

  // Too many wrong tries: the boxes wait, with the time left.
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) {
        setUntil(0);
        setError('');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [until]);

  const waiting = until > now;

  function said(err: unknown) {
    const refused = pinRefused(err);
    if (refused?.wait) {
      setUntil(Date.now() + refused.wait * 1000);
      setNow(Date.now());
      setError('');
    } else if (refused) setError(pinWrongText(t, refused.triesLeft ?? 0));
    else if (reasonOf(err) === 'bad_ticket') setError(t.pinTooLong);
    else setError(isOffline(err) ? t.serverError : t.couldNot);
  }

  async function signIn(typed: string) {
    if (busy || waiting) return;
    setBusy(true);
    setError('');
    try {
      await core.pinSignIn(typed);
    } catch (err) {
      setPin('');
      said(err);
    } finally {
      setBusy(false);
    }
  }

  async function withGoogle() {
    setForgot(false);
    try {
      const idToken = await googleIdToken();
      if (!idToken) return;
      setBusy(true);
      await core.pinGoogle(idToken);
    } catch (err) {
      const why = reasonOf(err);
      setError(why === 'wrong_google' ? t.pinWrongGoogle : why === 'bad_ticket' ? t.pinTooLong : isOffline(err) ? t.serverError : t.googleError);
    } finally {
      setBusy(false);
    }
  }

  async function wait7() {
    setBusy(true);
    try {
      // Answers when the wait ends; or, when it's already over, signs in.
      await core.pinReset();
    } catch (err) {
      setForgot(false);
      said(err);
    } finally {
      setBusy(false);
    }
  }

  const resetAt = step?.resetAt ? Date.parse(step.resetAt) : null;

  return (
    <Screen>
      <TopBar title={t.twoStep} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 34, gap: 14 }} keyboardShouldPersistTaps="handled">
        <BigIcon name="lock" />
        <Txt size={22} weight="700" align="center" style={{ marginTop: 10 }}>
          {t.pinEnterTitle}
        </Txt>
        <Txt size={15} color={theme.muted} align="center" style={{ marginBottom: 12 }}>
          {t.pinEnterText}
        </Txt>
        <PinBoxes value={pin} onChange={setPin} onDone={(v) => void signIn(v)} error={!!error} disabled={busy || waiting} label={t.pinEnterTitle} testID="sign-in-pin-field" />
        {(!!error || waiting) && (
          <Txt size={14} weight="500" color={theme.danger} align="center" testID="sign-in-pin-error">
            {waiting ? fill(t.pinWait, { time: waitClock((until - now) / 1000) }) : error}
          </Txt>
        )}
        {resetAt && (
          <Txt size={13.5} color={theme.muted} align="center" testID="pin-reset-at">
            {fill(t.pinWaitingUntil, { date: whenLabel(resetAt, t) })}
          </Txt>
        )}
        <Pressy onPress={() => setForgot(true)} disabled={busy} label={t.pinForgot} style={{ alignSelf: 'center' }} testID="pin-forgot">
          <Txt size={15} weight="600" color={theme.accInk} style={{ padding: 8 }}>
            {t.pinForgot}
          </Txt>
        </Pressy>
      </ScrollView>

      <Sheet visible={forgot} onClose={() => setForgot(false)} title={t.pinForgotTitle}>
        <View style={{ paddingHorizontal: 18, paddingTop: 4, gap: 14 }}>
          <Txt size={15} color={theme.muted}>
            {step?.google ? t.pinForgotGoogle : t.pinForgotNoGoogle}
          </Txt>
          {step?.google && (
            <Pressy onPress={() => void withGoogle()} disabled={busy} label={t.continueGoogle} testID="pin-google" style={{ borderRadius: 18, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 18, backgroundColor: theme.glass }}>
                <GoogleG />
                <Txt size={16} weight="700" color={theme.accInk}>
                  {t.continueGoogle}
                </Txt>
              </View>
            </Pressy>
          )}
          {resetAt ? (
            <Txt size={14} color={theme.text} align="center" testID="pin-waiting">
              {fill(t.pinWaitingUntil, { date: whenLabel(resetAt, t) })}
            </Txt>
          ) : (
            <Pressy onPress={() => void wait7()} disabled={busy} label={t.pinWait7} style={{ alignSelf: 'center' }} testID="pin-wait-7">
              <Txt size={15} weight="600" color={theme.accInk} style={{ padding: 8 }}>
                {t.pinWait7}
              </Txt>
            </Pressy>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}
