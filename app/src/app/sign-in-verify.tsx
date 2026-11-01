// sign-in-verify.tsx: "Verify +92 300 1234567", its own screen, like WhatsApp's.
//
// On the live server WhatsApp proves the number (free): tap Open WhatsApp, press Send,
// come back, and PakChat signs in by itself. Only that number's WhatsApp counts.
// There is no SMS code on the live server (owner, 29 Oct): if the server can't be
// reached, this screen waits and asks again instead of offering one.
//
// A test server (a Mac on the Wi-Fi, the emulator's) without WhatsApp settings sends a
// 6-digit code instead, printed in the Mac's Terminal; the emulator tests fill it in.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { formatPhone } from '@pakchat/shared';

import { core, onBuiltInServer } from '../core/core';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { phoneError } from '../ui/format';
import { Button, Field, Glass, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { WhatsAppCheck } from '../ui/WhatsAppCheck';

type Way = 'asking' | 'whatsapp' | 'code' | 'none';

export default function SignInVerify() {
  const t = useT();
  const { theme } = useLook();
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
  const [way, setWay] = useState<Way>('asking');
  const [unreachable, setUnreachable] = useState(false);

  // Which way this server proves numbers. No answer (offline, slow) → ask again in 2 s, for as
  // long as this screen is open. Only a server that answers "no WhatsApp here" gets the code way,
  // and never the live one.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const on = await core.whatsAppOn();
        if (alive) setWay(on ? 'whatsapp' : onBuiltInServer() ? 'none' : 'code');
      } catch {
        tries += 1;
        if (!alive) return;
        if (tries >= 2) setUnreachable(true);
        timer = setTimeout(() => void ask(), 2_000);
      }
    };
    void ask();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // WhatsApp proved the number: its one-time code signs in, exactly like an SMS code.
  const whatsAppSignIn = useCallback(async (number: string, oneTime: string) => {
    await core.signInWithPhone(number, oneTime);
  }, []);

  const shown = formatPhone(phone);

  return (
    <Screen>
      <TopBar title={fill(t.verifyNumberTitle, { phone: shown })} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Pressy onPress={() => router.back()} label={t.wrongNumberLink} testID="wrong-number" style={{ alignSelf: 'center' }}>
          <Txt size={15} weight="600" color={theme.accInk} style={{ padding: 6 }}>
            {t.wrongNumberLink}
          </Txt>
        </Pressy>

        {way === 'asking' && (
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }} testID="verify-asking">
            <ActivityIndicator color={theme.accInk} />
            <Txt size={14} color={theme.muted} align="center">
              {unreachable ? t.cantReach : t.checkingServer}
            </Txt>
          </View>
        )}

        {way === 'whatsapp' && (
          <>
            <Glass style={{ padding: 18, borderRadius: 20, gap: 14 }}>
              {[t.verifyStep1, t.verifyStep2, t.verifyStep3].map((step, i) => (
                <View key={step} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt size={14} weight="700" color={theme.accInk}>
                      {String(i + 1)}
                    </Txt>
                  </View>
                  <Txt size={15} style={{ flex: 1, marginTop: 3 }}>
                    {step}
                  </Txt>
                </View>
              ))}
            </Glass>
            <Txt size={13} color={theme.muted} align="center">
              {t.verifyNeedsWhatsApp}
            </Txt>
            <WhatsAppCheck purpose="sign_in" phone={phone} quiet onChecked={whatsAppSignIn} />
          </>
        )}

        {way === 'code' && <CodeWay phone={phone} />}

        {way === 'none' && (
          <Txt size={15} color={theme.muted} align="center" testID="verify-none">
            {t.verifyOff}
          </Txt>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Test servers only: the server "sends" a 6-digit code (printed in the Mac's Terminal). */
function CodeWay({ phone }: { phone: string }) {
  const t = useT();
  const { theme } = useLook();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const sent = useRef(false);

  const send = useCallback(async () => {
    setError('');
    try {
      const r = await core.sendPhoneCode(phone);
      setResendIn(r.resendAfter);
      setCode('');
      // A test server tells the emulator the code, so the tests needn't read the Terminal.
      void core
        .testCode(r.phone)
        .then(setCode)
        .catch(() => {});
    } catch (err) {
      setError(phoneError(t, err));
    }
  }, [phone, t]);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void send();
  }, [send]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  async function signIn(typed = code) {
    if (typed.length < 6 || busy) return;
    setError('');
    setBusy(true);
    try {
      await core.signInWithPhone(phone, typed);
    } catch (err) {
      setError(phoneError(t, err));
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Txt size={14} color={theme.muted} align="center">
        {fill(t.codeSentTo, { phone: formatPhone(phone) })}
      </Txt>
      <Field
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void signIn(digits);
        }}
        placeholder="------"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        testID="code-field"
      />
      {!!error && (
        <Txt size={14} weight="500" color={theme.danger} align="center" testID="sign-in-error">
          {error}
        </Txt>
      )}
      <Button title={busy ? t.signingIn : t.signInWord} onPress={() => signIn()} busy={busy} disabled={code.length < 6} testID="code-sign-in" />
      <Pressy onPress={send} disabled={resendIn > 0 || busy} label={t.resendCode} style={{ alignSelf: 'center' }}>
        <Txt size={14} weight="600" color={resendIn > 0 ? theme.muted : theme.accInk} style={{ padding: 8 }}>
          {resendIn > 0 ? fill(t.resendIn, { s: resendIn }) : t.resendCode}
        </Txt>
      </Pressy>
    </View>
  );
}
