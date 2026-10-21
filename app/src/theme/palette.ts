// palette.ts: every colour the app uses. Screens never write a colour themselves;
// they ask the theme (useTheme) for one of these names.
//
// There are two looks, picked by the owner on 21 Oct:
//   Sky       the light look: light-blue glass on a soft blue sky
//   Graphite  the dark look: plain charcoal
// and six accent colours that colour the buttons, the "All" chip, unread badges and your own bubbles.

export type Mode = 'sky' | 'graphite';
export type ModeChoice = Mode | 'auto';
export type Accent = 'blue' | 'green' | 'purple' | 'pink' | 'orange' | 'teal';

export const ACCENTS: Accent[] = ['blue', 'green', 'purple', 'pink', 'orange', 'teal'];

export type Theme = {
  mode: Mode;
  dark: boolean;
  // Background: a flat colour plus soft glows painted behind everything (see SkyBackground).
  bg: string;
  glows: string[];
  // Glass panels, the cards everything sits on.
  glass: string;
  glassLine: string;
  glassStrong: string;
  shadow: string;
  // Words.
  text: string;
  muted: string;
  faint: string;
  sectionText: string;
  // The accent: solid, its darker "ink" for words, a soft fill, and its gradient pair.
  acc: string;
  accInk: string;
  accSoft: string;
  grad: [string, string];
  onAcc: string;
  // Bubbles.
  bubbleIn: string;
  bubbleMine: [string, string];
  bubbleMineText: string;
  // Small things.
  avatar: [string, string];
  avatarText: string;
  tile: string;
  divider: string;
  online: string;
  danger: string;
  dangerSoft: string;
  read: string;
  selected: string;
  mention: string;
};

// The accent colours. For each: [solid, ink, soft fill, solid on dark, ink on dark,
// gradient start, gradient end, your bubble start, your bubble end, your bubble on dark].
const ACC: Record<Accent, [string, string, string, string, string, string, string, string, string, string]> = {
  blue: ['#2563EB', '#1D4ED8', '#D9E7FF', '#7AA7FF', '#A9C6FF', '#4C8DFF', '#2059E0', '#D6E6FF', '#C2D8FE', '#24407A'],
  green: ['#059669', '#047857', '#D5F2E6', '#34D399', '#86EFC4', '#34C38F', '#0F8A5F', '#D7F5E7', '#BFEBD6', '#174A39'],
  purple: ['#7C3AED', '#6D28D9', '#EBE1FF', '#B49BFF', '#D0C2FF', '#A78BFA', '#6D28D9', '#EDE4FF', '#DCCDFF', '#3A2C6E'],
  pink: ['#DB2777', '#BE185D', '#FCE1EE', '#F58AB9', '#F9B8D5', '#F472B6', '#BE185D', '#FDE4F0', '#F9CDE2', '#5E2342'],
  orange: ['#EA580C', '#C2410C', '#FFE6D5', '#FFA463', '#FFC79C', '#FB923C', '#C2410C', '#FFE9DA', '#FFD5B8', '#5C3016'],
  teal: ['#0D9488', '#0F766E', '#D3F4F0', '#2DD4BF', '#8BEADC', '#2DD4BF', '#0F766E', '#D5F5F1', '#B9EAE3', '#164A46'],
};

const sky: Omit<Theme, 'acc' | 'accInk' | 'accSoft' | 'grad' | 'bubbleMine'> = {
  mode: 'sky',
  dark: false,
  bg: '#EAF2FE',
  glows: ['#CFE2FF', '#DCEBFF', '#D3E5FF'],
  glass: 'rgba(255,255,255,0.75)',
  glassLine: 'rgba(255,255,255,0.95)',
  glassStrong: 'rgba(255,255,255,0.9)',
  shadow: 'rgba(30,64,140,0.4)',
  text: '#0B1B36',
  muted: '#52627C',
  faint: '#A9B8CF',
  sectionText: '#3F5A86',
  onAcc: '#FFFFFF',
  bubbleIn: '#FFFFFF',
  bubbleMineText: '#0B1B36',
  avatar: ['#DCE9FF', '#C5D9FD'],
  avatarText: '#1E3A8A',
  tile: '#E3EDFF',
  divider: '#EDF2F9',
  online: '#22C55E',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  read: '#2563EB',
  selected: 'rgba(37,99,235,0.12)',
  mention: '#1D4ED8',
};

const graphite: Omit<Theme, 'acc' | 'accInk' | 'accSoft' | 'grad' | 'bubbleMine'> = {
  mode: 'graphite',
  dark: true,
  bg: '#111214',
  glows: ['transparent', 'transparent', 'transparent'],
  glass: '#1E2026',
  glassLine: 'rgba(255,255,255,0.05)',
  glassStrong: 'rgba(22,23,26,0.94)',
  shadow: 'rgba(0,0,0,0.6)',
  text: '#ECEEF2',
  muted: '#9A9FAA',
  faint: '#5B606B',
  sectionText: '#AEB4C0',
  onAcc: '#FFFFFF',
  bubbleIn: '#1E2026',
  bubbleMineText: '#ECEEF2',
  avatar: ['#24262C', '#2A2D34'],
  avatarText: '#C9D3E6',
  tile: '#24262C',
  divider: '#24262C',
  online: '#22C55E',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  read: '#7AA7FF',
  selected: 'rgba(122,167,255,0.16)',
  mention: '#A9C6FF',
};

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Builds the full set of colours for one look and one accent. */
export function makeTheme(mode: Mode, accent: Accent): Theme {
  const base = mode === 'sky' ? sky : graphite;
  const a = ACC[accent];
  const dark = base.dark;
  const acc = dark ? a[3] : a[0];
  return {
    ...base,
    acc,
    accInk: dark ? a[4] : a[1],
    accSoft: dark ? `rgba(${hexToRgb(a[3])},0.18)` : a[2],
    grad: [a[5], a[6]],
    bubbleMine: dark ? [a[9], a[9]] : [a[7], a[8]],
    read: acc,
    selected: `rgba(${hexToRgb(acc)},${dark ? 0.16 : 0.12})`,
    mention: dark ? a[4] : a[1],
  };
}

/** The gradient of an accent, for the colour swatches in Settings. */
export function accentGradient(accent: Accent): [string, string] {
  return [ACC[accent][5], ACC[accent][6]];
}
