// icons.tsx: every icon in the app, drawn with lines (SVG), the same as in the design.
// <Icon name="search" size={20} color={theme.muted} />
//
// Icons that point a way (back, send, reply) are turned around in Urdu, because
// right-to-left screens read the other way. Pass `flip` for those.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useLook } from '../theme/ThemeProvider';

type Shape = { d?: string[]; fill?: string[]; circles?: [number, number, number][]; dots?: [number, number, number][]; rects?: [number, number, number, number, number][] };

const ICONS = {
  search: { d: ['M20 20l-3.5-3.5'], circles: [[11, 11, 7]] },
  camera: { d: ['M4 8h3l2-3h6l2 3h3v11H4z'], circles: [[12, 13, 3.5]] },
  more: { dots: [[12, 5, 1.6], [12, 12, 1.6], [12, 19, 1.6]] },
  chat: { d: ['M4 5h16v11H9l-5 4z'] },
  newChat: { d: ['M4 5h16v11H9l-5 4z', 'M12 8v5M9.5 10.5h5'] },
  status: { d: [], circles: [[12, 12, 3.5]] },
  calls: { d: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'] },
  you: { d: ['M4 20c0-4 4-6 8-6s8 2 8 6'], circles: [[12, 8, 4]] },
  back: { d: ['M15 5l-7 7 7 7'] },
  forwardArrow: { d: ['M9 5l7 7-7 7'] },
  video: { d: ['M16 10l5-3v10l-5-3'], rects: [[3, 6, 13, 12, 3]] },
  plus: { d: ['M12 5v14M5 12h14'] },
  emoji: { d: ['M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01'], circles: [[12, 12, 9]] },
  mic: { d: ['M5 11a7 7 0 0 0 14 0M12 18v3'], rects: [[9, 3, 6, 11, 3]] },
  send: { d: ['M4 12l16-8-6 16-3-7z', 'M11 13l9-9'] },
  ticks: { d: ['M2 13l4 4 9-10M10 16l1 1 9-10'] },
  tick: { d: ['M5 13l4 4 10-11'] },
  clock: { d: ['M12 7v5l3 2'], circles: [[12, 12, 8.5]] },
  pin: { d: ['M9 3h6l-1 6 4 4H6l4-4zM12 13v8'] },
  muted: { d: ['M6 16v-5a6 6 0 0 1 10-4.5M18 11v5H8M3 3l18 18M10 20h4'] },
  bell: { d: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20h4'] },
  archive: { d: ['M3 5h18v4H3zM5 9v10h14V9M10 13h4'] },
  trash: { d: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'] },
  star: { d: ['M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z'] },
  starFilled: { fill: ['M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z'] },
  reply: { d: ['M9 7L4 12l5 5', 'M4 12h10a6 6 0 0 1 6 6v1'] },
  forward: { d: ['M15 7l5 5-5 5', 'M20 12H10a6 6 0 0 0-6 6v1'] },
  copy: { d: ['M5 15V5a1 1 0 0 1 1-1h9'], rects: [[9, 8, 11, 12, 2]] },
  edit: { d: ['M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'] },
  info: { d: ['M12 11v5M12 8h.01'], circles: [[12, 12, 9]] },
  close: { d: ['M6 6l12 12M18 6L6 18'] },
  check: { d: ['M5 12.5l4.5 4.5L19 7'] },
  lock: { d: ['M8 11V8a4 4 0 0 1 8 0v3'], rects: [[5, 11, 14, 10, 2.5]] },
  shield: { d: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'] },
  globe: { d: ['M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'], circles: [[12, 12, 9]] },
  palette: { d: ['M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8z'], dots: [[7.5, 11, 1.3], [10, 7, 1.3], [15, 7.5, 1.3]] },
  key: { d: ['M10.5 13.5L20 4M16 8l3 3M14 10l2 2'], circles: [[7.5, 16.5, 4]] },
  database: { d: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'] },
  link: { d: ['M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'] },
  logout: { d: ['M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10'] },
  chevron: { d: ['M9 6l6 6-6 6'] },
  down: { d: ['M6 9l6 6 6-6'] },
  group: { d: ['M3 19c0-3 2.5-5 6-5s6 2 6 5M15 14c3 0 6 1.5 6 4.5'], circles: [[9, 8, 3.5], [16.5, 8.5, 2.8]] },
  userPlus: { d: ['M3 20c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6'], circles: [[10, 8, 4]] },
  poll: { d: ['M5 20V10M12 20V4M19 20v-7'] },
  flag: { d: ['M5 21V4M5 4h11l-2 4 2 4H5'] },
  sun: { d: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'], circles: [[12, 12, 4]] },
  moon: { d: ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'] },
  auto: { d: ['M12 3v18'], circles: [[12, 12, 9]] },
  warning: { d: ['M12 4l9 16H3zM12 10v4M12 17h.01'] },
  heart: { d: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'] },
  qr: { d: ['M14 14h3v3h-3zM20 14v3M14 20h6M17 17v3'], rects: [[3, 3, 7, 7, 1.5], [14, 3, 7, 7, 1.5], [3, 14, 7, 7, 1.5]] },
  timer: { d: ['M12 9v4l2 2M9 2h6'], circles: [[12, 14, 8]] },
  leave: { d: ['M10 4H5v16h5M14 8l4 4-4 4M18 12H9'] },
  select: { d: ['M8 12l3 3 5-6'], rects: [[3, 3, 18, 18, 5]] },
  unread: { d: ['M4 5h16v11H9l-5 4z'], dots: [[18, 5, 3.4]] },
  photo: { d: ['M3 17l5-5 4 4 3-3 6 6'], rects: [[3, 4, 18, 16, 3]], circles: [[15.5, 9, 1.8]] },
  doc: { d: ['M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5'] },
  hash: { d: ['M5 9h14M5 15h14M10 4L8 20M16 4l-2 16'] },
  server: { d: ['M7 7h.01M7 17h.01'], rects: [[3, 3, 18, 8, 2], [3, 13, 18, 8, 2]] },
} satisfies Record<string, Shape>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color = '#000',
  stroke = 1.9,
  flip,
}: {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
  /** Turn around in Urdu (right to left). */
  flip?: boolean;
}) {
  const { rtl } = useLook();
  const s: Shape = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={flip && rtl ? { transform: [{ scaleX: -1 }] } : undefined}>
      {name === 'status' && <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={stroke} strokeDasharray="4 3" fill="none" />}
      {s.d?.map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      {s.fill?.map((d) => <Path key={d} d={d} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />)}
      {s.circles?.map(([cx, cy, r]) => (
        <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} stroke={color} strokeWidth={stroke} fill="none" />
      ))}
      {s.dots?.map(([cx, cy, r]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={color} />)}
      {s.rects?.map(([x, y, w, h, rx]) => (
        <Rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx={rx} stroke={color} strokeWidth={stroke} fill="none" />
      ))}
    </Svg>
  );
}
