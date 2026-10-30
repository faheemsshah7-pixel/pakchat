// chatActions.ts: what a chat's menu does (the chat list's chevron and
// right-click, the chat's ⋮, Contact info). Same items and words as WhatsApp Web.

import type { Chat } from '@pakchat/shared';

import { core, openChat } from '../core/core';
import type { ChatPrefs } from '../core/core';
import { bodyLine, chatTitle, isSelfChat, memberName, otherPerson } from '../ui/format';
import { askText, choose, confirm, type MenuItem, toast } from '../ui/overlay';
import { setView } from '../ui/view';
import { askSecretCode } from './LockScreen';
import { tr } from '../i18n';

const HOUR = 3_600_000;
export const MAX_PINNED = 3;

export const isMuted = (p: ChatPrefs | undefined) => !!p?.muted && (!p.mutedUntil || p.mutedUntil > Date.now());

export async function archive(chat: Chat, on: boolean) {
  const pinnedAt = core.prefs[chat.id]?.pinnedAt;
  await core.setPrefs(chat.id, { archived: on, pinnedAt: on ? undefined : pinnedAt });
  if (on && core.viewing === chat.id) openChat(null);
  // Undo puts it back as it was, pinned too.
  toast(on ? tr('Chat archived') : tr('Chat unarchived'), { label: tr('Undo'), run: () => void core.setPrefs(chat.id, { archived: !on, pinnedAt }) });
}

export async function mute(chat: Chat) {
  if (isMuted(core.prefs[chat.id])) {
    await core.setPrefs(chat.id, { muted: false, mutedUntil: undefined });
    return;
  }
  const until = await askMute();
  if (until !== null) await core.setPrefs(chat.id, { muted: true, mutedUntil: until });
}

/** "Mute notifications": how long. Null if cancelled; undefined for "Always". */
async function askMute(): Promise<number | undefined | null> {
  const pick = await choose(
    tr('Mute notifications'),
    [
      { value: '8h', label: tr('8 hours') },
      { value: '1w', label: tr('1 week') },
      { value: 'always', label: tr('Always') },
    ],
    '8h',
    'Mute',
  );
  if (!pick) return null;
  return pick === '8h' ? Date.now() + 8 * HOUR : pick === '1w' ? Date.now() + 168 * HOUR : undefined;
}

export async function pin(chat: Chat) {
  if (core.prefs[chat.id]?.pinnedAt) return core.setPrefs(chat.id, { pinnedAt: undefined });
  const pinned = Object.values(core.prefs).filter((p) => p.pinnedAt && !p.archived).length;
  if (pinned >= MAX_PINNED) return toast(`You can only pin up to ${MAX_PINNED} chats`);
  await core.setPrefs(chat.id, { pinnedAt: Date.now() });
}

export async function markRead(chat: Chat, read: boolean) {
  if (read) {
    await core.setPrefs(chat.id, { markedUnread: false });
    await core.client.markRead(chat.id);
  } else await core.setPrefs(chat.id, { markedUnread: true });
}

export function favourite(chat: Chat) {
  return core.setPrefs(chat.id, { favourite: !core.prefs[chat.id]?.favourite });
}

// ---- "Select chats": the same actions on several chats at once ----

const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

export async function archiveMany(chats: Chat[], on: boolean) {
  const before = chats.map((c) => [c.id, core.prefs[c.id]?.pinnedAt] as const);
  for (const c of chats) await core.setPrefs(c.id, { archived: on, pinnedAt: on ? undefined : core.prefs[c.id]?.pinnedAt });
  if (on && chats.some((c) => c.id === core.viewing)) openChat(null);
  toast(`${plural(chats.length, 'chat')} ${on ? 'archived' : 'unarchived'}`, {
    label: tr('Undo'),
    run: () => void Promise.all(before.map(([id, pinnedAt]) => core.setPrefs(id, { archived: !on, pinnedAt }))),
  });
}

/** Mutes them all, or unmutes them all when every one is already muted (like WhatsApp). */
export async function muteMany(chats: Chat[]) {
  if (chats.every((c) => isMuted(core.prefs[c.id]))) {
    for (const c of chats) await core.setPrefs(c.id, { muted: false, mutedUntil: undefined });
    return;
  }
  const until = await askMute();
  if (until === null) return;
  for (const c of chats) await core.setPrefs(c.id, { muted: true, mutedUntil: until });
}

