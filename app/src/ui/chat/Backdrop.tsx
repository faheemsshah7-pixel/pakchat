// Backdrop.tsx: what's behind a chat's messages (its wallpaper): PakChat's
// faint doodles (the default), nothing, a colour (doodles over it or not),
// a gradient, or a photo.
// Each chat can have its own (chat info › Wallpaper), or follow the one for
// all chats (Settings › Chats). In Graphite any of them can be darkened.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { Image as Picture, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';

import type { Wallpaper } from '../../core/core';
import { useLook } from '../../theme/ThemeProvider';

/** The plain colours: [light, dark]. */
export const WALL_COLOURS: [string, string][] = [
  ['#EAF2FF', '#0F1A2B'],
  ['#E8F7EF', '#0F2119'],
  ['#FFF4E5', '#2A1E10'],
  ['#FDECEF', '#2A1418'],
  ['#F1EBFF', '#1C1530'],
  ['#E6F7F8', '#0E2224'],
  ['#F3F4F6', '#16181C'],
  ['#FFF9DB', '#26220E'],
];

/** The gradients: [light from, light to, dark from, dark to]. */
export const WALL_GRADIENTS: [string, string, string, string][] = [
  ['#DCEBFF', '#F5E9FF', '#0E1A30', '#24123A'],
  ['#D9F7E8', '#E3F1FF', '#0C2419', '#0E1B33'],
  ['#FFE7D1', '#FFE1EC', '#2B1A0D', '#2C1020'],
  ['#E0F7FA', '#EDE7F6', '#0B2427', '#1A1430'],
  ['#FFF3C4', '#FFD8C2', '#2A230B', '#2E1709'],
  ['#E8EAF6', '#E0F2F1', '#151833', '#0D2421'],
];

export function Backdrop({ wp }: { wp?: Wallpaper }) {
  const { theme } = useLook();
  const kind = wp?.kind ?? 'doodles';
  if (kind === 'none') return null;
  // In Graphite any wallpaper can be darkened (a photo starts a little dark).
  const dim = theme.dark ? Math.max(0, Math.min(0.8, wp?.dim ?? (kind === 'photo' ? 0.35 : 0))) : 0;
  let base: ReactNode;
  if (kind === 'colour') {
    const c = WALL_COLOURS[Number(wp?.value ?? 0)] ?? WALL_COLOURS[0];
    base = <View style={[FILL, { backgroundColor: theme.dark ? c[1] : c[0] }]}>{wp?.doodles && <Doodles tile={theme.dark ? TILES.colourDark : TILES.colourLight} />}</View>;
  } else if (kind === 'gradient') {
    const g = WALL_GRADIENTS[Number(wp?.value ?? 0)] ?? WALL_GRADIENTS[0];
    base = <LinearGradient colors={theme.dark ? [g[2], g[3]] : [g[0], g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />;
  } else if (kind === 'photo' && typeof wp?.value === 'string') {
    base = <Image source={{ uri: wp.value }} style={FILL} contentFit="cover" />;
  } else {
    base = <Doodles tile={theme.dark ? TILES.dark : TILES.light} />;
  }
  return (
    <View pointerEvents="none" style={FILL}>
      {base}
      {dim > 0 && <View style={[FILL, { backgroundColor: `rgba(0,0,0,${dim})` }]} />}
    </View>
  );
}

const FILL = { position: 'absolute' as const, top: 0, start: 0, end: 0, bottom: 0 };

/**
 * The doodles, one square of them in each tint (drawn by scripts/make-doodles.js): a
 * moon, stars, hearts, music, a camera. Light and dark for PakChat's own wallpaper,
 * and the two over a colour.
 */
const TILES: Record<'light' | 'dark' | 'colourLight' | 'colourDark', ImageSourcePropType> = {
  light: require('../../../assets/wallpaper/doodles-light.png'),
  dark: require('../../../assets/wallpaper/doodles-dark.png'),
  colourLight: require('../../../assets/wallpaper/doodles-colour-light.png'),
  colourDark: require('../../../assets/wallpaper/doodles-colour-dark.png'),
};
/** One square's size, in points. */
const TILE = 176;

/**
 * Faint drawings behind the messages, like WhatsApp's: the same small square side by
 * side. It used to be drawn afresh as one big picture each time a chat opened, which
 * held up the chat sliding in on older phones; a small ready-made picture shows at once.
 */
function Doodles({ tile }: { tile: ImageSourcePropType }) {
  const win = useWindowDimensions();
  // As many squares as cover it: the screen's size at first, then its own once measured.
  const [size, setSize] = useState({ width: win.width, height: win.height });
  const across = Math.ceil(size.width / TILE);
  const down = Math.ceil(size.height / TILE);
  return (
    <View
      style={[FILL, { overflow: 'hidden' }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.ceil(width / TILE) !== across || Math.ceil(height / TILE) !== down) setSize({ width, height });
      }}
    >
      <View style={{ width: across * TILE, flexDirection: 'row', flexWrap: 'wrap', direction: 'ltr' }}>
        {Array.from({ length: across * down }, (_, i) => (
          <Picture key={i} source={tile} style={{ width: TILE, height: TILE }} fadeDuration={0} />
        ))}
      </View>
    </View>
  );
}
