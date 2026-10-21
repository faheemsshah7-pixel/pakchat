// motion.ts: how things move. Every animation in the app uses one of these springs,
// so the whole app feels the same: quick, soft at the end, never bouncy enough to wobble.
//
// Springs (not fixed-time animations) follow your finger: let go mid-swipe and it
// carries on from that speed. And if "Remove animations" is on in the phone's
// settings, Reanimated jumps straight to the end (ReduceMotion.System, the default).
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { Easing, FadeIn, FadeOut, LinearTransition, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/** Buttons pressing in and out, chips, switches. */
export const snappy: WithSpringConfig = { damping: 20, stiffness: 320, mass: 0.8, reduceMotion: ReduceMotion.System };

/** Panels and sheets sliding in, rows settling after a swipe. */
export const smooth: WithSpringConfig = { damping: 24, stiffness: 210, mass: 1, reduceMotion: ReduceMotion.System };

/** Things that should arrive with a little life: new bubbles, the + button, reactions. */
export const lively: WithSpringConfig = { damping: 15, stiffness: 240, mass: 0.8, reduceMotion: ReduceMotion.System };

/** Fades (backdrops, words changing). */
export const fade: WithTimingConfig = { duration: 180, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System };

/** Rows moving to a new place in a list (a pinned chat going to the top). */
export const listLayout = LinearTransition.springify().damping(24).stiffness(210);

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