export async function pinMany(chats: Chat[]) {
  if (chats.every((c) => core.prefs[c.id]?.pinnedAt)) {
    for (const c of chats) await core.setPrefs(c.id, { pinnedAt: undefined });
    return;
  }
  const add = chats.filter((c) => !core.prefs[c.id]?.pinnedAt);
  const pinned = Object.values(core.prefs).filter((p) => p.pinnedAt && !p.archived).length;
  if (pinned + add.length > MAX_PINNED) return toast(`You can only pin up to ${MAX_PINNED} chats`);
  for (const c of add) await core.setPrefs(c.id, { pinnedAt: Date.now() });
}

export async function markManyRead(chats: Chat[], read: boolean) {
  for (const c of chats) await markRead(c, read);
}

export async function favouriteMany(chats: Chat[]) {
  const on = !chats.every((c) => core.prefs[c.id]?.favourite);
  for (const c of chats) await core.setPrefs(c.id, { favourite: on });
}

/** Deletes the chats from this computer. Groups I'm still in have to be exited first, as on WhatsApp. */
export async function deleteMany(chats: Chat[]): Promise<boolean> {
  const inGroups = chats.filter((c) => c.kind === 'group' && !c.left);
  const ok = chats.filter((c) => !inGroups.includes(c));
  if (!ok.length) {
    toast(inGroups.length === 1 ? tr('Exit the group first to delete it') : tr('Exit the groups first to delete them'));
    return false;
  }
  const extra = inGroups.length ? ` ${plural(inGroups.length, 'group')} you're still in won't be deleted.` : '';
  if (!(await confirm(`Delete ${plural(ok.length, 'chat')}?`, `Messages will only be removed from this computer.${extra}`, 'Delete chats', true))) return false;
  for (const c of ok) {
    await clearHere(c);
    await core.setPrefs(c.id, { deletedAt: Date.now(), pinnedAt: undefined, archived: undefined });
  }
  if (ok.some((c) => c.id === core.viewing)) openChat(null);
  toast(`${plural(ok.length, 'chat')} deleted`);
  return true;
}

/** Takes every message in the chat off this computer. */
async function clearHere(chat: Chat) {
  const all = await core.storage.listMessages(chat.id, { limit: 1_000_000 });
  await core.client.deleteHere(
    chat.id,
    all.map((m) => ({ author: m.author, id: m.id })),
  );
  core.emit(`messages:${chat.id}`);
  core.emit('chats');
}

export async function clearChat(chat: Chat) {
  if (!(await confirm(`Clear this chat?`, 'This chat will be empty but will remain in your chat list. Messages are only cleared on this computer.', 'Clear chat', true))) return;
  await clearHere(chat);
}

export async function deleteChat(chat: Chat) {
  if (chat.kind === 'group' && !chat.left) {
    if (!(await confirm(`Exit "${chat.title ?? ''}"?`, 'Only group admins will be notified that you left the group.', 'Exit group', true))) return;
    await core.client.removeMember(chat.id, core.myId);
    return;
  }
  if (!(await confirm(`Delete this chat?`, 'Messages will only be removed from this computer.', 'Delete chat', true))) return;
  await clearHere(chat);
  await core.setPrefs(chat.id, { deletedAt: Date.now(), pinnedAt: undefined, archived: undefined });
  if (core.viewing === chat.id) openChat(null);
}

export async function block(chat: Chat) {
  const other = otherPerson(chat);
  if (!other) return;
  if (!core.blocked) await core.loadBlocked().catch(() => {});
  const blocked = core.blocked?.has(other) ?? false;
  if (!blocked && !(await confirm(`Block ${chatTitle(chat)}?`, "Blocked contacts can't call you or send you messages. They won't be told.", 'Block', true))) return;
  try {
    await core.block(other, !blocked);
    toast(blocked ? `${chatTitle(chat)} unblocked` : `${chatTitle(chat)} blocked`);
  } catch {
    toast(tr('Couldn\'t do that. Check your internet connection.'));
  }
}

function listItems(chat: Chat): MenuItem[] {
  const items: MenuItem[] = core.lists.map((l) => ({
    label: `${l.chatIds.includes(chat.id) ? '✓ ' : ''}${l.name}`,
    run: () => void core.setLists(core.lists.map((x) => (x.id === l.id ? { ...x, chatIds: x.chatIds.includes(chat.id) ? x.chatIds.filter((c) => c !== chat.id) : [...x.chatIds, chat.id] } : x))),
  }));
  items.push({
    label: tr('New list'),
    icon: 'plus',
    run: () =>
      void askText('New list', 'Name, like Family or Work').then((name) => {
        if (name) void core.setLists([...core.lists, { id: crypto.randomUUID(), name, chatIds: [chat.id] }]);
      }),
  });
  return items;
}

export const TIMERS = [
  { value: '0', label: tr('Off') },
  { value: String(86_400), label: tr('24 hours') },
  { value: String(7 * 86_400), label: tr('7 days') },
  { value: String(90 * 86_400), label: tr('90 days') },
];

