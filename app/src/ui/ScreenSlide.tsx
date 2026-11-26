// ScreenSlide.tsx: how a screen slides in and out, like WhatsApp's.
//
// Android's own screen slide (plugins/withScreenSlide.js) starts the moment a screen is pushed,
// while the screen is still being built: on a slower phone the first frames of the slide waited for
// it to be made and drawn, and it stuttered as it came in (the owner's Realme, Nov). So these
// screens open with no slide of Android's (_layout.tsx) and slide themselves instead: each is
// built and drawn first, just off the side of the screen, and only then moves in, with nothing
// left to do while it moves. That's how WhatsApp's screens come in. Same length and curve as
// Android's slide was, and the screen under it moves a little the other way, as before. Going
// back slides it out the same way.
//
// A chat says itself when it's ready (its list has drawn what fits on the screen). Any other screen
// is ready once the phone has had two calm frames in a row after it was made (nothing big left to
// draw), so a light screen comes in almost at once and only a heavy one waits a moment.
import { usePreventRemove } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, makeMutable, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { mark } from '../core/speed';
import { useLook } from '../theme/ThemeProvider';

/** The same as Android's slide was (withScreenSlide.js): a fifth of a second, slowing into place. */
const MS = 200;
const EASE = Easing.out(Easing.cubic);
/** How far the screen underneath moves the other way as a new one covers it (withScreenSlide.js's UNDER). */
const UNDER = 0.3;
/** At the latest, a screen slides in this long after it starts being built, ready or not. */
const LATEST_MS = 700;
/** A frame this quick or quicker is a calm one (the phone has nothing big left to draw). */
const CALM_MS = 25;

/**
 * How far the chat list (the tabs, app/(tabs)/_layout.tsx) is covered: 0 in place, 1 covered.
 * It's the bottom of the pile of screens below.
 */
export const listCovered = makeMutable(0);
/** The screens open, bottom first: how covered each is. Only the top one is uncovered. */
const pile: SharedValue<number>[] = [listCovered];

type Slide = {
  /** The screen is built and drawn: it can come in now. */
  ready: () => void;
  /** Calls `fn` once the screen is fully in (at once if it is already). */
  whenIn: (fn: () => void) => () => void;
};
const SlideContext = createContext<Slide>({ ready: () => {}, whenIn: (fn) => (fn(), () => {}) });

/** For the screen inside: say when it's ready, and hear when it's in. */
export function useScreenSlide() {
  return useContext(SlideContext);
}

/**
 * The chat list under the other screens: moved a little aside as one covers it, and not drawn
 * once it's fully covered (nothing of it shows). Each ScreenSlide does the same for itself.
 */
export function useUnderChat() {
  const { rtl } = useLook();
  const { width } = useWindowDimensions();
  const away = -(rtl ? -1 : 1) * UNDER * width;
  return useAnimatedStyle(() => ({ opacity: listCovered.value >= 1 ? 0 : 1, transform: [{ translateX: away * listCovered.value }] }));
}

/**
 * `manual`: the screen inside calls `ready()` itself (a chat, when its list has drawn).
 * Otherwise it comes in after two calm frames.
 */
