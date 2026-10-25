// CrashNote.tsx: after PakChat closed by mistake, it says so the next time it
// opens, with a button that copies what went wrong (modules/pakchat-signal
// CrashLog.kt), to send to whoever is fixing it. Each crash is told once.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform } from 'react-native';

import { fileModule } from '../../modules/pakchat-signal';
import { useT } from '../i18n';
import { Dialog, toast } from './overlays';

/** What went wrong last time, once (asking forgets it). */
function lastCrash() {
  if (Platform.OS !== 'android') return null;
  try {
    return fileModule().lastCrash();
  } catch {
    // An older build without it: nothing to say.
    return null;
  }
}

export function CrashNote() {
  const t = useT();
  const [details, setDetails] = useState<string | null>(lastCrash);
  return (
    <Dialog
      visible={!!details}
      onClose={() => setDetails(null)}
      title={t.crashTitle}
      text={t.crashText}
      buttons={[
        {
          label: t.copyDetails,
          testID: 'crash-copy',
          onPress: () => {
            void Clipboard.setStringAsync(details ?? '');
            toast(t.copied);
            setDetails(null);
          },
        },
        { label: t.close, onPress: () => setDetails(null) },
      ]}
    />
  );
}
