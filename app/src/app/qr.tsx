// qr.tsx: QR code, like WhatsApp's. Two tabs:
//
//   My code   my picture, name and a code that opens a chat with me. Share sends it as a link.
//   Scan code the camera; point it at someone's code (or pick a photo of one) and our chat opens.
//
// Opened with `user` (a code scanned by the phone's own camera, see +native-intent.tsx),
// it goes straight to that chat.
import * as ImagePicker from 'expo-image-picker';
import { CameraView, scanFromURLAsync } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Share, View } from 'react-native';

import { core, isOffline } from '../core/core';
import { useAuth, usePerson } from '../core/hooks';
import { outsideFor } from '../core/lock';
import { qrLink, userFromQr } from '../core/qr';
import { defaultTimer } from '../core/timer';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Button, Chip, Glass, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { thud } from '../ui/motion';
import { QrCode } from '../ui/QrCode';
import { toast } from '../ui/overlays';

export default function Qr() {
  const t = useT();
  const { user, tab: firstTab } = useLocalSearchParams<{ user?: string; tab?: string }>();
  const [tab, setTab] = useState<'mine' | 'scan'>(firstTab === 'scan' ? 'scan' : 'mine');
  const opening = useRef(false);

  async function openWith(userId: string) {
    if (opening.current) return;
    if (userId === core.myId) {
      toast(t.thatsYourCode);
      return;
    }
    opening.current = true;
    try {
      const chat = await core.client.openDirect(userId, defaultTimer());
      router.replace({ pathname: '/chat/[id]', params: { id: chat.id } });
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.notValidCode);
      opening.current = false;
    }
  }

  // A code the phone's own camera scanned: straight to the chat.
  useEffect(() => {
    if (user) setTimeout(() => void openWith(user), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <Screen>
      <TopBar title={t.qrCode} onBack={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        <Chip label={t.myCode} on={tab === 'mine'} onPress={() => setTab('mine')} testID="qr-tab-mine" />
        <Chip label={t.scanCode} on={tab === 'scan'} onPress={() => setTab('scan')} testID="qr-tab-scan" />
      </View>
      {user ? (
        <ActivityIndicator style={{ marginTop: 60 }} />
      ) : tab === 'mine' ? (
        <MyCode />
      ) : (
        <Scan
          onCode={(text) => {
            const id = userFromQr(text);
            if (id) {
              thud();
              void openWith(id);
            } else toast(t.notValidCode);
          }}
        />
      )}
    </Screen>
  );
}

function MyCode() {
  const t = useT();
  const { theme } = useLook();
  const { myId } = useAuth();
  const me = usePerson(myId);
  const name = me?.name ?? '';
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, gap: 18 }}>
      <Glass style={{ alignItems: 'center', padding: 22, paddingTop: 48, borderRadius: 28, alignSelf: 'stretch', marginTop: 34 }}>
        <View style={{ position: 'absolute', top: -34 }}>
          <Avatar id={myId} name={name} size={68} />
        </View>
        <Txt size={19} weight="700" align="center" lines={1}>
          {name}
        </Txt>
        <Txt size={13} color={theme.muted} align="center" style={{ marginBottom: 16 }}>
          {t.pakchatContact}
        </Txt>
        <QrCode text={qrLink(myId)} size={230} color={theme.dark ? '#0B141A' : '#111B21'} />
      </Glass>
      <Txt size={13.5} color={theme.muted} align="center">
        {t.myCodeNote}
      </Txt>
      <Button
        title={t.share}
        icon="export"
        look="soft"
        onPress={() => void outsideFor(() => Share.share({ message: fill(t.myCodeShare, { name, link: qrLink(myId) }) })).catch(() => {})}
        testID="qr-share"
      />
    </View>
  );
}

function Scan({ onCode }: { onCode: (text: string) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [ok, setOk] = useState<boolean | null>(null);
  const last = useRef({ text: '', at: 0 });

  useEffect(() => {
    void (async () => {
      const now = await ImagePicker.getCameraPermissionsAsync();
      const granted = now.granted || (await outsideFor(() => ImagePicker.requestCameraPermissionsAsync())).granted;
      setOk(granted);
    })();
  }, []);

  // The same code is seen many times a second: act on it once every few seconds.
  const seen = (text: string) => {
    const now = Date.now();
    if (text === last.current.text && now - last.current.at < 3_000) return;
    last.current = { text, at: now };
    onCode(text);
  };

  async function fromPhoto() {
    const r = await outsideFor(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
    const uri = r.canceled ? null : r.assets[0]?.uri;
    if (!uri) return;
    const found = await scanFromURLAsync(uri, ['qr']).catch(() => []);
    if (found[0]) onCode(found[0].data);
    else toast(t.noCodeInPhoto);
  }

  if (ok === false)
    return (
      <View style={{ padding: 24, gap: 14, alignItems: 'center' }}>
        <Txt size={15} color={theme.muted} align="center">
          {t.cameraNeeded}
        </Txt>
        <Button title={t.openSettings} look="soft" onPress={() => void Linking.openSettings().catch(() => {})} />
      </View>
    );
  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 24, gap: 14 }}>
      <View style={{ flex: 1, borderRadius: 28, overflow: 'hidden', backgroundColor: '#000' }}>
        {ok && <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => seen(r.data)} testID="qr-camera" />}
        {/* The square to aim with. */}
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 230, height: 230, borderRadius: 26, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
        </View>
      </View>
      <Txt size={13.5} color={theme.muted} align="center">
        {t.scanNote}
      </Txt>
      <Pressy onPress={() => void fromPhoto()} label={t.scanFromPhoto} scale={0.97} testID="qr-from-photo">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 }}>
          <Icon name="photo" size={20} color={theme.accInk} />
          <Txt size={15} weight="600" color={theme.accInk}>
            {t.scanFromPhoto}
          </Txt>
        </View>
      </Pressy>
    </View>
  );
}
