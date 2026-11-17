// settings/privacy.tsx: who sees your last seen and online, photo and About, blue ticks,
// who can add you to groups, and blocked people. These are kept on the server (it's the
// one that hands out "last seen" and adds people to groups). And, like WhatsApp's
// Privacy › Calls: Silence unknown callers and Protect IP address in calls (this phone).
// Status (who sees mine) and Live location (the chats I'm sharing it in now, with Stop) too.
// Last seen, photo, About and groups also have "My contacts except…" (settings/privacy-except.tsx).
import type { PrivacyExcept } from '@pakchat/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../../core/core';
import { defaultTimer, setDefaultTimer } from '../../core/timer';
import { sharing, stopLive } from '../../core/live';
import { audienceWho } from '../../core/status';
import { useAuth, useBlocked, useChatList, useSettings } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Divider, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { TIMERS, timerLabel } from '../../ui/format';
import { tick } from '../../ui/motion';
import { Sheet, toast } from '../../ui/overlays';

type Choice = { value: string; label: string };

const NONE_LEFT_OUT: PrivacyExcept = { last_seen: [], photo: [], about: [], groups: [] };

export default function Privacy() {
  const t = useT();
  const { theme } = useLook();
  const { me } = useAuth();
  const blocked = useBlocked();
  const settings = useSettings();
  const [open, setOpen] = useState<'last_seen' | 'online' | 'photo' | 'about' | 'groups' | 'timer' | null>(null);
  const [timer, setTimer] = useState(defaultTimer);
  // Read again on coming back (Status privacy is its own page; a share can end meanwhile).
  const [statusWho, setStatusWho] = useState(() => audienceWho(t));
  const [live, setLive] = useState(() => sharing());
  const [liveOpen, setLiveOpen] = useState(false);
  const rows = useChatList();
  useFocusEffect(
    useCallback(() => {
      setStatusWho(audienceWho(t));
      setLive(sharing());
    }, [t]),
  );
  const p = me?.privacy ?? { lastSeen: 'everyone', online: 'everyone', readReceipts: true, photo: 'everyone', about: 'everyone', groups: 'everyone', except: NONE_LEFT_OUT };
  // A "me" saved before this build has no lists.
  const except = p.except ?? NONE_LEFT_OUT;

  const lastSeenChoices: Choice[] = [
    { value: 'everyone', label: t.everyone },
    { value: 'contacts', label: t.myContacts },
    { value: 'except', label: t.contactsExcept },
    { value: 'nobody', label: t.nobody },
  ];
  const onlineChoices: Choice[] = [
    { value: 'everyone', label: t.everyone },
    { value: 'same', label: t.sameAsLastSeen },
  ];
  const groupsChoices: Choice[] = [
    { value: 'everyone', label: t.everyone },
    { value: 'contacts', label: t.myContacts },
    { value: 'except', label: t.contactsExcept },
  ];
  // "My contacts except…" says how many are left out ("Contacts except 2").
  const labelOf = (list: Choice[], v: string, key?: keyof PrivacyExcept) =>
    v === 'except' && key ? fill(t.statusExcept, { n: except[key].length }) : (list.find((c) => c.value === v)?.label ?? v);

  async function change(privacy: { last_seen?: string; online?: string; photo?: string; about?: string; groups?: string; read_receipts?: boolean }) {
    // (The except lists are changed on their own page.)
    try {
      await core.updateMe({ privacy });
    } catch {
      toast(t.couldNot);
    }
  }

  const timerChoices: Choice[] = TIMERS.map((s) => ({ value: String(s), label: timerLabel(s, t) }));
  const choices = open === 'online' ? onlineChoices : open === 'timer' ? timerChoices : open === 'groups' ? groupsChoices : lastSeenChoices;
  const current = open === 'online' ? p.online : open === 'timer' ? String(timer) : open === 'photo' ? p.photo : open === 'about' ? p.about : open === 'groups' ? p.groups : p.lastSeen;
  const titles = { online: t.online2, timer: t.defaultTimer, photo: t.profilePhoto, about: t.about, groups: t.groups, last_seen: t.lastSeenOnline };

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
          <SettingRow icon="clock" title={t.lastSeenOnline} sub={labelOf(lastSeenChoices, p.lastSeen, 'last_seen')} onPress={() => setOpen('last_seen')} testID="privacy-last-seen" />
          <Divider />
          <SettingRow icon="you" title={t.online2} sub={labelOf(onlineChoices, p.online)} onPress={() => setOpen('online')} testID="privacy-online" />
          <Divider />
          <SettingRow icon="photo" title={t.profilePhoto} sub={labelOf(lastSeenChoices, p.photo, 'photo')} onPress={() => setOpen('photo')} testID="privacy-photo" />
          <Divider />
          <SettingRow icon="info" title={t.about} sub={labelOf(lastSeenChoices, p.about, 'about')} onPress={() => setOpen('about')} testID="privacy-about" />
          <Divider />
          <SettingRow icon="group" title={t.groups} sub={labelOf(groupsChoices, p.groups, 'groups')} onPress={() => setOpen('groups')} testID="privacy-groups" />
          <Divider />
          <SettingRow icon="status" title={t.status} sub={statusWho} onPress={() => router.push('/settings/status-privacy')} testID="privacy-status" />
          <Divider />
          <SettingRow icon="live" title={t.liveLocation} sub={live.length ? fill(t.liveInN, { n: live.length }) : t.nobody} onPress={() => (setLive(sharing()), setLiveOpen(true))} testID="privacy-live" />
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
        <Section title={t.calls} />
        <Glass>
          <SettingRow
            icon="muted"
            title={t.silenceUnknown}
            sub={t.silenceUnknownSub}
            chevron={false}
            right={<Toggle on={!!settings.silenceUnknown} onChange={(on) => core.setSettings({ silenceUnknown: on })} label={t.silenceUnknown} testID="privacy-silence-unknown" />}
          />
          <Divider />
          <SettingRow
            icon="shield"
            title={t.protectIp}
            sub={t.protectIpSub}
            chevron={false}
            right={<Toggle on={!!settings.protectIp} onChange={(on) => core.setSettings({ protectIp: on })} label={t.protectIp} testID="privacy-protect-ip" />}
          />
        </Glass>
        <Section title={t.safety} />
        <Glass>
          <SettingRow icon="flag" title={t.blocked} sub={blocked ? String(blocked.length) : ''} onPress={() => router.push('/settings/blocked')} testID="open-blocked" />
          <Divider />
          <SettingRow icon="fingerprint" title={t.appLock} sub={settings.appLock ? t.onWord : t.appLockSub} onPress={() => router.push('/settings/lock')} testID="open-lock" />
        </Glass>
      </ScrollView>

      <Sheet visible={liveOpen} onClose={() => setLiveOpen(false)} title={t.liveLocation}>
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          {!live.length && (
            <Txt size={14} color={theme.muted} style={{ paddingHorizontal: 4, paddingVertical: 10 }}>
              {t.liveNone}
            </Txt>
          )}
          {live.map((s) => (
            <View key={s.chatId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingVertical: 8 }}>
              <Txt size={15.5} weight="600" lines={1} style={{ flex: 1 }}>
                {rows?.find((r) => r.chat.id === s.chatId)?.title ?? '…'}
              </Txt>
              <Pressy onPress={() => void stopLive(s.chatId).then(() => setLive(sharing()))} label={t.stopSharing} scale={0.95} testID="privacy-live-stop">
                <Txt size={14} weight="700" color={theme.danger} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                  {t.stopWord}
                </Txt>
              </Pressy>
            </View>
          ))}
          {live.length > 1 && (
            <Pressy onPress={() => void stopLive().then(() => (setLive([]), setLiveOpen(false)))} label={t.stopAllSharing} scale={0.98} testID="privacy-live-stop-all">
              <Txt size={15} weight="700" color={theme.danger} style={{ paddingHorizontal: 4, paddingVertical: 12 }}>
                {t.stopAllSharing}
              </Txt>
            </Pressy>
          )}
        </View>
      </Sheet>

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? titles[open] : ''}>
        {open === 'groups' && (
          <Txt size={13.5} color={theme.muted} style={{ marginHorizontal: 20, marginBottom: 8 }}>
            {t.groupsPrivacyNote}
          </Txt>
        )}
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
                  // "My contacts except…": pick who's left out (picked again, it edits the list).
                  if (c.value === 'except' && (which === 'last_seen' || which === 'photo' || which === 'about' || which === 'groups')) {
                    router.push({ pathname: '/settings/privacy-except', params: { key: which } });
                    return;
                  }
                  if (which === 'timer') {
                    setDefaultTimer(Number(c.value));
                    setTimer(Number(c.value));
                  } else if (!on)
                    void change(
                      which === 'online' ? { online: c.value } : which === 'photo' ? { photo: c.value } : which === 'about' ? { about: c.value } : which === 'groups' ? { groups: c.value } : { last_seen: c.value },
                    );
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
