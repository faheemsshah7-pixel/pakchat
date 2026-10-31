// format.ts: times, names and one-line previews, worded like WhatsApp Web
// (and like the phone app, app/src/ui/format.ts).

import type { Chat, Message } from '@pakchat/shared';

import { core } from '../core/core';
import { plainText } from './richText';
import { tr } from '../i18n';

const DAY = 86_400_000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => tr(d));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m) => tr(m));

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const daysAgo = (ms: number) => Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

/** "2:41 PM" */
export function clock(ms: number) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? tr('AM') : tr('PM')}`;
}

/** "29/10/2026" */
function shortDate(ms: number) {
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** The chat list: the time today, "Yesterday", the day this week, or the date. */
export function listTime(ms: number) {
  const days = daysAgo(ms);
  if (days <= 0) return clock(ms);
  if (days === 1) return tr('Yesterday');
  if (days < 7) return DAYS[new Date(ms).getDay()];
  return shortDate(ms);
}

/** The pill between days: "Today", "Yesterday", "Monday", "3 October 2025". */
export function dayLabel(ms: number) {
  const days = daysAgo(ms);
  if (days <= 0) return tr('Today');
  if (days === 1) return tr('Yesterday');
  if (days < 7) return DAYS[new Date(ms).getDay()];
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** "online", "last seen today at 2:41 PM" … */
export function lastSeen(p: { online: boolean; lastSeen: string | null } | undefined) {
  if (!p) return '';
  if (p.online) return tr('online');
  const ms = p.lastSeen ? Date.parse(p.lastSeen) : 0;
  if (!ms) return '';
  const days = daysAgo(ms);
  if (days <= 0) return tr('last seen today at {time}', { time: clock(ms) });
  if (days === 1) return tr('last seen yesterday at {time}', { time: clock(ms) });
  return tr('last seen {date} at {time}', { date: shortDate(ms), time: clock(ms) });
}

/** "2.4 MB" */
export function fileSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** "1:05" */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Chats ----

export function isSelfChat(chat: Chat) {
  return chat.kind === 'direct' && chat.members.length > 0 && chat.members.every((m) => m.userId === core.myId);
}

/** The other person in a one-to-one chat (me, messaging myself). */
export function otherPerson(chat: Chat): string | null {
  if (chat.kind !== 'direct') return null;
  return chat.members.find((m) => m.userId !== core.myId)?.userId ?? core.myId;
}

/** A group's title, or the other person's name ("Ali (You)" messaging myself). */
export function chatTitle(chat: Chat) {
  if (chat.kind !== 'direct') return chat.title ?? '';
  if (isSelfChat(chat)) return tr('{name} (You)', { name: core.nameOf(core.myId) });
  const other = otherPerson(chat)!;
  // Not in my contacts: "~ Their name", like the phone app and WhatsApp. Saved: just my name for them.
  if (!core.isContact(other) && core.people[other]?.name) return `~ ${core.people[other]!.name}`;
  return core.nameOf(other) || phoneOf(other) || '…';
}

/** The number or Gmail I know someone by (from the phone's contacts). */
export function phoneOf(userId: string) {
  const c = core.contacts[userId];
  return c?.phone ?? core.ways[userId]?.phone ?? c?.email ?? core.ways[userId]?.email ?? '';
}

/** A name in a group: mine as saved, else "~ Their name", like WhatsApp. */
export function memberName(userId: string) {
  if (userId === core.myId) return tr('You');
  return core.nameOf(userId) || phoneOf(userId) || '…';
}

/** In a group, someone not in my contacts shows as "~ Name", like WhatsApp. */
export function groupName(userId: string) {
  const name = memberName(userId);
  return userId === core.myId || core.isContact(userId) || !core.nameOf(userId) ? name : `~ ${name}`;
}

// ---- Messages in one line ----

const timerWords = (s: number) => tr(s <= 86_400 ? '24 hours' : s <= 7 * 86_400 ? '7 days' : '90 days');

/** "Ali added Sara", and the other notes in a chat. */
export function systemText(m: Message) {
  const e = m.event;
  if (!e) return '';
  const who = (id: string) => (id === core.myId ? tr('You') : core.nameOf(id) || phoneOf(id) || '…');
  const by = who(e.by);
  const users = (e.users ?? []).map(who).join(', ');
  const title = String(e.title ?? '');
  switch (e.event) {
    case 'created':
      return tr('{by} created group "{title}"', { by, title });
    case 'added':
      return tr('{by} added {users}', { by, users });
    case 'joined':
      return tr("{users} joined using this group's invite link", { users });
    case 'left':
      return tr('{users} left', { users: users || by });
    case 'removed':
      return tr('{by} removed {users}', { by, users });
    case 'admin':
      return tr('{users} is now an admin', { users });
    case 'not_admin':
      return tr('{users} is no longer an admin', { users });
    case 'community':
      return tr('{by} added this group to the community "{title}"', { by, title });
    case 'community_left':
      return tr('This group is no longer in the community "{title}"', { title });
    case 'deactivated':
      return tr('The community "{title}" was deactivated', { title });
    case 'timer': {
      const s = Number(e.seconds ?? 0);
      return s
        ? tr("{by} turned on disappearing messages. New messages will disappear from this chat {after} after they're sent.", { by, after: timerWords(s) })
        : tr('{by} turned off disappearing messages.', { by });
    }
    case 'call': {
      const video = e.video === true;
      if (e.missed === true) return tr(e.group === true ? 'Missed group call' : video ? 'Missed video call' : 'Missed voice call');
      const seconds = Number(e.seconds ?? 0);
      const kind = tr(e.group === true ? 'Group call' : video ? 'Video call' : 'Voice call');
      return seconds ? `${kind} · ${duration(seconds * 1000)}` : kind;
    }
    default:
      return '';
  }
}

/** What a file is, in words: "Photo", "Video", "Voice message", "notes.pdf". */
export function fileWord(m: Message) {
  const f = m.file!;
  if (f.once) return tr(f.kind === 'video' ? 'Video' : f.kind === 'image' ? 'Photo' : 'Voice message');
  if (f.kind === 'sticker') return tr('Sticker');
  if (f.gif) return 'GIF';
  if (f.kind === 'image') return tr('Photo');
  if (f.kind === 'video') return tr(f.round ? 'Video message' : 'Video');
  if (f.kind === 'voice') return tr('Voice message');
  if (f.kind === 'audio') return f.name ?? tr('Audio');
  return f.name ?? tr('Document');
}

/** A message in one line: its words, or "Photo", "📍 Location", "📊 Lunch?" … */
export function bodyLine(m: Message) {
  if (m.kind === 'poll') return `📊 ${m.poll?.question ?? ''}`;
  if (m.kind === 'file' && m.file) {
    if (m.file.once) return fileWord(m);
    return m.text ? plainText(m.text) : fileWord(m);
  }
  if (m.kind === 'location') return m.location?.live ? tr('Live location') : `📍 ${m.location?.name ?? tr('Location')}`;
  if (m.kind === 'contact') return `👤 ${m.contacts?.map((c) => c.name).join(', ') ?? tr('Contact')}`;
  if (m.kind === 'event') return `📅 ${m.plan?.title ?? tr('Event')}`;
  return plainText(m.text ?? '');
}

/** The line under a chat's name. */
export function preview(m: Message | null, group: boolean) {
  if (!m) return '';
  if (m.kind === 'system') return systemText(m);
  if (m.deleted) return tr(m.author === core.myId ? 'You deleted this message' : 'This message was deleted');
  const body = bodyLine(m);
  if (group && m.author !== core.myId) return `${memberName(m.author)}: ${body}`;
  return body;
}

// ---- Letters and colours ----

const URDU = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** "Ayesha Khan" → "A", "FAST CS-B" → "FC" (the phone's rule, app/src/ui/letters.ts). */
export function initials(name: string) {
  const words = name.replace(/^~\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1 || URDU.test(name)) return [...words[0]][0].toUpperCase();
  const two = words[0] === words[0].toUpperCase() && words[1] === words[1].toUpperCase();
  return two ? ([...words[0]][0] + [...words[1]][0]).toUpperCase() : [...words[0]][0].toUpperCase();
}
