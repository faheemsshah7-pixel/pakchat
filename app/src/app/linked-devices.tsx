// linked-devices.tsx: Linked devices, like WhatsApp's. "Link a device" opens
// the scanner for the QR code on the PakChat website; tap a device to log it out.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { isOffline } from '../core/core';
import { useLinkedDevices } from '../core/hooks';
import { logOutDevice } from '../core/linking';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { clock, dayLabel } from '../ui/format';
import { Icon } from '../ui/icons';
import { Button, Divider, Glass, Screen, Section, SettingRow, TopBar, Txt } from '../ui/kit';
import { Dialog, toast } from '../ui/overlays';

export default function LinkedDevices() {
  const t = useT();
  const { theme } = useLook();
  const { list, syncing } = useLinkedDevices();
  const [leaving, setLeaving] = useState<{ deviceId: number; name: string } | null>(null);
  // The phone itself is device 1; the rest are linked.
  const linked = (list ?? []).filter((d) => d.deviceId !== 1);
  const when = (ms: number) => {
    const day = dayLabel(ms, t);
    return day === t.today ? day.toLowerCase() : day;
  };
  // Like WhatsApp's: "Active now", or "Last active today at 9:41".
  const status = (d: (typeof linked)[number]) =>
    syncing.has(d.deviceId)
      ? t.syncingChats
      : d.online
        ? t.activeNow
        : d.lastActive
          ? fill(t.lastActive, { when: fill(t.dayAtTime, { day: when(d.lastActive), time: clock(d.lastActive) }) })
          : fill(t.linkedOn, { when: when(d.linkedAt) });

  return (
    <Screen>
      <TopBar title={t.linkedDevices} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
        <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22, gap: 10 }}>
          <View style={{ width: 96, height: 96, borderRadius: 32, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="laptop" size={48} color={theme.accInk} stroke={1.5} />
          </View>
          <Txt size={19} weight="700" align="center">
            {t.linkedHero}
          </Txt>
          <Txt size={14} color={theme.muted} align="center">
            {t.linkedHeroNote}
          </Txt>
        </View>
        <Button
          title={t.linkADevice}
          onPress={() => (linked.length >= 4 ? toast(t.tooManyDevices) : router.push('/link-device'))}
          testID="link-a-device"
        />

        {list !== null && linked.length === 0 && (
          <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 22 }}>
            {t.noLinkedDevices}
          </Txt>
        )}
        {linked.length > 0 && (
          <>
            <Section title={t.deviceStatus} />
            <Txt size={13} color={theme.muted} style={{ marginHorizontal: 22, marginTop: -4, marginBottom: 8 }}>
              {t.tapToLogOut}
            </Txt>
            <Glass style={{ borderRadius: 22, overflow: 'hidden' }}>
              {linked.map((d, i) => (
                <View key={d.deviceId}>
                  {i > 0 && <Divider />}
                  <SettingRow
                    icon="laptop"
                    title={d.name}
                    sub={status(d)}
                    onPress={() => setLeaving({ deviceId: d.deviceId, name: d.name })}
                    chevron={false}
                    testID={`linked-${d.deviceId}`}
                  />
                </View>
              ))}
            </Glass>
          </>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 22, paddingHorizontal: 24 }}>
          <Icon name="lock" size={14} color={theme.muted} />
          <Txt size={12.5} color={theme.muted} align="center">
            {t.encryptedAllDevices}
          </Txt>
        </View>
      </ScrollView>

      <Dialog
        visible={!!leaving}
        onClose={() => setLeaving(null)}
        title={leaving ? fill(t.logOutDevice, { name: leaving.name }) : ''}
        text={leaving ? fill(t.logOutDeviceNote, { name: leaving.name }) : ''}
        buttons={[
          { label: t.cancel, onPress: () => setLeaving(null) },
          {
            label: t.logOut,
            danger: true,
            testID: 'confirm-log-out-device',
            onPress: () => {
              const d = leaving;
              setLeaving(null);
              if (d) void logOutDevice(d.deviceId).then(() => toast(t.loggedOutDevice), (err: unknown) => toast(isOffline(err) ? t.offline : t.couldNot));
            },
          },
        ]}
      />
    </Screen>
  );
}
