// restore.tsx: on a new phone, right after signing in, if there's a backup on the
// server: type its password to bring your chats here, or skip (it asks first: skipping
// can't be undone, and the next backup replaces this one).
import { router } from 'expo-router';
import KV from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import { findBackup, restore, WrongPassword, type BackupInfo } from '../core/backup';
import { core, isOffline } from '../core/core';
import { useFileProgress } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Button, Field, Screen, Txt } from '../ui/kit';
import { clock, dayLabel, fileSize } from '../ui/format';
import { Dialog, toast } from '../ui/overlays';

export default function Restore() {
  const t = useT();
  const { theme } = useLook();
  const [b, setB] = useState<BackupInfo | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Skipping can't be undone (and the next backup replaces this one), so it asks first, like WhatsApp.
  const [skipping, setSkipping] = useState(false);
  const progress = useFileProgress('restore');
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: 24 + keyboard.height.value }));

  useEffect(() => {
    void findBackup()
      .then((found) => (found ? setB(found) : done()))
      .catch(() => done());
  }, []);

  function done() {
    KV.removeItemSync(`offerRestore:${core.myId}`);
    if (router.canGoBack()) router.back();
  }

  async function go() {
    if (!b) return;
    setBusy(true);
    setError('');
    try {
      await restore(b, password);
      toast(t.restored);
      done();
    } catch (err) {
      setError(err instanceof WrongPassword ? t.wrongPassword : isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Animated.View style={[{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }, lift]}>
        <Animated.View style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: 32, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="archive" size={44} color={theme.accInk} />
        </Animated.View>
        <Animated.View style={{ gap: 6 }}>
          <Txt size={26} weight="800" align="center">
            {t.restoreTitle}
          </Txt>
          {!!b && (
            <Txt size={15} color={theme.muted} align="center">
              {fill(t.restoreNote, { when: `${dayLabel(b.madeAt, t)}, ${clock(b.madeAt)}`, size: fileSize(b.size) })}
            </Txt>
          )}
        </Animated.View>
        <Animated.View style={{ gap: 12 }}>
          <Field value={password} onChangeText={setPassword} placeholder={t.backupPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} icon="key" testID="restore-password" />
          {!!error && (
            <View>
              <Txt size={14} color={theme.danger} align="center" testID="restore-error">
                {error}
              </Txt>
            </View>
          )}
          <Button
            title={busy ? (progress !== undefined ? `${t.restoring} ${Math.round(progress * 100)}%` : t.restoring) : t.restore}
            onPress={go}
            busy={busy}
            disabled={!b || !password}
            testID="restore-go"
          />
          <Button title={t.skipRestore} look="soft" onPress={() => setSkipping(true)} disabled={busy} testID="restore-skip" />
        </Animated.View>
        <View />
      </Animated.View>
      <Dialog
        visible={skipping}
        onClose={() => setSkipping(false)}
        title={t.skipRestoreTitle}
        text={t.skipRestoreText}
        buttons={[
          { label: t.skipRestoring, danger: true, onPress: () => (setSkipping(false), done()), testID: 'restore-skip-yes' },
          { label: t.cancel, onPress: () => setSkipping(false) },
        ]}
      />
    </Screen>
  );
}
