// WhatsAppCheck.tsx: proving a phone number with WhatsApp, free for everyone.
//
// Tap "Open WhatsApp": WhatsApp opens a chat with PakChat's own number, with
// "PakChat code: K7M4QX" already typed. Press Send and come back. WhatsApp has
// proved which number sent it, so the server now knows the number is yours, and
// this screen carries on by itself (it asks the server every 2 seconds while it waits).
//
// Used on the sign-in screens (with the number typed first: only that number's
// WhatsApp counts) and in Settings > Account (adding a number).
import { useEffect, useRef, useState } from 'react';

import { formatPhone } from '@pakchat/shared';
import { ActivityIndicator, AppState, Linking, View } from 'react-native';
import { core } from '../core/core';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { phoneError } from './format';
import { Button, Txt } from './kit';

type Check = { id: string; secret: string; url: string; until: number };

export function WhatsAppCheck({
  purpose,
  phone: typed,
  quiet,
  onChecked,
  onBack,
  onGoogle,
}: {
  purpose: 'sign_in' | 'link';
  /** The number typed first ("+923001234567"). Then only that number's WhatsApp counts. */
  phone?: string;
  /** The screen explains the steps itself: only say something while waiting. */
  quiet?: boolean;
  /** The number sent the code. `code` signs it in (or adds it) once, like an SMS code. */
  onChecked: (phone: string, code: string) => Promise<void>;
  /** Without it there's no Back button (the screen has its own). */
  onBack?: () => void;
  /** Signing in: offered (Continue with Google) when WhatsApp hides the person's number. */
  onGoogle?: () => void;
}) {
  const t = useT();
  const { theme } = useLook();
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Another number's WhatsApp sent the code: say so, and keep waiting for the right one.
  const [wrongFrom, setWrongFrom] = useState('');
  // The code came, but their WhatsApp username hides their number: it can't count.
  const [hidden, setHidden] = useState(false);
  const done = useRef(false);

  async function open() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      // A check lasts 10 minutes; reuse it if WhatsApp was just closed without sending.
      let c = check;
      if (!c || c.until < Date.now() + 30_000) {
        const r = await core.startWhatsApp(purpose, typed);
        c = { id: r.id, secret: r.secret, url: r.url, until: Date.now() + r.expiresIn * 1000 };
        setCheck(c);
      }
      await Linking.openURL(c.url);
    } catch (err) {
      setError(phoneError(t, err));
    } finally {
      setBusy(false);
    }
  }

  // While a check is waiting, ask every 2 seconds (only while PakChat is on screen).
  useEffect(() => {
    if (!check) return;
    let alive = true;
    let asking = false;

    const ask = async () => {
      if (!alive || asking || done.current || AppState.currentState !== 'active') return;
      if (check.until < Date.now()) {
        setCheck(null);
        setError(t.waExpired);
        return;
      }
      asking = true;
      try {
        const { phone, wrongFrom: other, hidden: noNumber } = await core.claimWhatsApp(check.id, check.secret);
        if (alive && other) setWrongFrom(other);
        if (alive && noNumber) setHidden(true);
        if (phone && alive && !done.current) {
          done.current = true;
          setBusy(true);
          try {
            await onChecked(phone, check.secret);
          } catch (err) {
            done.current = false;
            setCheck(null);
            if (alive) setError(phoneError(t, err));
          } finally {
            if (alive) setBusy(false);
          }
        }
      } catch {
        // A blip on the network: the next ask tries again.
      } finally {
        asking = false;
      }
    };

    void ask();
    const timer = setInterval(() => void ask(), 2_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void ask());
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [check, onChecked, t]);

  const say =
    error ||
    (hidden ? (onGoogle ? `${t.waHidden} ${t.waHiddenGoogle}` : t.waHidden) : '') ||
    (wrongFrom && typed ? fill(t.sentFromOther, { from: formatPhone(wrongFrom), phone: formatPhone(typed) }) : '');

  return (
    <View style={{ gap: 8 }}>
      {(!quiet || check) && (
        <Txt size={14} color={theme.muted} align="center">
          {check ? t.waWaiting : t.waHint}
        </Txt>
      )}
      {check && !error ? (
        <View style={{ alignItems: 'center', paddingVertical: 6 }} testID="wa-waiting">
          <ActivityIndicator color={theme.accInk} />
        </View>
      ) : null}
      {say ? (
        <Txt size={14} weight="500" color={theme.danger} align="center" testID="wa-problem">
          {say}
        </Txt>
      ) : null}
      {hidden && onGoogle ? <Button title={t.continueGoogle} onPress={onGoogle} testID="wa-google" /> : null}
      <Button title={check ? t.waOpenAgain : t.waOpen} icon="send" look={hidden && onGoogle ? 'soft' : undefined} onPress={open} busy={busy} testID="wa-open" />
      {onBack && <Button title={t.back} look="soft" onPress={onBack} testID="wa-back" />}
    </View>
  );
}
