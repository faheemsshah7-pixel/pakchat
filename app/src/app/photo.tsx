// photo.tsx: someone's profile photo (or a group's), full screen on black,
// like WhatsApp. Without one it says "No profile photo". Drag it up or down to close it.
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core } from '../core/core';
import { useCore } from '../core/hooks';
import { photoUri } from '../core/photos';
import { useT } from '../i18n';
import { IconButton, Txt } from '../ui/kit';
import { SwipeToClose } from '../ui/SwipeToClose';

export default function Photo() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const uri = useCore(['photos', 'people', 'chats', 'auth'], () => photoUri(core.photoOf(id)));
  const [dragging, setDragging] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <SwipeToClose onClose={() => router.back()} onDrag={setDragging}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {uri ? (
            <Animated.View entering={FadeIn.duration(180)}>
              <Image source={{ uri }} style={{ width, height: width }} contentFit="contain" />
            </Animated.View>
          ) : (
            <Txt size={15} color="#B8BCC6" testID="no-photo">
              {t.noProfilePhoto}
            </Txt>
          )}
        </View>
      </SwipeToClose>
      {/* The bar stays put (and goes while the photo is dragged). */}
      {!dragging && (
        <Animated.View entering={FadeIn.duration(150)} style={{ position: 'absolute', top: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: insets.top + 6, paddingHorizontal: 8 }}>
          <IconButton icon="back" label={t.back} color="#FFFFFF" onPress={() => router.back()} />
          <Txt size={18} weight="700" color="#FFFFFF" lines={1} style={{ flex: 1 }}>
            {title}
          </Txt>
        </Animated.View>
      )}
    </View>
  );
}
