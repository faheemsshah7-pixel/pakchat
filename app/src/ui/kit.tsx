// kit.tsx: the building blocks every screen is made of, so they all look and move the same.
//
//   Screen       the sky (or graphite) background, safe from the notch, right-to-left in Urdu
//   Txt          words, in Inter (English) or Noto Nastaliq (Urdu), picked by the words themselves
//   Glass        a frosted card
//   Pressy       anything you can tap: it sinks a little under your finger, on a spring
//   IconButton   a round-cornered button with an icon
//   Avatar       a person or group's picture, or their first letter on a soft tile
//   Chip         a filter like "All" or "Unread"
//   Fab          the big + button
//   Toggle       an on/off switch
//   TopBar       the glass bar at the top of a screen
//   SettingRow   one row in Settings
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { interpolate, interpolateColor, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { core } from '../core/core';
import { useCore } from '../core/hooks';
import { photoUri } from '../core/photos';
import { useT } from '../i18n';
import { useLook, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './icons';
import { fade, pop, snappy } from './motion';

// ---- Words ----

const URDU = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** True when the words have Urdu (or Arabic) letters in them. */
export const hasUrdu = (s: string) => URDU.test(s);

export type Weight = '400' | '500' | '600' | '700' | '800';

/** The font for some words: Nastaliq for Urdu letters, Inter for everything else. */
export function fontStyle(text: string | null, lang: 'en' | 'ur', size: number, weight: Weight): TextStyle {
  const urdu = text === null ? lang === 'ur' : hasUrdu(text);
  if (urdu) {
    // Nastaliq is tall and leans down to the left, so it needs much more room between lines.
    return { fontFamily: 'NotoNastaliqUrdu', fontWeight: weight >= '600' ? '700' : '400', fontSize: size, lineHeight: Math.round(size * 2.05) };
  }
  return { fontFamily: 'Inter', fontWeight: weight, fontSize: size, lineHeight: Math.round(size * 1.38), includeFontPadding: false };
}

function plainText(children: ReactNode): string | null {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number')) return children.join('');
  return null;
}

export function Txt({
  children,
  size = 15,
  weight = '400',
  color,
  style,
  lines,
  align,
  selectable,
  testID,
}: {
  children: ReactNode;
  size?: number;
  weight?: Weight;
  color?: string;
  style?: StyleProp<TextStyle>;
  lines?: number;
  /** Which side the words sit on. Default: the start of the line (right in Urdu). */
  align?: 'start' | 'center' | 'end' | 'auto';
  selectable?: boolean;
  testID?: string;
}) {
  const { theme, lang, rtl } = useLook();
  const text = plainText(children);
  const textAlign: TextStyle['textAlign'] =
    align === 'center' ? 'center' : align === 'auto' ? 'auto' : align === 'end' ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left';
  return (
    <Text
      testID={testID}
      selectable={selectable}
      numberOfLines={lines}
      style={[fontStyle(text, lang, size, weight), { color: color ?? theme.text, textAlign }, style]}
    >
      {children}
    </Text>
  );
}

// ---- The background ----

/** The soft sky behind everything: a light blue with three glows (Sky), or plain charcoal (Graphite). */
export function SkyBackground() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  if (theme.dark) return <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]} />;
  const glow = (id: string, cx: number, cy: number, rx: number, ry: number, color: string) => (
    <>
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} rx={rx} ry={ry} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={1} />
          <Stop offset="0.7" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </>
  );
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]} pointerEvents="none">
      <Svg width={width} height={height}>
        {glow('g1', 0, 0, width * 0.9, height * 0.45, theme.glows[0])}
        {glow('g2', width, height * 0.18, width * 0.8, height * 0.4, theme.glows[1])}
        {glow('g3', width / 2, height, width * 0.9, height * 0.5, theme.glows[2])}
      </Svg>
    </View>
  );
}

/**
 * For a button pinned to the bottom of a screen: `bottom` space that grows with
 * the keyboard, so the button rides up above it instead of hiding behind it.
 */
export function useKeyboardLift(base = 24) {
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  return useAnimatedStyle(() => ({ bottom: base + Math.max(0, keyboard.height.value - insets.bottom) }));
}

