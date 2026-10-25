// Canvas.tsx: a photo in the editor with what's been put on it: lines drawn
// with a finger, words, and stickers (drag them about, pinch to size them, drag
// one to the bin to take it off). When it's sent, the screen takes a picture of
// all of it (react-native-view-shot), so it goes as one photo.
//
// Lines and places are kept in "canvas units" (1000 wide), so they stay put
// when the photo's box changes size (the keyboard, say).
import { useState, type ComponentRef, type Ref } from 'react';
import { Image as RNImage, View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '../../icons';
import { Txt } from '../../kit';

export type Stroke = { d: string; color: string; width: number };
export type Layer =
  | { id: string; kind: 'text'; text: string; color: string; x: number; y: number; scale: number }
  | { id: string; kind: 'sticker'; source: number | string; x: number; y: number; scale: number }
  | { id: string; kind: 'emoji'; text: string; x: number; y: number; scale: number };

/** A new word box, sticker or emoji (it goes in the middle). */
export type NewLayer = { kind: 'text'; text: string; color: string } | { kind: 'sticker'; source: number | string } | { kind: 'emoji'; text: string };
export type CanvasRef = ComponentRef<typeof View>;

export const UNITS = 1000;
export const PEN = 9;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function Canvas({
  uri,
  box,
  strokes,
  layers,
  drawing,
  color,
  onStroke,
  onMove,
  onRemove,
  onEditText,
  shot,
}: {
  uri: string;
  box: { w: number; h: number };
  strokes: Stroke[];
  layers: Layer[];
  drawing: boolean;
  color: string;
  onStroke: (s: Stroke) => void;
  onMove: (id: string, x: number, y: number, scale: number) => void;
  onRemove: (id: string) => void;
  onEditText: (id: string) => void;
  shot: Ref<CanvasRef>;
}) {
  const k = UNITS / Math.max(1, box.w);
  const unitsHigh = box.h * k;
  const current = useSharedValue('');
  const [dragging, setDragging] = useState(false);

  // Drawing: the line follows the finger on the UI thread; it's kept once you let go.
  const pen = usePanGesture({
    enabled: drawing,
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      current.value = `M${(e.x * k).toFixed(1)} ${(e.y * k).toFixed(1)}`;
    },
    onUpdate: (e) => {
      current.value += ` L${(e.x * k).toFixed(1)} ${(e.y * k).toFixed(1)}`;
    },
    onFinalize: () => {
      const d = current.value;
      current.value = '';
      // A dot (a tap) is a short line, so it shows.
      if (d) scheduleOnRN(onStroke, { d: d.includes('L') ? d : `${d} l0.1 0`, color, width: PEN });
    },
  });
  const live = useAnimatedProps(() => ({ d: current.value || 'M0 0' }));

  return (
    <GestureDetector gesture={pen}>
      <View ref={shot} collapsable={false} style={{ width: box.w, height: box.h, overflow: 'hidden', backgroundColor: '#000' }} testID="editor-canvas">
        {/* React Native's own image (not expo-image): it can be drawn into the snapshot. */}
        <RNImage source={{ uri }} style={{ width: box.w, height: box.h }} resizeMode="stretch" />
        <Svg width={box.w} height={box.h} viewBox={`0 0 ${UNITS} ${unitsHigh}`} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
          {strokes.map((s, i) => (
            <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
          <AnimatedPath animatedProps={live} stroke={color} strokeWidth={PEN} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
        {layers.map((l) => (
          <Piece
            key={l.id}
            layer={l}
            k={k}
            box={box}
            enabled={!drawing}
            onDrag={setDragging}
            onMove={onMove}
            onRemove={onRemove}
            onTap={l.kind === 'text' ? () => onEditText(l.id) : undefined}
          />
        ))}
        {dragging && (
          <View pointerEvents="none" style={{ position: 'absolute', bottom: 14, alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }} testID="editor-bin">
            <Icon name="trash" size={22} color="#FFFFFF" />
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

/** One word box or sticker: drag it, pinch it, or drop it on the bin. */
function Piece({
  layer,
  k,
  box,
  enabled,
  onDrag,
  onMove,
  onRemove,
  onTap,
}: {
  layer: Layer;
  k: number;
  box: { w: number; h: number };
  enabled: boolean;
  onDrag: (on: boolean) => void;
  onMove: (id: string, x: number, y: number, scale: number) => void;
  onRemove: (id: string) => void;
  onTap?: () => void;
}) {
  // Where it is, in points, while it moves; saved (in canvas units) when you let go.
  const x = useSharedValue(layer.x / k);
  const y = useSharedValue(layer.y / k);
  const s = useSharedValue(layer.scale);
  const from = useSharedValue({ x: 0, y: 0, s: 1 });
  // Its own size, so it's placed by its middle.
  const half = useSharedValue({ w: 0, h: 0 });
  const binX = box.w / 2;
  const binY = box.h - 40;

  const pan = usePanGesture({
    enabled,
    onBegin: () => {
      from.value = { x: x.value, y: y.value, s: s.value };
    },
    onActivate: () => scheduleOnRN(onDrag, true),
    onUpdate: (e) => {
      x.value = from.value.x + e.translationX;
      y.value = from.value.y + e.translationY;
    },
    onFinalize: () => {
      scheduleOnRN(onDrag, false);
      const nearBin = Math.hypot(x.value - binX, y.value - binY) < 48;
      if (nearBin) scheduleOnRN(onRemove, layer.id);
      else scheduleOnRN(onMove, layer.id, x.value * k, y.value * k, s.value);
    },
  });
  const pinch = usePinchGesture({
    enabled,
    onBegin: () => {
      from.value = { x: x.value, y: y.value, s: s.value };
    },
    onUpdate: (e) => {
      s.value = Math.max(0.4, Math.min(5, from.value.s * e.scale));
    },
    onFinalize: () => scheduleOnRN(onMove, layer.id, x.value * k, y.value * k, s.value),
  });
  const tap = useTapGesture({
    enabled: enabled && !!onTap,
    onActivate: () => {
      if (onTap) scheduleOnRN(onTap);
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch, tap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - half.value.w }, { translateY: y.value - half.value.h }, { scale: s.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) => half.set({ w: e.nativeEvent.layout.width / 2, h: e.nativeEvent.layout.height / 2 })}
        style={[{ position: 'absolute', top: 0, left: 0 }, style]}
        testID={`layer-${layer.kind}`}
      >
        {layer.kind === 'text' ? (
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, maxWidth: box.w * 0.9 }}>
            <Txt size={30} weight="800" color={layer.color} align="center" style={{ textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } }}>
              {layer.text}
            </Txt>
          </View>
        ) : layer.kind === 'emoji' ? (
          <Txt size={64} align="center">
            {layer.text}
          </Txt>
        ) : (
          <RNImage source={typeof layer.source === 'number' ? layer.source : { uri: layer.source }} style={{ width: 120, height: 120 }} resizeMode="contain" />
        )}
      </Animated.View>
    </GestureDetector>
  );
}
