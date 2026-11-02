// Zoomable.tsx: pinch a photo to zoom in and out, like WhatsApp's profile and group photos.
//
// Two fingers zoom in (up to 4 times) around the point between them, and moving them moves the
// photo too. Zoomed in, one finger moves it around, never past its edges. A double tap zooms in
// on that spot, or back out. Let go smaller than it started and it springs back. Everything runs
// on the UI thread, so it stays smooth on older phones.
//
// `width` × `height` is the box that takes the touches, in the middle of a `viewport` (the
// screen), so a zoomed photo can use the whole screen before it stops moving. `picture` is how big
// the photo really shows inside the box (when it's fitted in with bars around it, like a chat
// photo in viewer.tsx), so it never moves past the photo's own edges. `onZoomed` says when it's
// zoomed in, or being pinched (then a swipe to close or to the next photo should wait). `onTap` is
// a single tap (it waits to be sure it isn't a double tap, like WhatsApp). With `fill`, the box is
// as big as what holds it (PhotoPeek.tsx grows it); `enabled` false turns zooming off and puts it
// back to its normal size, without making a new one (a new one would flash). Taps still work.
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

const MAX = 4;
const DOUBLE = 2.5;
const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };

export function Zoomable({
  width,
  height,
  viewport,
  picture,
  onZoomed,
  onTap,
  fill,
  enabled = true,
  children,
}: {
  width: number;
  height: number;
  viewport: { width: number; height: number };
  picture?: { width: number; height: number };
  onZoomed?: (zoomed: boolean) => void;
  onTap?: () => void;
  fill?: boolean;
  enabled?: boolean;
  children: ReactNode;
}) {
  const s = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Where each gesture started: scale, position, and (for a pinch) the point between the fingers.
  const from = useSharedValue({ s: 1, x: 0, y: 0, fx: 0, fy: 0 });
  const [zoomed, setZoomed] = useState(false);
  const isZoomed = useSharedValue(false);

  const tell = (z: boolean) => {
    setZoomed(z);
    onZoomed?.(z);
  };
  /** Says whether it's zoomed in, only when that changes. */
  const mark = (z: boolean) => {
    'worklet';
    if (isZoomed.value === z) return;
    isZoomed.set(z);
    scheduleOnRN(tell, z);
  };

  /** How far it may move at scale `k` before an edge would show (0 when it still fits the screen). */
  const pw = picture?.width ?? width;
  const ph = picture?.height ?? height;
  const room = (k: number) => {
    'worklet';
    return {
      x: Math.max(0, (pw * k - viewport.width) / 2),
      y: Math.max(0, (ph * k - viewport.height) / 2),
    };
  };
  const clamp = (v: number, r: number) => {
    'worklet';
    return Math.min(r, Math.max(-r, v));
  };
  /** Settles: back to the start if it's smaller than that, and never past an edge. */
  const settle = () => {
    'worklet';
    const k = Math.min(MAX, Math.max(1, s.value));
    const r = room(k);
    s.set(withTiming(k, SETTLE));
    x.set(withTiming(k <= 1 ? 0 : clamp(x.value, r.x), SETTLE));
    y.set(withTiming(k <= 1 ? 0 : clamp(y.value, r.y), SETTLE));
    mark(k > 1.01);
  };

  // Turned off: back to normal size, smoothly (it's the same picture, so nothing flashes).
  const reset = () => {
    'worklet';
    s.set(withTiming(1, SETTLE));
    x.set(withTiming(0, SETTLE));
    y.set(withTiming(0, SETTLE));
    mark(false);
  };
  useEffect(() => {
    if (!enabled) scheduleOnUI(reset);
    // Only when it's turned off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const pinch = usePinchGesture({
    enabled,
    onActivate: (e) => {
      'worklet';
      from.set({ s: s.value, x: x.value, y: y.value, fx: e.focalX, fy: e.focalY });
      // Being pinched counts as zoomed, so nothing else (closing, the next photo) takes the fingers.
      mark(true);
    },
    onUpdate: (e) => {
      'worklet';
      const f = from.value;
      // A little past the limits while pinching (it settles back after).
      const k = Math.min(MAX * 1.25, Math.max(0.6, f.s * e.scale));
      // The spot that was between the fingers stays between them, wherever they go.
      const cx = width / 2;
      const cy = height / 2;
      x.set(e.focalX - cx - (k * (f.fx - cx - f.x)) / f.s);
      y.set(e.focalY - cy - (k * (f.fy - cy - f.y)) / f.s);
      s.set(k);
    },
    onDeactivate: () => {
      'worklet';
      settle();
    },
  });

  // One finger moves it, only while zoomed in (otherwise a drag is for closing it).
  const pan = usePanGesture({
    enabled: enabled && zoomed,
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      from.set({ ...from.value, x: x.value, y: y.value });
    },
    onUpdate: (e) => {
      'worklet';
      const r = room(s.value);
      x.set(clamp(from.value.x + e.translationX, r.x));
      y.set(clamp(from.value.y + e.translationY, r.y));
    },
  });

  // Double tap: zoom in on that spot, or back out.
  const doubleTap = useTapGesture({
    enabled,
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      if (s.value > 1.01) {
        s.set(withTiming(1, SETTLE));
        x.set(withTiming(0, SETTLE));
        y.set(withTiming(0, SETTLE));
        mark(false);
        return;
      }
      const r = room(DOUBLE);
      s.set(withTiming(DOUBLE, SETTLE));
      x.set(withTiming(clamp((1 - DOUBLE) * (e.x - width / 2), r.x), SETTLE));
      y.set(withTiming(clamp((1 - DOUBLE) * (e.y - height / 2), r.y), SETTLE));
      mark(true);
    },
  });

  // One tap (only once it's sure it wasn't the first of two).
  const tap = useTapGesture({
    // (Taps work even while zooming is off.)
    enabled: !!onTap,
    numberOfTaps: 1,
    requireToFail: doubleTap,
    onActivate: () => {
      'worklet';
      if (onTap) scheduleOnRN(onTap);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap, tap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: s.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      {/* The box stays still and takes the touches; the photo inside it moves. */}
      <View style={fill ? { width: '100%', height: '100%' } : { width, height }} collapsable={false}>
        <Animated.View style={[fill ? { width: '100%', height: '100%' } : { width, height }, style]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
