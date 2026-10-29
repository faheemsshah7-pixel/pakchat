// sign-in.tsx: the first screen. Continue with Google, or with your phone number.
//
// Google sign-in on Android goes through the phone's Credential Manager: it
// shows the Google accounts on the phone, you pick one, and Google gives the
// app a signed "ID token". The server checks Google's signature on it, then
// makes (or finds) your account. No password ever touches PakChat.
//
// With a phone number, the server sends a 6-digit code. Until PakChat goes live
// the code isn't texted: it shows in the Mac's Terminal (server/README.md, "SMS").
// On a test server the app fills it in by itself, for the emulator tests.
//
// Under the buttons is the server's address. On your phone that's your Mac's
// address on the Wi-Fi (the commands in LEARN.md Step 26 show how to find it).
// Tap it to change it right there on the screen.
//
// The keyboard: Android draws the app behind it, so the screen makes room
// itself (an empty space as tall as the keyboard at the bottom) and scrolls
// down, so the box you're typing in is never hidden.
import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, View, type ScrollViewInstance } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { formatPhone } from '@pakchat/shared';

import { core, isOffline, serverUrl, setServerUrl } from '../core/core';
import { googleIdToken } from '../core/google';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Button, Field, Glass, Pressy, Screen, Txt } from '../ui/kit';
import { phoneError } from '../ui/format';

/** Google's "G", in its four colours (Google asks for it on sign-in buttons). */
function GoogleG() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <Path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z" />
      <Path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </Svg>
  );
}

