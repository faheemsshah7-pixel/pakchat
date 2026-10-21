// overlays.tsx: things that float over a screen.
//
//   Popup      the ⋮ menu: grows out of the corner it was opened from
//   Sheet      slides up from the bottom; drag it down to close
//   Dialog     a question in the middle ("Delete this message?")
//   toast()    a short note at the bottom ("Copied") that goes away by itself
//
// Each one animates in AND out: it stays on screen until its closing
// animation has finished, then goes away.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, FadeInDown, FadeOutDown, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useLook, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './icons';
import { Pressy, Txt } from './kit';
import { smooth } from './motion';

/** Keeps something on screen while it animates out. `p` goes 0 → 1 when opening and back when closing. */
function useOpenClose(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const p = useSharedValue(0);
  // Opening: show it straight away (setting state while rendering is React's way to follow a prop).
  if (visible && !mounted) setMounted(true);
  useEffect(() => {
    if (visible) {
      p.value = withSpring(1, smooth);
    } else {
      p.value = withTiming(0, { duration: 170, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(setMounted, false);
      });
    }
  }, [visible, p]);
  return { mounted, p };
}

function Backdrop({ p, onClose, dim = 0.35 }: { p: { value: number }; onClose: () => void; dim?: number }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0, 1], 'clamp') }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(5,12,28,${dim})` }, style]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
    </Animated.View>
  );
}

// ---- The ⋮ menu ----

export function Popup({ visible, onClose, children, top = 64 }: { visible: boolean; onClose: () => void; children: ReactNode; top?: number }) {
  const t = useTheme();
  const { rtl } = useLook();
  const insets = useSafeAreaInsets();
  const { mounted, p } = useOpenClose(visible);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.6], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.86, 1]) }],
  }));
  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}>
        <Backdrop p={p} onClose={onClose} dim={0.08} />
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: insets.top + top,
              end: 12,
              minWidth: 220,
              paddingVertical: 6,
              borderRadius: 20,
              backgroundColor: t.dark ? '#24262C' : 'rgba(255,255,255,0.97)',
              borderWidth: 1,
              borderColor: t.glassLine,
              boxShadow: `0 24px 50px -16px ${t.shadow}`,
              transformOrigin: rtl ? 'top left' : 'top right',
            },
            style,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export function MenuItem({ icon, label, onPress, danger, testID }: { icon?: IconName; label: string; onPress: () => void; danger?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressy onPress={onPress} label={label} testID={testID} scale={0.97}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
        {icon && <Icon name={icon} size={20} color={danger ? t.danger : t.accInk} />}
        <Txt size={15} weight="500" color={danger ? t.danger : t.text}>
          {label}
        </Txt>
      </View>
    </Pressy>
  );
}

// ---- The bottom sheet ----

export function Sheet({ visible, onClose, children, title }: { visible: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  const t = useTheme();
  const { rtl } = useLook();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { mounted, p } = useOpenClose(visible);
  const drag = useSharedValue(0);

  // Pull it down to close; let go early and it springs back up.
  const pan = usePanGesture({
    activeOffsetY: 8,
    onUpdate: (e) => {
      drag.value = Math.max(0, e.translationY);
    },
    onDeactivate: (e) => {
      if (e.translationY > 120 || e.velocityY > 900) scheduleOnRN(onClose);
      drag.value = withSpring(0, smooth);
    },
  });

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(p.value, [0, 1], [height * 0.6, 0]) + drag.value }] }));
  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', direction: rtl ? 'rtl' : 'ltr' }}>
        <Backdrop p={p} onClose={onClose} />
        <Animated.View
          style={[
            {
              backgroundColor: t.dark ? '#1E2026' : '#F7FAFF',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingBottom: insets.bottom + 12,
              boxShadow: `0 -10px 40px -20px ${t.shadow}`,
              maxHeight: height * 0.85,
            },
            style,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: title ? 4 : 10 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: t.faint }} />
              {!!title && (
                <Txt size={17} weight="700" style={{ alignSelf: 'stretch', marginTop: 12, marginHorizontal: 20 }}>
                  {title}
                </Txt>
              )}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ---- A question in the middle ----

export type DialogButton = { label: string; onPress: () => void; danger?: boolean; testID?: string };

export function Dialog({ visible, onClose, title, text, buttons }: { visible: boolean; onClose: () => void; title?: string; text?: string; buttons: DialogButton[] }) {
  const t = useTheme();
  const { rtl } = useLook();
  const { mounted, p } = useOpenClose(visible);
  const style = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.5], [0, 1], 'clamp'), transform: [{ scale: interpolate(p.value, [0, 1], [0.9, 1]) }] }));
  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, direction: rtl ? 'rtl' : 'ltr' }}>
        <Backdrop p={p} onClose={onClose} />
        <Animated.View
          style={[{ alignSelf: 'stretch', borderRadius: 26, padding: 22, backgroundColor: t.dark ? '#1E2026' : '#FFFFFF', boxShadow: `0 30px 60px -20px ${t.shadow}`, gap: 10 }, style]}
        >
          {!!title && (
            <Txt size={18} weight="700">
              {title}
            </Txt>
          )}
          {!!text && (
            <Txt size={15} color={t.muted}>
              {text}
            </Txt>
          )}
          <View style={{ gap: 8, marginTop: 8 }}>
            {buttons.map((b) => (
              <Pressy key={b.label} onPress={b.onPress} label={b.label} testID={b.testID} scale={0.97}>
                <View style={{ height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: b.danger ? t.dangerSoft : t.accSoft }}>
                  <Txt size={15} weight="700" color={b.danger ? t.danger : t.accInk} align="center">
                    {b.label}
                  </Txt>
                </View>
              </Pressy>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ---- Toasts ----

let current: { id: number; text: string } | null = null;
const toastListeners = new Set<() => void>();
let nextId = 1;

/** Shows a short note at the bottom for a moment. */
export function toast(text: string) {
  const id = nextId++;
  current = { id, text };
  toastListeners.forEach((fn) => fn());
  setTimeout(() => {
    if (current?.id === id) {
      current = null;
      toastListeners.forEach((fn) => fn());
    }
  }, 2000);
}

/** Put once near the top of the app; shows the toasts. */
export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const now = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => current,
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', start: 0, end: 0, bottom: insets.bottom + 90, alignItems: 'center' }}>
      {now && (
        <Animated.View
          key={now.id}
          entering={FadeInDown.springify().damping(18)}
          exiting={FadeOutDown.duration(160)}
          style={{ paddingHorizontal: 18, paddingVertical: 11, borderRadius: 16, backgroundColor: t.dark ? '#ECEEF2' : '#0B1B36' }}
        >
          <Txt size={14} weight="600" color={t.dark ? '#111214' : '#FFFFFF'} align="center">
            {now.text}
          </Txt>
        </Animated.View>
      )}
    </View>
  );
}
