// PollSheet.tsx: making a poll. A question, two to twelve answers, and whether
// people may pick more than one. New answer boxes slide in as you fill the last.
// (The chat gives it a new key each time it opens, so it always starts empty.)
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Button, Field, Toggle, Txt } from '../kit';
import { Sheet } from '../overlays';

const MAX = 12;

export function PollSheet({ visible, onClose, onSend }: { visible: boolean; onClose: () => void; onSend: (question: string, options: string[], multi: boolean) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);

  function setOption(i: number, text: string) {
    const next = options.map((o, j) => (j === i ? text : o));
    // Always one empty box at the end, until there are twelve.
    if (next.at(-1)!.trim() && next.length < MAX) next.push('');
    setOptions(next);
  }

  // The same answer typed twice counts once.
  const filled = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
  const ready = question.trim().length > 0 && filled.length >= 2;

  return (
    <Sheet visible={visible} onClose={onClose} title={t.newPoll}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, gap: 10 }} keyboardShouldPersistTaps="handled">
        <Field value={question} onChangeText={setQuestion} placeholder={t.pollQuestion} testID="poll-question" maxLength={255} />
        <Txt size={13} weight="700" color={theme.sectionText} style={{ marginTop: 6 }}>
          {t.pollOptions}
        </Txt>
        {options.map((o, i) => (
          <Animated.View key={i}>
            <Field value={o} onChangeText={(v) => setOption(i, v)} placeholder={`${t.pollOption} ${i + 1}`} testID={`poll-option-${i}`} maxLength={100} />
          </Animated.View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <View style={{ flex: 1 }}>
            <Txt size={15} weight="600">
              {t.pollMulti}
            </Txt>
          </View>
          <Toggle on={multi} onChange={setMulti} label={t.pollMulti} />
        </View>
        <Button title={t.send} disabled={!ready} onPress={() => onSend(question.trim(), filled, multi)} testID="poll-send" />
      </ScrollView>
    </Sheet>
  );
}
