// The same rules as today's web app (web/src/messages.ts), now checked by
// every phone for itself, because the server can't read what's being changed.
// Times come from the server, so a phone with a wrong clock can't cheat.

import type { Change } from './content';
import type { Chat, Message } from './storage';

/** You can edit your own words for 15 minutes. */
export const EDIT_MINUTES = 15;
/** You can delete your own message for everyone for 60 hours. */
export const UNSEND_HOURS = 60;
/** A little extra, because a message can take a moment to reach the server. */
const GRACE_MS = 60_000;

export const roleOf = (chat: Chat, userId: string) => chat.members.find((m) => m.userId === userId)?.role ?? null;

/**
 * "Only admins can send": everyone else may still react and vote. The server
 * lets reactions through but can't see what they really are, so each phone
 * checks here too.
 */
export function maySend(chat: Chat, userId: string, t: string) {
  // A status: only its owner posts; the people watching can like it.
  if (chat.kind === 'status') return userId === statusOwner(chat) || t === 'react';
  if (chat.kind !== 'group' || !chat.onlyAdminsSend) return true;
  return roleOf(chat, userId) === 'admin' || t === 'react' || t === 'vote' || t === 'call' || t === 'opened';
}

/** Whose status this is (the status chat's only admin), or null for other chats. */
export function statusOwner(chat: Chat) {
  return chat.kind === 'status' ? (chat.members.find((m) => m.role === 'admin')?.userId ?? null) : null;
}

/** Does this change to `m`, from `from`, made at the server's time `at`, follow the rules? */
export function changeAllowed(chat: Chat, m: Message, change: Change, from: string, at: number) {
  if (m.kind === 'system') return false;
  switch (change.t) {
    case 'edit':
      return m.author === from && m.kind === 'text' && !m.deleted && at - m.sentAt <= EDIT_MINUTES * 60_000 + GRACE_MS;
    case 'delete':
      if (m.deleted) return false;
      // Group admins can delete anyone's message, as in WhatsApp.
      if (chat.kind === 'group' && roleOf(chat, from) === 'admin') return true;
      return m.author === from && at - m.sentAt <= UNSEND_HOURS * 3_600_000 + GRACE_MS;
    case 'react':
      return !m.deleted;
    case 'vote':
      // An event's answer: Going (0) or Not going (1).
      if (m.kind === 'event') return !m.deleted && !!m.plan?.general && change.options.length <= 1 && change.options.every((o) => o <= 1);
      return m.kind === 'poll' && !m.deleted && !!m.poll && change.options.every((o) => o < m.poll!.options.length) && (m.poll.multi || change.options.length <= 1);
    case 'pin':
      return !m.deleted;
    case 'opened':
      // Only a view once message, and only by someone who got it (or my own other device).
      return !m.deleted && !!m.file?.once && m.author !== from;
    case 'live':
      return !m.deleted && m.kind === 'location' && m.author === from && !!m.location?.live;
    default:
      return false;
  }
}
