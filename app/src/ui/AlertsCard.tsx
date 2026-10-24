// AlertsCard.tsx: settings the phone needs before calls and messages come like
// WhatsApp's, shown on the chat list until you've done them:
//   - "Show calls on the lock screen": Android 14 and newer can stop an app
//     opening full screen, and then a call to a locked phone shows only as an
//     alert, not its answer screen (IncomingCallActivity.kt).
//   - "Turn on alerts": Realme, Oppo, Xiaomi, Vivo and others stop apps in the
//     background (see Autostart.kt), so nothing comes while PakChat is closed.
//     WhatsApp is allowed by the phone maker, so it never needs to ask.
import KV from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { fileModule } from '../../modules/pakchat-signal';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon, type IconName } from './icons';
import { Button, Glass, Txt } from './kit';
import { toast } from './overlays';

const DONE = 'alerts:autostartDone';

type Need = { kind: 'fullScreen' } | { kind: 'autostart'; brand: string };

/** What the phone still needs (null when nothing). */
function need(): Need | null {
  if (Platform.OS !== 'android') return null;
  try {
    const fm = fileModule();
    if (!fm.callFullScreenAllowed()) return { kind: 'fullScreen' };
    if (KV.getItemSync(DONE)) return null;
    const b = fm.autostartBrand();
    return b ? { kind: 'autostart', brand: b.charAt(0).toUpperCase() + b.slice(1) } : null;
  } catch {
    return null;
  }
}

export function AlertsCard() {
  const t = useT();
  const { theme } = useLook();
  const [now, setNow] = useState(need);
  // Back from the settings page: check again (full screen goes once it's allowed).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setNow(need()));
    return () => sub.remove();
  }, []);
  if (!now) return null;
  const full = now.kind === 'fullScreen';
  const icon: IconName = full ? 'calls' : 'bell';
  return (
    <Glass style={{ marginHorizontal: 10, marginTop: 6, marginBottom: 8, padding: 14, gap: 10 }} testID="alerts-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} size={20} color={theme.accInk} />
        <Txt size={15.5} weight="700">
          {full ? t.fullScreenCardTitle : t.alertsCardTitle}
        </Txt>
      </View>
      <Txt size={13.5} color={theme.muted}>
        {now.kind === 'fullScreen' ? t.fullScreenCardText : fill(t.alertsCardText, { brand: now.brand })}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title={t.openSettings}
          style={{ flex: 1 }}
          onPress={() => {
            if (full) fileModule().callOpenFullScreenSettings();
            else if (!fileModule().openAutostart()) toast(t.couldNot);
          }}
          testID="alerts-open"
        />
        {!full && (
          <Button
            title={t.alertsCardDone}
            look="soft"
            style={{ flex: 1 }}
            onPress={() => {
              KV.setItemSync(DONE, '1');
              setNow(need());
            }}
            testID="alerts-done"
          />
        )}
      </View>
    </Glass>
  );
}
