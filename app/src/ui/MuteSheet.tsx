// MuteSheet.tsx: mute a chat (or the picked chats) for 8 hours, 1 week or
// Always, like WhatsApp. When the time is up the chat unmutes by itself
// (core.mute and unmuteDue).
import { View } from 'react-native';

import type { ChatPrefs } from '../core/core';
import { fill, useT, type Strings } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { whenLabel } from './format';
import { Txt } from './kit';
import { MenuItem, Sheet, whenOpened } from './overlays';

const HOUR = 3_600_000;

export const MuteSheet = whenOpened(function MuteSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (ms: number | null) => void }) {
  const t = useT();
  const { theme } = useLook();
  const pick = (ms: number | null) => (onClose(), onPick(ms));
  return (
    <Sheet visible={visible} onClose={onClose} title={t.muteNotifications}>
      <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>
        <Txt size={13.5} color={theme.muted}>
          {t.muteNote}
        </Txt>
      </View>
      <MenuItem icon="clock" label={t.mute8h} onPress={() => pick(8 * HOUR)} testID="mute-8h" />
      <MenuItem icon="calendar" label={t.mute1w} onPress={() => pick(7 * 24 * HOUR)} testID="mute-1w" />
      <MenuItem icon="muted" label={t.muteAlways} onPress={() => pick(null)} testID="mute-always" />
    </Sheet>
  );
});

/** "Muted until tomorrow at 9:00 am", or "Muted always" (empty when it isn't muted). */
export function mutedLine(p: ChatPrefs, t: Strings) {
  if (!p.muted) return '';
  return p.mutedUntil ? fill(t.mutedUntilWhen, { when: whenLabel(p.mutedUntil, t) }) : t.mutedAlways;
}
