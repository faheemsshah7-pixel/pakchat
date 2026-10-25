// SwipeToClose.tsx: drag a full-screen photo or video up or down to close it,
// like WhatsApp. It follows your finger, shrinks a little, and the black behind
// it fades so the chat shows through. Let go far enough (or flick it) and it
// flies off and the screen closes; not far enough and it springs back.
//
// Side to side is left alone, for swiping between photos and for a video's
// line. The screen showing it is see-through (_layout.tsx), so what's under
// it shows as the black fades.
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { smooth } from './motion';

/** How far to drag (or how hard to flick) for it to close. */
const FAR = 110;
const FLICK = 900;

export function SwipeToClose({ children, onClose, onDrag }: { children: ReactNode; onClose: () => void; onDrag?: (dragging: boolean) => void }) {
  const { height } = useWindowDimensions();
  const y = useSharedValue(0);
  // Closes once, even if a second drag starts while it flies off.
  const closed = useSharedValue(false);

  const pan = usePanGesture({
    activeOffsetY: [-14, 14],
    failOffsetX: [-14, 14],
    onActivate: () => {
      'worklet';
      if (onDrag) scheduleOnRN(onDrag, true);
    },
    onUpdate: (e) => {
      'worklet';
      if (!closed.value) y.value = e.translationY;
    },
    onDeactivate: (e) => {
      'worklet';
      if (closed.value) return;
      if (Math.abs(e.translationY) > FAR || Math.abs(e.velocityY) > FLICK) {
        const down = (e.velocityY === 0 ? e.translationY : e.velocityY) > 0;
        closed.value = true;
        y.value = withTiming(down ? height : -height, { duration: 200, easing: Easing.out(Easing.quad) });
        scheduleOnRN(onClose);
        return;
      }
      y.value = withSpring(0, smooth);
      if (onDrag) scheduleOnRN(onDrag, false);
    },
  });

  const content = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(y.value) / (height * 0.5));
    return { transform: [{ translateY: y.value }, { scale: 1 - p * 0.12 }] };
  });
  const black = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.abs(y.value) / (height * 0.45)) }));

  return (
    <View style={{ flex: 1 }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }, black]} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, content]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