/** Every screen sits in one of these. */
export function Screen({ children, style, bottom = true, backdrop }: { children: ReactNode; style?: StyleProp<ViewStyle>; bottom?: boolean; backdrop?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { rtl } = useLook();
  return (
    <View style={[{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }]}>
      <SkyBackground />
      {/* A chat's wallpaper fills the whole screen, behind its header and the typing bar too. */}
      {backdrop}
      <View style={[{ flex: 1, paddingTop: insets.top, paddingBottom: bottom ? insets.bottom : 0 }, style]}>{children}</View>
    </View>
  );
}

// ---- Cards and buttons ----

export function Glass({ children, style, strong, testID }: { children?: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: strong ? theme.glassStrong : theme.glass,
          borderColor: theme.glassLine,
          borderWidth: 1,
          borderRadius: 22,
          boxShadow: theme.dark ? undefined : `0 10px 30px -18px ${theme.shadow}`,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Anything tappable. It sinks to 96% under your finger and springs back. */
// The size and place keys that Pressy copies onto its outer Pressable (see below).
const OUTER_KEYS = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'minWidth', 'maxWidth'] as const;

export function Pressy({
  children,
  onPress,
  onLongPress,
  style,
  disabled,
  scale = 0.96,
  label,
  testID,
  hitSlop,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  scale?: number;
  label?: string;
  testID?: string;
  hitSlop?: number;
}) {
  const down = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(down.value, [0, 1], [1, scale]) }] }));
  // How big the button is in its row (flex: 1, a width, alignSelf) has to be set on
  // the outer Pressable too. With it only on the inner view, the Pressable shrank
  // to fit, so a `flex: 1` button (like the chat title) got no room for its text.
  // The inner view keeps the rest (colours, corners, padding) and fills the outer one.
  const { outer, inner } = useMemo(() => {
    const o: Record<string, unknown> = {};
    const i: Record<string, unknown> = { ...StyleSheet.flatten(style) };
    for (const k of OUTER_KEYS) {
      if (i[k] !== undefined) o[k] = i[k];
      delete i[k];
    }
    if (o.flex !== undefined || o.flexGrow !== undefined) i.flexGrow = 1;
    return { outer: o as ViewStyle, inner: i as ViewStyle };
  }, [style]);
  return (
    <Pressable
      style={outer}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={hitSlop}
      onPressIn={() => down.set(withSpring(1, snappy))}
      onPressOut={() => down.set(withSpring(0, snappy))}
    >
      <Animated.View style={[inner, anim, disabled && { opacity: 0.5 }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  onLongPress,
  label,
  look = 'plain',
  size = 44,
  iconSize = 21,
  color,
  flip,
  testID,
  disabled,
}: {
  icon: IconName;
  onPress?: () => void;
  onLongPress?: () => void;
  label: string;
  /** glass: frosted. soft: tinted with the accent. plain: just the icon. onAccent: on a coloured bar. */
  look?: 'glass' | 'soft' | 'plain' | 'onAccent';
  size?: number;
  iconSize?: number;
  color?: string;
  flip?: boolean;
  testID?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const bg = look === 'glass' ? theme.glass : look === 'soft' ? theme.accSoft : 'transparent';
  const fg = color ?? (look === 'soft' ? theme.accInk : look === 'onAccent' ? '#FFFFFF' : theme.text);
  return (
    <Pressy
      onPress={onPress}
      onLongPress={onLongPress}
      label={label}
      testID={testID}
      disabled={disabled}
      scale={0.9}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: look === 'glass' ? 1 : 0,
        borderColor: theme.glassLine,
      }}
    >
      <Icon name={icon} size={iconSize} color={fg} flip={flip} />
    </Pressy>
  );
}

/** A wide button: the accent gradient (main), or soft. */
export function Button({
  title,
  onPress,
  look = 'main',
  icon,
  disabled,
  busy,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  look?: 'main' | 'soft' | 'danger' | 'glass';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const fg = look === 'main' ? theme.onAcc : look === 'danger' ? theme.danger : look === 'glass' ? theme.text : theme.accInk;
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, paddingHorizontal: 20 }}>
      {icon && <Icon name={icon} size={20} color={fg} />}
      <Txt size={16} weight="700" color={fg} align="center">
        {title}
      </Txt>
    </View>
  );
  return (
    <Pressy onPress={onPress} disabled={disabled || busy} label={title} testID={testID} style={[{ borderRadius: 18, overflow: 'hidden' }, style]}>
      {look === 'main' ? (
        <LinearGradient
          colors={theme.grad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 18, boxShadow: `0 12px 26px -12px ${theme.acc}` }}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View
          style={{
            borderRadius: 18,
            backgroundColor: look === 'danger' ? theme.dangerSoft : look === 'glass' ? theme.glass : theme.accSoft,
            borderWidth: look === 'glass' ? 1 : 0,
            borderColor: theme.glassLine,
          }}
        >
          {inner}
        </View>
      )}
    </Pressy>
  );
}

// ---- People ----

