// TrimStrip.tsx: the strip of little frames above a video in the editor. Drag
// either end to keep only part of the video; it says which part and roughly
// how big it will be ("0:03–0:15 · about 4 MB"). VideoShrink.kt does the cut.
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { Image } from 'expo-image';

import { videoSizeGuess, type Picked } from '../../../core/files';
import { fill, useT } from '../../../i18n';
import { useLook } from '../../../theme/ThemeProvider';
import { duration as clock, fileSize } from '../../format';
import { Txt } from '../../kit';

const FRAMES = 8;
const HANDLE = 16;
/** The shortest part you can keep. */
const MIN_MS = 1000;

export function TrimStrip({ p, length, onChange }: { p: Picked; length: number; onChange: (trim: { start: number; end: number }) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const start = p.trim?.start ?? 0;
  const end = p.trim?.end ?? length;
  const base = useRef({ start, end });

  // The little frames along the strip.
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: string[] = [];
      for (let i = 0; i < FRAMES; i++) {
        try {
          const f = await VideoThumbnails.getThumbnailAsync(p.uri, { time: Math.round(((i + 0.5) / FRAMES) * length), quality: 0.3 });
          out.push(f.uri);
        } catch {
          break;
        }
        if (!live) return;
        setFrames([...out]);
      }
    })();
    return () => {
      live = false;
    };
  }, [p.uri, length]);

  const inner = Math.max(1, width - HANDLE * 2);
  const msPerPt = length / inner;

  const left = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    onBegin: () => (base.current = { start, end }),
    onUpdate: (e) => {
      const next = Math.max(0, Math.min(base.current.end - MIN_MS, base.current.start + e.translationX * msPerPt));
      onChange({ start: Math.round(next), end: base.current.end });
    },
  });
  const right = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    onBegin: () => (base.current = { start, end }),
    onUpdate: (e) => {
      const next = Math.min(length, Math.max(base.current.start + MIN_MS, base.current.end + e.translationX * msPerPt));
      onChange({ start: base.current.start, end: Math.round(next) });
    },
  });

  const x0 = (start / length) * inner;
  const x1 = (end / length) * inner + HANDLE;
  const size = videoSizeGuess(p, end - start);

  return (
    <View style={{ gap: 6 }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 48, direction: 'ltr' }} testID="trim-strip">
        <View style={{ position: 'absolute', top: 2, bottom: 2, start: HANDLE, end: HANDLE, flexDirection: 'row', borderRadius: 6, overflow: 'hidden', backgroundColor: '#222' }}>
          {frames.map((f) => (
            <Image key={f} source={{ uri: f }} style={{ flex: 1, height: '100%' }} contentFit="cover" />
          ))}
        </View>
        {/* Dimmed outside the part that's kept. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 2, bottom: 2, left: HANDLE, width: x0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', top: 2, bottom: 2, left: x1, right: HANDLE, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: x0 + HANDLE, width: Math.max(0, x1 - x0 - HANDLE), borderTopWidth: 2, borderBottomWidth: 2, borderColor: theme.acc }} />
        <GestureDetector gesture={left}>
          <View hitSlop={14} accessibilityLabel={t.trimStart} style={{ position: 'absolute', top: 0, bottom: 0, left: x0, width: HANDLE, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }} testID="trim-start">
            <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
          </View>
        </GestureDetector>
        <GestureDetector gesture={right}>
          <View hitSlop={14} accessibilityLabel={t.trimEnd} style={{ position: 'absolute', top: 0, bottom: 0, left: x1, width: HANDLE, borderTopRightRadius: 8, borderBottomRightRadius: 8, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }} testID="trim-end">
            <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
          </View>
        </GestureDetector>
      </View>
      <Txt size={13} weight="600" color="#FFFFFF" align="center" style={{ fontVariant: ['tabular-nums'] }} testID="trim-label">
        {`${clock(start)}–${clock(end)} · ${fill(t.aboutSize, { size: fileSize(size) })}`}
      </Txt>
    </View>
  );
}
