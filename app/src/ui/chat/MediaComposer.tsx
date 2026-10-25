// MediaComposer.tsx: the black, full-screen editor that photos and videos go
// through before they're sent, like WhatsApp's.
//
//   Top      ✕ · 🛡 Private · HD · (photos) crop and turn, stickers, words, drawing
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
import { useEffect, useRef, useState } from 'react';
import { Image as RNImage, KeyboardAvoidingView, Modal, PixelRatio, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { core } from '../../core/core';
import type { Picked } from '../../core/files';
import { useSavedStickers } from '../../core/hooks';
import { PACK } from '../../core/stickers';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration } from '../format';
import { Icon, type IconName } from '../icons';
import { fontStyle, Pressy, Txt } from '../kit';
import { pop, rise, tick } from '../motion';
import { Sheet, toast } from '../overlays';
import { Canvas, type CanvasRef, type Layer, type NewLayer, type Stroke, UNITS } from './editor/Canvas';
import { CropTool, fit, type Rect } from './editor/CropTool';
import { TrimStrip } from './editor/TrimStrip';
import { EMOJI } from './ExtrasPanel';
import { OnceToggle } from './VoiceRecorder';
import { GALLERY_MAX } from './Gallery';

export type Ready = Picked & { caption?: string };

type Draft = { key: string; p: Picked; caption: string; strokes: Stroke[]; layers: Layer[] };
type Tool = null | 'crop' | 'draw' | 'text' | 'sticker';

const COLORS = ['#FFFFFF', '#111111', '#E5484D', '#F5A524', '#FFE14D', '#30C76F', '#2F80ED', '#9B5CF6', '#F062B0'];

const editable = (p: Picked) => p.kind === 'image' && p.mime !== 'image/gif';
const squeezable = (p: Picked) => (p.kind === 'image' && p.mime !== 'image/gif') || (p.kind === 'video' && !p.gif);