const TINTS_SKY: [string, string, string][] = [
  ['#DCE9FF', '#C5D9FD', '#1E3A8A'],
  ['#D9F0FF', '#C0E3FB', '#0B4A75'],
  ['#E3E2FF', '#CFCDFB', '#3730A3'],
];
const TINTS_DARK: [string, string, string][] = [
  ['#24262C', '#24262C', '#C9D3E6'],
  ['#272A31', '#272A31', '#BFD0F0'],
  ['#22252B', '#22252B', '#D3D7E0'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** "Ayesha Khan" → "A", "FAST CS-B" → "FC". */
/** A person's picture colours (the light look), for alerts drawn outside the app. */
export function avatarTint(id: string) {
  const [a, b, ink] = TINTS_SKY[hash(id) % TINTS_SKY.length];
  return { a, b, ink };
}

export function initials(name: string) {
  // "~ Sara" (someone not in my contacts) is still S.
  const words = name.replace(/^~\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1 || hasUrdu(name)) return [...words[0]][0].toUpperCase();
  const two = words[0] === words[0].toUpperCase() && words[1] === words[1].toUpperCase();
  return two ? ([...words[0]][0] + [...words[1]][0]).toUpperCase() : [...words[0]][0].toUpperCase();
}

/**
 * Someone's (or a group's) picture: their photo once it's on the phone, else
 * their letters on a colour. `photo`: a value to show instead of theirs.
 */
export function Avatar({ id, name, size = 50, online, group, photo }: { id: string; name: string; size?: number; online?: boolean; group?: boolean; photo?: string | null }) {
  const theme = useTheme();
  const uri = useCore(['photos', 'people', 'auth'], () => photoUri(photo !== undefined ? photo : core.photoOf(id)));
  const tints = theme.dark ? TINTS_DARK : TINTS_SKY;
  const [a, b, ink] = tints[hash(id) % tints.length];
  const dot = Math.round(size * 0.3);
  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size * 0.34, backgroundColor: a }} contentFit="cover" transition={150} />
      ) : (
        <LinearGradient
          colors={[a, b]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: size, height: size, borderRadius: size * 0.34, alignItems: 'center', justifyContent: 'center' }}
        >
          {group && !name ? (
            <Icon name="group" size={size * 0.5} color={ink} />
          ) : (
            <Txt size={Math.round(size * 0.34)} weight="700" color={ink} align="center" style={hasUrdu(name) ? { lineHeight: size } : undefined}>
              {initials(name || '?')}
            </Txt>
          )}
        </LinearGradient>
      )}
      {online && (
        <Animated.View
          entering={pop()}
          style={{
            position: 'absolute',
            end: -2,
            bottom: -2,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: theme.online,
            borderWidth: 3,
            borderColor: theme.dark ? theme.bg : '#FFFFFF',
          }}
        />
      )}
    </View>
  );
}

// ---- Filters and switches ----

/** A filter chip. Picking it fills it with the accent gradient, smoothly. */
export function Chip({
  label,
  on,
  onPress,
  onLongPress,
  count,
  icon,
  testID,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  count?: number;
  /** Shows this icon instead of the words (the words are still read out by screen readers). */
  icon?: IconName;
  testID?: string;
}) {
  const { theme, lang } = useLook();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, fade);
  }, [on, v]);
  const fill = useAnimatedStyle(() => ({ opacity: v.value }));
  const words = useAnimatedStyle(() => ({ color: interpolateColor(v.value, [0, 1], [theme.text, theme.onAcc]) }));
  return (
    <Pressy onPress={onPress} onLongPress={onLongPress} label={label} testID={testID} scale={0.94}>
      <View
        style={{
          height: 36,
          paddingHorizontal: 15,
          borderRadius: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: theme.glass,
          borderWidth: 1,
          borderColor: theme.glassLine,
          overflow: 'hidden',
        }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, fill]}>
          <LinearGradient colors={theme.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        {icon ? <Icon name={icon} size={18} color={on ? theme.onAcc : theme.text} /> : <Animated.Text style={[fontStyle(label, lang, 13, '600'), words]}>{label}</Animated.Text>}
        {!!count && (
          <View
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 5,
              backgroundColor: on ? 'rgba(255,255,255,0.3)' : theme.acc,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt size={10} weight="700" color="#FFFFFF" align="center">
              {count}
            </Txt>
          </View>
        )}
      </View>
    </Pressy>
  );
}

/** An on/off switch. The knob springs across; in Urdu it moves the other way. */
export function Toggle({ on, onChange, label, testID }: { on: boolean; onChange: (on: boolean) => void; label: string; testID?: string }) {
  const theme = useTheme();
  const { rtl } = useLook();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(on ? 1 : 0, snappy);
  }, [on, v]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], [theme.faint, theme.acc]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: v.value * 20 * (rtl ? -1 : 1) }] }));
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} testID={testID} onPress={() => onChange(!on)} hitSlop={8}>
      <Animated.View style={[{ width: 48, height: 28, borderRadius: 14, padding: 3, alignItems: 'flex-start' }, track]}>
        <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }, knob]} />
      </Animated.View>
    </Pressable>
  );
}

