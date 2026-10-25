// ScheduledBar.tsx: "1 scheduled message" above the message bar, like
// Instagram. Tap it to see them: change the words or the time, send now, or
// delete (scheduled.ts).
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { useScheduled } from '../../core/hooks';
import { changePlan, dropPlan, sendPlanNow, SOONEST_MS, type Planned } from '../../core/scheduled';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { whenLabel } from '../format';
import { Icon } from '../icons';
import { Button, fontStyle, Glass, IconButton, Pressy, Txt } from '../kit';
import { rise } from '../motion';
import { Sheet, toast } from '../overlays';
import { SchedulePicker } from '../SchedulePicker';

export function ScheduledBar({ chatId }: { chatId: string }) {
  const t = useT();
  const { theme } = useLook();
  const list = useScheduled(chatId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Planned | null>(null);
  const [timing, setTiming] = useState<Planned | null>(null);
  if (!list.length && !open) return null;

  const act = (work: () => Promise<unknown>, done?: string) =>
    void work()
      .then(() => done && toast(done))
      .catch(() => toast(t.couldNot));

  return (
    <>
      {list.length > 0 && (
        <Animated.View entering={rise()} exiting={FadeOut.duration(120)}>
          <Pressy onPress={() => setOpen(true)} label={fill(list.length === 1 ? t.scheduledOne : t.scheduledMany, { n: list.length })} scale={0.98} testID="scheduled-bar">
            <Glass style={{ marginHorizontal: 14, marginTop: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="schedule" size={17} color={theme.accInk} />
              <Txt size={13.5} weight="700" color={theme.accInk} style={{ flex: 1 }}>
                {fill(list.length === 1 ? t.scheduledOne : t.scheduledMany, { n: list.length })}
              </Txt>
              <Txt size={12.5} color={theme.muted}>
                {whenLabel(list[0].at, t)}
              </Txt>
            </Glass>
          </Pressy>
        </Animated.View>
      )}

      <Sheet visible={open && !editing && !timing} onClose={() => setOpen(false)} title={t.scheduledTitle}>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {list.length === 0 && (
            <Txt size={14} color={theme.muted} align="center">
              {t.nothingScheduled}
            </Txt>
          )}
          {list.map((p) => (
            <View key={p.id} style={{ padding: 12, borderRadius: 18, backgroundColor: theme.glass, gap: 8 }} testID="scheduled-item">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="schedule" size={15} color={theme.accInk} />
                <Txt size={12.5} weight="700" color={theme.accInk}>
                  {whenLabel(p.at, t)}
                </Txt>
              </View>
              <Txt size={15} lines={4}>
                {p.text}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'flex-end' }}>
                <IconButton icon="edit" label={t.edit} size={38} iconSize={18} onPress={() => setEditing(p)} testID="scheduled-edit" />
                <IconButton icon="clock" label={t.changeTime} size={38} iconSize={18} onPress={() => setTiming(p)} testID="scheduled-time" />
                <IconButton icon="send" label={t.sendNow} size={38} iconSize={18} flip onPress={() => act(() => sendPlanNow(p.id), t.sentWord)} testID="scheduled-send-now" />
                <IconButton icon="trash" label={t.delete} size={38} iconSize={18} color="#E5484D" onPress={() => act(() => dropPlan(p.id))} testID="scheduled-delete" />
              </View>
            </View>
          ))}
        </ScrollView>
      </Sheet>

      <EditWords
        plan={editing}
        onClose={() => setEditing(null)}
        onSave={(text) => {
          const p = editing!;
          setEditing(null);
          act(() => changePlan(p.id, { text }));
        }}
      />

      <SchedulePicker
        visible={!!timing}
        title={t.changeTime}
        initial={timing?.at}
        button={t.save}
        soonest={SOONEST_MS}
        onClose={() => setTiming(null)}
        onPick={(at) => {
          const p = timing!;
          setTiming(null);
          act(() => changePlan(p.id, { at }), fill(t.scheduledFor, { when: whenLabel(at, t) }));
        }}
      />
    </>
  );
}

function EditWords({ plan, onClose, onSave }: { plan: Planned | null; onClose: () => void; onSave: (text: string) => void }) {
  const t = useT();
  const { theme, lang } = useLook();
  const [text, setText] = useState('');
  const [for_, setFor] = useState<string | null>(null);
  if (plan && for_ !== plan.id) {
    setFor(plan.id);
    setText(plan.text);
  }
  return (
    <Sheet visible={!!plan} onClose={onClose} title={t.edit}>
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          maxLength={4000}
          selectionColor={theme.acc}
          style={[fontStyle(text || null, lang, 16, '400'), { color: theme.text, minHeight: 90, maxHeight: 220, padding: 12, borderRadius: 16, backgroundColor: theme.glass, textAlignVertical: 'top' }]}
          testID="scheduled-words"
        />
        <Button title={t.save} onPress={() => text.trim() && onSave(text.trim())} disabled={!text.trim()} testID="scheduled-save" />
      </View>
    </Sheet>
  );
}
