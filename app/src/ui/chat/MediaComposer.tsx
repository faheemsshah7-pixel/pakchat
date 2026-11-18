// MediaComposer.tsx: the black, full-screen editor that photos and videos go
// through before they're sent, like WhatsApp's.
//
//   Top      ✕ · 🛡 Private · HD · (photos) crop and turn, stickers, words, drawing;
//            (videos) the sound, stickers, words and drawing
//   Middle   the photo (or the video, playing, with the trim strip under it)
//   Bottom   the row of everything picked (+ adds more), a caption for each,
//            ① view once, "→ Name", and the round send button
//
// "Private": where a photo or video was taken and the camera's details never
// go with it (files.ts makes a fresh copy of each).
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image as RNImage, Keyboard, KeyboardAvoidingView, Modal, PixelRatio, Pressable, ScrollView, TextInput, useWindowDimensions, View, type TextInputInstance } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { core } from '../../core/core';
import { videoSizeGuess, type Picked } from '../../core/files';
import { useSavedStickers } from '../../core/hooks';
import { PACK } from '../../core/stickers';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration, fileSize } from '../format';
import { Icon, type IconName } from '../icons';
import { fontStyle, Pressy, Txt } from '../kit';
import { fadeIn, fadeOut, tick } from '../motion';
import { Dialog, Sheet, toast } from '../overlays';
import { boxInk, Canvas, FilteredPhoto, FILTERS, FONTS, PENS, type CanvasRef, type Layer, type NewLayer, type Stroke, UNITS } from './editor/Canvas';
import { CropTool, fit, type Rect } from './editor/CropTool';
import { TrimStrip } from './editor/TrimStrip';
import { EMOJI } from './ExtrasPanel';
import { OnceToggle } from './VoiceRecorder';
import { GALLERY_MAX } from './Gallery';

export type Ready = Picked & { caption?: string };

/** `filter`: one of the colour filters (Canvas.tsx FILTERS). */
type Draft = { key: string; p: Picked; caption: string; strokes: Stroke[]; layers: Layer[]; filter?: number };
type Tool = null | 'crop' | 'draw' | 'text' | 'sticker' | 'filter';

const COLORS = ['#FFFFFF', '#111111', '#E5484D', '#F5A524', '#FFE14D', '#30C76F', '#2F80ED', '#9B5CF6', '#F062B0'];

const editable = (p: Picked) => p.kind === 'image' && p.mime !== 'image/gif';
const squeezable = (p: Picked) => (p.kind === 'image' && p.mime !== 'image/gif') || (p.kind === 'video' && !p.gif);

/** A video longer than this (a status: a minute, like WhatsApp's) starts cut to it, and can't be kept longer. */
const capped = (p: Picked, max?: number): Picked =>
  max && p.kind === 'video' && !p.gif && p.duration && p.duration > max && !p.trim ? { ...p, trim: { start: 0, end: max } } : p;

