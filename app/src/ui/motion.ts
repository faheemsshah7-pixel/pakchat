// motion.ts: how things move, which is hardly at all (owner, 29 Oct 2026): screens slide in
// and out, like opening a chat on WhatsApp, and WhatsApp's own few small touches stay: a new
// message rises into place (`arrive`), and a photo grows out of the chat and shrinks back
// into it (SwipeToClose.tsx). Menus, sheets, buttons, rows and tabs appear and change at
// once, so nothing waits on an animation. All of these run on the UI thread.
//
// What's left here is for things you drag with a finger (swipe to reply, drag a sheet or a
// photo down, slide to cancel a voice note, your own video in a call): when you let go they
// go back quickly, without overshooting or bouncing.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { Easing, FadeInDown, ReduceMotion, type WithSpringConfig } from 'react-native-reanimated';

/** A message sent, or come in, while its chat is open: it rises the last bit into place as it shows, quickly and without a bounce, like WhatsApp's. */
export const arrive = FadeInDown.duration(180).easing(Easing.out(Easing.cubic));

/** Something small going back after a drag (the mic, a round video's cancel slide). No bounce. */
export const snappy: WithSpringConfig = { damping: 40, stiffness: 600, mass: 0.6, overshootClamping: true, reduceMotion: ReduceMotion.Never };

/** A bubble, sheet, photo or call picture going back after a drag. No bounce. */
export const smooth: WithSpringConfig = { damping: 36, stiffness: 420, mass: 0.8, overshootClamping: true, reduceMotion: ReduceMotion.Never };

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
