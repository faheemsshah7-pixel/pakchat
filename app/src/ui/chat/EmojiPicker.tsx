// EmojiPicker.tsx: the "+" at the end of the reactions bar: any emoji to react
// with, by group, like WhatsApp. One not in the list can be typed from the
// phone's own emoji keyboard in the box at the top.
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { emojiOnly } from '../../core/richText';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../icons';
import { Pressy, Txt } from '../kit';
import { tick } from '../motion';
import { Sheet, whenOpened } from '../overlays';
import { EMOJI_GROUPS } from './emojiList';

const ICONS = { smileys: '😀', people: '👋', nature: '🌸', food: '🍕', activity: '⚽', travel: '🚗', objects: '💡', symbols: '❤️' } as const;

export const EmojiPicker = whenOpened(function EmojiPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (emoji: string) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [group, setGroup] = useState(0);
  const [typed, setTyped] = useState('');

  const pick = (e: string) => {
    setTyped('');
    onPick(e);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t.pickReaction}>
      <View style={{ paddingHorizontal: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 14, backgroundColor: theme.glass }}>
          <Icon name="emoji" size={19} color={theme.muted} />
          <TextInput
            value={typed}
            onChangeText={(v) => {
              // One emoji from the phone's keyboard: that's the reaction.
              if (emojiOnly(v) === 1) pick(v.trim());
              else setTyped(v);
            }}
            placeholder={t.typeAnyEmoji}
            placeholderTextColor={theme.muted}
            style={{ flex: 1, color: theme.text, fontSize: 15 }}
            testID="emoji-type"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          {EMOJI_GROUPS.map((g, i) => (
            <Pressy key={g.key} onPress={() => (tick(), setGroup(i))} label={g.key} scale={0.9} testID={`emoji-group-${g.key}`}>
              <View style={{ width: 42, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: i === group ? theme.accSoft : 'transparent' }}>
                <Txt size={20}>{ICONS[g.key]}</Txt>
              </View>
            </Pressy>
          ))}
        </ScrollView>
        <ScrollView style={{ height: 300 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingBottom: 8 }} keyboardShouldPersistTaps="always">
          {EMOJI_GROUPS[group].list.map((e) => (
            <Pressy key={e} onPress={() => pick(e)} label={e} scale={0.85} testID={`emoji-${e}`}>
              <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={26} align="center">
                  {e}
                </Txt>
              </View>
            </Pressy>
          ))}
        </ScrollView>
      </View>
    </Sheet>
  );
});
