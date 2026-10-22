// Marquee.tsx: one line of text that's too long for its space slides along once,
// like WhatsApp's "last seen today at 4:20 pm" under a chat's name, and stops at
// the end so the time stays in view. Text that fits just sits still.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { useLook } from '../theme/ThemeProvider';
import { Txt, type Weight } from './kit';

export function Marquee({ text, size, weight, color, testID }: { text: string; size?: number; weight?: Weight; color?: string; testID?: string }) {
  const { rtl } = useLook();
  // The space we have, and how wide the whole line would be.
  const [room, setRoom] = useState(0);
  const [wide, setWide] = useState(0);
  const x = useSharedValue(0);
  const over = room > 0 && wide > room ? wide - room : 0;

  useEffect(() => {
    x.value = 0;
    if (!over) return;
    // A short pause to read the start, then an easy glide (about 35 px a second) to the end.
    // In Urdu the line starts on the right, so it slides the other way.
    x.value = withDelay(
      900,
      withTiming((rtl ? 1 : -1) * over, { duration: Math.max(700, over * 28), easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }),
    );
  }, [over, text, rtl, x]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={{ overflow: 'hidden' }} onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
      {/* Measures the whole line, out of sight. */}
      <View style={{ position: 'absolute', opacity: 0, width: 4000, flexDirection: 'row' }} pointerEvents="none">
        <View onLayout={(e) => setWide(Math.ceil(e.nativeEvent.layout.width))}>
          <Txt size={size} weight={weight} lines={1}>
            {text}
          </Txt>
        </View>
      </View>
      <Animated.View style={[{ width: Math.max(room, wide) || undefined }, slide]}>
        <Txt size={size} weight={weight} color={color} lines={1} testID={testID}>
          {text}
        </Txt>
      </Animated.View>
    </View>
  );
}
