// motion.ts: how things move. Every animation in the app uses one of these, so the
// whole app feels the same: quick and soft at the end.
//
// How much bounce (the owner's call, 22 Oct): a little, never a wobble. Most things
// settle with a tiny overshoot you feel more than see; a sent message and the send
// button get a touch more. The typing bar follows the keyboard directly, with no
// animation of its own, so it never lags or bounces.
//
// About springs: a spring overshoots (goes a little past where it's going and back)
// when its "damping" is low for its "stiffness" and "mass". It stops overshooting at
//   damping = 2 * sqrt(stiffness * mass)
// "ratio" in the notes below is damping divided by that number: 1 means no overshoot,
// 0.85 to 0.9 a tiny settle, 0.7 one small bounce, under 0.6 a wobble (what felt annoying).
//
// Springs (not fixed-time animations) follow your finger: let go mid-swipe and it
// carries on from that speed. They play even when "Remove animations" is on in the
// phone's settings: skipping them left some screens invisible (see _layout.tsx).
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, ReduceMotion, type WithSpringConfig, type WithTimingConfig, ZoomIn } from 'react-native-reanimated';

/** Buttons pressing in and out, chips, switches. Ratio 0.9. */
export const snappy: WithSpringConfig = { damping: 29, stiffness: 320, mass: 0.8, reduceMotion: ReduceMotion.System };

/** Panels and sheets sliding in, the tab bar's pill, rows settling after a swipe. Ratio 0.9. */
export const smooth: WithSpringConfig = { damping: 26, stiffness: 210, mass: 1, reduceMotion: ReduceMotion.System };

/** The send button turning in: one small bounce. Ratio 0.72. */
export const lively: WithSpringConfig = { damping: 20, stiffness: 240, mass: 0.8, reduceMotion: ReduceMotion.System };

/** Rows, cards and pages rising into place, with a tiny settle. Ratio 0.86. */
export function rise(delay = 0) {
  return FadeInDown.delay(delay).springify().damping(18).stiffness(110);
}

/** Small things popping in (reactions, ticks, icons, the + button), with a tiny settle. Ratio 0.85. */
export function pop(delay = 0) {
  return ZoomIn.delay(delay).springify().damping(24).stiffness(200);
}

/** A new message bubble arriving: rises in with one small bounce. Ratio 0.69. */
export const arrive = FadeInDown.springify().damping(21).stiffness(230);

/** Fades (backdrops, words changing). */
export const fade: WithTimingConfig = { duration: 180, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System };

/** Rows moving to a new place in a list (a pinned chat going to the top). */
export const listLayout = LinearTransition.springify().damping(26).stiffness(210);

export const fadeIn = FadeIn.duration(180);
export const fadeOut = FadeOut.duration(140);

// On Android these use the phone's own system taps (the crisp ones the keyboard
// and Pixel's own apps use), not the motor buzz, which felt rough.

/** A light tap you can feel: crossing a swipe's line, picking a reaction. */
export function tick() {
  const feel = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick) : Haptics.selectionAsync();
  void feel.catch(() => {});
}

/** A firmer tap: a long press starting selection. */
export function thud() {
  const feel =
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  void feel.catch(() => {});
}
