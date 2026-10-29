// ContactShare.tsx: Contact in the attach menu. Pick one or more people from
// the phone's contacts and they go as contact cards (name, numbers, emails).
// Nothing is looked up on the server here: whoever gets the card can tap
// "Message" to find the person on PakChat, if they choose.
import type { SharedContact } from '@pakchat/shared';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, View } from 'react-native';

import { phoneBookCards } from '../../core/phoneBook';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../icons';
import { Avatar, Button, Field, Pressy, Txt } from '../kit';
import { Sheet, whenOpened } from '../overlays';

export const ContactShare = whenOpened(function ContactShare({ visible, onClose, onSend }: { visible: boolean; onClose: () => void; onSend: (cards: SharedContact[]) => void }) {
  const t = useT();
  return (
    <Sheet visible={visible} onClose={onClose} title={t.shareContact}>
      {visible && <Pick onSend={onSend} />}
    </Sheet>
  );
});

function Pick({ onSend }: { onSend: (cards: SharedContact[]) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [all, setAll] = useState<SharedContact[] | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    void phoneBookCards()
      .then(setAll)
      .catch(() => setAll(null));
  }, []);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (all ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !words || c.name.toLowerCase().includes(words) || c.phones.some((p) => p.replace(/\D/g, '').includes(words.replace(/\D/g, '') || '\u0000')));
  }, [all, q]);

  if (all === undefined) return <ActivityIndicator color={theme.acc} style={{ margin: 30 }} />;
  if (all === null)
    return (
      <View style={{ padding: 20, gap: 12, alignItems: 'center' }}>
        <Txt size={14} color={theme.muted} align="center">
          {t.noContactsAccess}
        </Txt>
        <Button title={t.openSettings} look="soft" onPress={() => void Linking.openSettings()} />
      </View>
    );

  return (
    <View style={{ paddingHorizontal: 14, gap: 10 }}>
      <Field icon="search" value={q} onChangeText={setQ} placeholder={t.search} testID="contact-search" />
      <FlatList
        style={{ maxHeight: 380 }}
        data={shown}
        keyExtractor={({ i }) => String(i)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: { c, i } }) => {
          const on = picked.has(i);
          return (
            <Pressy
              onPress={() =>
                setPicked((old) => {
                  const next = new Set(old);
                  if (on) next.delete(i);
                  else if (next.size < 10) next.add(i);
                  return next;
                })
              }
              label={c.name}
              scale={0.98}
              testID={`contact-${i}`}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                <Avatar id={c.phones[0] ?? c.name} name={c.name} size={42} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight="600" lines={1}>
                    {c.name}
                  </Txt>
                  <Txt size={12.5} color={theme.muted} lines={1}>
                    {c.phones[0] ?? c.emails?.[0] ?? ''}
                  </Txt>
                </View>
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? theme.acc : theme.muted, backgroundColor: on ? theme.acc : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Icon name="check" size={14} color="#FFFFFF" stroke={2.6} />}
                </View>
              </View>
            </Pressy>
          );
        }}
      />
      <Button
        title={picked.size ? fill(t.sendContacts, { n: picked.size }) : t.send}
        icon="send"
        disabled={!picked.size}
        onPress={() => onSend([...picked].map((i) => all[i]))}
        testID="contact-send"
      />
    </View>
  );
}
