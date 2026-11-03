// speed.ts: how long things take on this phone.
//
// A few things are timed every time: starting PakChat (from its code starting
// to the chat list showing), opening a chat (from the tap to it being drawn,
// and to the end of its slide), opening any other screen (from the tap to it
// starting to move, and to the end of its slide), going back, switching tabs
// and sending a message (from the tap to the bubble). And any moment PakChat
// was too busy to answer a touch (it froze for a moment), with the screen it
// was on. The newest few are kept here for Settings › Help › Speed check, and
// each also goes to the phone's log (tag ReactNativeJS), so an older phone's
// times can be read off and compared with a newer one's.
import { AppState, BackHandler } from 'react-native';

export type Timed = { what: SpeedWhat; ms: number; at: number; where?: string };

/** What was timed (words for it are in i18n: speedStart, speedChatDrawn, …). */
export type SpeedWhat = 'start' | 'chatDrawn' | 'chatIn' | 'tab' | 'send' | 'pageDrawn' | 'pageMoving' | 'pageIn' | 'back' | 'busy';

/** How long is fine for each (more shows in red). A slide itself takes a fifth of a second. */
export const SPEED_OK: Record<SpeedWhat, number> = {
  start: 1000,
  chatDrawn: 150,
  chatIn: 400,
  tab: 150,
  send: 150,
  pageDrawn: 120,
  pageMoving: 150,
  pageIn: 400,
  back: 350,
  busy: 0,
};

const KEEP = 60;
const log: Timed[] = [];
const started = new Map<string, number>();

/** Starts the clock for `name` (a tap, say). Starting it again restarts it. */
export function startTimer(name: string) {
  started.set(name, performance.now());
}

/** Notes how long since `name` started, and keeps the clock going (for a later step). */
export function lapTimer(name: string, what: SpeedWhat, where?: string) {
  const at = started.get(name);
  if (at !== undefined) note(what, performance.now() - at, where);
}

/** Notes how long since `name` started, and stops its clock. Nothing if it wasn't started. */
export function stopTimer(name: string, what: SpeedWhat, where?: string) {
  lapTimer(name, what, where);
  started.delete(name);
}

/** True while `name`'s clock is going. */
export function timing(name: string) {
  return started.has(name);
}

function note(what: SpeedWhat, ms: number, where?: string) {
  if (what === 'start' && !up) {
    up = true;
    watchBusy(AppState.currentState === 'active');
  }
  log.unshift({ what, ms: Math.round(ms), at: Date.now(), ...(where ? { where } : {}) });
  if (log.length > KEEP) log.length = KEEP;
  console.log(`[pakchat] speed: ${what}${where ? ` (${where})` : ''} ${Math.round(ms)} ms`);
}

// Screens (_layout.tsx tells us as they move). A chat is timed on its own (chat/[id].tsx).
let current = '';
/** The screen on top now (its route name), for "busy" moments. */
export function screenNow() {
  return current;
}

/** A screen started moving: opening (`closing` false) or going back (true). */
export function screenMoving(route: string, closing: boolean) {
  if (!closing && route !== 'chat/[id]' && started.has('page') && performance.now() - started.get('page')! < 3000) lapTimer('page', 'pageMoving', route);
}

/**
 * A screen finished moving. `top` is the one on top now. `kept` is true when it's still there:
 * the screen underneath a new one says it's "closing" too, but nobody went back.
 */
export function screenMoved(route: string, closing: boolean, top: string, kept = false) {
  current = top;
  if (closing && kept) return;
  if (closing) stopFresh('back', 'back', route);
  else if (route !== 'chat/[id]') stopFresh('page', 'pageIn', route);
  else started.delete('page');
}

/** Like stopTimer, but a clock started long ago (by a tap that didn't move a screen) is just dropped. */
function stopFresh(name: string, what: SpeedWhat, where: string) {
  const at = started.get(name);
  if (at !== undefined && performance.now() - at < 3000) note(what, performance.now() - at, where);
  started.delete(name);
}

/**
 * Starts the clocks from the app's own taps: anything that opens a screen (router.push and the
 * like) or goes back (router.back, a back arrow). Called once, with expo-router's `router`.
 */
