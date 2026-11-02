// PhotoPeek.tsx: tap a picture in the chat list and it pops up bigger, like
// WhatsApp: the photo with the name across its top, and under it Message,
// Voice call, Video call and Info. Tap the photo and it grows smoothly out of the
// pop-up to fill the screen, on black; back shrinks it smoothly away again (owner,
// 1 Nov). Full screen, pinch (or double tap) zooms in, like WhatsApp's (Zoomable.tsx).
// With no photo, "No profile photo" opens instead.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { core } from '../core/core';
import { useCore, type ChatRow } from '../core/hooks';
import { photoUri } from '../core/photos';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { startCall } from './CallBar';
import { Icon, type IconName } from './icons';
import { IconButton, Pressy, Txt } from './kit';
import { hash, hasUrdu, initials, TINTS_DARK, TINTS_SKY } from './letters';
import { Backdrop, useOpenClose } from './overlays';
import { Zoomable } from './Zoomable';

export function PhotoPeek({ row, onClose }: { row: ChatRow | null; onClose: () => void }) {
  const t = useT();
  const { theme, rtl } = useLook();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { mounted, p } = useOpenClose(!!row);
  // Keep showing it while it closes.
  const [shown, setShown] = useState(row);
  // (A new pop-up starts as a pop-up, not full screen.)
  const [full, setFull] = useState(false);
  // Fully grown to full screen: only then can it be pinched (while it grows it's just the picture).
  const [grown, setGrown] = useState(false);
  if (row && row !== shown) {
    setShown(row);
    setFull(false);
    setGrown(false);
  }
  const zoomOn = full && grown;
  const openFull = () => {
    setGrown(false);
    setFull(true);
  };
  const id = shown?.chat.id ?? '';
  const uri = useCore(['photos', 'people', 'chats', 'auth'], () => (id ? photoUri(core.photoOf(id)) : null));
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.5], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.8, 1]) }],
  }));

  // The photo full screen: `z` goes 0 (the pop-up's square) → 1 (the whole width, in the middle, on black).
  const z = useSharedValue(0);
  useEffect(() => {
    z.value = withTiming(full ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }, (done) => {
      'worklet';
      if (done && full) scheduleOnRN(setGrown, true);
    });
  }, [full, z]);
  const size = Math.min(width - 96, 300);
  const fromX = (width - size) / 2;
  const fromY = PEEK_TOP;
  const toY = (height - width) / 2;
  const grow = useAnimatedStyle(() => {
    const seen = interpolate(p.value, [0, 0.5], [0, 1], 'clamp');
    return {
      opacity: z.value > 0.001 ? seen : 0,
      left: interpolate(z.value, [0, 1], [fromX, 0]),
      top: interpolate(z.value, [0, 1], [fromY, toY]),
      width: interpolate(z.value, [0, 1], [size, width]),
      height: interpolate(z.value, [0, 1], [size, width]),
      borderRadius: interpolate(z.value, [0, 1], [6, 0]),
    };
  });
  const black = useAnimatedStyle(() => ({ opacity: z.value * interpolate(p.value, [0, 0.5], [0, 1], 'clamp') }));
  const bar = useAnimatedStyle(() => ({ opacity: interpolate(z.value, [0.6, 1], [0, 1], 'clamp') * interpolate(p.value, [0, 0.5], [0, 1], 'clamp') }));
  if (!mounted || !shown) return null;

  const { chat, title } = shown;
  // Back from the photo: it shrinks back down as everything goes, into the chat list.
  const back = () => {
    setGrown(false);
    setFull(false);
    onClose();
  };
  const [a, b, ink] = (theme.dark ? TINTS_DARK : TINTS_SKY)[hash(id) % TINTS_SKY.length];
  const canCall = !chat.left && !core.isSelfChat(chat);
  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const actions: { icon: IconName; label: string; on: () => void; testID: string }[] = [
    { icon: 'chat', label: t.message, on: () => router.push({ pathname: '/chat/[id]', params: { id } }), testID: 'peek-message' },
    ...(canCall
      ? [
          { icon: 'calls' as const, label: t.voiceCall, on: () => void startCall(id, false, t), testID: 'peek-voice' },
          { icon: 'video' as const, label: t.videoCall, on: () => void startCall(id, true, t), testID: 'peek-video' },
        ]
      : []),
    { icon: 'info', label: t.info, on: () => router.push({ pathname: '/info/[id]', params: { id } }), testID: 'peek-info' },
  ];

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={full ? back : onClose}>
      {/* A pop-up is a window of its own: without this, pinching it does nothing (owner, 2 Nov). */}
      <GestureHandlerRootView style={{ flex: 1, alignItems: 'center', paddingTop: PEEK_TOP, direction: rtl ? 'rtl' : 'ltr' }}>
        <Backdrop p={p} onClose={onClose} dim={0.55} />
        <Animated.View style={[{ width: size, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.dark ? '#1E2026' : '#FFFFFF' }, style]}>
          <Pressy onPress={uri ? openFull : go(() => router.push({ pathname: '/photo', params: { id, title } }))} label={t.profilePhoto} scale={0.99} testID="peek-photo">
            {uri ? (
              <Image source={{ uri }} style={{ width: size, height: size, backgroundColor: a }} contentFit="cover" />
            ) : (
              <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
                {chat.kind === 'group' && !title ? (
                  <Icon name="group" size={size * 0.4} color={ink} />
                ) : (
                  <Txt size={Math.round(size * 0.3)} weight="700" color={ink} style={hasUrdu(title) ? { lineHeight: size * 0.5 } : undefined}>
                    {initials(title || '?')}
                  </Txt>
                )}
              </LinearGradient>
            )}
            <LinearGradient colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', top: 0, start: 0, end: 0, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 22 }}>
              <Txt size={17} weight="600" color="#FFFFFF" lines={1}>
                {title}
              </Txt>
            </LinearGradient>
          </Pressy>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 }}>
            {actions.map((x) => (
              <Pressy key={x.testID} onPress={go(x.on)} label={x.label} scale={0.9} testID={x.testID} style={{ padding: 12 }}>
                <Icon name={x.icon} size={23} color={theme.accInk} />
              </Pressy>
            ))}
          </View>
        </Animated.View>
        {/* Full screen: black behind, and the photo grown out of the pop-up's square. */}
        <Animated.View pointerEvents={full ? 'auto' : 'none'} style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' }, black]} />
        {!!uri && (
          <Animated.View pointerEvents={zoomOn ? 'auto' : 'none'} style={[{ position: 'absolute', overflow: zoomOn ? 'visible' : 'hidden' }, grow]}>
            {/* Full screen: pinch to zoom, using the whole screen. Always the same picture (swapping
                it for a new one once grown made it flash, owner 2 Nov); zooming only turns on once
                it has grown, and going back sets it back to normal size. */}
            <Zoomable fill enabled={zoomOn} width={width} height={width} viewport={{ width, height }}>
              <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" testID="peek-full-photo" />
            </Zoomable>
          </Animated.View>
        )}
        {full && (
          <Animated.View style={[{ position: 'absolute', top: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingHorizontal: 8 }, bar]}>
            <IconButton icon="back" label={t.back} color="#FFFFFF" onPress={back} />
            <Txt size={18} weight="700" color="#FFFFFF" lines={1} style={{ flex: 1 }}>
              {title}
            </Txt>
          </Animated.View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

/** How far down the screen the pop-up sits. */
const PEEK_TOP = 120;