/** The big round-cornered + button. It pops in when the screen opens. */
export function Fab({ icon, onPress, label, testID, bottom = 22 }: { icon: IconName; onPress: () => void; label: string; testID?: string; bottom?: number }) {
  const theme = useTheme();
  return (
    <Animated.View entering={pop(120)} style={{ position: 'absolute', end: 22, bottom }}>
      <Pressy onPress={onPress} label={label} testID={testID} scale={0.9}>
        <LinearGradient
          colors={theme.grad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', boxShadow: `0 16px 32px -10px ${theme.acc}` }}
        >
          <Icon name={icon} size={25} color="#FFFFFF" stroke={2} />
        </LinearGradient>
      </Pressy>
    </Animated.View>
  );
}

// ---- Bars and rows ----

/** The glass bar at the top of most screens: back, a title, and buttons on the end. */
export function TopBar({
  title,
  subtitle,
  onBack,
  right,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Put your own middle in (the chat screen's name and picture). */
  children?: ReactNode;
}) {
  const t = useTheme();
  const words = useT();
  return (
    <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginHorizontal: 10, marginTop: 10, padding: 6, minHeight: 56 }}>
      {onBack && <IconButton icon="back" label={words.back} onPress={onBack} flip testID="back" size={42} iconSize={23} />}
      {children ?? (
        <View style={{ flex: 1, paddingHorizontal: onBack ? 4 : 12 }}>
          <Txt size={18} weight="700" lines={1}>
            {title}
          </Txt>
          {!!subtitle && (
            <Txt size={12} color={t.muted} lines={1}>
              {subtitle}
            </Txt>
          )}
        </View>
      )}
      {right}
    </Glass>
  );
}

/** One row in Settings or an info screen: an icon on a tile, a title, maybe a line under it. */
export function SettingRow({
  icon,
  title,
  sub,
  onPress,
  right,
  danger,
  testID,
  chevron = true,
}: {
  icon?: IconName;
  title: string;
  sub?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
  testID?: string;
  chevron?: boolean;
}) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 }}>
      {icon && (
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: danger ? t.dangerSoft : t.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={danger ? t.danger : t.accInk} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Txt size={15.5} weight="600" color={danger ? t.danger : t.text}>
          {title}
        </Txt>
        {!!sub && (
          <Txt size={13} color={t.muted}>
            {sub}
          </Txt>
        )}
      </View>
      {right ?? (onPress && chevron ? <Icon name="chevron" size={18} color={t.faint} flip /> : null)}
    </View>
  );
  return onPress ? (
    <Pressy onPress={onPress} label={title} testID={testID} scale={0.98}>
      {body}
    </Pressy>
  ) : (
    <View testID={testID}>{body}</View>
  );
}

/** A small heading over a group of rows. */
export function Section({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Txt size={13} weight="700" color={t.sectionText} style={{ marginTop: 18, marginBottom: 8, marginHorizontal: 22 }}>
      {title}
    </Txt>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.divider, marginStart: 66 }} />;
}

/** A text box in our style. */
export function Field(props: TextInputProps & { icon?: IconName }) {
  const t = useTheme();
  const { lang, rtl } = useLook();
  const { icon, style, ...rest } = props;
  const value = typeof rest.value === 'string' ? rest.value : '';
  return (
    <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 52, borderRadius: 16 }}>
      {icon && <Icon name={icon} size={19} color={t.muted} />}
      <TextInput
        placeholderTextColor={t.muted}
        selectionColor={t.acc}
        cursorColor={t.acc}
        {...rest}
        style={[
          fontStyle(value || null, lang, 16, '400'),
          // The box is always as tall as the field, with the words centred in it. Without a set
          // height Android could measure it as 0 tall once you typed, so your words vanished.
          { flex: 1, alignSelf: 'stretch', height: '100%', color: t.text, textAlign: rtl ? 'right' : 'left', textAlignVertical: 'center', paddingVertical: 0 },
          style,
        ]}
      />
    </Glass>
  );
}

/** An empty state: a big soft icon and a line of words. */
export function Empty({ icon, text, children }: { icon: IconName; text: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 36, paddingVertical: 48, gap: 14 }}>
      <Animated.View entering={pop()}>
        <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: t.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={38} color={t.accInk} stroke={1.6} />
        </View>
      </Animated.View>
      <Txt size={15} color={t.muted} align="center">
        {text}
      </Txt>
      {children}
    </View>
  );
}
