// TonePicker.tsx: pick an alert tone. Each one plays as you tap it. For a chat,
// "Default" follows the tone for all chats (Settings › Notifications).
import { View } from 'react-native';

import { previewTone, toneName, TONES } from '../core/tones';
import { useT, type Strings } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Divider, Pressy, Txt } from './kit';
import { Sheet } from './overlays';

export { toneName } from '../core/tones';

/** A tone's name ('' is the phone's own sound; undefined, for a chat, follows the default). */
export function TonePicker({
  visible,
  value,
  forChat,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: string | undefined;
  forChat: boolean;
  onPick: (tone: string | undefined) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { theme } = useLook();
  const options: (string | undefined)[] = [...(forChat ? [undefined] : []), '', ...TONES, 'silent'];
  return (
    <Sheet visible={visible} onClose={onClose} title={t.notificationTone}>
      <View style={{ paddingHorizontal: 12 }}>
        {options.map((o, i) => {
          const on = o === value;
          return (
            <View key={o ?? 'default'}>
              {i > 0 && <Divider />}
              <Pressy
                onPress={() => {
                  if (o) previewTone(o);
                  onPick(o);
                }}
                label={toneName(o, t)}
                scale={0.98}
                testID={`tone-${o ?? 'default'}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12 }}>
                  <Icon name={o === 'silent' ? 'muted' : 'tone'} size={20} color={on ? theme.accInk : theme.muted} />
                  <Txt size={15.5} weight={on ? '700' : '500'} style={{ flex: 1 }}>
                    {toneName(o, t)}
                  </Txt>
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
