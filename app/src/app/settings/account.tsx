// settings/account.tsx: the ways you sign in. One account can have a Gmail and a
// phone number; you can sign in with either. Remove one only while the other is
// there. A Gmail or number that already has its own PakChat account can't be added
// (later, its owner will be asked to agree).
import { formatPhone } from '@pakchat/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core, reasonOf } from '../../core/core';
import { googleIdToken } from '../../core/google';
import { useAuth } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Button, Divider, Field, Glass, Screen, SettingRow, TopBar, Txt } from '../../ui/kit';
import { phoneError } from '../../ui/format';
import { Dialog, Sheet, toast } from '../../ui/overlays';

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

  function startAdding() {
    setSentTo('');
    setCode('');
    setError('');
    setAdding(true);
  }

  async function addGoogle() {
    try {
      const token = await googleIdToken();
      if (!token) return;
      await core.linkGoogle(token);
      toast(t.linked2);
    } catch (err) {
      toast(reasonOf(err) === 'unknown' ? t.googleError : phoneError(t, err));
    }
  }

  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      const r = await core.sendLinkCode(phone);
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
      await core.linkPhone(sentTo, code);
      setAdding(false);
      toast(t.linked2);
    } catch (err) {
      setError(phoneError(t, err));
    } finally {
      setBusy(false);
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
      <TopBar title={t.signInWays} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 14 }}>
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
      </ScrollView>

      <Sheet visible={adding} onClose={() => setAdding(false)} title={t.linkPhone}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          {!sentTo ? (
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
