// EventSheet.tsx: 📎 › Event, like WhatsApp's. A name, a description, when it
// starts (and, if you like, ends), where, and whether it has a voice or video
// call. It goes into the chat as an event message people answer Going or Not
// going on, and everyone is reminded when it starts (core/plans.ts).
// (The chat gives it a new key each time it opens, so it always starts empty.)
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { whenLabel } from '../format';
import { Button, Chip, Field, Glass, SettingRow, Txt } from '../kit';
import { Sheet } from '../overlays';
import { SchedulePicker } from '../SchedulePicker';

export type NewEvent = { title: string; about?: string; at: number; end?: number; place?: string; call?: 'voice' | 'video' };

export function EventSheet({ visible, onClose, onSend }: { visible: boolean; onClose: () => void; onSend: (e: NewEvent) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [place, setPlace] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [call, setCall] = useState<'none' | 'voice' | 'video'>('none');
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const ready = title.trim().length > 0 && at != null;

  function send() {
    if (!ready || at == null) return;
    onSend({
      title: title.trim(),
      at,
      ...(about.trim() ? { about: about.trim() } : {}),
      ...(end != null && end > at ? { end } : {}),
      ...(place.trim() ? { place: place.trim() } : {}),
      ...(call !== 'none' ? { call } : {}),
    });
  }

  return (
    <>
      <Sheet visible={visible && !picking} onClose={onClose} title={t.newEvent}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, gap: 10 }} keyboardShouldPersistTaps="handled">
          <Field value={title} onChangeText={setTitle} placeholder={t.eventName} maxLength={200} testID="event-title" />
          <Field value={about} onChangeText={setAbout} placeholder={t.eventAbout} maxLength={1000} testID="event-about" />
          <Glass>
            <SettingRow icon="calendar" title={t.startsWord} sub={at ? whenLabel(at, t) : t.pickTime} onPress={() => setPicking('start')} testID="event-start" />
            <SettingRow icon="clock" title={t.endsWord} sub={end && at && end > at ? whenLabel(end, t) : t.optionalWord} onPress={() => setPicking('end')} testID="event-end" />
          </Glass>
          <Field value={place} onChangeText={setPlace} placeholder={t.eventPlace} icon="place" maxLength={300} testID="event-place" />
          <Txt size={13} weight="700" color={theme.sectionText} style={{ marginTop: 4 }}>
            {t.callWord}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label={t.noCall} on={call === 'none'} onPress={() => setCall('none')} testID="event-no-call" />
            <Chip label={t.voiceCall} on={call === 'voice'} onPress={() => setCall('voice')} testID="event-voice" />
            <Chip label={t.videoCall} on={call === 'video'} onPress={() => setCall('video')} testID="event-video" />
          </View>
          <Button title={t.send} icon="send" disabled={!ready} onPress={send} testID="event-send" />
        </ScrollView>
      </Sheet>
      <SchedulePicker
        visible={visible && !!picking}
        title={picking === 'end' ? t.endsWord : t.startsWord}
        initial={(picking === 'end' ? (end ?? (at ? at + 3_600_000 : undefined)) : at) ?? undefined}
        button={t.done}
        soonest={60_000}
        onClose={() => setPicking(null)}
        onPick={(when) => {
          if (picking === 'end') setEnd(when);
          else {
            setAt(when);
            // An end before the new start is no end.
            if (end != null && end <= when) setEnd(null);
          }
          setPicking(null);
        }}
      />
    </>
  );
}