/** Disappearing messages: off, 24 hours, 7 days or 90 days, for everyone in the chat. */
export async function disappearing(chat: Chat) {
  const pick = await choose(tr('Disappearing messages'), TIMERS, String(chat.timer ?? 0));
  if (pick != null && Number(pick) !== (chat.timer ?? 0)) await core.client.setTimer(chat.id, Number(pick)).catch(() => toast(tr('Couldn\'t change it. Try again.')));
}

/**
 * Export chat, like WhatsApp's: the chat's words as a .txt file ("25/10/2026, 10:15 - Ali: hello"),
 * downloaded to this computer. Nothing goes to our server.
 */
export async function exportChat(chat: Chat) {
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = (ms: number) => {
    const d = new Date(ms);
    return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
  };
  const now = Date.now();
  const all = (await core.storage.listMessages(chat.id, { limit: 100_000 })).filter((m) => m.kind !== 'system' && !(m.expiresAt && m.expiresAt <= now));
  const lines = all.map((m) => `${stamp(m.sentAt)} - ${m.author === core.myId ? (core.client.me?.me.name ?? 'You') : memberName(m.author)}: ${m.deleted ? 'This message was deleted' : m.file && !m.text ? `<${bodyLine(m)} omitted>` : bodyLine(m)}`);
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `PakChat Chat with ${chatTitle(chat) || 'PakChat'}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Lock chat, the phone's way (it moves to Locked chats, on the phone too), or
 * Unlock chat. Both need the secret code set on the phone.
 */
export async function lockChat(chat: Chat, on: boolean) {
  if (!core.lockCode) {
    toast(tr('To lock chats, first set a secret code on your phone: Settings › Privacy › Chat lock › Secret code'));
    return;
  }
  if (on) {
    if (!(await confirm(tr('Lock this chat?'), 'It moves to Locked chats, here and on your phone, and opens with your secret code. Its notifications say only "New message".', 'Lock chat'))) return;
    await core.setPrefs(chat.id, { lock: 'folder', archived: false });
    if (core.viewing === chat.id) openChat(null);
    toast(tr('Chat locked'));
  } else {
    if (!(await askSecretCode(tr('Unlock chat')))) return;
    await core.setPrefs(chat.id, { lock: undefined });
    toast(tr('Chat unlocked'));
  }
}

/** The chat menu, in WhatsApp Web's order. */
export function chatMenu(chat: Chat, opts: { open?: boolean } = {}): MenuItem[] {
  const p = core.prefs[chat.id] ?? {};
  const unread = chat.unread > 0 || !!p.markedUnread;
  const direct = chat.kind === 'direct' && !isSelfChat(chat);
  const other = otherPerson(chat);
  const blocked = !!other && !!core.blocked?.has(other);
  const items: MenuItem[] = [
    { label: p.archived ? tr('Unarchive chat') : tr('Archive chat'), icon: 'archive', run: () => void archive(chat, !p.archived) },
    isMuted(p) ? { label: tr('Unmute notifications'), icon: 'bell', run: () => void mute(chat) } : { label: tr('Mute notifications'), icon: 'muted', run: () => void mute(chat) },
    { label: p.pinnedAt ? tr('Unpin chat') : tr('Pin chat'), icon: 'pin', run: () => void pin(chat) },
    { label: unread ? tr('Mark as read') : tr('Mark as unread'), icon: 'unread', run: () => void markRead(chat, unread) },
    { label: p.favourite ? tr('Remove from Favourites') : tr('Add to Favourites'), icon: 'heart', run: () => void favourite(chat) },
  ];
  if (opts.open) items.push({ label: tr('Close chat'), icon: 'close', run: () => (openChat(null), setView({ drawer: null })) });
  items.push({ label: core.lists.some((l) => l.chatIds.includes(chat.id)) ? tr('Change list') : tr('Add to list'), icon: 'lists', sub: listItems(chat) });
  if (chat.kind !== 'status' && !isSelfChat(chat)) items.push({ label: p.lock ? tr('Unlock chat') : tr('Lock chat'), icon: 'lock', run: () => void lockChat(chat, !p.lock) });
  items.push('-');
  if (direct) items.push({ label: blocked ? tr('Unblock') : tr('Block'), icon: 'block', run: () => void block(chat) });
  items.push({ label: tr('Clear chat'), icon: 'close', run: () => void clearChat(chat) });
  items.push(chat.kind === 'group' && !chat.left ? { label: tr('Exit group'), icon: 'leave', red: true, run: () => void deleteChat(chat) } : { label: tr('Delete chat'), icon: 'trash', red: true, run: () => void deleteChat(chat) });
  return items;
}
