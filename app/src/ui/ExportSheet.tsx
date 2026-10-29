// ExportSheet.tsx: Export chat, from a chat's ⋮ menu or its info: with or
// without its media (core/exportChat.ts makes the file, then the share sheet).
import { useState } from 'react';
import { View } from 'react-native';

import { exportChat } from '../core/exportChat';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Button, Txt } from './kit';
import { Sheet, toast, whenOpened } from './overlays';

export const ExportSheet = whenOpened(function ExportSheet({ visible, chatId, onClose }: { visible: boolean; chatId: string; onClose: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const [busy, setBusy] = useState<'with' | 'without' | null>(null);

  async function go(withMedia: boolean) {
    setBusy(withMedia ? 'with' : 'without');
    try {
      await exportChat(chatId, withMedia, t);
      onClose();
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={t.exportChat}>
      <View style={{ paddingHorizontal: 18, gap: 12 }}>
        <Txt size={13.5} color={theme.muted}>
          {t.exportNote}
        </Txt>
        <Button title={t.includeMedia} icon="photo" busy={busy === 'with'} disabled={!!busy} onPress={() => void go(true)} testID="export-with" />
        <Button title={t.withoutMedia} look="soft" icon="doc" busy={busy === 'without'} disabled={!!busy} onPress={() => void go(false)} testID="export-without" />
      </View>
    </Sheet>
  );
});
