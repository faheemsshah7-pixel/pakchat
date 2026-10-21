// profile.tsx: once, after signing in for the first time: "What should people call you?"
// Google's name is filled in already; change it if you like.
import KV from 'expo-sqlite/kv-store';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

import { core } from '../core/core';
import { useAuth } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Avatar, Button, Field, Screen, Txt } from '../ui/kit';
import { toast } from '../ui/overlays';

export default function Profile() {
  const t = useT();
  const { theme } = useLook();
  const { me, myId } = useAuth();
  const [name, setName] = useState(me?.name ?? '');
  const [busy, setBusy] = useState(false);

  async function done() {
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== me?.name) await core.updateMe({ name: name.trim() });
      KV.setItemSync(`welcomed:${myId}`, '1');
      router.back();
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={{ alignItems: 'center' }}>
          <Avatar id={myId} name={name} size={110} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).springify().damping(20)}>
          <Txt size={28} weight="800" align="center">
            {t.welcome}
          </Txt>
          <Txt size={15} color={theme.muted} align="center" style={{ marginTop: 6 }}>
            {t.nameLabel}
          </Txt>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(140).springify().damping(20)} style={{ gap: 12 }}>
          <Field value={name} onChangeText={setName} placeholder={t.yourName} maxLength={25} autoCapitalize="words" testID="profile-name" />
          <Button title={t.continue} onPress={done} busy={busy} disabled={!name.trim()} testID="profile-continue" />
        </Animated.View>
      </View>
    </Screen>
  );
}
