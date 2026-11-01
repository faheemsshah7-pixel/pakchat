// settings/delete-account.tsx: Settings › Account › Delete my account, like WhatsApp's (Phase 11;
// Google Play asks for it). What deleting does, then type your number (or, with no number, your
// Gmail) and confirm once more. The server checks the number is yours before it deletes anything.
// Afterwards the phone forgets the chats too and goes back to the welcome screen.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import { core, isOffline, reasonOf } from '../../core/core';
import { useAuth } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Field, Glass, Screen, TopBar, Txt } from '../../ui/kit';
import { Dialog, toast } from '../../ui/overlays';

export default function DeleteAccount() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const [typed, setTyped] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keyboard = useAnimatedKeyboard();
  const keyboardSpace = useAnimatedStyle(() => ({ height: keyboard.height.value }));

  // Like WhatsApp, the number confirms it; an account signed in only with Gmail types its Gmail.
  const byPhone = !!me?.phone || !me?.email;

  async function deleteIt() {
    setAsking(false);
    setBusy(true);
    setError('');
    try {
      await core.deleteAccount(typed.trim());
      toast(t.deleteDone);
      // Signed out now: the app shows the welcome screen by itself.
    } catch (err) {
      setError(reasonOf(err) === 'wrong_confirm' ? (byPhone ? t.deleteWrongPhone : t.deleteWrongEmail) : isOffline(err) ? t.serverError : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  const will = [t.deleteWill1, t.deleteWill2, t.deleteWill3, t.deleteWill4];

  return (
    <Screen>
      <TopBar title={t.deleteAccount} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <Glass style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="warning" size={22} color={theme.danger} />
            <Txt size={16} weight="700" color={theme.danger} style={{ flex: 1 }}>
              {t.deleteWillTitle}
            </Txt>
          </View>
          {will.map((line) => (
            <View key={line} style={{ flexDirection: 'row', gap: 10, paddingLeft: 4 }}>
              <Txt size={14} color={theme.sectionText}>
                •
              </Txt>
              <Txt size={14} color={theme.sectionText} style={{ flex: 1 }}>
                {line}
              </Txt>
            </View>
          ))}
        </Glass>

        <Glass style={{ padding: 16, flexDirection: 'row', gap: 12 }}>
          <Icon name="info" size={20} color={theme.accInk} />
          <Txt size={13.5} color={theme.muted} style={{ flex: 1 }}>
            {t.deleteInsteadText}
          </Txt>
        </Glass>

        <Txt size={14} weight="600" style={{ paddingHorizontal: 6, marginTop: 4 }}>
          {byPhone ? t.deleteConfirmPhone : t.deleteConfirmEmail}
        </Txt>
        <Field
          value={typed}
          onChangeText={(v) => (setTyped(v), setError(''))}
          placeholder={byPhone ? '0300 1234567' : 'name@gmail.com'}
          keyboardType={byPhone ? 'phone-pad' : 'email-address'}
          autoCapitalize="none"
          autoCorrect={false}
          icon={byPhone ? 'calls' : 'globe'}
          testID="delete-confirm-field"
        />
        {!!error && (
          <Txt size={14} color={theme.danger} align="center" testID="delete-error">
            {error}
          </Txt>
        )}
        <Button title={busy ? t.deletingWord : t.deleteAccount} look="danger" icon="trash" onPress={() => setAsking(true)} busy={busy} disabled={!typed.trim() || busy} testID="delete-account" />
        <Animated.View style={keyboardSpace} />
      </ScrollView>

      <Dialog
        visible={asking}
        onClose={() => setAsking(false)}
        title={t.deleteAccountTitle}
        text={t.deleteSure}
        buttons={[
          { label: t.deleteAccount, danger: true, onPress: () => void deleteIt(), testID: 'confirm-delete-account' },
          { label: t.cancel, onPress: () => setAsking(false) },
        ]}
      />
    </Screen>
  );
}
