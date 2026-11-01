// verify/[id].tsx: the safety number for you and one person.
//
// Both phones work out the same 60 digits from your two identity keys. Read
// them to each other when you meet: if they match, nobody is in the middle.
// Or, like WhatsApp, one phone scans the QR code on the other's screen and
// PakChat compares them itself (owner's plan, Phase 8; added 31 Oct).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../../core/core';
import { usePerson } from '../../core/hooks';
import { outsideFor } from '../../core/lock';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Button, Glass, Screen, TopBar, Txt } from '../../ui/kit';
import { thud } from '../../ui/motion';
import { QrCode } from '../../ui/QrCode';
import { QrScan } from '../../ui/QrScan';
import { toast } from '../../ui/overlays';

/** What the QR code holds: the 60 digits, marked as PakChat's. */
const QR_PREFIX = 'pakchat-verify:';

export default function Verify() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const person = usePerson(id);
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** After a scan: whether the other phone's code matched this one. */
  const [matched, setMatched] = useState<boolean | null>(null);

  useEffect(() => {
    core.client
      .safetyNumber(id)
      .then(setCode)
      .catch(() => setFailed(true));
  }, [id]);

  const name = person?.name ?? '…';
  const groups = code ? (code.match(/.{1,5}/g) ?? []) : [];

  return (
    <Screen>
      <TopBar title={t.encryption} onBack={() => router.back()} />
      {/* Scrolls: with the QR code it's taller than a small phone. Hidden while scanning (the camera fills the screen). */}
      {!scanning && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, gap: 18, alignItems: 'center' }}>
          <View>
            <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield" size={40} color={theme.accInk} stroke={1.7} />
            </View>
          </View>
          <Txt size={20} weight="800" align="center">
            {fill(t.verifyTitle, { name })}
          </Txt>
          <Txt size={14.5} color={theme.muted} align="center">
            {fill(t.verifyNote, { name })}
          </Txt>
          <Glass style={{ alignSelf: 'stretch', padding: 18, borderRadius: 24, minHeight: 170, justifyContent: 'center' }} testID="safety-number">
            {code ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, direction: 'ltr' }}>
                {groups.map((g, i) => (
                  <Animated.View key={i} style={{ width: '25%', alignItems: 'center' }}>
                    <Txt size={20} weight="600" align="center" style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>
                      {g}
                    </Txt>
                  </Animated.View>
                ))}
              </View>
            ) : failed ? (
              <Txt size={14} color={theme.muted} align="center">
                {t.verifyOffline}
              </Txt>
            ) : (
              <ActivityIndicator color={theme.acc} />
            )}
          </Glass>
          {code && matched !== null && (
            <Txt size={14.5} weight="700" color={matched ? theme.accInk : theme.danger} align="center" testID={matched ? 'verify-match' : 'verify-no-match'}>
              {fill(matched ? t.verifyMatch : t.verifyNoMatch, { name })}
            </Txt>
          )}
          {code && (
            <>
              <QrCode text={QR_PREFIX + code} size={180} color={theme.dark ? '#0B141A' : '#111B21'} />
              <Txt size={13.5} color={theme.muted} align="center">
                {fill(t.verifyQrNote, { name })}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
                <Button title={t.scanCode} look="soft" icon="camera" onPress={() => setScanning(true)} style={{ flex: 1 }} testID="verify-scan" />
                <Button title={t.share} look="soft" icon="forward" onPress={() => void outsideFor(() => Share.share({ message: groups.join(' ') }))} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </ScrollView>
      )}
      {code && scanning && (
        <QrScan
          note={fill(t.verifyScanNote, { name })}
          onCode={(text) => {
            if (!text.startsWith(QR_PREFIX)) return toast(t.verifyNotCode);
            const same = text.slice(QR_PREFIX.length) === code;
            if (same) thud();
            setMatched(same);
            setScanning(false);
          }}
        />
      )}
    </Screen>
  );
}
