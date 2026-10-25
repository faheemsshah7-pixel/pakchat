// new-call.tsx: start a call, like WhatsApp's New call: search your contacts
// by name and call one (voice or video), or call a number that's on PakChat.
// With `fav`, the same list adds someone to Favourites (shown at the top of
// Calls, and in Chats' Favourites filter).
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import { core, isOffline } from '../core/core';
import { defaultTimer } from '../core/timer';
import { useFavouriteChats, usePeople } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { startCall } from '../ui/CallBar';
import { Icon } from '../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, Section, SettingRow, TopBar, Txt } from '../ui/kit';
import { rise } from '../ui/motion';
import { Sheet, toast } from '../ui/overlays';
import Animated from 'react-native-reanimated';

export default function NewCall() {
  const t = useT();
  const { theme } = useLook();
  const fav = useLocalSearchParams<{ fav?: string }>().fav === '1';
  const people = usePeople();
  const favs = useFavouriteChats();
  const [query, setQuery] = useState('');
  const [dialing, setDialing] = useState(false);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  // Who's a favourite already: their one-to-one chat is.
  const favourite = useMemo(() => new Set(favs.filter((c) => c.kind === 'direct').map((c) => core.otherPerson(c))), [favs]);

  const known = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return Object.values(people)
      .filter((p) => p.id !== core.myId && p.name)
      .map((p) => ({ id: p.id, name: core.name(p.id), phone: core.contacts[p.id]?.phone ?? '' }))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (digits.length >= 3 && p.phone.replace(/\D/g, '').includes(digits)))
      .sort((a, b) => a.name.replace(/^~ /, '').localeCompare(b.name.replace(/^~ /, '')));
  }, [people, query]);

  // A second tap while the chat is opening does nothing.
  const opening = useRef(false);
  async function call(userId: string, video: boolean) {
    if (opening.current) return;
    opening.current = true;
    try {
      const chat = await core.client.openDirect(userId, defaultTimer());
      router.back();
      await startCall(chat.id, video, t);
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      opening.current = false;
    }
  }

  async function toggleFavourite(userId: string) {
    if (opening.current) return;
    opening.current = true;
    try {
      const chat = await core.client.openDirect(userId, defaultTimer());
      const on = !core.prefs[chat.id]?.favourite;
      core.setPrefs(chat.id, { favourite: on });
      toast(on ? t.addedFavourite : t.removedFavourite);
      if (on) router.back();
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      opening.current = false;
    }
  }

  async function callNumber(video: boolean) {
    if (!number.trim() || busy) return;
    setBusy(true);
    try {
      const p = await core.lookup(number);
      if (!p) return toast(t.notOnPakChat);
      if (p.id === core.myId) return toast(t.ownAccount);
      setDialing(false);
      await call(p.id, video);
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={fav ? t.addFavourite : t.newCall} onBack={() => router.back()} />
      <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
        <Field value={query} onChangeText={setQuery} placeholder={t.searchNameOrNumber} icon="search" autoCorrect={false} testID="call-search" />
      </View>
      {!fav && !query.trim() && (
        <Glass style={{ marginHorizontal: 12 }}>
          <SettingRow icon="dialpad" title={t.callANumber} onPress={() => setDialing(true)} testID="call-a-number" />
          <Divider />
          <SettingRow icon="userPlus" title={t.newContact} onPress={() => router.push('/contact')} />
        </Glass>
      )}
      {fav && !query.trim() && (
        <Txt size={13} color={theme.muted} style={{ paddingHorizontal: 22, paddingBottom: 4 }}>
          {t.favouritesNote}
        </Txt>
      )}

      {known.length > 0 && <Section title={t.contacts} />}
      <FlatList
        data={known}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ marginHorizontal: 12, paddingBottom: 30 }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item, index }) => (
          <Animated.View entering={rise(Math.min(index, 10) * 25)}>
            <Pressy onPress={() => (fav ? void toggleFavourite(item.id) : void call(item.id, false))} label={item.name} scale={0.98} testID={`call-person-${item.name}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Avatar id={item.id} name={item.name.replace(/^~ /, '')} size={44} />
                <Txt size={15.5} weight="600" lines={1} style={{ flex: 1 }}>
                  {item.name}
                </Txt>
                {fav ? (
                  <Icon name="heart" size={21} color={favourite.has(item.id) ? theme.acc : theme.faint} />
                ) : (
                  <>
                    <IconButton icon="calls" label={t.voiceCall} size={40} iconSize={20} color={theme.accInk} onPress={() => void call(item.id, false)} testID="person-voice" />
                    <IconButton icon="video" label={t.videoCall} size={40} iconSize={21} color={theme.accInk} onPress={() => void call(item.id, true)} testID="person-video" />
                  </>
                )}
              </View>
            </Pressy>
          </Animated.View>
        )}
      />

      <Sheet visible={dialing} onClose={() => setDialing(false)} title={t.callANumber}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Txt size={13.5} color={theme.muted}>
            {t.callANumberNote}
          </Txt>
          <Field value={number} onChangeText={setNumber} placeholder="+92 300 1234567" keyboardType="phone-pad" autoFocus testID="dial-field" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={t.voiceCall} icon="calls" busy={busy} disabled={!number.trim()} onPress={() => void callNumber(false)} style={{ flex: 1 }} testID="dial-voice" />
            <Button title={t.videoCall} icon="video" look="soft" disabled={!number.trim() || busy} onPress={() => void callNumber(true)} style={{ flex: 1 }} testID="dial-video" />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
