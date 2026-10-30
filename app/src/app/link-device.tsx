// link-device.tsx: the scanner for the QR code on the PakChat website, or
// (Link with phone number instead) the 8-letter code it shows. Once it's
// linked, the phone copies its chats over in the background (linking.ts).
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { isOffline } from '../core/core';
import { linkFromCode, linkFromQr, LinkRefused } from '../core/linking';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Button, Field, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { thud } from '../ui/motion';
import { toast } from '../ui/overlays';
import { QrScan } from '../ui/QrScan';

export default function LinkDevice() {
  const t = useT();
  const { theme } = useLook();
  const [busy, setBusy] = useState(false);
  const [byCode, setByCode] = useState(false);
  const [code, setCode] = useState('');
  const working = useRef(false);
  // The scanner starts again after a failure and sees the same QR at once: wait a few seconds first.
  const failed = useRef({ text: '', at: 0 });

  async function link(text: string, how: 'qr' | 'code' = 'qr') {
    if (working.current) return;
    if (how === 'qr' && text === failed.current.text && Date.now() - failed.current.at < 5_000) return;
    working.current = true;
    setBusy(true);
    thud();
    try {
      const { name } = await (how === 'code' ? linkFromCode(text) : linkFromQr(text));
      toast(fill(t.deviceLinked, { name }), undefined, 4000);
      router.back();
    } catch (err) {
      console.log(`[pakchat] link: ${String(err)}`);
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
                : why === 'wrong_code'
                  ? t.wrongLinkCode
                  : why === 'no_phone'
                    ? t.noPhoneForLink
                : isOffline(err)
                  ? t.offline
                  : t.couldNot,
        undefined,
        4000,
      );
      failed.current = { text, at: Date.now() };
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
      ) : byCode ? (
        <View style={{ padding: 24, gap: 18 }}>
          <Txt size={20} weight="600">
            {t.enterLinkCode}
          </Txt>
          <Txt size={15} color={theme.muted}>
            {t.enterLinkCodeNote}
          </Txt>
          <Field
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={9}
            onSubmitEditing={() => void link(code, 'code')}
            testID="link-code-field"
          />
          <Button title={t.linkWord} disabled={code.replace(/[\s-]/g, '').length !== 8} onPress={() => void link(code, 'code')} testID="link-code-go" />
          <Pressy onPress={() => setByCode(false)} style={{ alignSelf: 'center', padding: 8 }}>
            <Txt size={15} color={theme.accInk} weight="600">
              {t.linkWithQr}
            </Txt>
          </Pressy>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <QrScan note={t.scanLinkNote} onCode={(text) => void link(text)} />
          <Pressy onPress={() => setByCode(true)} style={{ alignSelf: 'center', padding: 12, marginBottom: 12 }} testID="link-with-phone">
            <Txt size={15} color={theme.accInk} weight="600">
              {t.linkWithPhone}
            </Txt>
          </Pressy>
        </View>
      )}
    </Screen>
  );
}
