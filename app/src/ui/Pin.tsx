// Pin.tsx: the pieces of two-step verification's screens (settings/two-step.tsx,
// sign-in-pin.tsx, PinReminder.tsx): six boxes for the PIN, typed with the phone's
// number keyboard, and the big round icon over the title.
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputInstance } from 'react-native';

import { fill, type Strings } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon, type IconName } from './icons';
import { Pressy, Txt } from './kit';

/**
 * Six boxes, filled with dots as the PIN is typed (or the digits, with `show`). The boxes
 * are a picture: the typing goes into a hidden box, so the phone's own number keyboard,
 * pasting and TalkBack all work. `onDone` comes once all six are typed.
 */
export function PinBoxes({
  value,
  onChange,
  onDone,
  show,
  error,
  disabled,
  label,
  testID,
}: {
  value: string;
  onChange: (pin: string) => void;
  onDone?: (pin: string) => void;
  show?: boolean;
  error?: boolean;
  disabled?: boolean;
  label: string;
  testID?: string;
}) {
  const { theme } = useLook();
  const input = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);

  // Coming back from a wait (or a wrong PIN cleared it): the keyboard comes back too.
  // Asked again a little later too: a pop-up still closing (like "Turn off?") can take the
  // keyboard away from the first try.
  useEffect(() => {
    if (disabled) return;
    const tries = [250, 700].map((ms) => setTimeout(() => wake(), ms));
    return () => tries.forEach(clearTimeout);
  }, [disabled]);

  /** Focus, and the keyboard up (when the box already had focus but the keyboard went away, focus alone doesn't bring it back). */
  function wake() {
    const box = input.current;
    if (!box) return;
    if (box.isFocused()) {
      box.blur();
      setTimeout(() => input.current?.focus(), 50);
    } else box.focus();
  }

  return (
    <Pressable onPress={wake} disabled={disabled} accessible={false}>
      {/* Digits always run left to right, in Urdu too. */}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', direction: 'ltr', opacity: disabled ? 0.5 : 1 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const digit = value[i];
          const here = focused && !disabled && i === value.length;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                maxWidth: 52,
                aspectRatio: 0.82,
                borderRadius: 14,
                backgroundColor: theme.glass,
                borderWidth: 2,
                borderColor: error ? theme.danger : here ? theme.acc : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {digit !== undefined &&
                (show ? (
                  <Txt size={22} weight="700">
                    {digit}
                  </Txt>
                ) : (
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.text }} />
                ))}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => {
          const pin = v.replace(/\D/g, '').slice(0, 6);
          onChange(pin);
          if (pin.length === 6) onDone?.(pin);
        }}
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus={!disabled}
        caretHidden
        contextMenuHidden
        autoComplete="off"
        importantForAutofill="no"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        testID={testID}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      />
    </Pressable>
  );
}

/** "Show PIN" / "Hide PIN", under the boxes. */
export function ShowPin({ show, onToggle, t }: { show: boolean; onToggle: () => void; t: Strings }) {
  const { theme } = useLook();
  return (
    <Pressy onPress={onToggle} label={show ? t.pinHide : t.pinShow} style={{ alignSelf: 'center' }} testID="pin-show">
      <Txt size={15} weight="600" color={theme.accInk} style={{ padding: 8 }}>
        {show ? t.pinHide : t.pinShow}
      </Txt>
    </Pressy>
  );
}

/** The big round icon over a title: the accent's (a lock) or green (the shield, when it's on). */
export function BigIcon({ name, green }: { name: IconName; green?: boolean }) {
  const { theme } = useLook();
  const bg = green ? (theme.dark ? 'rgba(52,211,153,0.16)' : '#D5F2E6') : theme.accSoft;
  const fg = green ? (theme.dark ? '#34D399' : '#047857') : theme.accInk;
  return (
    <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      <Icon name={name} size={44} color={fg} />
    </View>
  );
}

/** "Wrong PIN. 3 tries left.", or how long to wait after too many. */
export function pinWrongText(t: Strings, triesLeft: number) {
  if (triesLeft <= 0) return t.pinWrong;
  return triesLeft === 1 ? t.pinWrong1 : fill(t.pinWrongN, { n: triesLeft });
}

/** A wait as "0:59", "4:00" or "23:59:59". */
export function waitClock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
