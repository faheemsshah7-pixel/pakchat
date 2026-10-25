// plans.ts: scheduled calls (an "event" message: a call's name, when, voice or
// video). Each one I send or get is noted here, so the Calls tab can list the
// ones coming up, and the phone reminds me when it starts (an alert at that
// time; tap it for the chat, where Join starts or joins the call).
import type { Message } from '@pakchat/shared';
import * as Notifications from 'expo-notifications';

import { core } from './core';
import { PLAN_ALERT, alertChannel, words } from './push';

export type PlanNote = { chatId: string; author: string; id: string; title: string; at: number; video: boolean; link?: string };

const KEY = 'app:callPlans';
/** A call shows in "Upcoming" until this long after it started. */
export const PLAN_SHOWS_MS = 2 * 3_600_000;
let list: PlanNote[] | null = null;

async function load() {
  list ??= (await core.storage.getValue<PlanNote[]>(KEY)) ?? [];
  return list;
}

async function save(next: PlanNote[]) {
  list = next;
  await core.storage.setValue(KEY, next);
  core.emit('calls');
}

const alertId = (p: { chatId: string; id: string }) => `${PLAN_ALERT}${p.chatId}:${p.id}`;

/** An event message was sent or arrived (or was deleted): note it, and set its reminder. */
export async function notePlan(m: Message) {
  if (m.kind !== 'event' || !m.plan) return;
  const all = (await load()).filter((p) => !(p.chatId === m.chatId && p.id === m.id && p.author === m.author));
  const old = Date.now() - PLAN_SHOWS_MS;
  if (m.deleted) {
    await save(all);
    await Notifications.cancelScheduledNotificationAsync(alertId(m)).catch(() => {});
    return;
  }
  const note: PlanNote = { chatId: m.chatId, author: m.author, id: m.id, title: m.plan.title, at: m.plan.at, video: m.plan.video, ...(m.plan.link ? { link: m.plan.link } : {}) };
  await save([...all.filter((p) => p.at > old), note]);
  if (note.at > Date.now() + 5_000) {
    const t = words();
    await Notifications.scheduleNotificationAsync({
      identifier: alertId(note),
      content: { title: note.title, body: note.video ? t.videoCallStarting : t.voiceCallStarting, data: { chatId: note.chatId }, priority: Notifications.AndroidNotificationPriority.HIGH },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: note.at, channelId: alertChannel },
    }).catch(() => {});
  }
}

/** Scheduled calls from now on (and ones that started in the last two hours), soonest first. */
export async function upcomingPlans() {
  const old = Date.now() - PLAN_SHOWS_MS;
  return (await load()).filter((p) => p.at > old).sort((a, b) => a.at - b.at);
}

/** Signing out: forget them, and their reminders. */
export async function forgetPlansOfCalls() {
  for (const p of await load()) await Notifications.cancelScheduledNotificationAsync(alertId(p)).catch(() => {});
  list = [];
  await core.storage.setValue(KEY, []);
}
