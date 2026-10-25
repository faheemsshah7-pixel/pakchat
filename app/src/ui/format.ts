// format.ts: turning times and messages into the short words a screen shows.
import type { Message } from '@pakchat/shared';

import { core, reasonOf } from '../core/core';
import { plainText } from '../core/richText';
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

/** "This month", or a month's name ("October", "March 2025" for another year), for Media, links and docs. */
export function monthLabel(ms: number, t: Strings) {
  const ur = t.today !== 'Today';
  const d = new Date(ms);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return t.thisMonth;
  const month = (ur ? MONTHS_UR : MONTHS_LONG_EN)[d.getMonth()];
  return d.getFullYear() === now.getFullYear() ? month : `${month} ${d.getFullYear()}`;
}

const MONTHS_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
    case 'community':
      return fill(t.sysCommunity, { name: by, title: String(e.title ?? '') });
    case 'community_left':
      return fill(t.sysCommunityLeft, { title: String(e.title ?? '') });
    case 'deactivated':
      return fill(t.sysDeactivated, { title: String(e.title ?? '') });
    case 'timer': {
      const s = Number(e.seconds ?? 0);
      return s ? fill(t.sysTimerOn, { name: by, time: timerLabel(s, t) }) : fill(t.sysTimerOff, { name: by });
    }
    case 'call': {
      // A call, noted in the chat by this phone (core/calls.ts).
      const video = e.video === true;
      if (e.missed === true) return e.group === true ? t.missedGroupCall : video ? t.missedVideoCall : t.missedVoiceCall;
      const seconds = Number(e.seconds ?? 0);
      if (!seconds) return video ? t.videoCall : t.voiceCall;
      const time = duration(seconds * 1000);
      return fill(e.group === true ? t.groupCallDone : video ? t.videoCallDone : t.voiceCallDone, { time });
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

/** "📷 Photo", "🎥 Video: caption", "📄 notes.pdf", "GIF", "Sticker" */
export function fileLine(m: Message, t: Strings) {
  const f = m.file!;
  // A view once caption is part of what's hidden.
  if (f.once) return `① ${f.kind === 'image' ? t.photoLabel : f.kind === 'video' ? t.videoLabel : t.voiceNote}`;
  const what = f.round
    ? `⭕ ${t.roundVideo}`
    : f.kind === 'sticker'
      ? t.stickerMsg
      : f.gif
        ? t.gifMsg
        : f.kind === 'image'
          ? t.photo
          : f.kind === 'video'
            ? t.videoMsg
            : f.kind === 'voice'
              ? t.voice
              : f.kind === 'audio'
                ? `🎵 ${f.name ?? t.audioWord}`
                : `📄 ${f.name ?? t.document}`;
  return m.text ? `${what}: ${plainText(m.text)}` : what;
}

/** What a message is, in one line: its words, or "📍 Location", "👤 Ali", "📅 Call: Team"… */
export function bodyLine(m: Message, t: Strings) {
  if (m.kind === 'poll') return `${t.poll} ${m.poll?.question ?? ''}`;
  if (m.kind === 'file' && m.file) return fileLine(m, t);
  if (m.kind === 'location') return `📍 ${m.location?.live ? t.liveLocation : (m.location?.name ?? t.location)}`;
  if (m.kind === 'contact') return `👤 ${m.contacts?.map((c) => c.name).join(', ') ?? t.contactWord}`;
  if (m.kind === 'event') return `📅 ${m.plan?.general ? t.eventTile : t.eventWord}: ${m.plan?.title ?? ''}`;
  // Without the *bold* and _italic_ marks, like WhatsApp's list and alerts.
  return plainText(m.text ?? '');
}

/** The one line under a chat's name in the list. */
export function preview(m: Message | null, t: Strings, group: boolean) {
  if (!m) return '';
  if (m.kind === 'system') return systemText(m, t);
  if (m.deleted) return m.author === core.myId ? t.youDeleted : t.deleted;
  const body = bodyLine(m, t);
  if (group && m.author !== core.myId) return `${core.name(m.author) || '…'}: ${body}`;
  return body;
}

/** Words for the server's reasons to refuse a phone number or a code. */
export function phoneError(t: Strings, err: unknown) {
  const reason = reasonOf(err);
  const words: Record<string, string> = {
    offline: t.serverError,
    bad_phone: t.badPhone,
    wrong_code: t.wrongCode,
    too_many_tries: t.tooManyTries,
    wait: t.waitForCode,
    too_many_codes: t.tooManyCodes,
    sms_cap: t.smsCap,
    rate_limited: t.slowDown,
    taken: t.taken,
  };
  return words[reason] ?? t.couldNot;
}

/** "2.4 MB", "830 KB" */
export function fileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "1:05" for a video's length in ms. */
export function duration(ms: number) {
  // Never below 0:00 (a call's clock can start a moment before the screen's does).
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A time ahead: "today at 9:00 pm", "tomorrow at 9:00 am", "Monday at 2:30 pm", "3 Nov at 8:00 am". */
export function whenLabel(ms: number, t: Strings) {
  const ur = t.today !== 'Today';
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY);
  const day = days <= 0 ? t.today : days === 1 ? t.tomorrow : days < 7 ? (ur ? DAYS_UR : DAYS_EN)[new Date(ms).getDay()] : date(ms, ur);
  return fill(t.dayAtTime, { day, time: clock(ms) });
}

/** A day chip in the time picker: "Today", "Tomorrow", "Mon 3". */
export function dayChip(ms: number, t: Strings) {
  const ur = t.today !== 'Today';
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY);
  if (days <= 0) return t.today;
  if (days === 1) return t.tomorrow;
  const d = new Date(ms);
  return `${(ur ? DAYS_UR : DAYS_EN)[d.getDay()].slice(0, ur ? undefined : 3)} ${d.getDate()}`;
}