export function watchRouter(router: object) {
  const r = router as Record<string, unknown>;
  const watch = (key: string, before: (to: unknown) => void) => {
    const wrap = (fn: unknown) =>
      typeof fn === 'function'
        ? (...args: unknown[]) => {
            before(args[0]);
            return (fn as (...a: unknown[]) => unknown)(...args);
          }
        : fn;
    // expo-router fills in the real methods once it's ready (and again later), so whatever it puts
    // there is wrapped as it arrives.
    let now = wrap(r[key]);
    Object.defineProperty(r, key, {
      configurable: true,
      enumerable: true,
      get: () => now,
      set: (fn: unknown) => {
        now = wrap(fn);
      },
    });
  };
  for (const key of ['push', 'navigate', 'replace']) watch(key, (to) => opening(routeOf(to)));
  for (const key of ['back', 'dismiss', 'dismissTo', 'dismissAll']) watch(key, goingBack);
}

/**
 * The phone's back button: its clock starts first thing. Added once navigation is set up, so
 * Android asks this before navigation's own (it only notes the time and lets the others decide
 * what back does). It doesn't see a back that a screen handles itself, like closing a pop-up.
 */
let backWatched = false;
export function watchBackButton() {
  if (backWatched) return;
  backWatched = true;
  BackHandler.addEventListener('hardwareBackPress', () => {
    goingBack();
    return false;
  });
}

/** The screen being opened ("settings", "info/[id]"), for its "drawn" time. */
let opened = '';

/** A tap that opens a screen (any but a chat, which starts its own clock): starts its clock. */
export function opening(route = '') {
  opened = route;
  startTimer('page');
}

/** Where router.push and the like go, as a route's name: '/settings' → "settings", { pathname: '/info/[id]' } → "info/[id]". */
function routeOf(to: unknown) {
  const path = typeof to === 'string' ? to : to && typeof to === 'object' && 'pathname' in to ? String((to as { pathname: unknown }).pathname) : '';
  return path.replace(/^\//, '').replace(/[?#].*$/, '');
}

/**
 * A screen has been drawn (Screen in kit.tsx, as it first appears): how long since the tap. Next to
 * "starts moving", it says whether a slow opening was PakChat drawing the screen or the phone
 * getting ready to slide it in. A chat has its own ("Opening a chat: drawn").
 */
export function screenDrawn() {
  if (!timing('page') || !opened || opened.startsWith('chat/') || opened === '(tabs)') return;
  const where = opened;
  opened = '';
  requestAnimationFrame(() => lapTimer('page', 'pageDrawn', where));
}

/** Back (the phone's button, a back arrow): starts the going-back clock. */
export function goingBack() {
  startTimer('back');
}

// Busy moments: a check twice a second; one that comes much later than it should means PakChat was
// too busy to answer a touch (or to draw) for that long. Only while PakChat is on screen.
const TICK = 500;
let last = performance.now();
let ticking: ReturnType<typeof setInterval> | null = null;
function tick() {
  const now = performance.now();
  const late = now - last - TICK;
  last = now;
  // (Far too late means the phone paused us, not that we were busy.)
  if (late > 250 && late < 10_000) note('busy', late, current || undefined);
}
// Only once PakChat has started: while it starts (the logo still showing) it's meant to be busy,
// and that was noted as the chat list being stuck (owner's speed check, 3 Nov).
let up = false;
function watchBusy(on: boolean) {
  if (ticking) clearInterval(ticking);
  ticking = null;
  last = performance.now();
  if (on && up) ticking = setInterval(tick, TICK);
}
AppState.addEventListener('change', (s) => watchBusy(s === 'active'));

/** The times kept, newest first. */
export function speedLog(): readonly Timed[] {
  return log;
}

// Starting PakChat: the clock starts as soon as this file is first loaded.
// The log line marks when PakChat's own code began (after Android started the
// app and loaded its code), so the phone's log shows that part apart from
// the screens' code loading (up to "Running main").
startTimer('start');
console.log('[pakchat] start: code began');
