// scheduled.ts: messages that go later, like Instagram's. Hold "send", pick a
// time, and the message waits on this phone. Android's alarm (Scheduled.kt)
// wakes PakChat at that time, even when it's closed or the phone restarted, and
// the message goes then (background.ts). Opening PakChat also sends any that
// are late (the phone was off, say).
//
// They're kept only on this phone, and the chat shows "1 scheduled message"
// with edit, send now and delete.
//
// On time to the minute: while PakChat is open, a timer here sends it. When
// it's closed, Android's alarm does, and that's exact only once "Alarms &
// reminders" is allowed for PakChat (Android 12+ asks the person; otherwise
// Android may send it a few minutes late). See exactAlarms below.
import type { LinkPreview, Ref } from '@pakchat/shared';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';

export type Planned = {
  id: string;
  chatId: string;
  /** When it goes (ms). */
  at: number;
  text: string;
  mentions?: string[];
  link?: LinkPreview;
  replyTo?: Ref;
  made: number;
};

/** The soonest a message can be scheduled for, from now. */
export const SOONEST_MS = 60_000;
/** And the latest: a year. */
export const LATEST_MS = 365 * 86_400_000;

const KEY = 'app:scheduled';
let list: Planned[] | null = null;
let sending: Promise<void> | null = null;

async function load() {
  list ??= (await core.storage.getValue<Planned[]>(KEY)) ?? [];
  return list;
}

async function save(next: Planned[]) {
  list = next;
  await core.storage.setValue(KEY, next);
  core.emit('scheduled');
  watch(next);
}

/** While PakChat is open, a timer sends the next one right on time. */
let timer: ReturnType<typeof setTimeout> | null = null;
function watch(all: Planned[]) {
  if (timer) clearTimeout(timer);
  timer = null;
  const next = Math.min(...all.map((p) => p.at));
  if (!Number.isFinite(next)) return;
  // setTimeout can't wait longer than about 24 days; it simply looks again then.
  timer = setTimeout(() => void sendDue(), Math.min(Math.max(0, next - Date.now()), 2 ** 31 - 1));
}

/** Start the timer (PakChat opened, or signed in). */
export async function watchPlans() {
  watch(await load());
}

/** Android 12+: may PakChat's alarm ring at the exact minute? (Otherwise it can be a few minutes late.) */
export function exactAlarms() {
  try {
    return fileModule().canExactAlarms();
  } catch {
    return true;
  }
}

/** Opens Android's "Alarms & reminders" page for PakChat. */
export function allowExactAlarms() {
  try {
    fileModule().openExactAlarmSettings();
  } catch {
    // An older Android: nothing to allow.
  }
}

/** What's waiting (in one chat, or all), soonest first. */
export async function scheduled(chatId?: string) {
  const all = await load();
  return all.filter((p) => !chatId || p.chatId === chatId).sort((a, b) => a.at - b.at);
}

export async function plan(chatId: string, at: number, text: string, extra: { mentions?: string[]; link?: LinkPreview; replyTo?: Ref } = {}) {
  const p: Planned = { id: core.newId(), chatId, at, text, made: Date.now() };
  if (extra.mentions?.length) p.mentions = extra.mentions;
  if (extra.link) p.link = extra.link;
  if (extra.replyTo) p.replyTo = extra.replyTo;
  await save([...(await load()), p]);
  arm(p);
  return p;
}

export async function changePlan(id: string, change: { text?: string; at?: number }) {
  const all = await load();
  const old = all.find((p) => p.id === id);
  if (!old) return;
  const next = { ...old, ...change };
  // Changed words: the old card may not fit them any more.
  if (change.text !== undefined && next.link && !change.text.includes(next.link.url)) delete next.link;
  await save(all.map((p) => (p.id === id ? next : p)));
  arm(next);
}

export async function dropPlan(id: string) {
  await save((await load()).filter((p) => p.id !== id));
  try {
    fileModule().cancelAlarm(id);
  } catch {
    // No alarm to cancel.
  }
}

/** "Send now": it goes at once, as a normal message. */
export async function sendPlanNow(id: string) {
  const p = (await load()).find((x) => x.id === id);
  if (!p) return;
  await dropPlan(id);
  await go(p);
}

/** Sends whatever's due (on start, coming back to PakChat, and from the alarm). */
export function sendDue() {
  sending ??= (async () => {
    if (core.state !== 'signedIn') return;
    const all = await load();
    const due = all.filter((p) => p.at <= Date.now() + 2_000);
    if (!due.length) return;
    await save(all.filter((p) => !due.includes(p)));
    for (const p of due) {
      try {
        fileModule().cancelAlarm(p.id);
      } catch {
        // Already rung.
      }
      await go(p).catch((err: unknown) => console.log(`[pakchat] scheduled send: ${String(err)}`));
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

/** The alarm rang (background.ts): connect for a moment and send. */
export async function onAlarm() {
  await core.init();
  if (core.state !== 'signedIn') return;
  await core.briefly(false, async () => {
    await sendDue();
  });
}

/** Signed out, or a chat was deleted: its scheduled messages go too. */
export async function forgetPlans(chatId?: string) {
  const all = await load();
  const gone = all.filter((p) => !chatId || p.chatId === chatId);
  if (!gone.length) return;
  for (const p of gone) {
    try {
      fileModule().cancelAlarm(p.id);
    } catch {
      // Nothing to cancel.
    }
  }
  await save(all.filter((p) => !gone.includes(p)));
}

async function go(p: Planned) {
  // A chat that's gone (or one I left) can't take it any more.
  const chat = await core.storage.getChat(p.chatId);
  if (!chat || chat.left) return;
  await core.client.sendText(p.chatId, p.text, { mentions: p.mentions, link: p.link, replyTo: p.replyTo });
}

function arm(p: Planned) {
  try {
    fileModule().scheduleAlarm(p.id, p.at);
  } catch (err) {
    console.log(`[pakchat] scheduled alarm: ${String(err)}`);
  }
}
