// AttachMenu.tsx: what the 📎 in the message bar opens. PakChat's own look: a
// frosted card that rises from the bar with a little stagger, each thing to send
// on a soft tile of its own colour (no "AI images").
//
//   Gallery   Camera   Document   Audio
//   Location  Contact  Poll     Event
import { Modal, Pressable, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../icons';
import { Glass, Pressy, Txt } from '../kit';
import { tick } from '../motion';
import { useOpenClose, whenOpened } from '../overlays';

export type AttachKind = 'gallery' | 'camera' | 'document' | 'audio' | 'location' | 'contact' | 'poll' | 'event';

/** Each tile's colour, the same in light and dark (the tile behind it is soft). */
const TILES: { key: AttachKind; icon: IconName; tint: string; testID: string }[] = [
  { key: 'gallery', icon: 'photo', tint: '#7C5CFA', testID: 'attach-photo' },
  { key: 'camera', icon: 'camera', tint: '#F0507A', testID: 'attach-camera' },
  { key: 'document', icon: 'doc', tint: '#3D7BF6', testID: 'attach-doc' },
  { key: 'audio', icon: 'music', tint: '#F08A24', testID: 'attach-audio' },
  { key: 'location', icon: 'place', tint: '#18A86B', testID: 'attach-location' },
  { key: 'contact', icon: 'card', tint: '#1C9BD6', testID: 'attach-contact' },
  { key: 'poll', icon: 'poll', tint: '#D9A400', testID: 'attach-poll' },
  { key: 'event', icon: 'calendar', tint: '#E0457B', testID: 'attach-event' },
];

export const AttachMenu = whenOpened(function AttachMenu({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (k: AttachKind) => void }) {
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const label: Record<AttachKind, string> = {
    gallery: t.gallery,
    camera: t.camera,
    document: t.document,
    audio: t.audio,
    location: t.location,
    contact: t.contact,
    poll: t.pollWord,
    event: t.eventTile,
  };
  // Like WhatsApp's: the card rises a little out of the message bar as it fades in.
  const { mounted, p } = useOpenClose(visible);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.5], [0, 1], 'clamp'),
    transform: [{ translateY: (1 - p.value) * 24 }, { scale: interpolate(p.value, [0, 1], [0.94, 1]) }],
  }));
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t.close}>
        <Animated.View style={[{ position: 'absolute', start: 10, end: 10, bottom: insets.bottom + 76, transformOrigin: 'bottom' }, style]}>
          <Pressable onPress={() => {}}>
            <Glass strong style={{ borderRadius: 28, paddingVertical: 14, paddingHorizontal: 6, boxShadow: `0 22px 44px -18px ${theme.shadow}` }} testID="attach-menu">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 }}>
                {TILES.map((x, i) => (
                  <Animated.View key={x.key} style={{ width: '25%', alignItems: 'center' }}>
                    <Pressy
                      onPress={() => {
                        tick();
                        onPick(x.key);
                      }}
                      label={label[x.key]}
                      testID={x.testID}
                      scale={0.88}
                    >
                      <View style={{ alignItems: 'center', gap: 7, paddingVertical: 4 }}>
                        <View
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 20,
                            // A soft tile of the colour, with the colour's own ring.
                            backgroundColor: `${x.tint}${theme.dark ? '33' : '1F'}`,
                            borderWidth: 1,
                            borderColor: `${x.tint}55`,
                            alignItems: 'center',
                            justifyContent: 'center',
                            transform: [{ rotate: i % 2 ? '3deg' : '-3deg' }],
                          }}
                        >
                          <Icon name={x.icon} size={25} color={x.tint} stroke={2} />
                        </View>
                        <Txt size={12.5} weight="600" align="center">
                          {label[x.key]}
                        </Txt>
                      </View>
                    </Pressy>
                  </Animated.View>
                ))}
              </View>
            </Glass>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
});
