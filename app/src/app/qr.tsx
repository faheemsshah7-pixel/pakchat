// qr.tsx: QR code, like WhatsApp's. Two tabs:
//
//   My code   my picture, name and a code that opens a chat with me. Share sends it as a link.
//   Scan code the camera; point it at someone's code (or pick a photo of one) and our chat opens.
//
// Opened with `user` (a code scanned by the phone's own camera, see +native-intent.tsx),
// it goes straight to that chat.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Share, View } from 'react-native';

import { core, isOffline } from '../core/core';
import { useAuth, usePerson } from '../core/hooks';
import { outsideFor } from '../core/lock';
import { qrLink, userFromQr } from '../core/qr';
import { defaultTimer } from '../core/timer';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Avatar, Button, Chip, Glass, Screen, TopBar, Txt } from '../ui/kit';
import { thud } from '../ui/motion';
import { QrCode } from '../ui/QrCode';
import { QrScan } from '../ui/QrScan';
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
        <QrScan
          note={t.scanNote}
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
