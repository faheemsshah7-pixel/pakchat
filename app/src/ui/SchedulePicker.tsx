// SchedulePicker.tsx: picking a day and time ahead, for scheduled messages and
// scheduled calls. Quick picks first (in an hour, tonight, tomorrow morning),
// then any day in the next month and any time, to the minute.
import { useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';

import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { dayChip, whenLabel } from './format';
import { Button, Chip, Txt } from './kit';
import { tick } from './motion';
import { Sheet, toast } from './overlays';

const ROW = 44;
const DAY = 86_400_000;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The next whole minute, at least `ahead` from `now`. */
function rounded(now: number, ahead: number) {
  return Math.ceil((now + ahead) / 60_000) * 60_000;
}

export function SchedulePicker({
  visible,
  title,
  initial,
  button,
  soonest = 60_000,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  initial?: number;
  /** The button's words ("Schedule"). */
  button: string;
  soonest?: number;
  onClose: () => void;
  onPick: (at: number) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {visible && <Picker initial={initial} button={button} soonest={soonest} onPick={onPick} />}
    </Sheet>
  );
}

function Picker({ initial, button, soonest, onPick }: { initial?: number; button: string; soonest: number; onPick: (at: number) => void }) {
  const t = useT();
  const { theme } = useLook();
  // The clock when the picker opened: the quick picks and days count from it.
  const [now] = useState(Date.now);
  const start = initial && initial > now + soonest ? initial : rounded(now, 60 * 60_000);
  const [day, setDay] = useState(startOfDay(start));
  const [hour, setHour] = useState(new Date(start).getHours());
  const [minute, setMinute] = useState(new Date(start).getMinutes());
  const days = useMemo(() => Array.from({ length: 31 }, (_, i) => startOfDay(startOfDay(now) + i * DAY + 3_600_000)), [now]);
  const hours = useRef<FlatList<number>>(null);
  const minutes = useRef<FlatList<number>>(null);

  const at = (() => {
    const d = new Date(day);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  })();

  function quick(ms: number) {
    tick();
    setDay(startOfDay(ms));
    const d = new Date(ms);
    setHour(d.getHours());
    setMinute(d.getMinutes());
    hours.current?.scrollToOffset({ offset: d.getHours() * ROW, animated: true });
    minutes.current?.scrollToOffset({ offset: d.getMinutes() * ROW, animated: true });
  }

  const tonight = (() => {
    const d = new Date(now);
    d.setHours(21, 0, 0, 0);
    return d.getTime();
  })();
  const morning = (() => {
    const d = new Date(now + DAY);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  })();
  const picks = [
    { label: t.inOneHour, at: rounded(now, 60 * 60_000) },
    ...(tonight > now + 30 * 60_000 ? [{ label: t.tonightWord, at: tonight }] : []),
    { label: t.tomorrowMorning, at: morning },
  ];

  const wheel = (ref: React.RefObject<FlatList<number> | null>, data: number[], value: number, set: (v: number) => void, label: (v: number) => string, id: string) => (
    <View style={{ width: 86, height: ROW * 3 }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: ROW, height: ROW, start: 0, end: 0, borderRadius: 12, backgroundColor: theme.accSoft }} />
      <FlatList
        ref={ref}
        data={data}
        keyExtractor={(v) => String(v)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: ROW }}
        getItemLayout={(_, i) => ({ length: ROW, offset: ROW * i, index: i })}
        initialScrollIndex={Math.max(0, data.indexOf(value))}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / ROW);
          const v = data[Math.max(0, Math.min(data.length - 1, i))];
          if (v !== value) tick();
          set(v);
        }}
        renderItem={({ item }) => (
          <View style={{ height: ROW, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={item === value ? 19 : 16} weight={item === value ? '700' : '500'} color={item === value ? theme.accInk : theme.muted} style={{ fontVariant: ['tabular-nums'] }}>
              {label(item)}
            </Txt>
          </View>
        )}
        testID={id}
      />
    </View>
  );

  return (
    <View style={{ paddingHorizontal: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {picks.map((x) => (
          <Chip key={x.label} label={x.label} on={false} onPress={() => quick(x.at)} />
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d) => (
          <Chip key={d} label={dayChip(d, t)} on={d === day} onPress={() => (tick(), setDay(d))} testID={`day-${days.indexOf(d)}`} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, direction: 'ltr' }}>
        {wheel(hours, HOURS, hour, setHour, (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`, 'pick-hour')}
        <Txt size={20} weight="700">
          :
        </Txt>
        {wheel(minutes, MINUTES, minute, setMinute, (m) => String(m).padStart(2, '0'), 'pick-minute')}
      </View>
      <Txt size={14} color={theme.muted} align="center" testID="pick-when">
        {whenLabel(at, t)}
      </Txt>
      <Button
        title={button}
        icon="schedule"
        onPress={() => {
          if (at < Date.now() + soonest) return toast(t.tooSoon);
          onPick(at);
        }}
        testID="pick-time"
      />
    </View>
  );
}
