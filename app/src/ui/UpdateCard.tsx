// UpdateCard.tsx: "Update PakChat" on the chat list, only in the APK people
// download from our website. A downloaded APK doesn't update itself, so this
// checks the website for a newer one and opens its download in the browser,
// which installs it over this one (same signing key, so chats stay).
// Google Play doesn't allow an app to update itself outside Play, so a copy
// installed from Play never checks, nor does a build made for Play
// (PAKCHAT_CHANNEL=play, see app.config.js). Removed for good once PakChat is public.
import Constants from 'expo-constants';
import KV from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';

import { fileModule } from '../../modules/pakchat-signal';
import { serverUrl } from '../core/core';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Button, Glass, Txt } from './kit';

const PLAY = 'com.android.vending';
const LATER = 'update:laterUntil';
const DAY = 86_400_000;

type Newer = { versionCode: number; versionName: string; url: string };

/** Whether this copy may look for updates on the website at all. */
function websiteCopy(): number | null {
  if (Platform.OS !== 'android') return null;
  if ((Constants.expoConfig?.extra as { channel?: string } | undefined)?.channel !== 'website') return null;
  try {
    const me = fileModule().appInstall();
    return me.installer === PLAY ? null : me.versionCode;
  } catch {
    return null;
  }
}

/** The website's newest APK, when it's newer than this one. */
async function newer(mine: number): Promise<Newer | null> {
  const base = serverUrl();
  const res = await fetch(`${base}/pakchat-apk.json`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as { versionCode?: unknown; versionName?: unknown };
  if (typeof j.versionCode !== 'number' || j.versionCode <= mine) return null;
  return { versionCode: j.versionCode, versionName: typeof j.versionName === 'string' ? j.versionName : '', url: `${base}/pakchat.apk` };
}

export function UpdateCard() {
  const t = useT();
  const { theme } = useLook();
  const [found, setFound] = useState<Newer | null>(null);

  // On opening PakChat, and on coming back to it.
  useEffect(() => {
    const mine = websiteCopy();
    if (mine === null) return;
    const check = () => {
      if (Number(KV.getItemSync(LATER) ?? 0) > Date.now()) return;
      void newer(mine)
        .then(setFound)
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  if (!found) return null;
  return (
    <Glass style={{ marginHorizontal: 10, marginTop: 6, marginBottom: 8, padding: 14, gap: 10 }} testID="update-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="download" size={20} color={theme.accInk} />
        <Txt size={15.5} weight="700">
          {t.updateCardTitle}
        </Txt>
      </View>
      <Txt size={13.5} color={theme.muted}>
        {fill(t.updateCardText, { version: found.versionName || String(found.versionCode) })}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t.updateNow} style={{ flex: 1 }} onPress={() => void Linking.openURL(found.url)} testID="update-now" />
        <Button
          title={t.updateLater}
          look="soft"
          style={{ flex: 1 }}
          onPress={() => {
            KV.setItemSync(LATER, String(Date.now() + DAY));
            setFound(null);
          }}
          testID="update-later"
        />
      </View>
    </Glass>
  );
}
