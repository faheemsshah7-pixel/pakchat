// settings/index.tsx: Settings (from the chat list's ⋮ menu): you, the look
// of the app, and everything else. The 🔍 at the top searches every setting
// (ui/SettingsSearch.tsx), like WhatsApp.
//
// Pick Sky, Graphite or Auto (follows the phone) and one of six accent
// colours: the whole app changes at once, and remembers it.
import { formatPhone } from '@pakchat/shared';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core, serverUrl } from '../../core/core';
import { useAuth, useChatList, useSettings } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { ACCENTS, accentGradient, makeTheme, type ModeChoice } from '../../theme/palette';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { pop, tick } from '../../ui/motion';
import { CameraBadge, PhotoSheet } from '../../ui/PhotoSheet';
import { Dialog, Sheet, toast } from '../../ui/overlays';
import { SettingsResults } from '../../ui/SettingsSearch';

export default function Settings() {
  const t = useT();
  const { theme, mode, accent, setPrefs } = useLook();
  const { me, myId } = useAuth();
  const [editing, setEditing] = useState(false);
  const [archivingAll, setArchivingAll] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const rows = useChatList();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  // Search in Settings (🔍 at the top), like WhatsApp.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const closeSearch = () => (setSearching(false), setQuery(''));

  // Back closes the search first.
  useEffect(() => {
    if (!searching) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSearching(false);
      setQuery('');
      return true;
    });
    return () => sub.remove();
  }, [searching]);
  const settings = useSettings();

  const modes: { key: ModeChoice; label: string }[] = [
    { key: 'sky', label: t.sky },
    { key: 'graphite', label: t.graphite },
    { key: 'auto', label: t.auto },
  ];

  async function save() {
    setEditing(false);
    try {
      await core.updateMe({ name: name.trim(), about: about.trim() });
    } catch {
      toast(t.couldNot);
    }
  }

  async function saveServer() {
    const typed = (server ?? '').trim();
    setServer(null);
    if (!typed) return;
    try {
      await core.changeServer(/^https?:\/\//.test(typed) ? typed : `http://${typed}`);
    } catch {
      toast(t.couldNot);
    }
  }

  const soon = (title: string) => router.push({ pathname: '/settings/soon', params: { title } });

  return (
    <Screen>
      {searching ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingTop: 10, paddingBottom: 4 }}>
          <IconButton icon="back" label={t.back} onPress={closeSearch} flip testID="settings-search-close" />
          <View style={{ flex: 1 }}>
            <Field value={query} onChangeText={setQuery} placeholder={t.search} icon="search" autoFocus autoCorrect={false} returnKeyType="search" testID="settings-search" />
          </View>
        </View>
      ) : (
        <TopBar title={t.settings} onBack={() => router.back()} right={<IconButton icon="search" label={t.search} onPress={() => setSearching(true)} testID="settings-search-open" />} />
      )}
      {searching && !!query.trim() ? (
        <SettingsResults query={query} onHere={closeSearch} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
          <View>
            <Pressy onPress={() => (setName(me?.name ?? ''), setAbout(me?.about ?? ''), setEditing(true))} label={t.editName} scale={0.98} testID="edit-me">
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginTop: 8, borderRadius: 24 }}>
                {/* The photo: tap it to change it, like WhatsApp. */}
                <Pressy onPress={() => setPhotoOpen(true)} label={t.profilePhoto} scale={0.94} testID="my-photo">
                  <Avatar id={myId} name={me?.name ?? ''} size={64} />
                  <CameraBadge />
                </Pressy>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={19} weight="800" lines={1} testID="my-name">
                    {me?.name}
                  </Txt>
                  <Txt size={13.5} color={theme.muted} lines={1}>
                    {me?.about || t.aboutHint}
                  </Txt>
                  <Txt size={12.5} color={theme.muted} lines={1}>
                    {me?.email ?? (me?.phone ? formatPhone(me.phone) : '')}
                  </Txt>
                </View>
                <IconButton icon="edit" label={t.editName} look="soft" size={40} iconSize={18} onPress={() => (setName(me?.name ?? ''), setAbout(me?.about ?? ''), setEditing(true))} />
              </Glass>
            </Pressy>
          </View>

          <Section title={t.appearance} />
          <Glass style={{ padding: 12, gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {modes.map((m) => (
                <ModeCard key={m.key} choice={m.key} label={m.label} on={mode === m.key} onPress={() => (tick(), setPrefs({ mode: m.key }))} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Txt size={14} weight="600">
                  {t.accentColour}
                </Txt>
              </View>
              {ACCENTS.map((a) => {
                const on = accent === a;
                return (
                  <Pressy key={a} onPress={() => (tick(), setPrefs({ accent: a }))} label={a} scale={0.85} testID={`accent-${a}`}>
                    <View style={{ width: 36, height: 36, borderRadius: 14, borderWidth: 2.5, borderColor: on ? theme.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      <LinearGradient
                        colors={accentGradient(a)}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
                      >
                        {on && (
                          <Animated.View entering={pop()}>
                            <Icon name="check" size={15} color="#FFFFFF" stroke={3} />
                          </Animated.View>
                        )}
                      </LinearGradient>
                    </View>
                  </Pressy>
                );
              })}
            </View>
          </Glass>

          <Section title={t.chatsWord} />
          <Glass>
            <SettingRow icon="wallpaper" title={t.wallpaper} sub={t.allChats} onPress={() => router.push('/wallpaper')} testID="open-wallpaper" />
            <Divider />
            <SettingRow
              icon="link"
              title={t.linkPreviews}
              sub={t.linkPreviewsSub}
              chevron={false}
              right={<Toggle on={settings.linkPreviews} onChange={(on) => core.setSettings({ linkPreviews: on })} label={t.linkPreviews} testID="link-previews" />}
            />
            <Divider />
            <SettingRow
              icon="archive"
              title={t.keepArchived}
              sub={t.keepArchivedSub}
              chevron={false}
              right={<Toggle on={settings.keepArchived} onChange={(on) => core.setSettings({ keepArchived: on })} label={t.keepArchived} testID="keep-archived" />}
            />
            <Divider />
            <SettingRow icon="archive" title={t.archiveAll} onPress={() => setArchivingAll(true)} chevron={false} testID="archive-all" />
          </Glass>

          <Section title={t.settings} />
          <Glass>
            <SettingRow
              icon="key"
              title={t.signInWays}
              sub={[me?.email, me?.phone && formatPhone(me.phone)].filter(Boolean).join(' · ')}
              onPress={() => router.push('/settings/account')}
              testID="open-account"
            />
            <Divider />
            <SettingRow icon="lock" title={t.privacy} sub={t.privacySub} onPress={() => router.push('/settings/privacy')} testID="open-privacy" />
            <Divider />
            <SettingRow icon="globe" title={t.language} sub={t.languageSub} onPress={() => router.push('/settings/language')} testID="open-language" />
            <Divider />
            <SettingRow icon="fingerprint" title={t.appLock} sub={settings.appLock ? t.onWord : t.appLockSub} onPress={() => router.push('/settings/lock')} testID="open-lock" />
            <Divider />
            <SettingRow icon="bell" title={t.notifications} onPress={() => router.push('/settings/notifications')} testID="open-notifications" />
            <Divider />
            <SettingRow icon="database" title={t.storage} sub={t.storageSub} onPress={() => router.push('/settings/storage')} testID="open-storage" />
            <Divider />
            <SettingRow icon="archive" title={t.backup} onPress={() => router.push('/settings/backup')} testID="open-backup" />
            <Divider />
            <SettingRow icon="link" title={t.linked} onPress={() => soon(t.linked)} />
            <Divider />
            {/* Where the server is. Change it here when the Mac's Wi-Fi address changes (no need to log out). */}
            <SettingRow icon="server" title={t.serverAddress} sub={serverUrl().replace(/^https?:\/\//, '')} onPress={() => setServer(serverUrl())} testID="open-server" />
          </Glass>

          <Glass style={{ marginTop: 14 }}>
            <SettingRow icon="logout" title={t.logOut} danger chevron={false} onPress={() => setLeaving(true)} testID="log-out" />
          </Glass>
        </ScrollView>
      )}

      <Sheet visible={editing} onClose={() => setEditing(false)} title={t.editName}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Field value={name} onChangeText={setName} placeholder={t.yourName} maxLength={25} testID="me-name" />
          <Field value={about} onChangeText={setAbout} placeholder={t.about} maxLength={140} testID="me-about" />
          <Button title={t.save} onPress={save} disabled={!name.trim()} testID="me-save" />
        </View>
      </Sheet>

      <Sheet visible={server !== null} onClose={() => setServer(null)} title={t.serverAddress}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Txt size={13} color={theme.muted}>
            {t.serverAddressHint}
          </Txt>
          <Field
            value={server ?? ''}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.10:4000"
            icon="server"
            onSubmitEditing={saveServer}
            testID="me-server"
          />
          <Button title={t.save} onPress={saveServer} disabled={!(server ?? '').trim()} testID="me-server-save" />
        </View>
      </Sheet>

      <PhotoSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} has={!!me?.photo} />
      <Dialog
        visible={archivingAll}
        onClose={() => setArchivingAll(false)}
        title={t.archiveAllSure}
        text={t.archiveAllNote}
        buttons={[
          {
            label: t.archive,
            testID: 'confirm-archive-all',
            onPress: () => {
              setArchivingAll(false);
              (rows ?? []).filter((r) => !r.prefs.archived).forEach((r) => core.setPrefs(r.chat.id, { archived: true, pinnedAt: undefined }));
              toast(t.archivedNote);
            },
          },
          { label: t.cancel, onPress: () => setArchivingAll(false) },
        ]}
      />
      <Dialog
        visible={leaving}
        onClose={() => setLeaving(false)}
        title={t.logOut}
        text={t.logOutSure}
        buttons={[
          {
            label: t.logOut,
            danger: true,
            testID: 'confirm-log-out',
            onPress: () => {
              setLeaving(false);
              void core.signOut();
            },
          },
          { label: t.cancel, onPress: () => setLeaving(false) },
        ]}
      />
    </Screen>
  );
}

/** A small picture of the look: its background, a white or dark card, and two bubbles. */
function ModeCard({ choice, label, on, onPress }: { choice: ModeChoice; label: string; on: boolean; onPress: () => void }) {
  const { theme, accent } = useLook();
  const preview = (m: 'sky' | 'graphite') => {
    const p = makeTheme(m, accent);
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: 6, gap: 4, justifyContent: 'flex-end' }}>
        <View style={{ width: '70%', height: 10, borderRadius: 5, backgroundColor: p.bubbleIn }} />
        <View style={{ width: '60%', height: 10, borderRadius: 5, backgroundColor: p.bubbleMine[1], alignSelf: 'flex-end' }} />
      </View>
    );
  };
  return (
    <View style={{ flex: 1 }}>
      <Pressy onPress={onPress} label={label} scale={0.95} testID={`mode-${choice}`}>
        <View style={{ borderRadius: 16, padding: 5, gap: 6, alignItems: 'center', borderWidth: 2, borderColor: on ? theme.acc : theme.glassLine, backgroundColor: theme.glass }}>
          <View style={{ height: 58, alignSelf: 'stretch', borderRadius: 11, overflow: 'hidden', flexDirection: 'row' }}>
            {choice === 'auto' ? (
              <>
                {preview('sky')}
                {preview('graphite')}
              </>
            ) : (
              preview(choice)
            )}
          </View>
          <Txt size={12.5} weight="700" color={on ? theme.accInk : theme.text} align="center">
            {label}
          </Txt>
        </View>
      </Pressy>
    </View>
  );
}
