// photo.tsx: someone's profile photo (or a group's), full screen on black,
// like WhatsApp. Without one it says "No profile photo". Drag it up or down to close it;
// pinch (or double tap) to zoom in, like WhatsApp's (Zoomable.tsx).
// Opened from a picture (info, a community), it grows out of it and shrinks back into it
// when it closes, like a chat photo (zoom.ts openPhoto, SwipeToClose.tsx); otherwise it fades.
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core } from '../core/core';
import { useCore } from '../core/hooks';
import { photoUri } from '../core/photos';
import { useT } from '../i18n';
import { IconButton, Txt } from '../ui/kit';
import { fadeIn, fadeOut } from '../ui/motion';
import { SwipeToClose, type Closer } from '../ui/SwipeToClose';
import { parseSpot } from '../ui/zoom';
import { Zoomable } from '../ui/Zoomable';

export default function Photo() {
  const { id, title, spot: spotParam, round } = useLocalSearchParams<{ id: string; title?: string; spot?: string; round?: string }>();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const uri = useCore(['photos', 'people', 'chats', 'auth'], () => photoUri(core.photoOf(id)));
  // Grows out of the picture tapped only when there's a photo (otherwise the words fade in).
  const [spot] = useState(() => (uri ? parseSpot(spotParam) : null));
  const [dragging, setDragging] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [opened, setOpened] = useState(false);
  const closer = useRef<Closer>(null);
  const close = useCallback(() => (closer.current ? closer.current.close() : router.back()), []);

  // Back shrinks it into its spot too.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <SwipeToClose ref={closer} onClose={() => router.back()} onDrag={setDragging} locked={zoomed} grow={{ spot, aspect: 1, back: true, round: round === '1', onOpened: () => setOpened(true) }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {uri ? (
            <Zoomable width={width} height={width} viewport={{ width, height }} onZoomed={setZoomed}>
              <Image source={{ uri }} style={{ width, height: width }} contentFit="contain" testID="photo-image" />
            </Zoomable>
          ) : (
            <Txt size={15} color="#B8BCC6" testID="no-photo">
              {t.noProfilePhoto}
            </Txt>
          )}
        </View>
      </SwipeToClose>
      {/* The bar stays put; it fades in once the photo has grown, and goes while it's dragged. */}
      {opened && !dragging && (
        <Animated.View
          entering={fadeIn}
          exiting={fadeOut}
          style={{ position: 'absolute', top: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingHorizontal: 8 }}
        >
          <IconButton icon="back" label={t.back} color="#FFFFFF" onPress={close} testID="photo-back" />
          <Txt size={18} weight="700" color="#FFFFFF" lines={1} style={{ flex: 1 }}>
            {title}
          </Txt>
        </Animated.View>
      )}
    </View>
  );
}
