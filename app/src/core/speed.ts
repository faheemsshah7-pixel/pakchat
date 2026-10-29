// speed.ts: how long things take on this phone.
//
// A few things are timed every time: starting PakChat (from its code starting
// to the chat list showing), opening a chat (from the tap to it being drawn,
// and to the end of its slide), switching tabs and sending a message (from
// the tap to the bubble). The newest few are kept here for Settings › Help ›
// Speed check, and each also goes to the phone's log (tag ReactNativeJS), so
// an older phone's times can be read off and compared with a newer one's.

export type Timed = { what: SpeedWhat; ms: number; at: number };

/** What was timed (words for it are in i18n: speedStart, speedChatDrawn, …). */
export type SpeedWhat = 'start' | 'chatDrawn' | 'chatIn' | 'tab' | 'send';

const KEEP = 40;
const log: Timed[] = [];
const started = new Map<string, number>();

/** Starts the clock for `name` (a tap, say). Starting it again restarts it. */
export function startTimer(name: string) {
  started.set(name, performance.now());
}

/** Notes how long since `name` started, and keeps the clock going (for a later step). */
export function lapTimer(name: string, what: SpeedWhat) {
  const at = started.get(name);
  if (at !== undefined) note(what, performance.now() - at);
}

/** Notes how long since `name` started, and stops its clock. Nothing if it wasn't started. */
export function stopTimer(name: string, what: SpeedWhat) {
  lapTimer(name, what);
  started.delete(name);
}

/** True while `name`'s clock is going. */
export function timing(name: string) {
  return started.has(name);
}

function note(what: SpeedWhat, ms: number) {
  log.unshift({ what, ms: Math.round(ms), at: Date.now() });
  if (log.length > KEEP) log.length = KEEP;
  console.log(`[pakchat] speed: ${what} ${Math.round(ms)} ms`);
}

/** The times kept, newest first. */
export function speedLog(): readonly Timed[] {
  return log;
}

// Starting PakChat: the clock starts as soon as this file is first loaded.
startTimer('start');
