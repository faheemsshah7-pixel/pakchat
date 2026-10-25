// Backdrop.tsx: what's behind a chat's messages (its wallpaper): PakChat's
// faint doodles (the default), nothing, a colour (doodles over it or not),
// a gradient, or a photo.
// Each chat can have its own (chat info › Wallpaper), or follow the one for
// all chats (Settings › Chats). In Graphite any of them can be darkened.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Defs, G, Pattern, Rect } from 'react-native-svg';

import type { Wallpaper } from '../../core/core';
import { useLook } from '../../theme/ThemeProvider';
import { IconPaths, type IconName } from '../icons';

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
    base = <View style={[FILL, { backgroundColor: theme.dark ? c[1] : c[0] }]}>{wp?.doodles && <Doodles color={theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(11,27,54,0.07)'} />}</View>;
  } else if (kind === 'gradient') {
    const g = WALL_GRADIENTS[Number(wp?.value ?? 0)] ?? WALL_GRADIENTS[0];
    base = <LinearGradient colors={theme.dark ? [g[2], g[3]] : [g[0], g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />;
  } else if (kind === 'photo' && typeof wp?.value === 'string') {
    base = <Image source={{ uri: wp.value }} style={FILL} contentFit="cover" />;
  } else {
    base = <Doodles color={theme.dark ? 'rgba(255,255,255,0.045)' : 'rgba(37,99,235,0.08)'} />;
  }
  return (
    <View pointerEvents="none" style={FILL}>
      {base}
      {dim > 0 && <View style={[FILL, { backgroundColor: `rgba(0,0,0,${dim})` }]} />}
    </View>
  );
}

const FILL = { position: 'absolute' as const, top: 0, start: 0, end: 0, bottom: 0 };

/** One square of the doodles, repeated across the whole wallpaper: [icon, x, y, turn]. */
const DOODLES: [IconName, number, number, number][] = [
  ['moon', 10, 8, -14],
  ['star', 70, 4, 12],
  ['heart', 128, 26, -8],
  ['music', 38, 58, 10],
  ['sun', 100, 72, 0],
  ['camera', 8, 112, -10],
  ['emoji', 66, 124, 8],
  ['chat', 134, 132, -12],
];
const TILE = 176;

/** Faint drawings behind the messages, like WhatsApp's: a moon, stars, hearts, music, a camera. */
function Doodles({ color }: { color: string }) {
  return (
    <Svg width="100%" height="100%" style={FILL}>
      <Defs>
        <Pattern id="pakchat-doodles" patternUnits="userSpaceOnUse" width={TILE} height={TILE}>
          {DOODLES.map(([name, x, y, turn]) => (
            <G key={name} transform={`translate(${x} ${y}) rotate(${turn} 12 12) scale(1.15)`}>
              <IconPaths name={name} color={color} stroke={1.6} />
            </G>
          ))}
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#pakchat-doodles)" />
    </Svg>
  );
}
