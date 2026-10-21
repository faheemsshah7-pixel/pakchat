// settings/privacy.tsx: who sees your last seen and online, blue ticks, and blocked people.
// These are kept on the server (it's the one that hands out "last seen").
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../../core/core';
import { useAuth, useBlocked } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Divider, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { tick } from '../../ui/motion';
import { Sheet, toast } from '../../ui/overlays';

type Choice = { value: string; label: string };

export default function Privacy() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const blocked = useBlocked();
  const [open, setOpen] = useState<'last_seen' | 'online' | null>(null);
  const p = me?.privacy ?? { lastSeen: 'everyone', online: 'everyone', readReceipts: true };

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

  async function change(privacy: { last_seen?: string; online?: string; read_receipts?: boolean }) {
    try {
      await core.updateMe({ privacy });
    } catch {
      toast(t.couldNot);
    }
  }

  const choices = open === 'online' ? onlineChoices : lastSeenChoices;
  const current = open === 'online' ? p.online : p.lastSeen;

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
          <SettingRow
            icon="ticks"
            title={t.readReceipts}
            sub={t.readReceiptsSub}
            right={<Toggle on={p.readReceipts} onChange={(on) => void change({ read_receipts: on })} label={t.readReceipts} testID="read-receipts" />}
          />
        </Glass>
        <Section title={t.safety} />
        <Glass>
          <SettingRow icon="flag" title={t.blocked} sub={blocked ? String(blocked.length) : ''} onPress={() => router.push('/settings/blocked')} testID="open-blocked" />
        </Glass>
      </ScrollView>

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open === 'online' ? t.online2 : t.lastSeenOnline}>
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
                  if (!on) void change(which === 'online' ? { online: c.value } : { last_seen: c.value });
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
