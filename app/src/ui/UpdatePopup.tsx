// UpdatePopup.tsx: an "Update PakChat" pop-up when PakChat opens (owner, 31 Oct:
// "like an alert"; it was a card in the chat list before), only in the APK people
// download from our website. A downloaded APK doesn't update itself, so this
// checks the website for a newer one and opens its download in the browser,
// which installs it over this one (same signing key, so chats stay).
// Google Play doesn't allow an app to update itself outside Play, so a copy
// installed from Play never checks, nor does a build made for Play
// (PAKCHAT_CHANNEL=play, see app.config.js). Removed for good once PakChat is public.
import Constants from 'expo-constants';
import KV from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { fileModule } from '../../modules/pakchat-signal';
import { serverUrl } from '../core/core';
import { fill, useT } from '../i18n';
import { Dialog } from './overlays';

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

export function UpdatePopup() {
  const t = useT();
  const [found, setFound] = useState<Newer | null>(null);

  // On opening PakChat, and on coming back to it. "Later" stops it for a day.
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

  const later = () => {
    KV.setItemSync(LATER, String(Date.now() + DAY));
    setFound(null);
  };
  return (
    <Dialog
      visible={!!found}
      onClose={later}
      title={t.updateCardTitle}
      text={found ? fill(t.updateCardText, { version: found.versionName || String(found.versionCode) }) : ''}
      buttons={[
        {
          label: t.updateNow,
          testID: 'update-now',
          onPress: () => {
            if (found) void Linking.openURL(found.url);
            // Shown again next time PakChat opens, until the new one is installed.
            setFound(null);
          },
        },
        { label: t.updateLater, testID: 'update-later', onPress: later },
      ]}
    />
  );
}
