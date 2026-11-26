// settings/account.tsx: the ways you sign in. One account can have a Gmail and a
// phone number; you can sign in with either. Remove one only while the other is
// there. A Gmail or number that already has its own PakChat account can't be added
// (later, its owner will be asked to agree).
//
// Also Two-step verification (settings/two-step.tsx), Security notifications (the "security code changed" notes), where the server is (only on a test server: change it when the Mac's Wi-Fi address
// changes, no need to log out), Log out, and Delete my account (settings/delete-account.tsx).
import { formatPhone, pinRefused } from '@pakchat/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core, isOffline, onBuiltInServer, reasonOf, serverUrl } from '../../core/core';
import { googleIdToken } from '../../core/google';
import { useAuth, useSettings } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Button, Divider, Field, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { phoneError } from '../../ui/format';
import { Dialog, Sheet, toast } from '../../ui/overlays';
import { PinBoxes, pinWrongText, waitClock } from '../../ui/Pin';
import { WhatsAppCheck } from '../../ui/WhatsAppCheck';
import { slid } from '../../ui/ScreenSlide';

function Account() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const settings = useSettings();
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
  // Moving one whose account has a two-step PIN: that PIN is asked too (security fix, build 35).
  const [pinFor, setPinFor] = useState<{ kind: 'google'; token: string } | { kind: 'phone'; number: string; code: string } | null>(null);
  const [movePin, setMovePin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinUntil, setPinUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Too many wrong tries: the boxes wait, with the time left (as when signing in).
  useEffect(() => {
    if (pinUntil <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= pinUntil) setPinUntil(0);
    }, 1000);
    return () => clearInterval(id);
  }, [pinUntil]);
  const pinWaiting = pinUntil > now;

  /** That account has a PIN: ask for it (the code or Google's token stays good meanwhile). */
  function askPin(m: { kind: 'google'; token: string } | { kind: 'phone'; number: string; code: string }) {
    setAdding(false);
    setMovePin('');
    setPinError('');
    setPinFor(m);
  }

  async function moveWithPin(typed: string) {
    const m = pinFor;
    if (!m || pinBusy || pinWaiting) return;
    setPinBusy(true);
    setPinError('');
    try {
      if (m.kind === 'google') await core.linkGoogle(m.token, true, typed);
      else await core.linkPhone(m.number, m.code, true, typed);
      setPinFor(null);
      toast(t.linked2);
    } catch (err) {
      setMovePin('');
      const refused = pinRefused(err);
      if (refused?.wait) {
        setPinUntil(Date.now() + refused.wait * 1000);
        setNow(Date.now());
      } else if (refused) setPinError(pinWrongText(t, refused.triesLeft ?? 0));
      else setPinError(isOffline(err) ? t.serverError : m.kind === 'google' && reasonOf(err) === 'unknown' ? t.googleError : phoneError(t, err));
    } finally {
      setPinBusy(false);
    }
  }

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
        if (reasonOf(err) === 'pin_needed') {
          askPin({ kind: 'phone', number: sentTo, code });
          return;
        }
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
      if (reasonOf(err) === 'pin_needed' && m.kind !== 'sendCode') return askPin(m);
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
            action={
              me?.email ? (
                both ? <Button small title={t.unlink} look="soft" onPress={() => setRemoving('google')} testID="unlink-google" /> : undefined
              ) : (
                <Button small title={t.linkGoogle} look="soft" onPress={addGoogle} testID="link-google" />
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
            action={
              me?.phone ? (
                both ? <Button small title={t.unlink} look="soft" onPress={() => setRemoving('phone')} testID="unlink-phone" /> : undefined
              ) : (
                <Button small title={t.linkPhone} look="soft" onPress={startAdding} testID="link-phone" />
              )
            }
          />
        </Glass>
        {!both && (
          <Txt size={13} color={theme.muted} style={{ paddingHorizontal: 6 }}>
            {t.lastSignIn}
          </Txt>
        )}
        {/* Two-step verification (settings/two-step.tsx): a PIN asked when the account signs in on a new phone. */}
        <Glass>
          <SettingRow icon="lock" title={t.twoStep} sub={me?.pin ? t.twoStepSubOn : t.twoStepSubOff} onPress={() => router.push('/settings/two-step')} testID="open-two-step" />
        </Glass>
        {/* Where the server is, only on a test server (a Mac on the Wi-Fi): change it here when the
            Mac's Wi-Fi address changes (no need to log out). The live one never shows it (Phase 11). */}
        {!onBuiltInServer() && (
          <Glass>
            <SettingRow icon="server" title={t.serverAddress} sub={serverUrl().replace(/^https?:\/\//, '')} onPress={() => setServer(serverUrl())} testID="open-server" />
          </Glass>
        )}
        {/* Like WhatsApp's: a note in the chat when someone's security code changes (a new phone,
            or PakChat put back on), so you can check it. Off: no notes. */}
        <Glass>
          <SettingRow
            icon="shield"
            title={t.securityNotes}
            sub={t.securityNotesSub}
            chevron={false}
            right={<Toggle on={settings.securityNotes !== false} onChange={(on) => core.setSettings({ securityNotes: on })} label={t.securityNotes} testID="security-notes" />}
          />
        </Glass>
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
      <Sheet visible={!!pinFor} onClose={() => setPinFor(null)} title={t.movePinTitle}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 14 }}>
          <Txt size={14} color={theme.muted}>
            {pinFor?.kind === 'google' ? fill(t.movePinGoogle, { what: emailIn(pinFor.token) }) : fill(t.movePinPhone, { what: pinFor ? formatPhone(pinFor.number) : '' })}
          </Txt>
          <PinBoxes
            value={movePin}
            onChange={setMovePin}
            onDone={(v) => void moveWithPin(v)}
            error={!!pinError}
            disabled={pinBusy || pinWaiting}
            label={t.movePinTitle}
            testID="move-pin-field"
          />
          {(!!pinError || pinWaiting) && (
            <Txt size={14} weight="500" color={theme.danger} align="center" testID="move-pin-error">
              {pinWaiting ? fill(t.pinWait, { time: waitClock((pinUntil - now) / 1000) }) : pinError}
            </Txt>
          )}
          <Button title={t.moveHere} onPress={() => void moveWithPin(movePin)} busy={pinBusy} disabled={movePin.length < 6 || pinWaiting} testID="move-pin-save" />
          <Pressy onPress={() => setPinFor(null)} label={t.cancel} style={{ alignSelf: 'center' }} testID="move-pin-cancel">
            <Txt size={15} weight="600" color={theme.accInk} style={{ padding: 6 }}>
              {t.cancel}
            </Txt>
          </Pressy>
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

export default slid(Account);