export function ScreenSlide({ children, manual = false }: { children: ReactNode; manual?: boolean }) {
  const { theme, rtl } = useLook();
  const { width } = useWindowDimensions();
  const side = (rtl ? -1 : 1) * width;
  const x = useSharedValue(side);
  // How covered this screen is, by one opened over it.
  const [covered] = useState(() => makeMutable(0));
  const away = -(rtl ? -1 : 1) * UNDER * width;
  const started = useRef(false);
  const slidIn = useRef(false);
  const waiting = useRef(new Set<() => void>());
  const leaving = useRef(false);
  // Gone off the side after going back: what was on it is taken down first, on a frame of its
  // own, and only then the screen itself (39: that cleanup was one long frame just after the slide).
  const [emptied, setEmptied] = useState(false);

  useEffect(() => {
    pile.push(covered);
    return () => {
      const at = pile.indexOf(covered);
      if (at > 0) {
        // Whatever this one covered is uncovered (in case it closed without its slide).
        const below = pile[at - 1];
        if (at === pile.length - 1) below.value = 0;
        pile.splice(at, 1);
      }
    };
  }, [covered]);
  const below = () => pile[pile.indexOf(covered) - 1] ?? null;

  const arrived = useCallback(() => {
    slidIn.current = true;
    mark('screen slid in');
    for (const fn of waiting.current) fn();
    waiting.current.clear();
  }, []);

  const start = useCallback(() => {
    if (started.current || leaving.current) return;
    started.current = true;
    mark('screen slide starts');
    x.set(
      withTiming(0, { duration: MS, easing: EASE }, (done) => {
        'worklet';
        if (done) scheduleOnRN(arrived);
      }),
    );
    const under = pile[pile.indexOf(covered) - 1];
    if (under) under.value = withTiming(1, { duration: MS, easing: EASE });
  }, [x, arrived, covered]);

  // Built and drawn: in on the next frame (that frame shows it just off the side, so it's drawn).
  const ready = useCallback(() => {
    if (started.current) return;
    requestAnimationFrame(start);
  }, [start]);

  useEffect(() => {
    const latest = setTimeout(start, LATEST_MS);
    return () => clearTimeout(latest);
  }, [start]);

  // Any other screen: ready after two calm frames in a row (a slow frame means the phone is still
  // making or drawing it).
  useEffect(() => {
    if (manual) return;
    let frame = 0;
    let last = 0;
    let calm = 0;
    const tick = (now: number) => {
      if (last && now - last <= CALM_MS) calm += 1;
      else calm = 0;
      last = now;
      if (calm >= 2) return ready();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [manual, ready]);

  // Going back (the back button, the bar's arrow, anything that closes the screen): out first, then
  // gone. Until then the screen stays (usePreventRemove), and `repeat` carries on with what closed it.
  usePreventRemove(true, ({ data, repeat }) => {
    if (leaving.current) return;
    leaving.current = true;
    // Another screen taking this one's place comes in by itself.
    if (data.action.type === 'REPLACE') return repeat();
    let went = false;
    // Closing it (taking its pieces off, and the screen under it drawn again) waits for the frame
    // after the slide's last one, so that work is never inside the slide (38i: a hitch at its end).
    const gone = () => {
      if (went) return;
      went = true;
      requestAnimationFrame(() => {
        setEmptied(true);
        requestAnimationFrame(() => requestAnimationFrame(() => repeat()));
      });
    };
    const under = below();
    const out = () => {
      x.set(
        withTiming(side, { duration: MS, easing: EASE }, (done) => {
          'worklet';
          if (done) scheduleOnRN(gone);
        }),
      );
      if (under) under.value = withTiming(0, { duration: MS, easing: EASE });
      // If the slide is cut short (an animation that never finishes), it still goes.
      setTimeout(gone, MS + 300);
    };
    if (!under || under.value < 1) return out();
    // The screen underneath isn't drawn while it's covered, so first it's drawn again, still hidden
    // behind this one, and only then does this one move: that redraw isn't on the slide's first
    // frame (38h: a stutter just as going back began).
    under.value = 0.999;
    requestAnimationFrame(() => requestAnimationFrame(out));
  });

  const whenIn = useCallback((fn: () => void) => {
    if (slidIn.current) {
      fn();
      return () => {};
    }
    waiting.current.add(fn);
    return () => waiting.current.delete(fn);
  }, []);

  const value = useMemo(() => ({ ready, whenIn }), [ready, whenIn]);
  const style = useAnimatedStyle(() => ({
    opacity: covered.value >= 1 ? 0 : 1,
    transform: [{ translateX: x.get() + away * covered.value }],
  }));
  return (
    <SlideContext.Provider value={value}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }, style]}>{emptied ? null : children}</Animated.View>
    </SlideContext.Provider>
  );
}

/** A screen of its own that slides in once it's built (for the routes in app/). */
export function slid<P extends object>(Screen: ComponentType<P>) {
  function Slid(props: P) {
    return (
      <ScreenSlide>
        <Screen {...props} />
      </ScreenSlide>
    );
  }
  Slid.displayName = `Slid(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return Slid;
}

/** For a screen with nothing to wait for (a locked chat, a chat that's gone): it can come in at once. */
export function SlideReadyNow() {
  const { ready } = useScreenSlide();
  useEffect(() => ready(), [ready]);
  return null;
}