export function MediaComposer({
  items,
  to,
  maxVideoMs,
  noOnce,
  onClose,
  onMore,
  onSend,
}: {
  items: Picked[];
  /** Who it goes to ("→ Ayesha"). */
  to: string;
  /** The longest a video can be (a status: a minute). */
  maxVideoMs?: number;
  /** No "view once" (a status). */
  noOnce?: boolean;
  onClose: () => void;
  /** + : more from the gallery. */
  onMore: () => Promise<Picked[]>;
  onSend: (list: Ready[]) => void;
}) {
  const t = useT();
  const { theme, lang, rtl } = useLook();
  const insets = useSafeAreaInsets();
  // A narrow phone: "Private" is just its icon, so every tool fits on the top row.
  const narrow = useWindowDimensions().width < 400;
  const caption = useRef<TextInputInstance>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() => items.map((p) => ({ key: core.newId(), p: capped(p, maxVideoMs), caption: '', strokes: [], layers: [] })));
  const [at, setAt] = useState(0);
  // Starts as Settings › Storage › Media upload quality says.
  const [hd, setHd] = useState(() => !!core.settings.uploadHd);
  const [once, setOnce] = useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState<{ id: string | null; text: string; font: number; box: boolean } | null>(null);
  // The pen: which thickness, or the blur pen.
  const [pen, setPen] = useState(1);
  const [blur, setBlur] = useState(false);
  const [hdSheet, setHdSheet] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const shot = useRef<CanvasRef>(null);
  // Where a video shows on screen (the drawing's canvas sits exactly on it).
  const [videoBox, setVideoBox] = useState({ w: 0, h: 0 });

  const d = drafts[Math.min(at, drafts.length - 1)];
  const p = d?.p;
  const isVideo = p?.kind === 'video' && !p.gif;
  // No blur pen on a video (a blur needs the picture under it, and a video's moves).
  const blurOn = blur && !isVideo;
  // The photo's own size (the gallery usually says; a fresh copy might not, so it's read).
  const [measured, setMeasured] = useState<{ uri: string; w: number; h: number } | null>(null);
  const size = p?.width && p.height ? { w: p.width, h: p.height } : measured?.uri === p?.uri && measured ? measured : { w: 0, h: 0 };
  useEffect(() => {
    if (!p || p.kind !== 'image' || (p.width && p.height)) return;
    const uri = p.uri;
    RNImage.getSize(
      uri,
      (w, h) => setMeasured({ uri, w, h }),
      () => setMeasured({ uri, w: 1, h: 1 }),
    );
  }, [p]);

  const change = (key: string, next: Partial<Draft>) => setDrafts((all) => all.map((x) => (x.key === key ? { ...x, ...next } : x)));
  const changeP = (key: string, next: Partial<Picked>) => setDrafts((all) => all.map((x) => (x.key === key ? { ...x, p: { ...x.p, ...next } } : x)));

  /** Drawings, words and stickers become part of the photo (a snapshot of the canvas). */
  async function flatten(x: Draft): Promise<Draft> {
    if (x.p.kind === 'video') return snapVideo(x);
    if (!x.strokes.length && !x.layers.length && !x.filter) return x;
    if (!shot.current || x.key !== d?.key) return x;
    const box = fit(size, area);
    const uri = await captureRef(shot, { format: 'jpg', quality: 0.95, result: 'tmpfile' });
    const scale = PixelRatio.get();
    const flat: Draft = { ...x, strokes: [], layers: [], filter: undefined, p: { ...x.p, uri: uri.startsWith('file:') ? uri : `file://${uri}`, mime: 'image/jpeg', width: Math.round(box.w * scale), height: Math.round(box.h * scale), size: undefined, edited: true } };
    setDrafts((all) => all.map((y) => (y.key === x.key ? flat : y)));
    return flat;
  }

  /**
   * A video's drawing, words and stickers: a see-through picture of them, put on every
   * frame when it's sent (files.ts, VideoShrink.kt). They stay on the draft too, to change
   * when you come back to it.
   */
  async function snapVideo(x: Draft): Promise<Draft> {
    const keep = (y: Draft) => {
      setDrafts((all) => all.map((z) => (z.key === y.key ? y : z)));
      return y;
    };
    if (!x.strokes.length && !x.layers.length) return x.p.overlay ? keep({ ...x, p: { ...x.p, overlay: undefined } }) : x;
    if (!shot.current || x.key !== d?.key) return x;
    const uri = await captureRef(shot, { format: 'png', result: 'tmpfile' });
    return keep({ ...x, p: { ...x.p, overlay: uri.startsWith('file:') ? uri : `file://${uri}` } });
  }

  async function goTo(i: number) {
    if (i === at || busy) return;
    if (d) await flatten(d).catch(() => d);
    setTool(null);
    setAt(i);
  }

  async function rotate() {
    if (!d || busy) return;
    setBusy(true);
    try {
      const x = await flatten(d);
      const ctx = ImageManipulator.manipulate(x.p.uri);
      ctx.rotate(-90);
      const img = await ctx.renderAsync();
      const saved = await img.saveAsync({ compress: 0.97, format: SaveFormat.JPEG });
      changeP(x.key, { uri: saved.uri, mime: 'image/jpeg', width: saved.width, height: saved.height, size: undefined, edited: true });
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  async function crop(r: Rect) {
    if (!d || busy) return;
    if (r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1) return setTool(null);
    setBusy(true);
    try {
      const x = await flatten(d);
      const w = x.p.width ?? size.w;
      const h = x.p.height ?? size.h;
      const ctx = ImageManipulator.manipulate(x.p.uri);
      ctx.crop({ originX: Math.round(r.x * w), originY: Math.round(r.y * h), width: Math.max(1, Math.round(r.w * w)), height: Math.max(1, Math.round(r.h * h)) });
      const img = await ctx.renderAsync();
      const saved = await img.saveAsync({ compress: 0.97, format: SaveFormat.JPEG });
      changeP(x.key, { uri: saved.uri, mime: 'image/jpeg', width: saved.width, height: saved.height, size: undefined, edited: true });
      setTool(null);
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  /** Closing with drawing, words, stickers or a filter on a photo: "Discard changes?" first, like WhatsApp. */
  function tryClose() {
    if (drafts.some((x) => x.strokes.length || x.layers.length || x.filter || x.p.edited || x.p.mute || x.p.trim)) setDiscard(true);
    else onClose();
  }

  // Swiping the photo sideways goes to the next (or last) one picked, like WhatsApp.
  const swipe = usePanGesture({
    enabled: drafts.length > 1 && !tool,
    activeOffsetX: [-30, 30],
    failOffsetY: [-20, 20],
    onDeactivate: (e) => {
      if (Math.abs(e.translationX) > 60 || Math.abs(e.velocityX) > 600) scheduleOnRN(swiped, e.translationX < 0 ? 1 : -1);
    },
  });
  function swiped(step: number) {
    const i = at + (rtl ? -step : step);
    if (i >= 0 && i < drafts.length) void goTo(i);
  }

  async function addMore() {
    if (drafts.length >= GALLERY_MAX) return;
    const more = await onMore().catch(() => []);
    if (!more.length) return;
    if (d) await flatten(d).catch(() => d);
    setDrafts((all) => [...all, ...more.map((m) => ({ key: core.newId(), p: capped(m, maxVideoMs), caption: '', strokes: [], layers: [] }))].slice(0, GALLERY_MAX));
    setAt(drafts.length);
    setTool(null);
  }

  function remove() {
    if (drafts.length <= 1) return onClose();
    setDrafts((all) => all.filter((x) => x.key !== d.key));
    setAt((i) => Math.max(0, Math.min(i, drafts.length - 2)));
    setTool(null);
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      const last = d ? await flatten(d) : d;
      const all = drafts.map((x) => (x.key === last?.key ? last : x));
      const single = all.length === 1;
      onSend(
        all.map((x) => ({
          ...x.p,
          hd,
          ...(once && single && squeezable(x.p) ? { once: true as const } : {}),
          caption: x.caption.trim() || undefined,
        })),
      );
    } catch {
      toast(t.couldNot);
      setBusy(false);
    }
  }

  function addLayer(l: NewLayer) {
    const box = isVideo ? videoBox : fit(size, area);
    const k = UNITS / Math.max(1, box.w);
    change(d.key, { layers: [...d.layers, { ...l, id: core.newId(), x: (box.w / 2) * k, y: (box.h / 2.4) * k, scale: 1, rot: 0 } as Layer] });
  }

  /** About how big it goes, for the quality sheet (a single video: from its length). */
  function sizeNote(on: boolean) {
    if (drafts.length !== 1 || p?.kind !== 'video' || p.gif) return null;
    const len = p.trim ? p.trim.end - p.trim.start : p.duration;
    if (!len) return null;
    return fill(t.aboutSize, { size: fileSize(videoSizeGuess(p, len, on)) });
  }

  if (!d) return null;
  const box = p.kind === 'image' ? fit(size, area) : { w: 0, h: 0 };
  const canOnce = !noOnce && drafts.length === 1 && squeezable(p);
  const canHd = drafts.some((x) => squeezable(x.p));

  type Tb = { icon: IconName; label: string; on: () => void; active?: boolean; id: string };
  // Stickers, words and the pen: on photos and videos alike.
  const drawTools: Tb[] = [
    { icon: 'sticker', label: t.sticker, on: () => setTool('sticker'), active: tool === 'sticker', id: 'tool-sticker' },
    { icon: 'text', label: t.textWord, on: () => (setTool('text'), setWriting({ id: null, text: '', font: 0, box: false })), active: tool === 'text', id: 'tool-text' },
    { icon: 'draw', label: t.drawWord, on: () => setTool(tool === 'draw' ? null : 'draw'), active: tool === 'draw', id: 'tool-draw' },
  ];
  const top: Tb[] = editable(p)
    ? [
        { icon: 'crop', label: t.cropWord, on: () => setTool(tool === 'crop' ? null : 'crop'), active: tool === 'crop', id: 'tool-crop' },
        { icon: 'filters', label: t.filtersWord, on: () => setTool(tool === 'filter' ? null : 'filter'), active: tool === 'filter', id: 'tool-filter' },
        ...drawTools,
      ]
    : isVideo
      ? // A video: send it without its sound, like WhatsApp's speaker button; and the pen, words and stickers.
        [{ icon: p.mute ? 'speakerOff' : 'speaker', label: p.mute ? t.soundOff : t.soundOn, on: () => (tick(), changeP(d.key, { mute: !p.mute })), active: !!p.mute, id: 'video-mute' }, ...drawTools]
      : [];

  // The canvas's part (the same on a photo and over a video).
  const canvasProps = {
    strokes: d.strokes,
    layers: d.layers,
    drawing: tool === 'draw',
    color,
    pen: PENS[pen],
    shot,
    onStroke: (s: Stroke) => change(d.key, { strokes: [...d.strokes, s] }),
    onMove: (id: string, x: number, y: number, scale: number, rot: number) => change(d.key, { layers: d.layers.map((l) => (l.id === id ? { ...l, x, y, scale, rot } : l)) }),
    onRemove: (id: string) => change(d.key, { layers: d.layers.filter((l) => l.id !== id) }),
    onEditText: (id: string) => {
      const l = d.layers.find((x) => x.id === id);
      if (l?.kind === 'text') {
        setColor(l.color);
        setWriting({ id, text: l.text, font: l.font ?? 0, box: !!l.box });
        setTool('text');
      }
    },
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => (tool ? setTool(null) : tryClose())} statusBarTranslucent navigationBarTranslucent>
      {/* A pop-up is a window of its own: without its own gesture root, the pen, the trim strip,
          crop, and moving stickers and words get no touches on Android (owner, 18 Nov). */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
        {/* Top: close, Private, HD, and the photo tools. */}
        <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 3 }}>
          <Round icon="close" label={t.close} onPress={tryClose} id="editor-close" />
          <Pressy ripple="light" onPress={() => toast(t.privateNote)} label={t.privateWord} scale={0.94} testID="editor-private">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: narrow ? 8 : 10, minHeight: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)' }}>
              <Icon name="privateBadge" size={15} color="#FFFFFF" />
              {!narrow && (
                <Txt size={12.5} weight="700" color="#FFFFFF">
                  {t.privateWord}
                </Txt>
              )}
            </View>
          </Pressy>
          <View style={{ flex: 1 }} />
          {canHd && (
            <Pressy
              // A little sheet to choose, like WhatsApp's: Standard or HD.
              onPress={() => setHdSheet(true)}
              label={t.hdQuality}
              scale={0.9}
              testID="send-hd"
            >
              <View style={{ minHeight: 30, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.6, borderColor: hd ? theme.acc : '#FFFFFF', backgroundColor: hd ? theme.acc : 'transparent', justifyContent: 'center', marginHorizontal: 4 }}>
                <Txt size={13} weight="800" color="#FFFFFF">
                  HD
                </Txt>
              </View>
            </Pressy>
          )}
          {top.map((x) => (
            <Round key={x.id} icon={x.icon} label={x.label} onPress={x.on} active={x.active} id={x.id} />
          ))}
          {drafts.length > 1 && <Round icon="trash" label={t.delete} onPress={remove} id="editor-remove" />}
        </View>

        {/* The photo or video. */}
        <GestureDetector gesture={swipe}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {p.kind === 'image' && box.w > 0 && editable(p) ? (
            <Canvas key={d.key + p.uri} uri={p.uri} box={box} blur={blur} filter={d.filter} {...canvasProps} />
          ) : p.kind === 'image' ? (
            <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
          ) : p.kind === 'video' ? (
            <VideoPart
              key={d.key}
              p={p}
              max={maxVideoMs}
              quiet={!!p.mute}
              busy={!!tool}
              onBox={setVideoBox}
              overlay={isVideo ? (vbox) => <Canvas key={d.key} uri={p.uri} box={vbox} clear {...canvasProps} /> : undefined}
              onTrim={(trim) => changeP(d.key, { trim })}
              onLength={(ms) => !p.duration && setDrafts((all) => all.map((x) => (x.key === d.key ? { ...x, p: capped({ ...x.p, duration: ms }, maxVideoMs) } : x)))}
            />
          ) : (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <Icon name={p.kind === 'audio' ? 'music' : 'doc'} size={64} color="#FFFFFF" />
              <Txt size={16} weight="600" color="#FFFFFF" align="center">
                {p.name ?? t.document}
              </Txt>
            </View>
          )}

          {/* Drawing: undo, the colour slider down the side (any colour, like WhatsApp's), and along the
              bottom the three thicknesses and the blur pen. */}
          {tool === 'draw' && (
            <Animated.View entering={fadeIn} exiting={fadeOut} style={{ position: 'absolute', end: 10, top: 10, gap: 10, alignItems: 'center' }}>
              <Round icon="undo" label={t.undoWord} onPress={() => change(d.key, { strokes: d.strokes.slice(0, -1) })} id="draw-undo" />
              {!blurOn && <ColourSlider color={color} onPick={setColor} />}
            </Animated.View>
          )}
          {tool === 'draw' && (
            <Animated.View entering={fadeIn} exiting={fadeOut} style={{ position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)' }}>
              {PENS.map((w, i) => (
                <Pressy key={w} ripple="light" onPress={() => (setPen(i), setBlur(false))} label={`${t.penSize} ${i + 1}`} round testID={`pen-${i}`}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: !blurOn && pen === i ? 'rgba(255,255,255,0.22)' : 'transparent' }}>
                    <View style={{ width: 6 + i * 6, height: 6 + i * 6, borderRadius: 10, backgroundColor: color }} />
                  </View>
                </Pressy>
              ))}
              {!isVideo && (
                <Pressy ripple="light" onPress={() => setBlur(!blur)} label={t.blurPen} round testID="pen-blur">
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: blur ? 'rgba(255,255,255,0.22)' : 'transparent' }}>
                    <Icon name="blurPen" size={20} color="#FFFFFF" />
                  </View>
                </Pressy>
              )}
            </Animated.View>
          )}

          {tool === 'crop' && size.w > 0 && (
            <CropTool uri={p.uri} size={size} area={area} busy={busy} onCancel={() => setTool(null)} onRotate={() => void rotate()} onDone={(r) => void crop(r)} />
          )}
        </View>
        </GestureDetector>

        {/* Filters: a strip of small copies of the photo, one per filter, like WhatsApp's. */}
        {tool === 'filter' && editable(p) && (
          <Animated.View entering={fadeIn} exiting={fadeOut}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
              {FILTERS.map((_, i) => (
                <Pressy key={i} ripple="light" onPress={() => (tick(), change(d.key, { filter: i || undefined }))} label={t.filterNames[i] ?? ''} scale={0.94} testID={`filter-${i}`}>
                  <View style={{ alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 62, height: 62, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: (d.filter ?? 0) === i ? theme.acc : 'transparent' }}>
                      <Svg width={58} height={58} viewBox="0 0 58 58">
                        <FilteredPhoto uri={p.uri} w={58} h={58} filter={i} />
                      </Svg>
                    </View>
                    <Txt size={11.5} weight="600" color="#FFFFFF">
                      {t.filterNames[i] ?? ''}
                    </Txt>
                  </View>
                </Pressy>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Bottom: everything picked, the caption, and send. */}
        {tool !== 'crop' && (
          <View style={{ paddingBottom: insets.bottom + 10, paddingHorizontal: 10, gap: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
              {drafts.length > 1 &&
                drafts.map((x, i) => (
                  <Pressy key={x.key} onPress={() => void goTo(i)} label={`${i + 1}`} scale={0.92} testID={`editor-thumb-${i}`}>
                    <View style={{ width: 54, height: 54, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: i === at ? theme.acc : 'transparent', backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' }}>
                      {x.p.kind === 'image' || x.p.kind === 'video' ? (
                        <Image source={{ uri: x.p.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      ) : (
                        <Icon name={x.p.kind === 'audio' ? 'music' : 'doc'} size={22} color="#FFFFFF" />
                      )}
                      {x.p.kind === 'video' && (
                        <View style={{ position: 'absolute', bottom: 2, start: 3 }}>
                          <Icon name="video" size={12} color="#FFFFFF" />
                        </View>
                      )}
                    </View>
                  </Pressy>
                ))}
              <Pressy ripple="light" onPress={() => void addMore()} label={t.addMoreMedia} scale={0.92} testID="editor-more">
                <View style={{ width: 54, height: 54, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="plus" size={22} color="#FFFFFF" />
                </View>
              </Pressy>
            </ScrollView>

            {emoji && (
              <Animated.View entering={fadeIn} exiting={fadeOut} style={{ height: 160, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }} keyboardShouldPersistTaps="handled">
                  {EMOJI.map((e) => (
                    <Pressy key={e} onPress={() => change(d.key, { caption: d.caption + e })} label={e} scale={0.85}>
                      <View style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
                        <Txt size={26}>{e}</Txt>
                      </View>
                    </Pressy>
                  ))}
                </ScrollView>
              </Animated.View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 6, paddingEnd: 6, minHeight: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.13)' }}>
              {/* The smiley, like WhatsApp's caption box. */}
              {/* The emoji panel and the keyboard take turns, so the photo stays in view. */}
              <Pressy
                ripple="light"
                onPress={() => {
                  if (emoji) {
                    setEmoji(false);
                    caption.current?.focus();
                  } else {
                    Keyboard.dismiss();
                    setEmoji(true);
                  }
                }}
                label={t.emojiWord}
                round
                testID="caption-emoji"
              >
                <View style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={emoji ? 'keyboard' : 'emoji'} size={22} color="#FFFFFF" />
                </View>
              </Pressy>
              <TextInput
                ref={caption}
                key={d.key}
                value={d.caption}
                onFocus={() => setEmoji(false)}
                onChangeText={(caption) => change(d.key, { caption })}
                placeholder={t.addCaption}
                placeholderTextColor="rgba(255,255,255,0.6)"
                selectionColor={theme.acc}
                cursorColor={theme.acc}
                multiline
                maxLength={1000}
                style={[fontStyle(d.caption || null, lang, 16, '400'), { flex: 1, color: '#FFFFFF', maxHeight: 110, paddingVertical: 10 }]}
                testID="caption"
              />
              {canOnce && <OnceToggle on={once} onChange={setOnce} light />}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, flexDirection: 'row' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.13)' }}>
                  <Icon name="forwardArrow" size={15} color="#FFFFFF" flip />
                  <Txt size={14} weight="700" color="#FFFFFF" lines={1} style={{ flexShrink: 1 }}>
                    {to}
                  </Txt>
                </View>
              </View>
              <Pressy ripple="light" onPress={() => void send()} label={t.send} scale={0.9} disabled={busy} testID="send-file">
                <LinearGradient colors={theme.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', boxShadow: `0 10px 24px -8px ${theme.acc}` }}>
                  <Icon name="send" size={23} color="#FFFFFF" stroke={2} flip />
                  {drafts.length > 1 && (
                    <View style={{ position: 'absolute', top: -4, end: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                      <Txt size={12} weight="800" color={theme.accInk}>
                        {drafts.length}
                      </Txt>
                    </View>
                  )}
                </LinearGradient>
              </Pressy>
            </View>
          </View>
        )}

        {/* Words: write them big, pick a colour, Done puts them on the photo. */}
        {tool === 'text' && writing && (
          <Animated.View entering={fadeIn} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', paddingTop: insets.top + 10, zIndex: 5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
              {/* Like WhatsApp's: the next font, and the words on a box of their colour. */}
              <Pressy ripple="light" onPress={() => setWriting({ ...writing, font: (writing.font + 1) % FONTS.length })} label={t.statusFont} round testID="text-font">
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
                  <Txt size={19} weight="700" color="#FFFFFF" style={writing.font ? FONTS[writing.font] : undefined}>
                    Aa
                  </Txt>
                </View>
              </Pressy>
              <Pressy ripple="light" onPress={() => setWriting({ ...writing, box: !writing.box })} label={t.textBox} round testID="text-box">
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: writing.box ? '#FFFFFF' : 'rgba(255,255,255,0.12)' }}>
                  <Txt size={17} weight="800" color={writing.box ? '#000000' : '#FFFFFF'}>
                    A
                  </Txt>
                </View>
              </Pressy>
              <View style={{ flex: 1 }} />
              <Pressy
                onPress={() => {
                  const text = writing.text.trim();
                  const look = { font: writing.font || undefined, box: writing.box || undefined };
                  if (writing.id) change(d.key, { layers: text ? d.layers.map((l) => (l.id === writing.id && l.kind === 'text' ? { ...l, text, color, ...look } : l)) : d.layers.filter((l) => l.id !== writing.id) });
                  else if (text) addLayer({ kind: 'text', text, color, ...look });
                  setWriting(null);
                  setTool(null);
                }}
                label={t.doneWord}
                scale={0.94}
                testID="text-done"
              >
                <View style={{ paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, backgroundColor: theme.acc }}>
                  <Txt size={15} weight="700" color="#FFFFFF">
                    {t.doneWord}
                  </Txt>
                </View>
              </Pressy>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
              <TextInput
                autoFocus
                value={writing.text}
                onChangeText={(text) => setWriting({ ...writing, text })}
                placeholder={t.typeSomething}
                placeholderTextColor="rgba(255,255,255,0.5)"
                multiline
                maxLength={200}
                style={[
                  fontStyle(writing.text || null, lang, 30, '800'),
                  { color: writing.box ? boxInk(color) : color, textAlign: 'center' },
                  writing.box && { backgroundColor: color, borderRadius: 12, alignSelf: 'center', paddingHorizontal: 12 },
                  writing.font ? FONTS[writing.font] : null,
                ]}
                testID="text-input"
              />
            </View>
            <View style={{ paddingBottom: 14 }}>
              <Colors color={color} onPick={setColor} />
            </View>
          </Animated.View>
        )}
      </KeyboardAvoidingView>
      </GestureHandlerRootView>

      <Sheet visible={hdSheet} onClose={() => setHdSheet(false)} title={t.mediaQuality}>
        {(
          [
            [false, t.standardQuality, t.hdOffNote],
            [true, t.hdQuality, t.hdOnNote],
          ] as const
        ).map(([on, label, note]) => (
          <Pressy
            key={label}
            onPress={() => {
              tick();
              setHd(on);
              setHdSheet(false);
            }}
            label={label}
            scale={0.98}
            testID={on ? 'quality-hd' : 'quality-standard'}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: hd === on ? theme.acc : theme.muted, alignItems: 'center', justifyContent: 'center' }}>
                {hd === on && <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: theme.acc }} />}
              </View>
              <View style={{ flex: 1 }}>
                <Txt size={15.5} weight="600">
                  {label}
                </Txt>
                <Txt size={13} color={theme.muted}>
                  {sizeNote(on) ?? note}
                </Txt>
              </View>
            </View>
          </Pressy>
        ))}
      </Sheet>
      <Dialog
        visible={discard}
        onClose={() => setDiscard(false)}
        title={t.discardChanges}
        buttons={[
          { label: t.cancel, onPress: () => setDiscard(false) },
          { label: t.discardWord, danger: true, onPress: () => (setDiscard(false), onClose()), testID: 'editor-discard' },
        ]}
      />
      <StickerPicker
        visible={tool === 'sticker'}
        onClose={() => setTool(null)}
        onPick={(l) => {
          setTool(null);
          addLayer(l);
        }}
      />
    </Modal>
  );
}

/** A round see-through button on the black. */
function Round({ icon, label, onPress, active, id }: { icon: IconName; label: string; onPress: () => void; active?: boolean; id: string }) {
  const { theme } = useLook();
  return (
    <Pressy ripple="light" onPress={onPress} label={label} scale={0.88} testID={id}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.acc : 'rgba(255,255,255,0.12)' }}>
        <Icon name={icon} size={20} color="#FFFFFF" />
      </View>
    </Pressy>
  );
}

function Colors({ color, onPick, vertical }: { color: string; onPick: (c: string) => void; vertical?: boolean }) {
  return (
    <View style={{ flexDirection: vertical ? 'column' : 'row', justifyContent: 'center', gap: vertical ? 8 : 10 }}>
      {COLORS.map((c) => (
        <Pressy key={c} onPress={() => onPick(c)} label={c} scale={0.85} testID={`color-${c.slice(1)}`}>
          <View style={{ width: color === c ? 30 : 24, height: color === c ? 30 : 24, borderRadius: 15, backgroundColor: c, borderWidth: 2, borderColor: color === c ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }} />
        </Pressy>
      ))}
    </View>
  );
}

/** The colour slider: drag along it for any colour (white at the top, black at the bottom), like WhatsApp's. */
const SLIDER = 200;
const HUES = ['#FFFFFF', '#FF0000', '#FF8A00', '#FFE600', '#2EE61A', '#00D5FF', '#2050FF', '#B020FF', '#FF2D9B', '#000000'];
function colourAt(f: number) {
  const n = HUES.length - 1;
  const at = Math.min(n, Math.max(0, f * n));
  const i = Math.min(n - 1, Math.floor(at));
  const mix = at - i;
  const a = parseInt(HUES[i].slice(1), 16);
  const b = parseInt(HUES[i + 1].slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - mix) + ((b >> sh) & 255) * mix);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0').toUpperCase()}`;
}
function ColourSlider({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const pick = (y: number) => onPick(colourAt(y / SLIDER));
  const drag = usePanGesture({
    minDistance: 0,
    onBegin: (e) => {
      scheduleOnRN(pick, e.y);
    },
    onUpdate: (e) => {
      scheduleOnRN(pick, e.y);
    },
  });
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color, borderWidth: 2, borderColor: '#FFFFFF' }} />
      <GestureDetector gesture={drag}>
        <View style={{ width: 28, height: SLIDER, alignItems: 'center' }} testID="colour-slider">
          <LinearGradient colors={HUES as unknown as [string, string, ...string[]]} style={{ width: 12, height: SLIDER, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' }} />
        </View>
      </GestureDetector>
    </View>
  );
}

/** Stickers (PakChat's pack and my saved ones) and emoji to put on a photo. */
function StickerPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (l: NewLayer) => void }) {
  const t = useT();
  const saved = useSavedStickers();
  return (
    <Sheet visible={visible} onClose={onClose} title={t.stickers}>
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 8, gap: 4 }}>
        {[...saved.map((s) => s.uri), ...PACK.map((s) => s.source)].map((src, i) => (
          <Animated.View key={String(src)}>
            <Pressy ripple="light" onPress={() => onPick({ kind: 'sticker', source: src })} label={t.sticker} scale={0.88} testID={i === 0 ? 'editor-sticker-first' : undefined}>
              <Image source={typeof src === 'number' ? src : { uri: src }} style={{ width: 76, height: 76, margin: 2 }} contentFit="contain" />
            </Pressy>
          </Animated.View>
        ))}
        {EMOJI.map((e) => (
          <Pressy key={e} onPress={() => onPick({ kind: 'emoji', text: e })} label={e} scale={0.85}>
            <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={28} align="center">
                {e}
              </Txt>
            </View>
          </Pressy>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** Turns a player's sound off or on (the speaker button: how it will go). */
function soundOff(player: ReturnType<typeof useVideoPlayer>, quiet: boolean) {
  player.muted = quiet;
}

/**
 * A video playing over and over (only the part that's kept), with the trim strip under it.
 * `overlay`: the drawing's canvas, laid exactly on the picture (`onBox` says where that is).
 * `busy`: a tool is open (no tap to stop it, and the trim strip hidden under the pens).
 */
function VideoPart({
  p,
  max,
  quiet,
  busy,
  overlay,
  onBox,
  onTrim,
  onLength,
}: {
  p: Picked;
  max?: number;
  quiet: boolean;
  busy?: boolean;
  overlay?: (box: { w: number; h: number }) => ReactNode;
  onBox?: (box: { w: number; h: number }) => void;
  onTrim: (trim: { start: number; end: number }) => void;
  onLength: (ms: number) => void;
}) {
  const t = useT();
  // Its shape as it's seen (a first frame comes turned the right way; the player's size doesn't).
  const [shape, setShape] = useState<{ w: number; h: number } | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!overlay) return;
    let on = true;
    VideoThumbnails.getThumbnailAsync(p.uri, { time: 0, quality: 0.1 })
      .then((f) => on && f.width > 0 && f.height > 0 && setShape({ w: f.width, h: f.height }))
      .catch(() => {});
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.uri, !!overlay]);
  const box = shape ? fit(shape, room) : null;
  useEffect(() => {
    if (box) onBox?.(box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.w, box?.h]);
  const player = useVideoPlayer({ uri: p.uri }, (pl) => {
    pl.loop = true;
    pl.muted = false;
    pl.timeUpdateEventInterval = 0.25;
    pl.play();
  });
  const [length, setLength] = useState(p.duration ?? 0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => soundOff(player, quiet), [player, quiet]);
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && !length && player.duration > 0) {
      const ms = Math.round(player.duration * 1000);
      setLength(ms);
      onLength(ms);
    }
  });
  // Only the part that's kept plays.
  const start = p.trim?.start ?? 0;
  const end = p.trim?.end ?? length;
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!length) return;
    if (currentTime * 1000 >= end - 80 || currentTime * 1000 < start - 300) player.seekBy(start / 1000 - currentTime);
  });
  const gif = !!p.gif;
  return (
    <View style={{ flex: 1, alignSelf: 'stretch' }}>
      <View style={{ flex: 1 }} onLayout={(e) => setRoom({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {/* A tap stops and starts it, with ▶ in the middle while stopped (like WhatsApp). The player
            itself never gets a touch: Android's player view takes the finger away from the pen. */}
        <Pressable style={{ flex: 1 }} disabled={busy} onPress={() => (playing ? player.pause() : player.play())} accessibilityLabel={playing ? t.pause : t.play}>
          <View pointerEvents="none" style={{ flex: 1 }}>
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} testID="editor-video" />
          </View>
        </Pressable>
        {!playing && !busy && (
          <Animated.View entering={fadeIn} exiting={fadeOut} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="play" size={28} color="#FFFFFF" />
            </View>
          </Animated.View>
        )}
        {/* The drawing, on top of the picture (not inside the tap above). */}
        {overlay && box && box.w > 0 && (
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
            {overlay(box)}
          </View>
        )}
      </View>
      {/* While drawing, the strip only steps out of the way (its room stays), so the picture and
          the drawing on it keep the same size. */}
      {!gif && length > 1500 && (
        <View pointerEvents={busy ? 'none' : 'auto'} style={{ paddingHorizontal: 30, paddingTop: 10, paddingBottom: 2, opacity: busy ? 0 : 1 }}>
          <TrimStrip
            p={p}
            length={length}
            max={max}
            onChange={(trim) => {
              onTrim(trim);
              player.seekBy(trim.start / 1000 - player.currentTime);
            }}
          />
        </View>
      )}
      {gif && (
        <Txt size={13} color="rgba(255,255,255,0.7)" align="center" style={{ paddingVertical: 6 }}>
          {t.gifWord}
        </Txt>
      )}
      {!gif && !!length && length <= 1500 && (
        <Txt size={13} color="rgba(255,255,255,0.7)" align="center" style={{ paddingVertical: 6 }}>
          {fill(t.videoLength, { time: duration(length) })}
        </Txt>
      )}
    </View>
  );
}
