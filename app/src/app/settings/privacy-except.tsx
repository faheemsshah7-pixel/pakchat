// settings/privacy-except.tsx: "My contacts except…" for last seen, profile photo,
// About or groups (Settings › Privacy), like WhatsApp. Tick the people to leave
// out, then Done. My contacts here are the people I have a one-to-one chat with,
// the same as the server counts them (server/lib/pakchat/privacy.ex): every such
// chat on this phone, also ones deleted here or in Locked chats. People in Locked
// chats show only after the fingerprint (a row at the end asks), and someone
// already left out is never dropped just because they aren't shown.
import type { Chat } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { core, isOffline } from '../../core/core';
import { useAuth, usePeople, useSettings } from '../../core/hooks';
import { authenticate } from '../../core/lock';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Field, Pressy, Screen, TopBar, Txt } from '../../ui/kit';
import { toast } from '../../ui/overlays';
import { slid } from '../../ui/ScreenSlide';

type Key = 'last_seen' | 'photo' | 'about' | 'groups';
const KEYS: Key[] = ['last_seen', 'photo', 'about', 'groups'];

function PrivacyExcept() {
  const t = useT();
  const { theme } = useLook();
  const { key: raw } = useLocalSearchParams<{ key?: string }>();
  const key: Key = KEYS.includes(raw as Key) ? (raw as Key) : 'last_seen';
  const { me } = useAuth();
  usePeople();
  const settings = useSettings();
  // Every chat on this phone (the chat list leaves out deleted and locked ones).
  const [chats, setChats] = useState<Chat[] | null>(null);
  useEffect(() => {
    let live = true;
    void core.client
      .chats()
      .then((c) => live && setChats(c))
      .catch(() => live && setChats([]));
    return () => {
      live = false;
    };
  }, []);
  const [showLocked, setShowLocked] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(me?.privacy.except?.[key] ?? []));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // My contacts: the other person in each one-to-one chat (not myself). `locked`: only in Locked chats.
  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; about: string; locked: boolean }>();
    for (const chat of chats ?? []) {
      if (chat.kind !== 'direct' || chat.callLink) continue;
      const other = core.otherPerson(chat);
      if (!other || other === core.myId) continue;
      const locked = core.prefs[chat.id]?.lock === 'folder';
      const was = byId.get(other);
      if (was) was.locked &&= locked;
      else byId.set(other, { id: other, name: core.name(other) || '…', about: core.people[other]?.about ?? '', locked });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [chats]);
  const hasLocked = people.some((p) => p.locked);
  const visible = showLocked ? people : people.filter((p) => !p.locked);
  const q = query.trim().toLowerCase();
  const shown = q ? visible.filter((p) => p.name.toLowerCase().includes(q)) : visible;

  async function openLocked() {
    const r = await authenticate(t.unlockChat, t.cancel);
    if (r === 'ok') setShowLocked(true);
    else if (r === 'failed') toast(t.notRecognised);
    else if (r === 'wait') toast(t.waitABit);
    else if (r === 'unavailable') toast(t.biometricsGone);
  }
  const titles: Record<Key, string> = { last_seen: t.lastSeenOnline, photo: t.profilePhoto, about: t.about, groups: t.groups };

  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    if (!chats) return;
    setSaving(true);
    try {
      // Everyone ticked stays, shown here or not (Locked chats, or a chat not on this
      // phone): the server only uses the list for contacts anyway.
      const ids = [...picked];
      await core.updateMe({ privacy: { [key]: 'except', except: { [key]: ids } } });
      router.back();
    } catch (err) {
      setSaving(false);
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  return (
    <Screen>
      <TopBar title={titles[key]} onBack={() => router.back()} />
      <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8 }}>
        <Txt size={13.5} color={theme.muted} style={{ marginHorizontal: 4 }}>
          {picked.size ? fill(t.exceptPicked, { n: picked.size }) : t.exceptNote}
        </Txt>
        <Field icon="search" value={query} onChangeText={setQuery} placeholder={t.search} testID="except-search" />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        extraData={picked}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 100 }}
        ListFooterComponent={
          hasLocked && !showLocked && !settings.lockedHidden && !q ? (
            <Pressy label={t.lockedChats} scale={0.98} onPress={() => void openLocked()} testID="except-locked">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="lock" size={20} color={theme.accInk} />
                </View>
                <Txt size={15.5} weight="600">
                  {t.lockedChats}
                </Txt>
              </View>
            </Pressy>
          ) : undefined
        }
        ListEmptyComponent={
          <Txt size={14} color={theme.muted} style={{ padding: 16 }}>
            {q ? t.noResults : t.noContactsYet}
          </Txt>
        }
        renderItem={({ item: p }) => {
          const on = picked.has(p.id);
          return (
            <Pressy label={p.name} scale={0.98} onPress={() => toggle(p.id)} testID="except-person">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 9 }}>
                <Avatar id={p.id} name={p.name} size={44} />
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="600" lines={1}>
                    {p.name}
                  </Txt>
                  {!!p.about && (
                    <Txt size={13} color={theme.muted} lines={1}>
                      {p.about}
                    </Txt>
                  )}
                </View>
                {/* Ticked: left out (a red tick, like WhatsApp's). */}
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? theme.danger : theme.faint, backgroundColor: on ? theme.danger : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Icon name="check" size={14} color="#FFFFFF" stroke={2.6} />}
                </View>
              </View>
            </Pressy>
          );
        }}
      />
      <View style={{ position: 'absolute', start: 12, end: 12, bottom: 20 }}>
        <Button title={t.doneWord} onPress={() => void save()} busy={saving} disabled={saving || !chats} testID="except-save" />
      </View>
    </Screen>
  );
}

export default slid(PrivacyExcept);
