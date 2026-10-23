// settings/status-privacy.tsx: who sees my status, as on WhatsApp.
//
//   My contacts               everyone saved in my contacts who's on PakChat
//   My contacts except…       all of them but the ones ticked
//   Only share with…          just the ones ticked
//
// A change applies to the statuses I post next, and to the ones still up:
// someone taken out gets no new statuses, and the next one is locked with a
// fresh key (shared/src/client.ts, setStatusAudience).
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core, isOffline } from '../../core/core';
import { usePeople } from '../../core/hooks';
import { setStatusPrivacy, statusPrivacy, type StatusPrivacy } from '../../core/status';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Divider, Glass, Pressy, Screen, Section, TopBar, Txt } from '../../ui/kit';
import { tick } from '../../ui/motion';
import { toast } from '../../ui/overlays';

export default function StatusPrivacyScreen() {
  const t = useT();
  const { theme } = useLook();
  usePeople();
  const [p, setP] = useState<StatusPrivacy>(statusPrivacy);
  const [saving, setSaving] = useState(false);
  const contacts = useMemo(
    () =>
      Object.entries(core.contacts)
        .filter(([id]) => id !== core.myId)
        .map(([id, c]) => ({ id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const modes: { mode: StatusPrivacy['mode']; label: string }[] = [
    { mode: 'contacts', label: t.myContacts },
    { mode: 'except', label: t.contactsExcept },
    { mode: 'only', label: t.onlyShareWith },
  ];

  async function save() {
    setSaving(true);
    try {
      await setStatusPrivacy(p);
      router.back();
    } catch (err) {
      setSaving(false);
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  const toggle = (id: string) => setP((old) => ({ ...old, ids: old.ids.includes(id) ? old.ids.filter((x) => x !== id) : [...old.ids, id] }));

  return (
    <Screen>
      <TopBar title={t.statusPrivacy} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Section title={t.whoSeesStatus} />
        <Glass>
          {modes.map((m, i) => {
            const on = p.mode === m.mode;
            return (
              <View key={m.mode}>
                {i > 0 && <Divider />}
                <Pressy label={m.label} scale={0.98} onPress={() => (tick(), setP({ mode: m.mode, ids: m.mode === p.mode ? p.ids : [] }))} testID={`status-mode-${m.mode}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15 }}>
                    <Txt size={15.5} weight={on ? '700' : '500'} color={on ? theme.accInk : theme.text} style={{ flex: 1 }}>
                      {m.label}
                    </Txt>
                    {on && <Icon name="check" size={20} color={theme.accInk} stroke={2.4} />}
                  </View>
                </Pressy>
              </View>
            );
          })}
        </Glass>
        <Txt size={13} color={theme.muted} style={{ marginHorizontal: 14, marginTop: 10 }}>
          {t.statusPrivacyNote}
        </Txt>

        {p.mode !== 'contacts' && (
          <>
            <Section title={p.mode === 'except' ? t.hideStatusFrom : t.shareStatusWith} />
            <Glass>
              {contacts.length ? (
                contacts.map((c, i) => {
                  const on = p.ids.includes(c.id);
                  return (
                    <View key={c.id}>
                      {i > 0 && <Divider />}
                      <Pressy label={c.name} scale={0.98} onPress={() => toggle(c.id)} testID="status-person">
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                          <Avatar id={c.id} name={c.name} size={40} />
                          <Txt size={15.5} weight="600" style={{ flex: 1 }} lines={1}>
                            {c.name}
                          </Txt>
                          <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: on ? theme.acc : theme.faint, backgroundColor: on ? theme.acc : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            {on && <Icon name="check" size={15} color="#FFFFFF" stroke={2.6} />}
                          </View>
                        </View>
                      </Pressy>
                    </View>
                  );
                })
              ) : (
                <Txt size={14} color={theme.muted} style={{ padding: 16 }}>
                  {t.noContactsYet}
                </Txt>
              )}
            </Glass>
          </>
        )}
        <View style={{ marginTop: 20 }}>
          <Button title={t.save} onPress={() => void save()} busy={saving} disabled={saving} testID="status-privacy-save" />
        </View>
      </ScrollView>
    </Screen>
  );
}
