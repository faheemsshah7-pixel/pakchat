// AttachMenu.tsx: what the 📎 in the message bar opens, like WhatsApp's (owner, 2 Nov): a
// panel that takes the keyboard's place under the message bar (the bar rides up on top of
// it), with a grab handle, and each thing to send on an outlined tile with a coloured icon.
//
//   Gallery   Camera  Location  Contact
//   Document  Audio   Poll      Event
//
// The chat screen moves the bar up and down with `up` (see chat/[id].tsx); this only draws
// the panel under it.
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../icons';
import { Pressy, Txt } from '../kit';
import { tick } from '../motion';

export type AttachKind = 'gallery' | 'camera' | 'document' | 'audio' | 'location' | 'contact' | 'poll' | 'event';

/** The panel's height above the phone's own bottom bar. */
export const ATTACH_HEIGHT = 268;

/** WhatsApp's order and colours. */
const TILES: { key: AttachKind; icon: IconName; tint: string; testID: string }[] = [
  { key: 'gallery', icon: 'photo', tint: '#2C8BF6', testID: 'attach-photo' },
  { key: 'camera', icon: 'camera', tint: '#FF2E74', testID: 'attach-camera' },
  { key: 'location', icon: 'place', tint: '#06CF9C', testID: 'attach-location' },
  { key: 'contact', icon: 'card', tint: '#009DE2', testID: 'attach-contact' },
  { key: 'document', icon: 'doc', tint: '#7F66FF', testID: 'attach-doc' },
  { key: 'audio', icon: 'music', tint: '#FA6533', testID: 'attach-audio' },
  { key: 'poll', icon: 'poll', tint: '#FFBC38', testID: 'attach-poll' },
  { key: 'event', icon: 'calendar', tint: '#FF2E74', testID: 'attach-event' },
];

/** `up`: how far the panel has risen, from 0 (hidden) to its full height (with the phone's bottom bar). */
export function AttachMenu({ up, onPick }: { up: SharedValue<number>; onPick: (k: AttachKind) => void }) {
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const full = ATTACH_HEIGHT + insets.bottom;
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
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: full - up.value }], opacity: up.value > 0 ? 1 : 0 }));
  const line = theme.dark ? 'rgba(255,255,255,0.14)' : 'rgba(11,27,54,0.12)';
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          start: 0,
          end: 0,
          bottom: 0,
          height: full,
          paddingBottom: insets.bottom,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          backgroundColor: theme.dark ? '#14171A' : '#FFFFFF',
          zIndex: 3,
        },
        style,
      ]}
      testID="attach-menu"
    >
      {/* The grab handle. */}
      <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 16, backgroundColor: theme.dark ? 'rgba(255,255,255,0.28)' : 'rgba(11,27,54,0.2)' }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, paddingHorizontal: 12 }}>
        {TILES.map((x) => (
          <View key={x.key} style={{ width: '25%', alignItems: 'center' }}>
            <Pressy
              onPress={() => {
                tick();
                onPick(x.key);
              }}
              label={label[x.key]}
              testID={x.testID}
              scale={0.9}
            >
              <View style={{ alignItems: 'center', gap: 8 }}>
                <View style={{ width: 66, height: 66, borderRadius: 18, borderWidth: 1, borderColor: line, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={x.icon} size={27} color={x.tint} stroke={2.2} />
                </View>
                <Txt size={13.5} color={theme.muted} align="center">
                  {label[x.key]}
                </Txt>
              </View>
            </Pressy>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}
