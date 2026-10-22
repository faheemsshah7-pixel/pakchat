// settings/backup.tsx: chat backup. Pick a password (kept only on this phone, in
// Android's locked storage), back up now, or let it back up once a day.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { backUp, backupPrefs, findBackup, hasPassword, lastBackupAt, MIN_PASSWORD, setBackupPrefs, setPassword, type BackupInfo } from '../../core/backup';
import { useFileProgress } from '../../core/hooks';
import { core, isOffline } from '../../core/core';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Divider, Field, Glass, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { clock, dayLabel, fileSize } from '../../ui/format';
import { Dialog, Sheet, toast } from '../../ui/overlays';

export default function Backup() {
  const t = useT();
  const { theme } = useLook();
  const [server, setServer] = useState<BackupInfo | null | undefined>(undefined);
  const [prefs, setPrefs] = useState(backupPrefs);
  const [havePassword, setHavePassword] = useState(hasPassword);
  const [asking, setAsking] = useState(false);
  const [password, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const progress = useFileProgress('backup');

  function load() {
    void findBackup()
      .then(setServer)
      .catch(() => setServer(null));
  }
  useEffect(load, []);

  function change(p: typeof prefs) {
    setPrefs(p);
    setBackupPrefs(p);
  }

  function savePassword() {
    setPassword(password);
    setHavePassword(true);
    setAsking(false);
    setPw('');
    setAgain('');
    void now();
  }

  async function now() {
    if (!hasPassword()) return setAsking(true);
    setBusy(true);
    try {
      await backUp();
      toast(t.backupDone);
      load();
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setDeleting(false);
    try {
      await core.server.deleteBackup();
      setServer(null);
    } catch {
      toast(t.couldNot);
    }
  }

  const when = server ? server.madeAt : lastBackupAt();
  const whenText = when ? `${dayLabel(when, t)}, ${clock(when)}` : '';

  return (
    <Screen>
      <TopBar title={t.backup} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Glass style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
          <Icon name="lock" size={22} color={theme.accInk} />
          <View style={{ flex: 1 }}>
            <Txt size={14} color={theme.sectionText}>
              {t.backupNote}
            </Txt>
          </View>
        </Glass>

        <Glass style={{ marginTop: 12, padding: 14, gap: 10 }}>
          <Txt size={15.5} weight="700" testID="backup-last">
            {server ? fill(t.lastBackup, { when: `${whenText} · ${fileSize(server.size)}` }) : server === null ? t.noBackupYet : '…'}
          </Txt>
          <Button
            title={busy ? (progress !== undefined ? `${t.backingUp} ${Math.round(progress * 100)}%` : t.backingUp) : t.backupNow}
            icon="upload"
            onPress={now}
            busy={busy}
            testID="backup-now"
          />
        </Glass>

        <Section title={t.settings} />
        <Glass>
          <SettingRow icon="clock" title={t.dailyBackup} chevron={false} right={<Toggle on={prefs.daily} onChange={(on) => change({ ...prefs, daily: on })} label={t.dailyBackup} />} />
          <Divider />
          <SettingRow icon="globe" title={t.wifiOnly} chevron={false} right={<Toggle on={prefs.wifiOnly} onChange={(on) => change({ ...prefs, wifiOnly: on })} label={t.wifiOnly} />} />
          <Divider />
          <SettingRow icon="key" title={havePassword ? t.changePassword : t.backupPassword} onPress={() => setAsking(true)} testID="backup-password" />
          {!!server && (
            <>
              <Divider />
              <SettingRow icon="trash" title={t.deleteBackup} danger chevron={false} onPress={() => setDeleting(true)} />
            </>
          )}
        </Glass>
      </ScrollView>

      <Sheet visible={asking} onClose={() => setAsking(false)} title={t.backupPassword}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Txt size={13} color={theme.muted}>
            {t.backupPasswordHint}
          </Txt>
          <Field value={password} onChangeText={setPw} placeholder={t.backupPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} icon="key" testID="backup-password-field" />
          <Field value={again} onChangeText={setAgain} placeholder={t.passwordAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} icon="key" testID="backup-password-again" />
          <Button title={t.save} onPress={savePassword} disabled={password.length < MIN_PASSWORD || password !== again} testID="backup-password-save" />
        </View>
      </Sheet>

      <Dialog
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={t.deleteBackup}
        text={t.deleteBackupSure}
        buttons={[
          { label: t.deleteBackup, danger: true, onPress: () => void remove() },
          { label: t.cancel, onPress: () => setDeleting(false) },
        ]}
      />
    </Screen>
  );
}
