// format.ts: turning times and messages into the short words a screen shows.
import type { Message } from '@pakchat/shared';

import { core } from '../core/core';
import { fill, type Strings } from '../i18n';

const DAY = 86_400_000;

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "2:41 pm" */
export function clock(ms: number) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_UR = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];

function date(ms: number, ur: boolean) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const month = (ur ? MONTHS_UR : MONTHS_EN)[d.getMonth()];
  return `${d.getDate()} ${month}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** For the chat list: the time today, "Yesterday", the day this week, or the date. */
export function listTime(ms: number, t: Strings) {
  const ur = t.today !== 'Today';
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return clock(ms);
  if (days === 1) return t.yesterday;
  if (days < 7) return (ur ? DAYS_UR : DAYS_EN)[new Date(ms).getDay()];
  return date(ms, ur);
}

/** For the little label between days in a chat: "Today", "Yesterday", "Monday", "3 Oct". */
export function dayLabel(ms: number, t: Strings) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return t.today;
  return listTime(ms, t);
}

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

/** "online", "last seen today at 2:41 pm", … */
export function lastSeen(p: { online: boolean; lastSeen: string | null } | null, t: Strings) {
  if (!p) return '';
  if (p.online) return t.online;
  if (!p.lastSeen) return '';
  const ms = Date.parse(p.lastSeen);
  if (!ms) return '';
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return fill(t.lastSeenToday, { time: clock(ms) });
  if (days === 1) return fill(t.lastSeenYesterday, { time: clock(ms) });
  return fill(t.lastSeenDate, { date: date(ms, t.today !== 'Today') });
}

/** A name, or "You". */
export function who(userId: string, t: Strings) {
  return userId === core.myId ? t.youWord : core.name(userId) || '…';
}

/** "Ali added Sara and Bilal" and the other group notes. */
export function systemText(m: Message, t: Strings) {
  const e = m.event;
  if (!e) return '';
  const by = who(e.by, t);
  const users = (e.users ?? []).map((u) => who(u, t)).join(t.and);
  switch (e.event) {
    case 'created':
      return fill(t.sysCreated, { name: by, title: String(e.title ?? '') });
    case 'added':
      return fill(t.sysAdded, { name: by, users });
    case 'joined':
      return fill(t.sysJoined, { users });
    case 'left':
      return fill(t.sysLeft, { name: users || by });
    case 'removed':
      return fill(t.sysRemoved, { name: by, users });
    case 'admin':
      return fill(t.sysAdmin, { users });
    case 'not_admin':
      return fill(t.sysNotAdmin, { users });
    case 'timer': {
      const s = Number(e.seconds ?? 0);
      return s ? fill(t.sysTimerOn, { name: by, time: timerLabel(s, t) }) : fill(t.sysTimerOff, { name: by });
    }
    default:
      return '';
  }
}

/** Disappearing message times. */
export const TIMERS = [0, 86_400, 7 * 86_400, 90 * 86_400];

export function timerLabel(seconds: number, t: Strings) {
  if (!seconds) return t.off;
  if (seconds <= 86_400) return t.hours24;
  if (seconds <= 7 * 86_400) return t.days7;
  return t.days90;
}

/** The one line under a chat's name in the list. */
export function preview(m: Message | null, t: Strings, group: boolean) {
  if (!m) return '';
  if (m.kind === 'system') return systemText(m, t);
  if (m.deleted) return m.author === core.myId ? t.youDeleted : t.deleted;
  const body = m.kind === 'poll' ? `${t.poll} ${m.poll?.question ?? ''}` : (m.text ?? '');
  if (group && m.author !== core.myId) return `${core.name(m.author) || '…'}: ${body}`;
  return body;
}