export function MediaComposer({
  items,
  to,
  onClose,
  onMore,
  onSend,
}: {
  items: Picked[];
  /** Who it goes to ("→ Ayesha"). */
  to: string;
  onClose: () => void;
  /** + : more from the gallery. */
  onMore: () => Promise<Picked[]>;
  onSend: (list: Ready[]) => void;
}) {
  const t = useT();
  const { theme, lang } = useLook();
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<Draft[]>(() => items.map((p) => ({ key: core.newId(), p, caption: '', strokes: [], layers: [] })));
  const [at, setAt] = useState(0);
  const [hd, setHd] = useState(false);
  const [once, setOnce] = useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState<{ id: string | null; text: string } | null>(null);
  const shot = useRef<CanvasRef>(null);

  const d = drafts[Math.min(at, drafts.length - 1)];
  const p = d?.p;
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
    if (!x.strokes.length && !x.layers.length) return x;
    if (!shot.current || x.key !== d?.key) return x;
    const box = fit(size, area);
    const uri = await captureRef(shot, { format: 'jpg', quality: 0.95, result: 'tmpfile' });
    const scale = PixelRatio.get();
    const flat: Draft = { ...x, strokes: [], layers: [], p: { ...x.p, uri: uri.startsWith('file:') ? uri : `file://${uri}`, mime: 'image/jpeg', width: Math.round(box.w * scale), height: Math.round(box.h * scale), size: undefined, edited: true } };
    setDrafts((all) => all.map((y) => (y.key === x.key ? flat : y)));
    return flat;
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

  async function addMore() {
    if (drafts.length >= GALLERY_MAX) return;
    const more = await onMore().catch(() => []);
    if (!more.length) return;
    if (d) await flatten(d).catch(() => d);
    setDrafts((all) => [...all, ...more.map((m) => ({ key: core.newId(), p: m, caption: '', strokes: [], layers: [] }))].slice(0, GALLERY_MAX));
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
    const box = fit(size, area);
    const k = UNITS / Math.max(1, box.w);
    change(d.key, { layers: [...d.layers, { ...l, id: core.newId(), x: (box.w / 2) * k, y: (box.h / 2.4) * k, scale: 1 } as Layer] });
  }

  if (!d) return null;
  const box = p.kind === 'image' ? fit(size, area) : { w: 0, h: 0 };
  const canOnce = drafts.length === 1 && squeezable(p);
  const canHd = drafts.some((x) => squeezable(x.p));

  const top: { icon: IconName; label: string; on: () => void; active?: boolean; id: string }[] = editable(p)
    ? [
        { icon: 'crop', label: t.cropWord, on: () => setTool(tool === 'crop' ? null : 'crop'), active: tool === 'crop', id: 'tool-crop' },
        { icon: 'sticker', label: t.sticker, on: () => setTool('sticker'), active: tool === 'sticker', id: 'tool-sticker' },
        { icon: 'text', label: t.textWord, on: () => (setTool('text'), setWriting({ id: null, text: '' })), active: tool === 'text', id: 'tool-text' },
        { icon: 'draw', label: t.drawWord, on: () => setTool(tool === 'draw' ? null : 'draw'), active: tool === 'draw', id: 'tool-draw' },
      ]
    : [];

  return (
    <Modal visible animationType="slide" onRequestClose={() => (tool ? setTool(null) : onClose())} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
        {/* Top: close, Private, HD, and the photo tools. */}
        <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 3 }}>
          <Round icon="close" label={t.close} onPress={onClose} id="editor-close" />
          <Pressy onPress={() => toast(t.privateNote)} label={t.privateWord} scale={0.94} testID="editor-private">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)' }}>
              <Icon name="privateBadge" size={15} color="#FFFFFF" />
              <Txt size={12.5} weight="700" color="#FFFFFF">
                {t.privateWord}
              </Txt>
            </View>
          </Pressy>
          <View style={{ flex: 1 }} />
          {canHd && (
            <Pressy
              onPress={() => {
                tick();
                toast(hd ? t.hdOffNote : t.hdOnNote);
                setHd(!hd);
              }}
              label={t.hdQuality}
              scale={0.9}
              testID="send-hd"
            >
              <View style={{ height: 30, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.6, borderColor: hd ? theme.acc : '#FFFFFF', backgroundColor: hd ? theme.acc : 'transparent', justifyContent: 'center', marginHorizontal: 4 }}>
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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {p.kind === 'image' && box.w > 0 && editable(p) ? (
            <Canvas
              key={d.key + p.uri}
              uri={p.uri}
              box={box}
              strokes={d.strokes}
              layers={d.layers}
              drawing={tool === 'draw'}
              color={color}
              shot={shot}
              onStroke={(s) => change(d.key, { strokes: [...d.strokes, s] })}
              onMove={(id, x, y, scale) => change(d.key, { layers: d.layers.map((l) => (l.id === id ? { ...l, x, y, scale } : l)) })}
              onRemove={(id) => change(d.key, { layers: d.layers.filter((l) => l.id !== id) })}
              onEditText={(id) => {
                const l = d.layers.find((x) => x.id === id);
                if (l?.kind === 'text') {
                  setColor(l.color);
                  setWriting({ id, text: l.text });
                  setTool('text');
                }
              }}
            />
          ) : p.kind === 'image' ? (
            <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
          ) : p.kind === 'video' ? (
            <VideoPart key={d.key} p={p} onTrim={(trim) => changeP(d.key, { trim })} onLength={(ms) => !p.duration && changeP(d.key, { duration: ms })} />
          ) : (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <Icon name={p.kind === 'audio' ? 'music' : 'doc'} size={64} color="#FFFFFF" />
              <Txt size={16} weight="600" color="#FFFFFF" align="center">
                {p.name ?? t.document}
              </Txt>
            </View>
          )}

          {/* Drawing: the colours down the side, and undo. */}
          {tool === 'draw' && (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={{ position: 'absolute', end: 10, top: 10, gap: 8, alignItems: 'center' }}>
              <Round icon="undo" label={t.undoWord} onPress={() => change(d.key, { strokes: d.strokes.slice(0, -1) })} id="draw-undo" />
              <Colors color={color} onPick={setColor} vertical />
            </Animated.View>
          )}

          {tool === 'crop' && size.w > 0 && (
            <CropTool uri={p.uri} size={size} area={area} busy={busy} onCancel={() => setTool(null)} onRotate={() => void rotate()} onDone={(r) => void crop(r)} />
          )}
        </View>

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
              <Pressy onPress={() => void addMore()} label={t.addMoreMedia} scale={0.92} testID="editor-more">
                <View style={{ width: 54, height: 54, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="plus" size={22} color="#FFFFFF" />
                </View>
              </Pressy>
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 14, paddingEnd: 6, minHeight: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.13)' }}>
              <TextInput
                key={d.key}
                value={d.caption}
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
              <Pressy onPress={() => void send()} label={t.send} scale={0.9} disabled={busy} testID="send-file">
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
          <Animated.View entering={FadeIn.duration(120)} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', paddingTop: insets.top + 10, zIndex: 5 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 }}>
              <Pressy
                onPress={() => {
                  const text = writing.text.trim();
                  if (writing.id) change(d.key, { layers: text ? d.layers.map((l) => (l.id === writing.id && l.kind === 'text' ? { ...l, text, color } : l)) : d.layers.filter((l) => l.id !== writing.id) });
                  else if (text) addLayer({ kind: 'text', text, color });
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
                style={[fontStyle(writing.text || null, lang, 30, '800'), { color, textAlign: 'center' }]}
                testID="text-input"
              />
            </View>
            <View style={{ paddingBottom: 14 }}>
              <Colors color={color} onPick={setColor} />
            </View>
          </Animated.View>
        )}
      </KeyboardAvoidingView>

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
    <Pressy onPress={onPress} label={label} scale={0.88} testID={id}>
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

/** Stickers (PakChat's pack and my saved ones) and emoji to put on a photo. */
function StickerPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (l: NewLayer) => void }) {
  const t = useT();
  const saved = useSavedStickers();
  return (
    <Sheet visible={visible} onClose={onClose} title={t.stickers}>
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 8, gap: 4 }}>
        {[...saved.map((s) => s.uri), ...PACK.map((s) => s.source)].map((src, i) => (
          <Animated.View key={String(src)} entering={i < 16 ? pop(i * 15) : undefined}>
            <Pressy onPress={() => onPick({ kind: 'sticker', source: src })} label={t.sticker} scale={0.88} testID={i === 0 ? 'editor-sticker-first' : undefined}>
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

/** A video playing over and over (only the part that's kept), with the trim strip under it. */
function VideoPart({ p, onTrim, onLength }: { p: Picked; onTrim: (trim: { start: number; end: number }) => void; onLength: (ms: number) => void }) {
  const t = useT();
  const player = useVideoPlayer({ uri: p.uri }, (pl) => {
    pl.loop = true;
    pl.muted = false;
    pl.timeUpdateEventInterval = 0.25;
    pl.play();
  });
  const [length, setLength] = useState(p.duration ?? 0);
  const [playing, setPlaying] = useState(true);
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
      {/* A tap stops and starts it, with ▶ in the middle while stopped (like WhatsApp). */}
      <Pressable style={{ flex: 1 }} onPress={() => (playing ? player.pause() : player.play())} accessibilityLabel={playing ? t.pause : t.play}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} testID="editor-video" />
        {!playing && (
          <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="play" size={28} color="#FFFFFF" />
            </View>
          </Animated.View>
        )}
      </Pressable>
      {!gif && length > 1500 && (
        <Animated.View entering={rise()} style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 }}>
          <TrimStrip
            p={p}
            length={length}
            onChange={(trim) => {
              onTrim(trim);
              player.seekBy(trim.start / 1000 - player.currentTime);
            }}
          />
        </Animated.View>
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
