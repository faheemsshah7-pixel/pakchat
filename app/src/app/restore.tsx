// restore.tsx: on a new phone, right after signing in, if there's a backup on the
// server: type its password to bring your chats here, or skip.
import { router } from 'expo-router';
import KV from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import { findBackup, restore, WrongPassword, type BackupInfo } from '../core/backup';
import { core, isOffline } from '../core/core';
import { useFileProgress } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Button, Field, Screen, Txt } from '../ui/kit';
import { clock, dayLabel, fileSize } from '../ui/format';
import { pop, rise } from '../ui/motion';
import { toast } from '../ui/overlays';

export default function Restore() {
  const t = useT();
  const { theme } = useLook();
  const [b, setB] = useState<BackupInfo | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
        <Animated.View entering={pop()} style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: 32, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="archive" size={44} color={theme.accInk} />
        </Animated.View>
        <Animated.View entering={rise(80)} style={{ gap: 6 }}>
          <Txt size={26} weight="800" align="center">
            {t.restoreTitle}
          </Txt>
          {!!b && (
            <Txt size={15} color={theme.muted} align="center">
              {fill(t.restoreNote, { when: `${dayLabel(b.madeAt, t)}, ${clock(b.madeAt)}`, size: fileSize(b.size) })}
            </Txt>
          )}
        </Animated.View>
        <Animated.View entering={rise(140)} style={{ gap: 12 }}>
          <Field value={password} onChangeText={setPassword} placeholder={t.backupPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} icon="key" testID="restore-password" />
          {!!error && (
            <Animated.View entering={FadeIn}>
              <Txt size={14} color={theme.danger} align="center" testID="restore-error">
                {error}
              </Txt>
            </Animated.View>
          )}
          <Button
            title={busy ? (progress !== undefined ? `${t.restoring} ${Math.round(progress * 100)}%` : t.restoring) : t.restore}
            onPress={go}
            busy={busy}
            disabled={!b || !password}
            testID="restore-go"
          />
          <Button title={t.skipRestore} look="soft" onPress={done} disabled={busy} testID="restore-skip" />
        </Animated.View>
        <View />
      </Animated.View>
    </Screen>
  );
}
