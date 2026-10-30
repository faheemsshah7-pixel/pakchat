// messageActions.ts: a message's menu (the chevron on a bubble, or
// right-click) and the reaction bar, in WhatsApp Web's order.

import type { Message } from '@pakchat/shared';

import { core, openChat } from '../core/core';
import { chatTitle, memberName } from '../ui/format';
import { plainText } from '../ui/richText';
import { type MenuItem, toast } from '../ui/overlay';
import { msgKey, setView } from '../ui/view';
import { deleteMessages, forward } from './dialogs';
import { tr } from '../i18n';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
/** Own text messages can be edited for 15 minutes, like WhatsApp. */
export const EDIT_MS = 15 * 60_000;

const ref = (m: Message) => ({ author: m.author, id: m.id });

export function react(m: Message, emoji: string) {
  const mine = m.reactions?.[core.myId];
  void core.client.react(m.chatId, ref(m), mine === emoji ? null : emoji).catch(() => toast(tr('Couldn\'t react. Try again.')));
}

/** Downloads a file to the computer, under its own name. */
export async function download(m: Message) {
  const f = m.file;
  if (!f) return;
  try {
    const url = await core.fileUrl(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name ?? `PakChat ${new Date(m.sentAt).toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${(f.mime.split('/')[1] ?? 'bin').split(';')[0]}`;
    a.click();
  } catch {
    toast(tr('Couldn\'t download. It may have expired on the server.'));
  }
}

export function messageMenu(m: Message, opts: { group: boolean; canSend: boolean }): MenuItem[] {
  const mine = m.author === core.myId;
  const items: MenuItem[] = [];
  if (m.deleted) return [{ label: tr('Select'), icon: 'select', run: () => setView({ selecting: [m] }) }, { label: tr('Delete'), icon: 'trash', red: true, run: () => void deleteMessages([m]) }];
  if (mine && m.seq != null) items.push({ label: tr('Message info'), icon: 'info', run: () => setView({ drawer: 'msginfo', info: m }) });
  if (opts.canSend) items.push({ label: tr('Reply'), icon: 'reply', keys: 'Alt+R', run: () => setView({ replyTo: m, editing: null }) });
  if (opts.group && !mine) {
    const direct = () => core.client.openDirect(m.author);
    items.push({
      label: tr('Reply privately'),
      icon: 'reply',
      run: () =>
        void Promise.all([direct(), core.storage.getChat(m.chatId)]).then(([c, g]) => {
          openChat(c.id);
          setView({ privateReply: { to: c.id, m, group: g ? chatTitle(g) : 'Group' } });
        }),
    });
    items.push({ label: `Message ${memberName(m.author)}`, icon: 'chat', run: () => void direct().then((c) => openChat(c.id)) });
  }
  if (m.text) items.push({ label: tr('Copy'), icon: 'copy', run: () => void navigator.clipboard.writeText(plainText(m.text!)).then(() => toast(tr('Message copied'))) });
  items.push({ label: tr('React'), icon: 'smile', run: () => dispatchEvent(new CustomEvent('pakchat:react', { detail: msgKey(m) })) });
  if (m.file && !m.file.once && m.file.id !== 'pending') items.push({ label: tr('Download'), icon: 'download', run: () => void download(m) });
  if (!m.file?.once && m.kind !== 'poll') items.push({ label: tr('Forward'), icon: 'forward', run: () => void forward([m]) });
  if (opts.canSend) {
    const pinned = !!m.pinnedUntil && m.pinnedUntil > Date.now();
    items.push({
      label: pinned ? tr('Unpin') : tr('Pin'),
      icon: 'pin',
      run: () => void core.client.pin(m.chatId, ref(m), pinned ? null : Date.now() + 7 * 86_400_000).catch(() => toast(tr('Couldn\'t pin. Try again.'))),
    });
  }
  // Keep in chat: a disappearing message stays (Unkeep: whoever kept it, or its author).
  if (!m.file?.once && (m.expiresAt || (m.keptBy && (m.keptBy === core.myId || mine))))
    items.push({
      label: m.keptBy ? tr('Unkeep') : tr('Keep'),
      icon: 'timer',
      run: () => void core.client.keep(m.chatId, ref(m), !m.keptBy).catch(() => toast(tr('Couldn\'t do that. Try again.'))),
    });
  const starred = !!core.starred[msgKey(m)];
  items.push({ label: starred ? tr('Unstar') : tr('Star'), icon: 'star', keys: 'Alt+8', run: () => void core.toggleStar(m) });
  if (mine && m.kind === 'text' && m.seq != null && Date.now() - m.sentAt < EDIT_MS) items.push({ label: tr('Edit'), icon: 'edit', run: () => setView({ editing: m, replyTo: null }) });
  items.push({ label: tr('Select'), icon: 'select', run: () => setView({ selecting: [m] }) });
  items.push('-');
  if (!mine) items.push({ label: tr('Report'), icon: 'flag', run: () => void report(m) });
  items.push({ label: tr('Delete'), icon: 'trash', red: true, run: () => void deleteMessages([m]) });
  return items;
}

async function report(m: Message) {
  try {
    // Like WhatsApp: only this message goes with the report, as I see it.
    const text = m.text ? plainText(m.text) : m.file ? `[${m.file.kind}]` : `[${m.kind}]`;
    await core.api('POST', '/reports', { user_id: m.author, chat_id: m.chatId, reason: 'other', messages: [{ author: m.author, text: text.slice(0, 2000), at: m.sentAt }] });
    toast(tr('Reported. Thank you.'));
  } catch {
    toast(tr('Couldn\'t report. Check your internet connection.'));
  }
}
