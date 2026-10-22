// contact.tsx: save someone under your own name, like WhatsApp's "New contact".
//
// First and last name, their number and/or Gmail, and "Save to": a Google account
// (Google syncs it to your Gmail contacts), the phone, the SIM card, or PakChat only.
// Opened with an id (from a chat with someone not in your contacts, or to edit),
// or empty for a new contact: then the number or Gmail is checked with the server
// first, so you only save people who are on PakChat.
import { formatPhone, normalizePhone } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { core, isOffline, type Contact } from '../core/core';
import { usePeople } from '../core/hooks';
import { accountKey, lastSaveTo, phoneBookAccounts, rememberSaveTo, saveToPhoneBook, type PhoneBookAccount } from '../core/phoneBook';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon, type IconName } from '../ui/icons';
import { Avatar, Button, Divider, Field, Glass, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { Sheet, toast } from '../ui/overlays';

const PAKCHAT_ONLY = 'pakchat';

export default function SaveContact() {
  const t = useT();
  const { theme } = useLook();
  const { id, phone: givenPhone, email: givenEmail } = useLocalSearchParams<{ id?: string; phone?: string; email?: string }>();
  usePeople();
  const saved = id ? core.contacts[id] : undefined;
  const startName = (saved?.name ?? (id ? core.plainName(id) : '')).trim();
  const [first, setFirst] = useState(startName.split(/\s+/)[0] ?? '');
  const [last, setLast] = useState(startName.split(/\s+/).slice(1).join(' '));
  const [phone, setPhone] = useState(saved?.phone ? formatPhone(saved.phone) : (givenPhone ?? ''));
  const [email, setEmail] = useState(saved?.email ?? givenEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // "Save to": the phone's accounts, once PakChat may see contacts.
  const [accounts, setAccounts] = useState<PhoneBookAccount[] | null>(null);
  const [saveTo, setSaveTo] = useState<string>(PAKCHAT_ONLY);
  const [picking, setPicking] = useState(false);

  function applyAccounts(list: PhoneBookAccount[] | null) {
    setAccounts(list);
    if (!list?.length) return setSaveTo(PAKCHAT_ONLY);
    const remembered = lastSaveTo();
    if (remembered && (remembered === PAKCHAT_ONLY || list.some((a) => accountKey(a) === remembered))) setSaveTo(remembered);
    else setSaveTo(accountKey(list[0]));
  }

  // Adding someone from a chat: fill in the number or Gmail I found them by, or that they messaged me from.
  useEffect(() => {
    if (!id || saved) return;
    void core
      .waysOf(id)
      .then((w) => {
        if (w.phone) setPhone((typed) => typed || formatPhone(w.phone!));
        if (w.email) setEmail((typed) => typed || w.email!);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    // Editing someone already saved only changes PakChat's name for them.
    if (saved) return;
    void phoneBookAccounts(false)
      .then(applyAccounts)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openSaveTo() {
    if (!accounts) {
      const list = await phoneBookAccounts(true).catch(() => null);
      if (!list) return toast(t.noContactsAccess);
      applyAccounts(list);
    }
    setPicking(true);
  }

  const name = [first.trim(), last.trim()].filter(Boolean).join(' ');
  const chosen = accounts?.find((a) => accountKey(a) === saveTo) ?? null;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const contact: Contact = { name };
      let who = id ?? null;
      // Each number or Gmail typed must be this person's (or, for a new contact, someone's) on PakChat.
      for (const [typed, kind] of [
        [phone.trim(), 'phone'],
        [email.trim().toLowerCase(), 'email'],
      ] as const) {
        if (!typed) continue;
        const clean = kind === 'phone' ? normalizePhone(typed) : typed.includes('@') ? typed : `${typed}@gmail.com`;
        if (!clean) return setError(t.badPhone);
        const found = await core.lookup(clean);
        if (found && found.id === core.myId) return setError(t.ownAccount);
        if (found && who && found.id !== who) return setError(fill(t.belongsToOther, { what: typed }));
        // Someone you chat with may not have added this number to PakChat: keep it anyway.
        if (!found && !id) continue;
        if (found) who = found.id;
        if (kind === 'phone') contact.phone = clean;
        else contact.email = clean;
      }
      if (!who) return setError(t.notOnPakChat);
      // Into the phone's address book too, unless "PakChat only".
      if (chosen) {
        try {
          await saveToPhoneBook(chosen, name, contact.phone, contact.email);
        } catch {
          toast(fill(t.couldNotSaveTo, { where: accountLabel(chosen) }));
        }
      }
      rememberSaveTo(saveTo);
      core.saveContact(who, contact);
      toast(t.contactSaved);
      router.back();
    } catch (err) {
      setError(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!id) return;
    core.removeContact(id);
    router.back();
  }

  const accountIcon = (a: PhoneBookAccount | null): IconName => (!a ? 'chat' : a.kind === 'google' ? 'globe' : a.kind === 'sim' ? 'key' : 'calls');
  function accountLabel(a: PhoneBookAccount | null) {
    if (!a) return t.pakchatOnly;
    if (a.kind === 'google') return t.googleAccount;
    if (a.kind === 'sim') return a.name && !/^sim$/i.test(a.name) ? `${t.simCard} · ${a.name}` : t.simCard;
    return t.thisPhone;
  }
  const accountSub = (a: PhoneBookAccount | null) => (!a ? t.pakchatOnlyNote : a.kind === 'google' ? (a.name ?? '') : a.kind === 'sim' ? t.simNote : t.thisPhoneNote);

  const options: (PhoneBookAccount | null)[] = [...(accounts ?? []), null];

  return (
    <Screen>
      <TopBar title={saved ? t.editContact : id ? t.saveContact : t.newContact} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <Avatar id={id ?? 'new'} name={name} size={84} />
        </View>
        <Field value={first} onChangeText={setFirst} placeholder={t.firstName} icon="you" autoCapitalize="words" maxLength={30} testID="contact-name" autoFocus={!id} />
        <Field value={last} onChangeText={setLast} placeholder={t.lastName} autoCapitalize="words" maxLength={30} testID="contact-last-name" style={{ marginStart: 29 }} />
        <Field value={phone} onChangeText={setPhone} placeholder={t.contactPhone} icon="calls" keyboardType="phone-pad" testID="contact-phone" />
        <Field value={email} onChangeText={setEmail} placeholder={t.contactEmail} icon="globe" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} testID="contact-email" />

        {!saved && (
          <Pressy onPress={openSaveTo} label={t.saveTo} scale={0.98} testID="save-to">
            <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={accountIcon(chosen)} size={19} color={theme.accInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt size={12.5} color={theme.muted}>
                  {t.saveTo}
                </Txt>
                <Txt size={15.5} weight="600" lines={1} testID="save-to-choice">
                  {accountLabel(chosen)}
                </Txt>
                {chosen?.kind === 'google' && !!chosen.name && (
                  <Txt size={12.5} color={theme.muted} lines={1}>
                    {chosen.name}
                  </Txt>
                )}
              </View>
              <Icon name="down" size={20} color={theme.muted} />
            </Glass>
          </Pressy>
        )}

        {!!error && (
          <Animated.View entering={FadeIn}>
            <Txt size={14} color={theme.danger} align="center" testID="contact-error">
              {error}
            </Txt>
          </Animated.View>
        )}
        <Button title={t.save} onPress={save} busy={busy} disabled={!name || (!id && !phone.trim() && !email.trim())} testID="contact-save" />
        {saved && <Button title={t.removeContact} look="danger" onPress={remove} testID="contact-remove" />}
      </ScrollView>

      <Sheet visible={picking} onClose={() => setPicking(false)} title={t.saveTo}>
        <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
          {options.map((a, i) => {
            const key = a ? accountKey(a) : PAKCHAT_ONLY;
            const on = key === saveTo;
            return (
              <View key={key}>
                {i > 0 && <Divider />}
                <Pressy onPress={() => (setSaveTo(key), setPicking(false))} label={accountLabel(a)} scale={0.98} testID={`save-to-${a?.kind ?? PAKCHAT_ONLY}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 14, backgroundColor: on ? theme.accSoft : 'transparent' }}>
                    <Icon name={accountIcon(a)} size={21} color={on ? theme.accInk : theme.muted} />
                    <View style={{ flex: 1 }}>
                      <Txt size={15.5} weight={on ? '700' : '500'} color={on ? theme.accInk : theme.text}>
                        {accountLabel(a)}
                      </Txt>
                      <Txt size={12.5} color={theme.muted} lines={1}>
                        {accountSub(a)}
                      </Txt>
                    </View>
                    {on && <Icon name="check" size={20} color={theme.accInk} stroke={2.4} />}
                  </View>
                </Pressy>
              </View>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}
