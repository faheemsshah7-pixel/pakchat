// Slider.tsx: a slider (0 to 1) in PakChat's look: a soft track that fills
// with the accent, and a round thumb. Drag it or tap along it. `onChange` goes
// as it moves; `onDone` once it's let go.
import { useState } from 'react';
import { View } from 'react-native';
import { usePanGesture, useTapGesture, useSimultaneousGestures, GestureDetector } from 'react-native-gesture-handler';

import { useLook } from '../theme/ThemeProvider';

const THUMB = 26;

export function Slider({ value, onChange, onDone, label, testID }: { value: number; onChange: (v: number) => void; onDone?: (v: number) => void; label: string; testID?: string }) {
  const { theme, rtl } = useLook();
  const [width, setWidth] = useState(0);
  const at = (x: number) => {
    const w = Math.max(1, width - THUMB);
    const v = Math.max(0, Math.min(1, (x - THUMB / 2) / w));
    return rtl ? 1 - v : v;
  };
  const pan = usePanGesture({
    runOnJS: true,
    onUpdate: (e) => onChange(at(e.x)),
    onDeactivate: (e) => onDone?.(at(e.x)),
  });
  const tap = useTapGesture({
    runOnJS: true,
    onDeactivate: (e) => {
      const v = at(e.x);
      onChange(v);
      onDone?.(v);
    },
  });
  const both = useSimultaneousGestures(pan, tap);
  const left = Math.max(0, width - THUMB) * value;
  return (
    <GestureDetector gesture={both}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const v = Math.max(0, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)));
          onChange(v);
          onDone?.(v);
        }}
        style={{ height: 40, justifyContent: 'center', direction: 'ltr' }}
        testID={testID}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.glassLine, marginHorizontal: THUMB / 2 }}>
          <View style={{ position: 'absolute', top: 0, bottom: 0, [rtl ? 'right' : 'left']: 0, width: left, borderRadius: 3, backgroundColor: theme.acc }} />
        </View>
        <View
          style={{
            position: 'absolute',
            [rtl ? 'right' : 'left']: left,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: '#FFFFFF',
            borderWidth: 3,
            borderColor: theme.acc,
            elevation: 2,
          }}
        />
      </View>
    </GestureDetector>
  );
}
