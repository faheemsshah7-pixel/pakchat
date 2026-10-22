// (tabs)/you.tsx: you, the look of the app, and Settings.
//
// Pick Sky, Graphite or Auto (follows the phone) and one of six accent
// colours: the whole app changes at once, and remembers it.
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core, serverUrl } from '../../core/core';
import { useAuth } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { ACCENTS, accentGradient, makeTheme, type ModeChoice } from '../../theme/palette';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Divider, Field, Glass, IconButton, Pressy, Screen, Section, SettingRow, Txt } from '../../ui/kit';
import { pop, rise, tick } from '../../ui/motion';
import { Dialog, Sheet, toast } from '../../ui/overlays';

export default function You() {
  const t = useT();
  const { theme, mode, accent, setPrefs } = useLook();
  const { me, myId } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [server, setServer] = useState<string | null>(null);

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
    <Screen bottom={false}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Animated.View entering={rise()}>
          <Pressy onPress={() => (setName(me?.name ?? ''), setAbout(me?.about ?? ''), setEditing(true))} label={t.editName} scale={0.98} testID="edit-me">
            <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginTop: 8, borderRadius: 24 }}>
              <Avatar id={myId} name={me?.name ?? ''} size={64} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={19} weight="800" lines={1} testID="my-name">
                  {me?.name}
                </Txt>
                <Txt size={13.5} color={theme.muted} lines={1}>
                  {me?.about || t.aboutHint}
                </Txt>
                <Txt size={12.5} color={theme.muted} lines={1}>
                  {me?.email}
                </Txt>
              </View>
              <IconButton icon="edit" label={t.editName} look="soft" size={40} iconSize={18} onPress={() => (setName(me?.name ?? ''), setAbout(me?.about ?? ''), setEditing(true))} />
            </Glass>
          </Pressy>
        </Animated.View>

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
                    <LinearGradient colors={accentGradient(a)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
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

        <Section title={t.settings} />
        <Glass>
          <SettingRow icon="lock" title={t.privacy} sub={t.privacySub} onPress={() => router.push('/settings/privacy')} testID="open-privacy" />
          <Divider />
          <SettingRow icon="globe" title={t.language} sub={t.languageSub} onPress={() => router.push('/settings/language')} testID="open-language" />
          <Divider />
          <SettingRow icon="key" title={t.appLock} sub={t.appLockSub} onPress={() => soon(t.appLock)} />
          <Divider />
          <SettingRow icon="bell" title={t.notifications} onPress={() => soon(t.notifications)} />
          <Divider />
          <SettingRow icon="database" title={t.storage} sub={t.storageSub} onPress={() => soon(t.storage)} />
          <Divider />
          <SettingRow icon="archive" title={t.backup} onPress={() => soon(t.backup)} />
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
