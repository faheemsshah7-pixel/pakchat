// settings/chats.tsx: Settings › Chats, like WhatsApp's. Theme (Sky, Graphite or
// Auto, which follows the phone, and one of six accent colours: the whole app
// changes at once, and remembers it), wallpaper, link previews, archived chats
// and chat backup.
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../../core/core';
import { useChatList, useSettings } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { ACCENTS, accentGradient, makeTheme, type ModeChoice } from '../../theme/palette';
import { Icon } from '../../ui/icons';
import { Divider, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { pop, tick } from '../../ui/motion';
import { Dialog, toast } from '../../ui/overlays';

export default function ChatsSettings() {
  const t = useT();
  const { theme, mode, accent, setPrefs } = useLook();
  const settings = useSettings();
  const rows = useChatList();
  const [archivingAll, setArchivingAll] = useState(false);

  const modes: { key: ModeChoice; label: string }[] = [
    { key: 'sky', label: t.sky },
    { key: 'graphite', label: t.graphite },
    { key: 'auto', label: t.auto },
  ];

  return (
    <Screen>
      <TopBar title={t.chatsWord} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Section title={t.themeWord} />
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

        <Section title={t.displayWord} />
        <Glass>
          <SettingRow icon="wallpaper" title={t.wallpaper} sub={t.allChats} onPress={() => router.push('/wallpaper')} testID="open-wallpaper" />
        </Glass>

        <Section title={t.chatSettingsWord} />
        <Glass>
          <SettingRow
            icon="link"
            title={t.linkPreviews}
            sub={t.linkPreviewsSub}
            chevron={false}
            right={<Toggle on={settings.linkPreviews} onChange={(on) => core.setSettings({ linkPreviews: on })} label={t.linkPreviews} testID="link-previews" />}
          />
        </Glass>

        <Section title={t.archivedChatsWord} />
        <Glass>
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

        <Glass style={{ marginTop: 14 }}>
          <SettingRow icon="upload" title={t.backup} onPress={() => router.push('/settings/backup')} testID="open-backup" />
        </Glass>
      </ScrollView>

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
