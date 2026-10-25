// settings/storage.tsx: which files download by themselves, on mobile data and on
// Wi-Fi (like WhatsApp's "Media auto-download"). Others wait for a tap. And
// "Use less data for calls", as in WhatsApp's Storage and data.
import type { FileKind } from '@pakchat/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { calls } from '../../core/calls';
import { core } from '../../core/core';
import { autoDownload, loadLimits, setAutoDownload, type AutoDownload } from '../../core/files';
import { useSettings } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Divider, Glass, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';

export default function Storage() {
  const t = useT();
  const { theme } = useLook();
  const [auto, setAuto] = useState<AutoDownload>(autoDownload);
  const [limit, setLimit] = useState<number | null>(null);
  const settings = useSettings();

  useEffect(() => {
    void loadLimits().then(setLimit);
  }, []);

  const kinds: { kind: FileKind; label: string; icon: 'photo' | 'music' | 'video' | 'doc' }[] = [
    { kind: 'image', label: t.photosWord, icon: 'photo' },
    { kind: 'audio', label: t.audioWord, icon: 'music' },
    { kind: 'video', label: t.videosWord, icon: 'video' },
    { kind: 'doc', label: t.docsWord, icon: 'doc' },
  ];

  function flip(net: keyof AutoDownload, kind: FileKind, on: boolean) {
    // Voice notes go with audio.
    const both: FileKind[] = kind === 'audio' ? ['audio', 'voice'] : [kind];
    const list = auto[net].filter((k) => !both.includes(k));
    const next = { ...auto, [net]: on ? [...list, ...both] : list };
    setAuto(next);
    setAutoDownload(next);
  }

  return (
    <Screen>
      <TopBar title={t.storage} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <Glass style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}>
          <Icon name="download" size={22} color={theme.accInk} />
          <View style={{ flex: 1 }}>
            <Txt size={14} color={theme.sectionText}>
              {t.storageNote}
            </Txt>
            {limit !== null && (
              <Txt size={13} color={theme.muted} style={{ marginTop: 4 }}>
                {fill(t.fileTooBig, { mb: Math.floor(limit / 1024 / 1024) })}
              </Txt>
            )}
          </View>
        </Glass>
        {(['mobile', 'wifi'] as const).map((net) => (
          <View key={net}>
            <Section title={net === 'mobile' ? t.onMobileData : t.onWifi} />
            <Glass>
              {kinds.map((k, i) => (
                <View key={k.kind}>
                  {i > 0 && <Divider />}
                  <SettingRow
                    icon={k.icon}
                    title={k.label}
                    chevron={false}
                    right={<Toggle on={auto[net].includes(k.kind)} onChange={(on) => flip(net, k.kind, on)} label={k.label} testID={`auto-${net}-${k.kind}`} />}
                  />
                </View>
              ))}
            </Glass>
          </View>
        ))}
        <Section title={t.calls} />
        <Glass>
          <SettingRow
            icon="calls"
            title={t.lessDataCalls}
            sub={t.lessDataCallsSub}
            chevron={false}
            right={
              <Toggle
                on={!!settings.lessDataCalls}
                onChange={(on) => {
                  core.setSettings({ lessDataCalls: on });
                  calls.dataSaverChanged();
                }}
                label={t.lessDataCalls}
                testID="less-data-calls"
              />
            }
          />
        </Glass>
      </ScrollView>
    </Screen>
  );
}
