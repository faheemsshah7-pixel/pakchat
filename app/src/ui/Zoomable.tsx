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
//
// Like WhatsApp's, a zoomed photo dragged and let go keeps gliding and slows to a stop; pulled
// past its edge it gives a little and springs back. With `onEdgeSwipe`, carrying on past an edge
// it was already at goes to the next (or previous) photo, as WhatsApp's viewer does.
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

const MAX = 4;
const DOUBLE = 2.5;
const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };
/** How much a photo gives when pulled past its edge (a third of the finger's movement). */
const GIVE = 0.35;
/** How far past an edge (or how fast) a drag must go to move on to the next photo. */
const EDGE_PULL = 70;
const EDGE_FLING = 900;

export function Zoomable({
  width,
  height,
  viewport,
  picture,
  onZoomed,
  onTap,
  onEdgeSwipe,
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
  /** Dragged on past an edge it was already at: -1 the finger went left, 1 right. */
  onEdgeSwipe?: (dir: -1 | 1) => void;
  fill?: boolean;
  enabled?: boolean;
  children: ReactNode;
}) {
  const s = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Where each gesture started: scale, position, and (for a pinch) the point between the fingers.
  const from = useSharedValue({ s: 1, x: 0, y: 0, fx: 0, fy: 0 });
  // Which side edges were already showing when a one-finger drag started (left, right).
  const edge = useSharedValue({ l: false, r: false });
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

  // One finger moves it, only while zoomed in (otherwise a drag is for closing it). Past an edge
  // it gives a little; let go, it glides on and slows down, never past an edge.
  const edgeSwipe = (dir: -1 | 1) => onEdgeSwipe?.(dir);
  const pan = usePanGesture({
    enabled: enabled && zoomed,
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      from.set({ ...from.value, x: x.value, y: y.value });
      const r = room(s.value);
      edge.set({ l: x.value >= r.x - 1, r: x.value <= -r.x + 1 });
    },
    onUpdate: (e) => {
      'worklet';
      const r = room(s.value);
      const give = (v: number, lim: number) => (v > lim ? lim + (v - lim) * GIVE : v < -lim ? -lim + (v + lim) * GIVE : v);
      x.set(give(from.value.x + e.translationX, r.x));
      y.set(give(from.value.y + e.translationY, r.y));
    },
    onDeactivate: (e) => {
      'worklet';
      const r = room(s.value);
      // Already at an edge and pulled on past it: the next photo (zoom goes back to normal).
      const past = from.value.x + e.translationX;
      const right = edge.value.l && past - r.x > 0 && (past - r.x > EDGE_PULL || e.velocityX > EDGE_FLING);
      const left = edge.value.r && past + r.x < 0 && (-r.x - past > EDGE_PULL || -e.velocityX > EDGE_FLING);
      if (onEdgeSwipe && (left || right)) {
        reset();
        scheduleOnRN(edgeSwipe, left ? -1 : 1);
        return;
      }
      x.set(withDecay({ velocity: e.velocityX, clamp: [-r.x, r.x], rubberBandEffect: true, rubberBandFactor: 0.6 }));
      y.set(withDecay({ velocity: e.velocityY, clamp: [-r.y, r.y], rubberBandEffect: true, rubberBandFactor: 0.6 }));
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