export default function SignIn() {
  const t = useT();
  const { theme, lang, setPrefs } = useLook();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [server, setServer] = useState(serverUrl());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(server);
  const [testOn, setTestOn] = useState(false);
  const [testName, setTestName] = useState('');
  // Signing in by phone: type the number, then the code.
  const [step, setStep] = useState<'start' | 'number' | 'code'>('start');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const keyboard = useAnimatedKeyboard();
  const keyboardSpace = useAnimatedStyle(() => ({ height: keyboard.height.value }));

  // Once the keyboard is up, scroll so the box you tapped sits just above it. The keyboard can
  // take a while to slide up (much longer on a busy phone), so this runs when Android says it's
  // fully up, not after a guessed wait. Tapping another box while it's already up scrolls too.
  function showBottom() {
    setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 120);
  }
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 60));
    return () => sub.remove();
  }, []);

  useEffect(() => console.log('[pakchat] sign-in screen drawn'), []);

  // Pretend accounts only show when the Mac's server was started for the emulator tests.
  useEffect(() => {
    let alive = true;
    void core
      .testSignInOn()
      .then((on) => alive && setTestOn(on))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [server]);

  async function google() {
    setError('');
    setBusy(true);
    try {
      const idToken = await googleIdToken();
      if (!idToken) return;
      await finish(() => core.signIn(idToken));
    } catch {
      // Google itself said no (or isn't set up on this phone).
      setError(t.googleError);
    } finally {
      setBusy(false);
    }
  }

  /** Hands the token to our server. Its problems get their own words, so this never throws. */
  async function finish(signIn: () => Promise<unknown>) {
    try {
      await signIn();
    } catch (err) {
      // Google said yes, but our server couldn't be reached (wrong address, or it isn't running), or said no.
      setError(isOffline(err) ? t.serverError : t.signInRefused);
    }
  }

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  async function sendCode() {
    if (!phone.trim() || busy) return;
    setError('');
    setBusy(true);
    try {
      const r = await core.sendPhoneCode(phone);
      setSentTo(r.phone);
      setResendIn(r.resendAfter);
      setCode('');
      setStep('code');
      // A test server tells the app the code, so the emulator tests needn't read the Terminal.
      if (testOn) void core.testCode(r.phone).then(setCode).catch(() => {});
    } catch (err) {
      setError(phoneError(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function phoneSignIn(typed = code) {
    if (typed.length < 6 || busy) return;
    setError('');
    setBusy(true);
    try {
      await core.signInWithPhone(sentTo, typed);
    } catch (err) {
      setError(phoneError(t, err));
      setBusy(false);
    }
  }

  async function testSignIn() {
    if (!testName.trim() || busy) return;
    setError('');
    setBusy(true);
    await finish(() => core.signInForTest(testName));
    setBusy(false);
  }

  function saveServer() {
    // Nothing typed: keep the address as it was.
    if (!draft.trim()) return setEditing(false);
    const url = /^https?:\/\//.test(draft.trim()) ? draft.trim() : `http://${draft.trim()}`;
    setServerUrl(url);
    setServer(serverUrl());
    setEditing(false);
  }

  const features = [
    { icon: 'lock' as const, text: t.featLocked },
    { icon: 'sun' as const, text: t.featLight },
    { icon: 'globe' as const, text: t.featUrdu },
  ];

  return (
    <Screen>
      <ScrollView ref={scroller} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressy onPress={() => setPrefs({ lang: lang === 'ur' ? 'en' : 'ur' })} label={t.switchLanguage} testID="switch-language">
            <Glass style={{ height: 40, paddingHorizontal: 14, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="globe" size={17} color={theme.accInk} />
              <Txt size={15} weight="600" color={theme.accInk}>
                {t.switchLanguage}
              </Txt>
            </Glass>
          </Pressy>
        </View>

        <View style={{ alignItems: 'center', marginTop: 48, gap: 12 }}>
          <View>
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 32,
                backgroundColor: theme.acc,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 24px 50px -16px ${theme.acc}`,
              }}
            >
              <Icon name="chat" size={46} color="#FFFFFF" stroke={2} />
            </View>
          </View>
          <View>
            <Txt size={36} weight="800" align="center" style={{ marginTop: 10, letterSpacing: -1 }}>
              {t.appName}
            </Txt>
          </View>
          <View>
            <Txt size={16} color={theme.muted} align="center">
              {t.tagline}
            </Txt>
          </View>
        </View>

        <View style={{ gap: 10, marginTop: 36 }}>
          {features.map((f, i) => (
            <Animated.View key={f.icon}>
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={f.icon} size={19} color={theme.accInk} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight="500">
                    {f.text}
                  </Txt>
                </View>
              </Glass>
            </Animated.View>
          ))}
        </View>

        <View style={{ flex: 1, minHeight: 24 }} />

        {!!error && (
          <View>
            <View style={{ backgroundColor: theme.dangerSoft, borderRadius: 14, padding: 12, marginBottom: 12 }} testID="sign-in-error">
              <Txt size={14} weight="500" color={theme.danger} align="center">
                {error}
              </Txt>
            </View>
          </View>
        )}

        <Animated.View style={{ gap: 10 }}>
          {step === 'start' && (
            <>
              <Pressy onPress={google} disabled={busy} label={t.continueGoogle} testID="google-sign-in">
                <View
                  style={{
                    height: 54,
                    borderRadius: 17,
                    backgroundColor: '#FFFFFF',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    boxShadow: '0 12px 28px -14px rgba(30,64,140,0.45)',
                  }}
                >
                  <GoogleG />
                  <Txt size={16} weight="700" color="#1F1F1F">
                    {busy ? t.signingIn : t.continueGoogle}
                  </Txt>
                </View>
              </Pressy>
              <Button title={t.usePhone} icon="calls" onPress={() => (setError(''), setStep('number'))} testID="use-phone" />
            </>
          )}

          {step === 'number' && (
            <Animated.View style={{ gap: 8 }}>
              <Txt size={13} color={theme.muted}>
                {t.phoneHint}
              </Txt>
              <Field
                value={phone}
                onChangeText={setPhone}
                placeholder="0300 1234567"
                keyboardType="phone-pad"
                autoComplete="tel"
                icon="calls"
                autoFocus
                testID="phone-field"
                onFocus={showBottom}
                returnKeyType="go"
                onSubmitEditing={sendCode}
              />
              <Button title={t.sendCode} onPress={sendCode} busy={busy} disabled={!phone.trim()} testID="send-code" />
              <Button title={t.back} look="soft" onPress={() => (setError(''), setStep('start'))} />
            </Animated.View>
          )}

          {step === 'code' && (
            <Animated.View style={{ gap: 8 }}>
              <Txt size={14} color={theme.muted} align="center">
                {fill(t.codeSentTo, { phone: formatPhone(sentTo) })}
              </Txt>
              <Field
                value={code}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, 6);
                  setCode(digits);
                  if (digits.length === 6) void phoneSignIn(digits);
                }}
                placeholder="123456"
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={6}
                autoFocus
                testID="code-field"
                onFocus={showBottom}
              />
              <Button title={busy ? t.signingIn : t.signInWord} onPress={() => phoneSignIn()} busy={busy} disabled={code.length < 6} testID="code-sign-in" />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Pressy onPress={() => (setError(''), setStep('number'))} label={t.changeNumber}>
                  <Txt size={14} weight="600" color={theme.accInk} style={{ padding: 8 }}>
                    {t.changeNumber}
                  </Txt>
                </Pressy>
                <Pressy onPress={sendCode} disabled={resendIn > 0 || busy} label={t.resendCode}>
                  <Txt size={14} weight="600" color={resendIn > 0 ? theme.muted : theme.accInk} style={{ padding: 8 }}>
                    {resendIn > 0 ? fill(t.resendIn, { s: resendIn }) : t.resendCode}
                  </Txt>
                </Pressy>
              </View>
            </Animated.View>
          )}

          {testOn && step === 'start' && (
            <Animated.View style={{ gap: 8, marginTop: 6 }}>
              <Txt size={13} weight="700" color={theme.sectionText}>
                {t.testAccount}
              </Txt>
              <Field value={testName} onChangeText={setTestName} placeholder={t.yourName} testID="test-name" autoCapitalize="words" returnKeyType="go" onSubmitEditing={testSignIn} onFocus={showBottom} />
              <Button title={t.continue} look="soft" onPress={testSignIn} busy={busy} testID="test-sign-in" />
            </Animated.View>
          )}

          {editing ? (
            <Animated.View style={{ gap: 8, marginTop: 6 }}>
              <Txt size={13} color={theme.muted}>
                {t.serverAddressHint}
              </Txt>
              <Field
                value={draft}
                onChangeText={setDraft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.10:4000"
                testID="server-field"
                icon="server"
                autoFocus
                onFocus={showBottom}
                onSubmitEditing={saveServer}
              />
              <Button title={t.save} onPress={saveServer} testID="server-save" />
            </Animated.View>
          ) : (
            <Pressy onPress={() => (setDraft(server), setEditing(true))} label={t.serverAddress} testID="server-address" scale={0.98}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}>
                <Icon name="server" size={15} color={theme.muted} />
                <Txt size={13} color={theme.muted}>
                  {server.replace(/^https?:\/\//, '')}
                </Txt>
                <Icon name="edit" size={14} color={theme.muted} />
              </View>
            </Pressy>
          )}
        </Animated.View>
        <Animated.View style={keyboardSpace} />
      </ScrollView>
    </Screen>
  );
}
