// ScheduleCallSheet.tsx: schedule a call, like WhatsApp's. Give it a name,
// pick when and voice or video, and it goes into the chat as an event message
// with a Join button. Everyone in the chat is reminded when it starts
// (core/plans.ts). From the Calls tab you first pick which chat it's for.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core, isOffline } from '../core/core';
import { useChatList } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { whenLabel } from './format';
import { Icon } from './icons';
import { Avatar, Button, Chip, Field, Glass, Pressy, SettingRow, Txt } from './kit';
import { Sheet, toast, whenOpened } from './overlays';
import { SchedulePicker } from './SchedulePicker';

export const ScheduleCallSheet = whenOpened(function ScheduleCallSheet({ visible, chatId, onClose }: { visible: boolean; chatId?: string; onClose: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const rows = (useChatList() ?? []).filter((r) => !r.chat.left && (r.chat.kind === 'group' || r.chat.kind === 'direct') && !r.chat.announcements);
  const [to, setTo] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [video, setVideo] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const target = chatId ?? to;

  function reset() {
    setTo(null);
    setTitle('');
    setAt(null);
    setVideo(false);
    setBusy(false);
  }

  async function send() {
    if (!target || !at) return;
    setBusy(true);
    try {
      await core.client.sendPlan(target, { title: title.trim() || t.scheduledCallWord, at, video });
      toast(t.callScheduled);
      reset();
      onClose();
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet visible={visible && !picking} onClose={onClose} title={t.scheduleCall}>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {!chatId && (
            <>
              <Txt size={13} weight="700" color={theme.sectionText}>
                {t.callFor}
              </Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {rows.slice(0, 30).map((r) => {
                  const on = to === r.chat.id;
                  return (
                    <Pressy key={r.chat.id} onPress={() => setTo(r.chat.id)} label={r.title} scale={0.92} testID={`plan-to-${r.title}`}>
                      <View style={{ width: 64, alignItems: 'center', gap: 4, opacity: to && !on ? 0.55 : 1 }}>
                        <View>
                          <Avatar id={r.other ?? r.chat.id} name={r.chat.kind === 'group' ? '' : r.title} size={50} group={r.chat.kind === 'group'} />
                          {on && (
                            <View
                              style={{ position: 'absolute', end: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Icon name="check" size={11} color="#FFFFFF" stroke={3} />
                            </View>
                          )}
                        </View>
                        <Txt size={11.5} lines={1} align="center">
                          {r.title}
                        </Txt>
                      </View>
                    </Pressy>
                  );
                })}
              </ScrollView>
            </>
          )}
          <Field value={title} onChangeText={setTitle} placeholder={t.callName} maxLength={80} testID="plan-title" />
          <Glass>
            <SettingRow icon="calendar" title={t.whenWord} sub={at ? whenLabel(at, t) : t.pickTime} onPress={() => setPicking(true)} testID="plan-when" />
          </Glass>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label={t.voiceCall} on={!video} onPress={() => setVideo(false)} testID="plan-voice" />
            <Chip label={t.videoCall} on={video} onPress={() => setVideo(true)} testID="plan-video" />
          </View>
          <Button title={t.scheduleCall} icon="calendar" busy={busy} disabled={!target || !at} onPress={() => void send()} testID="plan-send" />
        </View>
      </Sheet>
      <SchedulePicker
        visible={visible && picking}
        title={t.whenWord}
        initial={at ?? undefined}
        button={t.done}
        soonest={60_000}
        onClose={() => setPicking(false)}
        onPick={(when) => {
          setAt(when);
          setPicking(false);
        }}
      />
    </>
  );
});
