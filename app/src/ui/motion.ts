// motion.ts: how things move (owner, 29 Oct 2026: like WhatsApp, quick and never bouncy).
// Screens slide in and out, like opening a chat on WhatsApp. Pop-ups come and go the way
// WhatsApp's do: the ⋮ menu grows out of its corner, sheets slide up, questions fade in, the
// reactions over a held message pop in (overlays.tsx, `popIn`). A new message rises into place
// (`arrive`), a photo grows out of the chat and shrinks back into it (SwipeToClose.tsx). Small
// changes cross-fade quickly, as WhatsApp's do: a selection bar for the title, "typing…" for
// "online", the mic for send, a tick appearing (`fadeIn`, `quick`). Lists and rows never
// bounce or rise in. All of these run on the UI thread.
//
// What's left here is for things you drag with a finger (swipe to reply, drag a sheet or a
// photo down, slide to cancel a voice note, your own video in a call): when you let go they
// go back quickly, without overshooting or bouncing.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { Easing, FadeIn, FadeInDown, FadeOut, Keyframe, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/** A message sent, or come in, while its chat is open: it rises the last bit into place as it shows, quickly and without a bounce, like WhatsApp's. */
export const arrive = FadeInDown.duration(180).easing(Easing.out(Easing.cubic));

/** The reactions over a held message: they grow quickly into place as they fade in, like WhatsApp's. */
export const popIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.6 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.out(Easing.cubic) },
}).duration(170);
export const popOut = FadeOut.duration(100);

/** One thing changing for another (a selection bar for the title, "typing…" for "online"): a quick cross-fade, like WhatsApp's. */
export const fadeIn = FadeIn.duration(150);
export const fadeOut = FadeOut.duration(110);

/** A strip coming up out of the message bar (the message you're replying to, a link's preview), like WhatsApp's. */
export const riseIn = FadeInDown.duration(160).easing(Easing.out(Easing.cubic));

/** A small change (the mic turning into send, a tick, a chip's colour): quick, slowing to a stop. */
export const quick: WithTimingConfig = { duration: 150, easing: Easing.out(Easing.cubic) };

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
