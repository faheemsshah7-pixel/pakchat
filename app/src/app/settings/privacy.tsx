// settings/privacy.tsx: who sees your last seen and online, blue ticks, and blocked people.
// These are kept on the server (it's the one that hands out "last seen").
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../../core/core';
import { defaultTimer, setDefaultTimer } from '../../core/timer';
import { useAuth, useBlocked } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Divider, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { TIMERS, timerLabel } from '../../ui/format';
import { tick } from '../../ui/motion';
import { Sheet, toast } from '../../ui/overlays';

type Choice = { value: string; label: string };

export default function Privacy() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const blocked = useBlocked();
  const [open, setOpen] = useState<'last_seen' | 'online' | 'photo' | 'timer' | null>(null);
  const [timer, setTimer] = useState(defaultTimer);
  const p = me?.privacy ?? { lastSeen: 'everyone', online: 'everyone', readReceipts: true, photo: 'everyone' };

  const lastSeenChoices: Choice[] = [
    { value: 'everyone', label: t.everyone },
    { value: 'contacts', label: t.myContacts },
    { value: 'nobody', label: t.nobody },
  ];
  const onlineChoices: Choice[] = [
    { value: 'everyone', label: t.everyone },
    { value: 'same', label: t.sameAsLastSeen },
  ];
  const labelOf = (list: Choice[], v: string) => list.find((c) => c.value === v)?.label ?? v;

  async function change(privacy: { last_seen?: string; online?: string; photo?: string; read_receipts?: boolean }) {
    try {
      await core.updateMe({ privacy });
    } catch {
      toast(t.couldNot);
    }
  }

  const timerChoices: Choice[] = TIMERS.map((s) => ({ value: String(s), label: timerLabel(s, t) }));
  const choices = open === 'online' ? onlineChoices : open === 'timer' ? timerChoices : lastSeenChoices;
  const current = open === 'online' ? p.online : open === 'timer' ? String(timer) : open === 'photo' ? p.photo : p.lastSeen;

  return (
    <Screen>
      <TopBar title={t.privacy} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Glass style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
          <Icon name="lock" size={22} color={theme.accInk} />
          <View style={{ flex: 1 }}>
            <Txt size={14} color={theme.sectionText}>
              {t.privacyLocked}
            </Txt>
          </View>
        </Glass>
        <Section title={t.whoCanSee} />
        <Glass>
          <SettingRow icon="clock" title={t.lastSeenOnline} sub={labelOf(lastSeenChoices, p.lastSeen)} onPress={() => setOpen('last_seen')} testID="privacy-last-seen" />
          <Divider />
          <SettingRow icon="you" title={t.online2} sub={labelOf(onlineChoices, p.online)} onPress={() => setOpen('online')} testID="privacy-online" />
          <Divider />
          <SettingRow icon="photo" title={t.profilePhoto} sub={labelOf(lastSeenChoices, p.photo)} onPress={() => setOpen('photo')} testID="privacy-photo" />
          <Divider />
          <SettingRow
            icon="ticks"
            title={t.readReceipts}
            sub={t.readReceiptsSub}
            right={<Toggle on={p.readReceipts} onChange={(on) => void change({ read_receipts: on })} label={t.readReceipts} testID="read-receipts" />}
          />
        </Glass>
        <Section title={t.disappearing} />
        <Glass>
          <SettingRow icon="timer" title={t.defaultTimer} sub={timerLabel(timer, t)} onPress={() => setOpen('timer')} testID="privacy-default-timer" />
        </Glass>
        <Txt size={13} color={theme.muted} style={{ marginHorizontal: 14, marginTop: 8 }}>
          {t.defaultTimerNote}
        </Txt>
        <Section title={t.safety} />
        <Glass>
          <SettingRow icon="flag" title={t.blocked} sub={blocked ? String(blocked.length) : ''} onPress={() => router.push('/settings/blocked')} testID="open-blocked" />
        </Glass>
      </ScrollView>

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open === 'online' ? t.online2 : open === 'timer' ? t.defaultTimer : open === 'photo' ? t.profilePhoto : t.lastSeenOnline}>
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          {choices.map((c) => {
            const on = current === c.value;
            return (
              <Pressy
                key={c.value}
                label={c.label}
                scale={0.98}
                testID={`choice-${c.value}`}
                onPress={() => {
                  tick();
                  const which = open;
                  setOpen(null);
                  if (which === 'timer') {
                    setDefaultTimer(Number(c.value));
                    setTimer(Number(c.value));
                  } else if (!on) void change(which === 'online' ? { online: c.value } : which === 'photo' ? { photo: c.value } : { last_seen: c.value });
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, borderRadius: 14, backgroundColor: on ? theme.accSoft : 'transparent' }}>
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight={on ? '700' : '500'} color={on ? theme.accInk : theme.text}>
                      {c.label}
                    </Txt>
                  </View>
                  {on && <Icon name="check" size={20} color={theme.accInk} stroke={2.4} />}
                </View>
              </Pressy>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}
