// sign-in.tsx: the first screen. Continue with Google, and that's it.
//
// Google sign-in on Android goes through the phone's Credential Manager: it
// shows the Google accounts on the phone, you pick one, and Google gives the
// app a signed "ID token". The server checks Google's signature on it, then
// makes (or finds) your account. No password ever touches PakChat.
//
// Under the buttons is the server's address. On your phone that's your Mac's
// address on the Wi-Fi (the commands in LEARN.md Step 26 show how to find it).
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { GoogleOneTapSignIn, isCancelledResponse, isNoSavedCredentialFoundResponse, isSuccessResponse } from 'react-native-nitro-google-signin';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { core, GOOGLE_WEB_CLIENT_ID, isOffline, serverUrl, setServerUrl } from '../core/core';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Button, Field, Glass, Pressy, Screen, Txt } from '../ui/kit';
import { lively } from '../ui/motion';
import { Sheet, toast } from '../ui/overlays';

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

let configured = false;

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

  // Pretend accounts only show when the Mac's server was started for the emulator tests.
  useEffect(() => {
    let alive = true;
    void core.testSignInOn().then((on) => alive && setTestOn(on));
    return () => {
      alive = false;
    };
  }, [server]);

  async function google() {
    setError('');
    setBusy(true);
    try {
      if (!configured) {
        GoogleOneTapSignIn.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
        configured = true;
      }
      await GoogleOneTapSignIn.checkPlayServices();
      // First the quick sheet with accounts used before, then all accounts on the phone.
      let res = await GoogleOneTapSignIn.signIn();
      if (isNoSavedCredentialFoundResponse(res)) res = await GoogleOneTapSignIn.createAccount();
      if (isNoSavedCredentialFoundResponse(res)) res = await GoogleOneTapSignIn.presentExplicitSignIn();
      if (isCancelledResponse(res)) return;
      if (!isSuccessResponse(res) || !res.data.idToken) throw new Error('google');
      const idToken = res.data.idToken;
      await finish(() => core.signIn(idToken));
    } catch {
      // Google itself said no (or isn't set up on this phone).
      setError(t.googleError);
    } finally {
      setBusy(false);
    }
  }

  /** Hands the token to our server. Its problems get their own words, so this never throws. */
  async function finish(signIn: () => Promise<void>) {
    try {
      await signIn();
    } catch (err) {
      // Google said yes, but our server couldn't be reached (wrong address, or it isn't running), or said no.
      setError(isOffline(err) ? t.serverError : t.signInRefused);
    }
  }

  async function testSignIn() {
    if (!testName.trim()) return;
    setError('');
    setBusy(true);
    await finish(() => core.signInForTest(testName));
    setBusy(false);
  }

  function saveServer() {
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
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
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
          <Animated.View entering={ZoomIn.springify().damping(lively.damping!).stiffness(lively.stiffness!)}>
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
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(80).springify().damping(20)}>
            <Txt size={36} weight="800" align="center" style={{ marginTop: 10, letterSpacing: -1 }}>
              {t.appName}
            </Txt>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(140).springify().damping(20)}>
            <Txt size={16} color={theme.muted} align="center">
              {t.tagline}
            </Txt>
          </Animated.View>
        </View>

        <View style={{ gap: 10, marginTop: 36 }}>
          {features.map((f, i) => (
            <Animated.View key={f.icon} entering={FadeInDown.delay(200 + i * 70).springify().damping(20)}>
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
          <Animated.View entering={FadeIn}>
            <View style={{ backgroundColor: theme.dangerSoft, borderRadius: 14, padding: 12, marginBottom: 12 }} testID="sign-in-error">
              <Txt size={14} weight="500" color={theme.danger} align="center">
                {error}
              </Txt>
            </View>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.delay(380).springify().damping(20)} style={{ gap: 10 }}>
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
          <Button title={t.usePhone} icon="calls" onPress={() => toast(t.phoneSoon)} />

          {testOn && (
            <Animated.View entering={FadeIn} style={{ gap: 8, marginTop: 6 }}>
              <Txt size={13} weight="700" color={theme.sectionText}>
                {t.testAccount}
              </Txt>
              <Field value={testName} onChangeText={setTestName} placeholder={t.yourName} testID="test-name" autoCapitalize="words" returnKeyType="go" onSubmitEditing={testSignIn} />
              <Button title={t.continue} look="soft" onPress={testSignIn} busy={busy} testID="test-sign-in" />
            </Animated.View>
          )}

          <Pressy onPress={() => (setDraft(server), setEditing(true))} label={t.serverAddress} testID="server-address" scale={0.98}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}>
              <Icon name="server" size={15} color={theme.muted} />
              <Txt size={13} color={theme.muted}>
                {server.replace(/^https?:\/\//, '')}
              </Txt>
              <Icon name="edit" size={14} color={theme.muted} />
            </View>
          </Pressy>
        </Animated.View>
      </ScrollView>

      <Sheet visible={editing} onClose={() => setEditing(false)} title={t.serverAddress}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }}>
          <Txt size={14} color={theme.muted}>
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
            onSubmitEditing={saveServer}
          />
          <Button title={t.save} onPress={saveServer} testID="server-save" />
        </View>
      </Sheet>
    </Screen>
  );
}
