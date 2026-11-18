// PinReminder.tsx: "Do you still know your PIN?" now and then, like WhatsApp's, so the
// two-step PIN (settings/two-step.tsx) isn't forgotten by the day a new phone needs it.
// First 3 days after it's made, then every week; "Not now" asks again the next day.
// A right answer here also stops a "wait 7 days" someone else may have asked for.
import KV from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { core, isOffline } from '../core/core';
import { useAuth } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Pressy, Txt } from './kit';
import { Sheet, toast } from './overlays';
import { PinBoxes, ShowPin } from './Pin';

const DAY = 86_400_000;

export function PinReminder() {
  const t = useT();
  const { theme } = useLook();
  const { me, myId } = useAuth();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const on = me?.pin === true;

  useEffect(() => {
    if (!on || !myId) return;
    const check = () => {
      const askedKey = `pinAsked:${myId}`;
      const asked = Number(KV.getItemSync(askedKey) ?? 0);
      // Made on another phone, or before this was here: start counting now.
      if (!asked) return KV.setItemSync(askedKey, String(Date.now()));
      const times = Number(KV.getItemSync(`pinRight:${myId}`) ?? 0);
      const snoozed = Number(KV.getItemSync(`pinSnooze:${myId}`) ?? 0);
      if (Date.now() - asked > (times === 0 ? 3 : 7) * DAY && Date.now() - snoozed > DAY) setOpen(true);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [on, myId]);

  function close() {
    KV.setItemSync(`pinSnooze:${myId}`, String(Date.now()));
    setOpen(false);
    setPin('');
    setError('');
  }

  async function typed(value: string) {
    setBusy(true);
    try {
      if (await core.checkPin(value)) {
        KV.setItemSync(`pinRight:${myId}`, String(Number(KV.getItemSync(`pinRight:${myId}`) ?? 0) + 1));
        setOpen(false);
        setPin('');
        setError('');
        toast(t.pinCheckRight);
      } else {
        setPin('');
        setError(t.pinCheckWrong);
      }
    } catch (err) {
      setPin('');
      toast(isOffline(err) ? t.serverError : t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={open && on} onClose={close} title={t.pinCheckTitle}>
      <View style={{ paddingHorizontal: 18, paddingTop: 4, gap: 14 }}>
        <Txt size={15} color={theme.muted}>
          {t.pinCheckText}
        </Txt>
        <PinBoxes
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (v) setError('');
          }}
          onDone={(v) => void typed(v)}
          show={show}
          error={!!error}
          disabled={busy}
          label={t.pinCheckTitle}
          testID="pin-check-field"
        />
        {!!error && (
          <Txt size={14} weight="500" color={theme.danger} align="center">
            {error}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <ShowPin show={show} onToggle={() => setShow((s) => !s)} t={t} />
          <Pressy onPress={close} label={t.pinNotNow} testID="pin-not-now">
            <Txt size={15} weight="600" color={theme.accInk} style={{ padding: 8 }}>
              {t.pinNotNow}
            </Txt>
          </Pressy>
        </View>
      </View>
    </Sheet>
  );
}
