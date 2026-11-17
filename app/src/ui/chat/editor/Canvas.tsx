// Canvas.tsx: a photo in the editor with what's been put on it: lines drawn
// with a finger, words, and stickers (drag them about, pinch to size them, drag
// one to the bin to take it off). When it's sent, the screen takes a picture of
// all of it (react-native-view-shot), so it goes as one photo.
//
// Lines and places are kept in "canvas units" (1000 wide), so they stay put
// when the photo's box changes size (the keyboard, say).
//
// Like WhatsApp's: the pen has three thicknesses and any colour, and a blur pen
// that hides what's under it; stickers and words can be turned with two fingers;
// words have a few fonts and can sit on a coloured box; and the photo can have a
// colour filter. The photo itself is drawn in the SVG, so the filter and the blur
// are part of the snapshot too.
import { useState, type ComponentRef, type Ref } from 'react';
import { Image as RNImage, View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useRotationGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Defs, FeColorMatrix, FeGaussianBlur, Filter, G, Image as SvgImage, Mask, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '../../icons';
import { Txt } from '../../kit';

/** `blur`: the blur pen (it hides what's under it instead of drawing a colour). */
export type Stroke = { d: string; color: string; width: number; blur?: boolean };
/** `rot`: turned, in degrees. Words: `font` (an index into FONTS) and `box` (on a box of their colour). */
export type Layer =
  | { id: string; kind: 'text'; text: string; color: string; font?: number; box?: boolean; x: number; y: number; scale: number; rot?: number }
  | { id: string; kind: 'sticker'; source: number | string; x: number; y: number; scale: number; rot?: number }
  | { id: string; kind: 'emoji'; text: string; x: number; y: number; scale: number; rot?: number };

/** A new word box, sticker or emoji (it goes in the middle). */
export type NewLayer = { kind: 'text'; text: string; color: string; font?: number; box?: boolean } | { kind: 'sticker'; source: number | string } | { kind: 'emoji'; text: string };
export type CanvasRef = ComponentRef<typeof View>;

export const UNITS = 1000;
export const PEN = 9;
/** The pen's three thicknesses (canvas units), and the blur pen's. */
export const PENS = [5, 9, 16];
export const BLUR_PEN = 46;

/** The fonts words can have, like WhatsApp's (Android's own). */
export const FONTS: { fontFamily?: string; fontWeight?: '800' | '400' }[] = [{}, { fontFamily: 'serif', fontWeight: '400' }, { fontFamily: 'monospace', fontWeight: '400' }, { fontFamily: 'cursive', fontWeight: '400' }, { fontFamily: 'sans-serif-condensed' }];

/** The colour filters for a photo (FeColorMatrix), like WhatsApp's. The names are in strings (filterNames). */
export const FILTERS: ({ type: 'saturate'; values: number } | { type: 'matrix'; values: string } | null)[] = [
  null,
  { type: 'saturate', values: 1.55 },
  { type: 'saturate', values: 0 },
  { type: 'matrix', values: '1.12 0 0 0 0.03  0 1.02 0 0 0.01  0 0 0.84 0 0  0 0 0 1 0' },
  { type: 'matrix', values: '0.9 0 0 0 0  0 1 0 0 0.01  0 0 1.16 0 0.04  0 0 0 1 0' },
  { type: 'matrix', values: '0.393 0.769 0.189 0 0  0.349 0.686 0.168 0 0  0.272 0.534 0.131 0 0  0 0 0 1 0' },
  { type: 'matrix', values: '0.82 0.1 0.08 0 0.07  0.08 0.82 0.1 0 0.07  0.1 0.08 0.82 0 0.07  0 0 0 1 0' },
];

/** The photo, drawn in an SVG with its filter (and, for the blur pen, a blurred copy under a mask). */
export function FilteredPhoto({ uri, w, h, filter, blurs }: { uri: string; w: number; h: number; filter?: number; blurs?: Stroke[] }) {
  const f = filter ? FILTERS[filter] : null;
  return (
    <>
      <Defs>
        {f && (
          <Filter id="look" x="0" y="0" width="100%" height="100%">
            {f.type === 'saturate' ? <FeColorMatrix type="saturate" values={f.values} /> : <FeColorMatrix type="matrix" values={f.values} />}
          </Filter>
        )}
        {!!blurs?.length && (
          <>
            {/* Strong enough that small words under it can't be read; the photo's filter goes on it too. */}
            <Filter id="soft" x="0" y="0" width="100%" height="100%">
              <FeGaussianBlur stdDeviation={Math.round(Math.max(24, w * 0.03))} />
              {f && (f.type === 'saturate' ? <FeColorMatrix type="saturate" values={f.values} /> : <FeColorMatrix type="matrix" values={f.values} />)}
            </Filter>
            <Mask id="hide" x="0" y="0" width={w} height={h} maskUnits="userSpaceOnUse">
              {blurs.map((s, i) => (
                <Path key={i} d={s.d} stroke="#FFFFFF" strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              ))}
            </Mask>
          </>
        )}
      </Defs>
      <SvgImage href={{ uri }} x={0} y={0} width={w} height={h} preserveAspectRatio="none" filter={f ? 'url(#look)' : undefined} />
      {!!blurs?.length && (
        <G mask="url(#hide)">
          <SvgImage href={{ uri }} x={0} y={0} width={w} height={h} preserveAspectRatio="none" filter="url(#soft)" />
        </G>
      )}
    </>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function Canvas({
  uri,
  box,
  strokes,
  layers,
  drawing,
  color,
  pen: penWidth = PEN,
  blur = false,
  filter,
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
  /** The pen's thickness (canvas units); blur: the blur pen. */
  pen?: number;
  blur?: boolean;
  filter?: number;
  onStroke: (s: Stroke) => void;
  onMove: (id: string, x: number, y: number, scale: number, rot: number) => void;
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
      if (d) scheduleOnRN(onStroke, { d: d.includes('L') ? d : `${d} l0.1 0`, color, width: blur ? BLUR_PEN : penWidth, ...(blur ? { blur: true } : {}) });
    },
  });
  const live = useAnimatedProps(() => ({ d: current.value || 'M0 0' }));

  return (
    <GestureDetector gesture={pen}>
      <View ref={shot} collapsable={false} style={{ width: box.w, height: box.h, overflow: 'hidden', backgroundColor: '#000' }} testID="editor-canvas">
        {/* The photo, in the SVG (so its filter and the blur pen go into the snapshot too). */}
        <Svg width={box.w} height={box.h} viewBox={`0 0 ${UNITS} ${unitsHigh}`} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
          <FilteredPhoto uri={uri} w={UNITS} h={unitsHigh} filter={filter} blurs={strokes.filter((s) => s.blur)} />
          {strokes.map((s, i) => (s.blur ? null : <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />))}
          {/* The line being drawn (the blur pen's shows as a pale line until it's let go). */}
          <AnimatedPath animatedProps={live} stroke={blur ? 'rgba(255,255,255,0.45)' : color} strokeWidth={blur ? BLUR_PEN : penWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
  onMove: (id: string, x: number, y: number, scale: number, rot: number) => void;
  onRemove: (id: string) => void;
  onTap?: () => void;
}) {
  const r = useSharedValue(layer.rot ?? 0);
  const fromR = useSharedValue(0);
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
      else scheduleOnRN(onMove, layer.id, x.value * k, y.value * k, s.value, r.value);
    },
  });
  // Two fingers turn it, like WhatsApp's.
  const turn = useRotationGesture({
    enabled,
    onBegin: () => {
      fromR.value = r.value;
    },
    onUpdate: (e) => {
      r.value = fromR.value + (e.rotation * 180) / Math.PI;
    },
    onFinalize: () => scheduleOnRN(onMove, layer.id, x.value * k, y.value * k, s.value, r.value),
  });
  const pinch = usePinchGesture({
    enabled,
    onBegin: () => {
      from.value = { x: x.value, y: y.value, s: s.value };
    },
    onUpdate: (e) => {
      s.value = Math.max(0.4, Math.min(5, from.value.s * e.scale));
    },
    onFinalize: () => scheduleOnRN(onMove, layer.id, x.value * k, y.value * k, s.value, r.value),
  });
  const tap = useTapGesture({
    enabled: enabled && !!onTap,
    onActivate: () => {
      if (onTap) scheduleOnRN(onTap);
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch, turn, tap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - half.value.w }, { translateY: y.value - half.value.h }, { scale: s.value }, { rotate: `${r.value}deg` }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) => half.set({ w: e.nativeEvent.layout.width / 2, h: e.nativeEvent.layout.height / 2 })}
        style={[{ position: 'absolute', top: 0, left: 0 }, style]}
        testID={`layer-${layer.kind}`}
      >
        {layer.kind === 'text' ? (
          <View style={[{ paddingHorizontal: 10, paddingVertical: 4, maxWidth: box.w * 0.9 }, layer.box && { backgroundColor: layer.color, borderRadius: 10 }]}>
            <Txt
              size={30}
              weight="800"
              color={layer.box ? boxInk(layer.color) : layer.color}
              align="center"
              style={[layer.box ? null : { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } }, layer.font ? FONTS[layer.font] : null]}
            >
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

/** Words on a box of their colour: dark words on a light box, white on a dark one. */
export function boxInk(colour: string) {
  const n = parseInt(colour.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? '#111111' : '#FFFFFF';
}
