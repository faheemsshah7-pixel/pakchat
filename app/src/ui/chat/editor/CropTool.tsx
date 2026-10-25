// CropTool.tsx: cropping and turning a photo in the editor. Drag a corner to
// crop, drag the middle to move the frame, ⟳ turns it a quarter. Done makes
// the new photo at full size (expo-image-manipulator).
import { useRef, useState } from 'react';
import { Image as RNImage, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { useT } from '../../../i18n';
import { useLook } from '../../../theme/ThemeProvider';
import { IconButton, Pressy, Txt } from '../../kit';

export type Rect = { x: number; y: number; w: number; h: number };
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
/** The frame can't get smaller than this part of the photo. */
const MIN = 0.12;

export function fit(size: { w: number; h: number }, area: { w: number; h: number }) {
  if (!size.w || !size.h || !area.w || !area.h) return { w: 0, h: 0 };
  const r = Math.min(area.w / size.w, area.h / size.h);
  return { w: Math.floor(size.w * r), h: Math.floor(size.h * r) };
}

type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'move';

export function CropTool({
  uri,
  size,
  area,
  busy,
  onCancel,
  onRotate,
  onDone,
}: {
  uri: string;
  size: { w: number; h: number };
  area: { w: number; h: number };
  busy: boolean;
  onCancel: () => void;
  onRotate: () => void;
  /** The part to keep, as parts of the photo (0 to 1). */
  onDone: (r: Rect) => void;
}) {
  const t = useT();
  const { theme } = useLook();
  const box = fit(size, { w: area.w - 32, h: area.h - 120 });
  const [rect, setRect] = useState<Rect>(FULL);
  const base = useRef(rect);

  const drag = (c: Corner) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    usePanGesture({
      runOnJS: true,
      minDistance: 0,
      onBegin: () => (base.current = rect),
      onUpdate: (e) => {
        const dx = e.translationX / Math.max(1, box.w);
        const dy = e.translationY / Math.max(1, box.h);
        const b = base.current;
        let { x, y, w, h } = b;
        if (c === 'move') {
          x = Math.min(1 - w, Math.max(0, b.x + dx));
          y = Math.min(1 - h, Math.max(0, b.y + dy));
        } else {
          if (c === 'tl' || c === 'bl') {
            x = Math.min(b.x + b.w - MIN, Math.max(0, b.x + dx));
            w = b.x + b.w - x;
          } else w = Math.min(1 - b.x, Math.max(MIN, b.w + dx));
          if (c === 'tl' || c === 'tr') {
            y = Math.min(b.y + b.h - MIN, Math.max(0, b.y + dy));
            h = b.y + b.h - y;
          } else h = Math.min(1 - b.y, Math.max(MIN, b.h + dy));
        }
        setRect({ x, y, w, h });
      },
    });
  const tl = drag('tl');
  const tr = drag('tr');
  const bl = drag('bl');
  const br = drag('br');
  const mv = drag('move');

  const px = { left: rect.x * box.w, top: rect.y * box.h, width: rect.w * box.w, height: rect.h * box.h };
  const corner = (g: typeof tl, style: object, id: string) => (
    <GestureDetector gesture={g}>
      <View hitSlop={16} style={[{ position: 'absolute', width: 28, height: 28, borderColor: '#FFFFFF' }, style]} testID={id} />
    </GestureDetector>
  );

  return (
    <View style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 22 }} testID="crop-tool">
      <View style={{ width: box.w, height: box.h, direction: 'ltr' }}>
        <RNImage source={{ uri }} style={{ width: box.w, height: box.h }} resizeMode="stretch" />
        {/* Dimmed outside the frame. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: px.top, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: px.top + px.height, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: px.left, top: px.top, height: px.height, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: px.left + px.width, right: 0, top: px.top, height: px.height, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <GestureDetector gesture={mv}>
          <View style={[{ position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF' }, px]} testID="crop-frame">
            {/* Thirds, to help line things up. */}
            <View pointerEvents="none" style={{ position: 'absolute', left: '33.3%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: '66.6%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', top: '33.3%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', top: '66.6%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
          </View>
        </GestureDetector>
        {corner(tl, { left: px.left - 3, top: px.top - 3, borderTopWidth: 4, borderLeftWidth: 4 }, 'crop-tl')}
        {corner(tr, { left: px.left + px.width - 25, top: px.top - 3, borderTopWidth: 4, borderRightWidth: 4 }, 'crop-tr')}
        {corner(bl, { left: px.left - 3, top: px.top + px.height - 25, borderBottomWidth: 4, borderLeftWidth: 4 }, 'crop-bl')}
        {corner(br, { left: px.left + px.width - 25, top: px.top + px.height - 25, borderBottomWidth: 4, borderRightWidth: 4 }, 'crop-br')}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <Pressy onPress={onCancel} label={t.cancel} scale={0.94} testID="crop-cancel">
          <Txt size={15} weight="700" color="#FFFFFF" style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
            {t.cancel}
          </Txt>
        </Pressy>
        <IconButton icon="rotate" label={t.rotateWord} look="onAccent" onPress={() => (setRect(FULL), onRotate())} disabled={busy} testID="crop-rotate" />
        <Pressy onPress={() => setRect(FULL)} label={t.resetWord} scale={0.94} testID="crop-reset">
          <Txt size={15} weight="700" color="#FFFFFF" style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
            {t.resetWord}
          </Txt>
        </Pressy>
        <Pressy onPress={() => onDone(rect)} label={t.doneWord} scale={0.94} disabled={busy} testID="crop-done">
          <View style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14, backgroundColor: theme.acc }}>
            <Txt size={15} weight="700" color="#FFFFFF">
              {t.doneWord}
            </Txt>
          </View>
        </Pressy>
      </View>
    </View>
  );
}
