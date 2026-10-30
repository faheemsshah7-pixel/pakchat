// link-device.tsx: the scanner for the QR code on the PakChat website. Once
// it's linked, the phone copies its chats over in the background (linking.ts).
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { isOffline } from '../core/core';
import { linkFromQr, LinkRefused } from '../core/linking';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Screen, TopBar, Txt } from '../ui/kit';
import { thud } from '../ui/motion';
import { toast } from '../ui/overlays';
import { QrScan } from '../ui/QrScan';

export default function LinkDevice() {
  const t = useT();
  const { theme } = useLook();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  async function link(text: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    thud();
    try {
      const { name } = await linkFromQr(text);
      toast(fill(t.deviceLinked, { name }), undefined, 4000);
      router.back();
    } catch (err) {
      const why = err instanceof LinkRefused ? err.reason : null;
      toast(
        why === 'not_a_qr'
          ? t.notALinkCode
          : why === 'expired'
            ? t.linkCodeExpired
            : why === 'mismatch'
              ? t.linkCodeMismatch
              : why === 'too_many_devices'
                ? t.tooManyDevices
                : isOffline(err)
                  ? t.offline
                  : t.couldNot,
        undefined,
        4000,
      );
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={t.linkADevice} onBack={() => router.back()} />
      {busy ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <ActivityIndicator color={theme.acc} size="large" />
          <Txt size={15} color={theme.muted}>
            {t.linkingDevice}
          </Txt>
        </View>
      ) : (
        <QrScan note={t.scanLinkNote} onCode={(text) => void link(text)} />
      )}
    </Screen>
  );
}
