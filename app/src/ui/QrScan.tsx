// QrScan.tsx: the camera, looking for a QR code (or a photo of one). Used for
// people's codes (qr.tsx) and for linking the website (link-device.tsx).
import * as ImagePicker from 'expo-image-picker';
import { CameraView, scanFromURLAsync } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { outsideFor } from '../core/lock';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Button, Pressy, Txt } from './kit';
import { toast } from './overlays';

export function QrScan({ onCode, note }: { onCode: (text: string) => void; note: string }) {
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
        {note}
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
