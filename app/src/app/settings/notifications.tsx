// settings/notifications.tsx: whether PakChat can alert you when it's closed.
// The alert shows who wrote and what they said, unlocked on the phone itself.
// Also the tone for chats without their own, one for groups, and conversation
// tones (the little sounds while a chat is open) with how loud they are.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { useSettings } from '../../core/hooks';
import { core } from '../../core/core';
import { pushState, startPush, type PushState } from '../../core/push';
import { previewVolume } from '../../core/tones';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Divider, Glass, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { Slider } from '../../ui/Slider';
import { TonePicker, toneName } from '../../ui/TonePicker';

export default function NotificationsScreen() {
  const t = useT();
  const { theme } = useLook();
  const [state, setState] = useState<PushState>(pushState);
  const settings = useSettings();
  const [picking, setPicking] = useState<'messages' | 'groups' | null>(null);
  const [volume, setVolume] = useState<number | null>(null);

  useEffect(() => {
    void startPush().then(() => setState(pushState()));
  }, []);

  return (
    <Screen>
      <TopBar title={t.notifications} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        <Glass style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
          <Icon name="bell" size={22} color={theme.accInk} />
          <View style={{ flex: 1 }}>
            <Txt size={14} color={theme.sectionText}>
              {t.notificationsNote}
            </Txt>
          </View>
        </Glass>
        <Glass style={{ padding: 14, gap: 10 }}>
          <Txt size={15.5} weight="700" color={state === 'blocked' ? theme.danger : theme.text} testID="push-state">
            {state === 'on' ? t.notificationsOn : state === 'blocked' ? t.notificationsOff : t.notificationsUnavailable}
          </Txt>
          <Button title={t.openSettings} look="soft" onPress={() => void Linking.openSettings()} />
        </Glass>

        <Section title={t.messagesWord} />
        <Glass>
          <SettingRow icon="tone" title={t.notificationTone} sub={toneName(settings.defaultTone, t)} onPress={() => setPicking('messages')} testID="default-tone" />
          <Divider />
          <SettingRow
            icon="speaker"
            title={t.conversationTones}
            sub={t.conversationTonesSub}
            chevron={false}
            right={<Toggle on={settings.conversationTones} onChange={(on) => core.setSettings({ conversationTones: on })} label={t.conversationTones} testID="conversation-tones" />}
          />
          {settings.conversationTones && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 2 }}>
              <Txt size={13} weight="600" color={theme.sectionText}>
                {t.toneLoudness}
              </Txt>
              <Slider
                value={volume ?? settings.toneVolume}
                onChange={setVolume}
                onDone={(v) => {
                  core.setSettings({ toneVolume: Math.round(v * 100) / 100 });
                  setVolume(null);
                  previewVolume(v);
                }}
                label={t.toneLoudness}
                testID="tone-volume"
              />
            </View>
          )}
        </Glass>

        <Section title={t.groups} />
        <Glass>
          <SettingRow icon="group" title={t.notificationTone} sub={toneName(settings.groupTone ?? settings.defaultTone, t)} onPress={() => setPicking('groups')} testID="group-tone" />
        </Glass>
      </ScrollView>
      <TonePicker
        visible={picking !== null}
        value={picking === 'groups' ? (settings.groupTone ?? settings.defaultTone) : settings.defaultTone}
        forChat={false}
        onPick={(tone) => core.setSettings(picking === 'groups' ? { groupTone: tone ?? '' } : { defaultTone: tone ?? '' })}
        onClose={() => setPicking(null)}
      />
    </Screen>
  );
}
