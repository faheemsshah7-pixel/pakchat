// PinResetNotice.tsx: "PIN reset asked for". Someone typed my number on another phone and
// asked to reset my two-step PIN (the 7-day wait). This phone being in use already stopped
// it (the server cancels it when this phone connects); this just tells me, once.
import { core } from '../core/core';
import { useSettings } from '../core/hooks';
import { dismissPinReset } from '../core/push';
import { useT } from '../i18n';
import { Dialog } from './overlays';

export function PinResetNotice() {
  const t = useT();
  const settings = useSettings();

  function ok() {
    core.setSettings({ pinResetAt: undefined });
    dismissPinReset();
  }

  return <Dialog visible={!!settings.pinResetAt} onClose={ok} title={t.pinResetTitle} text={t.pinResetText} buttons={[{ label: t.okWord, onPress: ok, testID: 'pin-reset-ok' }]} />;
}
