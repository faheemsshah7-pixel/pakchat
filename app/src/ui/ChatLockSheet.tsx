// ChatLockSheet.tsx: Chat lock for one chat (from its info): off, in the
// Locked chats folder (WhatsApp's way), or kept in the list with a lock (ours).
// Changing it asks for your fingerprint or face first.
import { router } from 'expo-router';
import { View } from 'react-native';

import { core } from '../core/core';
import { useChatPrefs } from '../core/hooks';
import { authenticate, canUseBiometrics, openWith } from '../core/lock';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon, type IconName } from './icons';
import { Divider, Pressy, Txt } from './kit';
import { Sheet, toast } from './overlays';

type Way = 'off' | 'folder' | 'list';

export function ChatLockSheet({ visible, chatId, onClose }: { visible: boolean; chatId: string; onClose: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const prefs = useChatPrefs(chatId);
  const now: Way = prefs.lock ?? 'off';
  const ways: { way: Way; icon: IconName; title: string; sub: string }[] = [
    { way: 'off', icon: 'eye', title: t.chatLockOff, sub: t.chatLockOffSub },
    { way: 'folder', icon: 'archive', title: t.chatLockFolder, sub: t.chatLockFolderSub },
    { way: 'list', icon: 'lock', title: t.chatLockList, sub: t.chatLockListSub },
  ];

  async function pick(way: Way) {
    if (way === now) return onClose();
    if (!(await canUseBiometrics())) return toast(t.noBiometrics);
    const r = await authenticate(t.confirmFingerprint, t.cancel);
    if (r === 'failed') return toast(t.notRecognised);
    if (r === 'wait') return toast(t.waitABit);
    if (r !== 'ok') return;
    core.setPrefs(chatId, { lock: way === 'off' ? undefined : way });
    // Just unlocked it with a fingerprint: it stays open while you're here.
    openWith(chatId);
    onClose();
    if (way === 'folder') {
      toast(t.movedToLocked);
      // Out of the chat list now: back there, like WhatsApp.
      router.dismissTo('/');
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={t.chatLock}>
      <View style={{ paddingHorizontal: 12 }}>
        {ways.map((w, i) => {
          const on = w.way === now;
          return (
            <View key={w.way}>
              {i > 0 && <Divider />}
              <Pressy onPress={() => void pick(w.way)} label={w.title} scale={0.98} testID={`chat-lock-${w.way}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12 }}>
                  <Icon name={w.icon} size={21} color={on ? theme.accInk : theme.muted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={15.5} weight={on ? '700' : '600'}>
                      {w.title}
                    </Txt>
                    <Txt size={12.5} color={theme.muted}>
                      {w.sub}
                    </Txt>
                  </View>
                  {on && <Icon name="check" size={18} color={theme.accInk} stroke={2.6} />}
                </View>
              </Pressy>
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}
