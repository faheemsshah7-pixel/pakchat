// PhotoPeek.tsx: tap a picture in the chat list and it pops up bigger, like
// WhatsApp: the photo with the name across its top, and under it Message,
// Voice call, Video call and Info. Tap the photo to see it full screen (or
// "No profile photo" if there isn't one).
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, useWindowDimensions, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';

import { core } from '../core/core';
import { useCore, type ChatRow } from '../core/hooks';
import { photoUri } from '../core/photos';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { startCall } from './CallBar';
import { Icon, type IconName } from './icons';
import { Pressy, Txt } from './kit';
import { hash, hasUrdu, initials, TINTS_DARK, TINTS_SKY } from './letters';
import { Backdrop, useOpenClose } from './overlays';

export function PhotoPeek({ row, onClose }: { row: ChatRow | null; onClose: () => void }) {
  const t = useT();
  const { theme, rtl } = useLook();
  const { width } = useWindowDimensions();
  const { mounted, p } = useOpenClose(!!row);
  // Keep showing it while it closes.
  const [shown, setShown] = useState(row);
  if (row && row !== shown) setShown(row);
  const id = shown?.chat.id ?? '';
  const uri = useCore(['photos', 'people', 'chats', 'auth'], () => (id ? photoUri(core.photoOf(id)) : null));
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.5], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.8, 1]) }],
  }));
  if (!mounted || !shown) return null;

  const { chat, title } = shown;
  const size = Math.min(width - 96, 300);
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
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 120, direction: rtl ? 'rtl' : 'ltr' }}>
        <Backdrop p={p} onClose={onClose} dim={0.55} />
        <Animated.View style={[{ width: size, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.dark ? '#1E2026' : '#FFFFFF' }, style]}>
          <Pressy onPress={go(() => router.push({ pathname: '/photo', params: { id, title } }))} label={t.profilePhoto} scale={0.99} testID="peek-photo">
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
      </View>
    </Modal>
  );
}
