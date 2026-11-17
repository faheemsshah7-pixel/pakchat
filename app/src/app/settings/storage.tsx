// settings/storage.tsx: which files download by themselves, on mobile data and on
// Wi-Fi (like WhatsApp's "Media auto-download"). Others wait for a tap. And
// "Use less data for calls" and "Media upload quality", as in WhatsApp's Storage and data.
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
import { Divider, Glass, Pressy, Screen, Section, SettingRow, Toggle, TopBar, Txt } from '../../ui/kit';
import { Sheet } from '../../ui/overlays';

export default function Storage() {
  const t = useT();
  const { theme } = useLook();
  const [auto, setAuto] = useState<AutoDownload>(autoDownload);
  const [limit, setLimit] = useState<number | null>(null);
  const settings = useSettings();
  const [quality, setQuality] = useState(false);

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
        <Glass style={{ marginBottom: 12 }}>
          <SettingRow icon="folder" title={t.manageStorage} sub={t.manageStorageSub} onPress={() => router.push('/settings/manage-storage')} testID="manage-storage" />
        </Glass>
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
        <Section title={t.mediaQuality} />
        <Glass>
          <SettingRow icon="photo" title={t.mediaQuality} sub={settings.uploadHd ? t.hdQuality : t.standardQuality} onPress={() => setQuality(true)} testID="upload-quality" />
        </Glass>
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

      {/* Media upload quality, like WhatsApp's: Standard (smaller, quicker) or HD. */}
      <Sheet visible={quality} onClose={() => setQuality(false)} title={t.mediaQuality}>
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          {(
            [
              [false, t.standardQuality, t.hdOffNote],
              [true, t.hdQuality, t.hdOnNote],
            ] as const
          ).map(([on, label, note]) => {
            const picked = !!settings.uploadHd === on;
            return (
              <Pressy key={label} label={label} scale={0.98} onPress={() => (setQuality(false), core.setSettings({ uploadHd: on }))} testID={on ? 'upload-hd' : 'upload-standard'}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, backgroundColor: picked ? theme.accSoft : 'transparent' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={15.5} weight={picked ? '700' : '500'} color={picked ? theme.accInk : theme.text}>
                      {label}
                    </Txt>
                    <Txt size={13} color={theme.muted}>
                      {note}
                    </Txt>
                  </View>
                  {picked && <Icon name="check" size={20} color={theme.accInk} stroke={2.4} />}
                </View>
              </Pressy>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}
