// settings/account.tsx: the ways you sign in. One account can have a Gmail and a
// phone number; you can sign in with either. Remove one only while the other is
// there. A Gmail or number that already has its own PakChat account can't be added
// (later, its owner will be asked to agree).
//
// Also where the server is (only on a test server: change it when the Mac's Wi-Fi address
// changes, no need to log out), Log out, and Delete my account (settings/delete-account.tsx).
import { formatPhone } from '@pakchat/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core, onBuiltInServer, reasonOf, serverUrl } from '../../core/core';
import { googleIdToken } from '../../core/google';
import { useAuth } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Button, Divider, Field, Glass, Screen, Section, SettingRow, TopBar, Txt } from '../../ui/kit';
import { phoneError } from '../../ui/format';
import { Dialog, Sheet, toast } from '../../ui/overlays';
import { WhatsAppCheck } from '../../ui/WhatsAppCheck';

export default function Account() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const [removing, setRemoving] = useState<'google' | 'phone' | null>(null);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [server, setServer] = useState<string | null>(null);
  // A Gmail or number that has its own account: asked first, then moved here (owner, 31 Oct).
  const [moving, setMoving] = useState<{ kind: 'google'; token: string } | { kind: 'sendCode' } | { kind: 'phone'; number: string; code: string } | null>(null);
  /** Said yes to moving this number: its code is sent, and adding it moves it. */
  const moveOk = useRef(false);
  const [leaving, setLeaving] = useState(false);

  async function saveServer() {
    const typed = (server ?? '').trim();
    setServer(null);
    if (!typed) return;
    try {
      await core.changeServer(/^https?:\/\//.test(typed) ? typed : `http://${typed}`);
    } catch {
      toast(t.couldNot);
    }
  }

  // A live server checks numbers with WhatsApp (free) instead of SMS codes. The live one always
  // does (no SMS there), even before its answer comes; only a test server may say no.
  const [waOn, setWaOn] = useState(onBuiltInServer);
  useEffect(() => {
    let alive = true;
    void core
      .whatsAppOn()
      .then((on) => alive && setWaOn(on || onBuiltInServer()))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // WhatsApp proved the number: its one-time code adds it, exactly like an SMS code.
  const whatsAppAdd = useCallback(
    async (number: string, oneTime: string) => {
      try {
        await core.linkPhone(number, oneTime);
      } catch (err) {
        if (reasonOf(err) !== 'taken') throw err;
        setMoving({ kind: 'phone', number, code: oneTime });
        return;
      }
      setAdding(false);
      toast(t.linked2);
    },
    [t],
  );

  function startAdding() {
    moveOk.current = false;
    setSentTo('');
    setCode('');
    setError('');
    setAdding(true);
  }

  async function addGoogle() {
    try {
      const token = await googleIdToken();
      if (!token) return;
      try {
        await core.linkGoogle(token);
      } catch (err) {
        if (reasonOf(err) !== 'taken') throw err;
        setMoving({ kind: 'google', token });
        return;
      }
      toast(t.linked2);
    } catch (err) {
      toast(reasonOf(err) === 'unknown' ? t.googleError : phoneError(t, err));
    }
  }

  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      let r;
      try {
        r = await core.sendLinkCode(phone, moveOk.current);
      } catch (err) {
        if (reasonOf(err) !== 'taken') throw err;
        setMoving({ kind: 'sendCode' });
        return;
      }
      setSentTo(r.phone);
      if (await core.testSignInOn()) void core.testCode(r.phone).then(setCode).catch(() => {});
    } catch (err) {
      setError(phoneError(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function addPhone() {
    setBusy(true);
    setError('');
    try {
      try {
        await core.linkPhone(sentTo, code, moveOk.current);
      } catch (err) {
        if (reasonOf(err) !== 'taken') throw err;
        setMoving({ kind: 'phone', number: sentTo, code });
        return;
      }
      setAdding(false);
      toast(t.linked2);
    } catch (err) {
      setError(phoneError(t, err));
    } finally {
      setBusy(false);
    }
  }

  /** Said yes on "Move it here": does what was refused, moving it. */
  async function moveHere() {
    const m = moving;
    setMoving(null);
    if (!m) return;
    try {
      if (m.kind === 'google') {
        await core.linkGoogle(m.token, true);
        toast(t.linked2);
      } else if (m.kind === 'sendCode') {
        moveOk.current = true;
        await sendCode();
      } else {
        await core.linkPhone(m.number, m.code, true);
        setAdding(false);
        toast(t.linked2);
      }
    } catch (err) {
      toast(m.kind === 'google' && reasonOf(err) === 'unknown' ? t.googleError : phoneError(t, err));
    }
  }

  async function remove(what: 'google' | 'phone') {
    setRemoving(null);
    try {
      await core.unlink(what);
      toast(t.removed);
    } catch (err) {
      toast(reasonOf(err) === 'last_sign_in' ? t.lastSignIn : t.couldNot);
    }
  }

  const both = !!me?.email && !!me?.phone;

  return (
    <Screen>
      <TopBar title={t.accountWord} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 14 }}>
        <Section title={t.signInWays} />
        <Glass>
          <SettingRow
            icon="globe"
            title={t.googleAccount}
            sub={me?.email ?? t.notLinked}
            chevron={false}
            testID="way-google"
            right={
              me?.email ? (
                both ? <Button title={t.unlink} look="soft" onPress={() => setRemoving('google')} testID="unlink-google" /> : undefined
              ) : (
                <Button title={t.linkGoogle} look="soft" onPress={addGoogle} testID="link-google" />
              )
            }
          />
          <Divider />
          <SettingRow
            icon="calls"
            title={t.phoneNumber}
            sub={me?.phone ? formatPhone(me.phone) : t.notLinked}
            chevron={false}
            testID="way-phone"
            right={
              me?.phone ? (
                both ? <Button title={t.unlink} look="soft" onPress={() => setRemoving('phone')} testID="unlink-phone" /> : undefined
              ) : (
                <Button title={t.linkPhone} look="soft" onPress={startAdding} testID="link-phone" />
              )
            }
          />
        </Glass>
        {!both && (
          <Txt size={13} color={theme.muted} style={{ paddingHorizontal: 6 }}>
            {t.lastSignIn}
          </Txt>
        )}
        {/* Where the server is, only on a test server (a Mac on the Wi-Fi): change it here when the
            Mac's Wi-Fi address changes (no need to log out). The live one never shows it (Phase 11). */}
        {!onBuiltInServer() && (
          <Glass>
            <SettingRow icon="server" title={t.serverAddress} sub={serverUrl().replace(/^https?:\/\//, '')} onPress={() => setServer(serverUrl())} testID="open-server" />
          </Glass>
        )}
        <Glass>
          <SettingRow icon="logout" title={t.logOut} danger chevron={false} onPress={() => setLeaving(true)} testID="log-out" />
          <Divider />
          <SettingRow icon="trash" title={t.deleteAccount} danger onPress={() => router.push('/settings/delete-account')} testID="open-delete-account" />
        </Glass>
      </ScrollView>

      <Sheet visible={server !== null} onClose={() => setServer(null)} title={t.serverAddress}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Txt size={13} color={theme.muted}>
            {t.serverAddressHint}
          </Txt>
          <Field
            value={server ?? ''}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.10:4000"
            icon="server"
            onSubmitEditing={saveServer}
            testID="me-server"
          />
          <Button title={t.save} onPress={saveServer} disabled={!(server ?? '').trim()} testID="me-server-save" />
        </View>
      </Sheet>

      <Dialog
        visible={leaving}
        onClose={() => setLeaving(false)}
        title={t.logOut}
        text={t.logOutSure}
        buttons={[
          {
            label: t.logOut,
            danger: true,
            testID: 'confirm-log-out',
            onPress: () => {
              setLeaving(false);
              void core.signOut();
            },
          },
          { label: t.cancel, onPress: () => setLeaving(false) },
        ]}
      />

      <Sheet visible={adding} onClose={() => setAdding(false)} title={t.linkPhone}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          {waOn ? (
            <WhatsAppCheck purpose="link" onChecked={whatsAppAdd} onBack={() => setAdding(false)} />
          ) : !sentTo ? (
            <>
              <Txt size={13} color={theme.muted}>
                {t.phoneHint}
              </Txt>
              <Field value={phone} onChangeText={setPhone} placeholder="0300 1234567" keyboardType="phone-pad" icon="calls" testID="link-phone-field" onSubmitEditing={sendCode} />
              <Button title={t.sendCode} onPress={sendCode} busy={busy} disabled={!phone.trim()} testID="link-send-code" />
            </>
          ) : (
            <>
              <Txt size={13} color={theme.muted}>
                {fill(t.codeSentTo, { phone: formatPhone(sentTo) })}
              </Txt>
              <Field value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="123456" keyboardType="number-pad" maxLength={6} testID="link-code-field" />
              <Button title={t.save} onPress={addPhone} busy={busy} disabled={code.length < 6} testID="link-code-save" />
            </>
          )}
          {!!error && (
            <Txt size={14} color={theme.danger} align="center">
              {error}
            </Txt>
          )}
        </View>
      </Sheet>

      <Dialog
        visible={!!moving}
        onClose={() => setMoving(null)}
        title={moving?.kind === 'google' ? t.moveGoogleTitle : t.movePhoneTitle}
        text={fill(t.moveText, {
          what: !moving ? '' : moving.kind === 'google' ? emailIn(moving.token) : formatPhone(moving.kind === 'phone' ? moving.number : phone),
        })}
        buttons={[
          { label: t.moveHere, danger: true, onPress: () => void moveHere(), testID: 'confirm-move' },
          { label: t.cancel, onPress: () => setMoving(null) },
        ]}
      />
      <Dialog
        visible={!!removing}
        onClose={() => setRemoving(null)}
        title={t.unlink}
        text={fill(t.unlinkSure, { what: removing === 'google' ? (me?.email ?? '') : formatPhone(me?.phone ?? '') })}
        buttons={[
          { label: t.unlink, danger: true, onPress: () => removing && void remove(removing), testID: 'confirm-unlink' },
          { label: t.cancel, onPress: () => setRemoving(null) },
        ]}
      />
    </Screen>
  );
}

/** The Gmail address in Google's token (its middle part), to name it in "Move it here". */
function emailIn(token: string): string {
  try {
    const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const email = (JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))) as { email?: unknown }).email;
    return typeof email === 'string' ? email : 'Gmail';
  } catch {
    return 'Gmail';
  }
}
