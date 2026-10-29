// SwipeToClose.tsx: drag a full-screen photo or video up or down to close it,
// like WhatsApp. It follows your finger, shrinks a little, and the black behind
// it fades so the chat shows through. Let go far enough (or flick it) and it
// closes; not far enough and it springs back.
//
// With `grow` (the viewer), it also opens and closes like WhatsApp's: the
// picture grows out of its spot in the chat (zoom.ts) to fill the screen, and
// closing (a swipe, or Back) shrinks it back into that spot. Swiped on to
// another photo, or opened from somewhere without a spot, it fades instead.
// Everything here runs on the UI thread, so it stays smooth on older phones.
//
// Side to side is left alone, for swiping between photos and for a video's
// line. The screen showing it is see-through (_layout.tsx), so what's under
// it shows as the black fades.
import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { smooth } from './motion';
import type { Spot } from './zoom';

/** How far to drag (or how hard to flick) for it to close. */
const FAR = 110;
const FLICK = 900;
/** Growing out of the chat and shrinking back into it. */
const GROW = { duration: 220, easing: Easing.out(Easing.cubic) };
const SHRINK = { duration: 200, easing: Easing.out(Easing.cubic) };
/** The corners of a photo in the chat. */
const CORNER = 14;

export type Closer = { close: () => void };

export type Grow = {
  /** Where it grows from and goes back to. Null: it fades in and out instead. */
  spot: Spot | null;
  /** The picture's height over its width, to start out filling the spot the way the chat does. */
  aspect: number | null;
  /** False once swiped on to another photo: closing fades instead of going back to the spot. */
  back: boolean;
  /** Fully open. */
  onOpened?: () => void;
};

export function SwipeToClose({
  children,
  onClose,
  onDrag,
  grow,
  ref,
}: {
  children: ReactNode;
  onClose: () => void;
  onDrag?: (dragging: boolean) => void;
  grow?: Grow;
  /** close(): the same closing as a swipe (for Back). */
  ref?: Ref<Closer>;
}) {
  const win = useWindowDimensions();
  // The real size of the screen it fills (measured), for the growing.
  const W = useSharedValue(win.width);
  const H = useSharedValue(win.height);
  const y = useSharedValue(0);
  // Closes once, even if a second drag starts while it goes.
  const closed = useSharedValue(false);
  // How far it has grown out of its spot (0 at the spot, 1 filling the screen), and how far faded in.
  const spot = grow?.spot ?? null;
  const p = useSharedValue(grow && spot ? 0 : 1);
  const shown = useSharedValue(grow && !spot ? 0 : 1);
  const back = useSharedValue(!!spot && (grow?.back ?? true));
  useEffect(() => {
    back.set(!!spot && (grow?.back ?? true));
  }, [grow?.back, spot, back]);

  // Opening: grow out of the spot (or fade in).
  const [opening] = useState(() => !!grow);
  const onOpened = grow?.onOpened;
  useEffect(() => {
    if (!opening) return;
    const done = () => onOpened?.();
    if (spot) {
      p.set(
        withTiming(1, GROW, () => {
          'worklet';
          scheduleOnRN(done);
        }),
      );
    } else {
      shown.set(
        withTiming(1, { duration: 150 }, () => {
          'worklet';
          scheduleOnRN(done);
        }),
      );
    }
    // Only once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Closes: back into the spot, or (opened without one, or swiped on) fading or flying off the way it was going. */
  const shut = (direction: number) => {
    'worklet';
    if (closed.get()) return;
    closed.set(true);
    const finish = () => {
      'worklet';
      scheduleOnRN(onClose);
    };
    if (back.get()) {
      y.set(withTiming(0, SHRINK));
      p.set(withTiming(0, SHRINK, finish));
    } else if (direction !== 0) {
      y.set(withTiming(direction * H.get(), { duration: 200, easing: Easing.out(Easing.quad) }, finish));
    } else {
      shown.set(withTiming(0, { duration: 150 }, finish));
    }
  };

  useImperativeHandle(ref, () => ({ close: () => shut(0) }));

  const pan = usePanGesture({
    activeOffsetY: [-14, 14],
    failOffsetX: [-14, 14],
    onActivate: () => {
      'worklet';
      if (onDrag) scheduleOnRN(onDrag, true);
    },
    onUpdate: (e) => {
      'worklet';
      if (!closed.get()) y.set(e.translationY);
    },
    onDeactivate: (e) => {
      'worklet';
      if (closed.get()) return;
      if (Math.abs(e.translationY) > FAR || Math.abs(e.velocityY) > FLICK) {
        shut((e.velocityY === 0 ? e.translationY : e.velocityY) > 0 ? 1 : -1);
        return;
      }
      y.set(withSpring(0, smooth));
      if (onDrag) scheduleOnRN(onDrag, false);
    },
  });

  // The frame the picture shows in: the spot at first, the whole screen once grown.
  const aspect = grow?.aspect ?? (spot ? spot.h / spot.w : 1);
  const frame = useAnimatedStyle(() => {
    const drag = Math.min(1, Math.abs(y.value) / (H.value * 0.5));
    const moved = [{ translateY: y.value }, { scale: 1 - drag * 0.12 }];
    if (!spot) return { opacity: shown.value, transform: moved };
    const g = p.value;
    return {
      position: 'absolute',
      left: spot.x * (1 - g),
      top: spot.y * (1 - g),
      width: spot.w + (W.value - spot.w) * g,
      height: spot.h + (H.value - spot.h) * g,
      borderRadius: CORNER * (1 - g),
      overflow: 'hidden',
      transform: moved,
    };
  });
  // What's in the frame stays the size of the screen, centred, scaled down at first so the
  // picture fills the spot (cropped, like the chat shows it).
  const inside = useAnimatedStyle(() => {
    if (!spot) return { flex: 1 };
    const g = p.value;
    const fw = spot.w + (W.value - spot.w) * g;
    const fh = spot.h + (H.value - spot.h) * g;
    // How big the picture shows on the full screen (fitted inside it).
    const shownW = Math.min(W.value, H.value / aspect);
    const shownH = shownW * aspect;
    const s0 = Math.max(spot.w / shownW, spot.h / shownH);
    return {
      position: 'absolute',
      width: W.value,
      height: H.value,
      left: (fw - W.value) / 2,
      top: (fh - H.value) / 2,
      transform: [{ scale: s0 + (1 - s0) * g }],
    };
  });
  const black = useAnimatedStyle(() => ({ opacity: p.value * shown.value * (1 - Math.min(1, Math.abs(y.value) / (H.value * 0.45))) }));

  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => {
        W.set(e.nativeEvent.layout.width);
        H.set(e.nativeEvent.layout.height);
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }, black]} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, frame]}>
          <Animated.View style={inside}>{children}</Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
