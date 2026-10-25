// settings/lock.tsx: App lock and Chat lock (see core/lock.ts).
//
// App lock: on with a fingerprint or face only, after a warning that if it
// stops working the only way back is to reinstall and restore. When it locks:
// at once, after 30 seconds, after a minute, or when the phone locks.
// Chat lock: how soon a locked chat locks again after you leave it, the secret
// code that hides the Locked chats folder, and "Clear locked chats" for a
// forgotten code (it deletes them from this phone).
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { core } from '../../core/core';
import { useSettings } from '../../core/hooks';
import { authenticate, canUseBiometrics, codeHash } from '../../core/lock';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Chip, Divider, Field, Glass, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { Dialog, Sheet, toast } from '../../ui/overlays';

export default function LockSettings() {
  const t = useT();
  const { theme } = useLook();
  const settings = useSettings();
  const [warn, setWarn] = useState(false);
  const [noBio, setNoBio] = useState(false);
  const [coding, setCoding] = useState(false);
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [clearing, setClearing] = useState(false);

  async function turnOn() {
    if (!(await canUseBiometrics())) return setNoBio(true);
    setWarn(true);
  }

  async function confirmOn() {
    setWarn(false);
    const r = await authenticate(t.confirmFingerprint, t.cancel);
    if (r === 'ok') core.setSettings({ appLock: true });
    else if (r === 'failed') toast(t.notRecognised);
    else if (r === 'wait') toast(t.waitABit);
  }

  async function turnOff() {
    const r = await authenticate(t.confirmFingerprint, t.cancel);
    if (r === 'ok' || r === 'unavailable') core.setSettings({ appLock: false });
    else if (r === 'failed') toast(t.notRecognised);
  }

  async function saveCode() {
    const c = code.trim();
    if (c.length < 4) return toast(t.codeTooShort);
    if (c.toLowerCase() !== again.trim().toLowerCase()) return toast(t.codesDiffer);
    core.setSettings({ lockedHidden: true, secretCode: await codeHash(c) });
    setCoding(false);
    setCode('');
    setAgain('');
    toast(t.secretCodeSet);
  }

  async function clearLocked() {
    setClearing(false);
    const locked = Object.entries(core.prefs).filter(([, p]) => !!p.lock);
    for (const [chatId] of locked) {
      await core.deleteChatHere(chatId).catch(() => {});
      core.setPrefs(chatId, { lock: undefined });
    }
    core.setSettings({ lockedHidden: false, secretCode: undefined });
    toast(t.lockedCleared);
  }

  const afters: { v: 0 | 30 | 60 | -1; label: string }[] = [
    { v: 0, label: t.atOnce },
    { v: 30, label: t.after30s },
    { v: 60, label: t.after1m },
    { v: -1, label: t.whenPhoneLocks },
  ];
  const relocks: { v: 0 | 30 | 60; label: string }[] = [
    { v: 0, label: t.atOnce },
    { v: 30, label: t.after30s },
    { v: 60, label: t.after1m },
  ];

  return (
    <Screen>
      <TopBar title={t.appLock} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
        <Glass style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
          <Icon name="fingerprint" size={24} color={theme.accInk} />
          <Txt size={13.5} color={theme.sectionText} style={{ flex: 1 }}>
            {t.appLockNote}
          </Txt>
        </Glass>

        <Section title={t.appLock} />
        <Glass>
          <SettingRow
            icon="lock"
            title={t.unlockWithBiometrics}
            chevron={false}
            right={<Toggle on={settings.appLock} onChange={(on) => void (on ? turnOn() : turnOff())} label={t.unlockWithBiometrics} testID="app-lock-toggle" />}
          />
          {settings.appLock && (
            <>
              <Divider />
              <View style={{ padding: 14, gap: 8 }}>
                <Txt size={13} weight="700" color={theme.sectionText}>
                  {t.lockWhen}
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {afters.map((a) => (
                    <Chip key={a.v} label={a.label} on={settings.appLockAfter === a.v} onPress={() => core.setSettings({ appLockAfter: a.v })} testID={`lock-after-${a.v}`} />
                  ))}
                </View>
              </View>
            </>
          )}
        </Glass>

        <Section title={t.chatLock} />
        <Glass>
          <View style={{ padding: 14, gap: 8 }}>
            <Txt size={13.5} color={theme.sectionText}>
              {t.chatLockNote}
            </Txt>
            <Txt size={13} weight="700" color={theme.sectionText} style={{ marginTop: 6 }}>
              {t.relockAfter}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {relocks.map((a) => (
                <Chip key={a.v} label={a.label} on={settings.chatRelock === a.v} onPress={() => core.setSettings({ chatRelock: a.v })} testID={`relock-${a.v}`} />
              ))}
            </View>
          </View>
          <Divider />
          <SettingRow
            icon="eye"
            title={t.hideLockedChats}
            sub={t.hideLockedChatsSub}
            chevron={false}
            right={
              <Toggle
                on={settings.lockedHidden}
                onChange={(on) => (on ? setCoding(true) : core.setSettings({ lockedHidden: false, secretCode: undefined }))}
                label={t.hideLockedChats}
                testID="hide-locked"
              />
            }
          />
          {settings.lockedHidden && (
            <>
              <Divider />
              <SettingRow icon="key" title={t.changeSecretCode} onPress={() => setCoding(true)} testID="change-code" />
            </>
          )}
          <Divider />
          <SettingRow icon="trash" title={t.clearLockedChats} sub={t.clearLockedChatsSub} danger chevron={false} onPress={() => setClearing(true)} testID="clear-locked" />
        </Glass>
      </ScrollView>

      <Dialog
        visible={warn}
        onClose={() => setWarn(false)}
        title={t.appLockWarnTitle}
        text={t.appLockWarn}
        buttons={[
          { label: t.turnOn, onPress: () => void confirmOn(), testID: 'app-lock-yes' },
          { label: t.cancel, onPress: () => setWarn(false) },
        ]}
      />
      <Dialog
        visible={noBio}
        onClose={() => setNoBio(false)}
        title={t.noBiometricsTitle}
        text={t.noBiometrics}
        buttons={[
          {
            label: t.openSettings,
            onPress: () => {
              setNoBio(false);
              void Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() => Linking.openSettings());
            },
          },
          { label: t.cancel, onPress: () => setNoBio(false) },
        ]}
      />
      <Dialog
        visible={clearing}
        onClose={() => setClearing(false)}
        title={t.clearLockedChats}
        text={t.clearLockedChatsSure}
        buttons={[
          { label: t.clearLockedChats, danger: true, onPress: () => void clearLocked(), testID: 'clear-locked-yes' },
          { label: t.cancel, onPress: () => setClearing(false) },
        ]}
      />
      <Sheet visible={coding} onClose={() => setCoding(false)} title={t.secretCode}>
        <View style={{ paddingHorizontal: 18, gap: 12 }}>
          <Txt size={13.5} color={theme.muted}>
            {t.secretCodeNote}
          </Txt>
          <Field value={code} onChangeText={setCode} placeholder={t.secretCode} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={30} testID="secret-code" />
          <Field value={again} onChangeText={setAgain} placeholder={t.secretCodeAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={30} testID="secret-code-again" />
          <Button title={t.save} disabled={code.trim().length < 4} onPress={() => void saveCode()} testID="secret-code-save" />
        </View>
      </Sheet>
    </Screen>
  );
}
