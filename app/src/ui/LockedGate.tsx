// LockedGate.tsx: what a locked chat shows until your fingerprint or face
// opens it (Chat lock). Nothing of the chat is read until then, not even its name.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { lockWaitUntil, unlockChat } from '../core/lock';
import { useNow } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Button, Screen, TopBar, Txt } from './kit';

export function LockedGate({ chatId }: { chatId: string }) {
  const t = useT();
  const { theme } = useLook();
  const now = useNow(1_000);
  const [note, setNote] = useState<string | null>(null);
  const wait = Math.max(0, Math.ceil((lockWaitUntil() - now) / 1000));

  async function unlock(again = true) {
    const r = await unlockChat(chatId, t.unlockChat, t.cancel);
    // Android closed the prompt on its own: ask once more.
    if (r === 'interrupted' && again) return void setTimeout(() => void unlock(false), 400);
    if (r === 'failed') setNote(t.notRecognised);
    else if (r === 'unavailable') setNote(t.biometricsGone);
  }

  useEffect(() => {
    const ask = setTimeout(() => void unlock(), 300);
    return () => clearTimeout(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  return (
    <Screen>
      <TopBar title={t.lockedChat} onBack={() => router.back()} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 }} testID="chat-locked">
        <View>
          <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={38} color={theme.accInk} />
          </View>
        </View>
        <Txt size={19} weight="800" align="center">
          {t.chatIsLocked}
        </Txt>
        <Txt size={14} color={theme.muted} align="center">
          {t.chatIsLockedSub}
        </Txt>
        {!!note && (
          <Txt size={13.5} color={theme.danger} align="center">
            {note}
          </Txt>
        )}
        <Button
          title={wait ? fill(t.tryAgainIn, { n: wait }) : t.unlock}
          icon="fingerprint"
          disabled={wait > 0}
          onPress={() => void unlock()}
          style={{ alignSelf: 'stretch', marginTop: 8 }}
          testID="chat-unlock"
        />
      </View>
    </Screen>
  );
}
