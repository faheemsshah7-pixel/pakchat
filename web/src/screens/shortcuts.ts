// shortcuts.ts: WhatsApp Web's keyboard shortcuts. On a Mac they use
// Cmd+Ctrl, elsewhere Ctrl+Alt (so they never clash with the browser's own).

import { useEffect } from 'react';

import { core, openChat } from '../core/core';
import { chatRowsNow } from '../core/hooks';
import { confirm } from '../ui/overlay';
import { getView, setView } from '../ui/view';
import { archive, markRead, mute, pin } from './chatActions';
import { EDIT_MS } from './messageActions';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? 'Cmd+Ctrl' : 'Ctrl+Alt';

/** For Settings › Keyboard shortcuts. */
export const SHORTCUTS: [string, string][] = [
  ['New chat', `${MOD}+N`],
  ['New group', `${MOD}+Shift+N`],
  ['Search', `${MOD}+/`],
  ['Search in chat', MAC ? 'Cmd+Shift+F' : 'Ctrl+Shift+F'],
  ['Next chat', `${MOD}+Shift+]`],
  ['Previous chat', `${MOD}+Shift+[`],
  ['Close chat', 'Escape'],
  ['Chat info', MAC ? 'Option+I' : 'Alt+I'],
  ['Settings', `${MOD}+,`],
  ['Mark as unread', `${MOD}+Shift+U`],
  ['Mute', `${MOD}+Shift+M`],
  ['Archive chat', `${MOD}+Shift+E`],
  ['Pin chat', `${MOD}+Shift+P`],
  ['Edit last message', MAC ? 'Cmd+↑' : 'Ctrl+↑'],
  ['Record voice message', `${MOD}+Shift+R`],
  ['Pause or continue recording', MAC ? 'Option+P' : 'Alt+P'],
  ['Send voice message', MAC ? 'Cmd+Enter' : 'Ctrl+Enter'],
  ['Dark theme on or off', `${MOD}+T`],
];

export async function logOut() {
  if (await confirm('Log out?', "Your chats on this computer will be removed. They stay on your phone, and you can link this computer again any time.", 'Log out', true)) await core.signOut();
}

async function step(by: number) {
  const rows = (await chatRowsNow()).filter((r) => !r.prefs.archived);
  if (!rows.length) return;
  const i = rows.findIndex((r) => r.chat.id === core.viewing);
  openChat(rows[(i + by + rows.length) % rows.length].chat.id);
}

async function editLast() {
  if (!core.viewing) return;
  const recent = await core.storage.listMessages(core.viewing, { limit: 30 });
  const m = recent.reverse().find((x) => x.author === core.myId && x.kind === 'text' && !x.deleted && x.seq != null);
  if (m && Date.now() - m.sentAt < EDIT_MS) setView({ editing: m, replyTo: null });
}

export function useShortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = MAC ? e.metaKey && e.ctrlKey : e.ctrlKey && e.altKey;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const chatId = core.viewing;
      const chat = async () => (chatId ? core.storage.getChat(chatId) : null);
      let handled = true;
      if (mod && !e.shiftKey && k === 'n') setView({ tab: 'chats', side: 'newChat' });
      else if (mod && e.shiftKey && k === 'n') setView({ tab: 'chats', side: 'newGroup' });
      else if (mod && k === '/') {
        setView({ tab: 'chats', side: null });
        dispatchEvent(new Event('pakchat:search'));
      }
      else if (mod && e.shiftKey && (k === ']' || k === '}' || k === 'Tab')) void step(1);
      else if (mod && e.shiftKey && (k === '[' || k === '{')) void step(-1);
      else if (mod && k === ',') setView({ tab: 'settings' });
      else if (mod && e.shiftKey && k === 'r' && chatId) dispatchEvent(new Event('pakchat:record'));
      else if (mod && k === 't') void core.setSettings({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' });
      else if (mod && e.shiftKey && k === 'u') void chat().then((c) => c && markRead(c, c.unread > 0 || !!core.prefs[c.id]?.markedUnread));
      else if (mod && e.shiftKey && k === 'm') void chat().then((c) => c && mute(c));
      else if (mod && e.shiftKey && k === 'e') void chat().then((c) => c && archive(c, !core.prefs[c.id]?.archived));
      else if (mod && e.shiftKey && k === 'p') void chat().then((c) => c && pin(c));
      else if ((MAC ? e.metaKey : e.ctrlKey) && e.shiftKey && !e.altKey && k === 'f' && chatId) setView({ drawer: 'search' });
      else if (e.altKey && !e.ctrlKey && !e.metaKey && (k === 'i' || e.code === 'KeyI') && chatId) setView({ drawer: getView().drawer === 'info' ? null : 'info' });
      else if (k === 'Escape' && !document.querySelector('.layer, .viewer, .stview, .sendpv, .cpill.rec, .camera')) {
        const v = getView();
        if (v.chatPicks) setView({ chatPicks: null });
        else if (v.selecting) setView({ selecting: null });
        else if (v.replyTo || v.editing || v.privateReply) setView({ replyTo: null, editing: null, privateReply: null });
        else if (v.drawer) setView({ drawer: null });
        else if (v.side) setView({ side: null });
        else if (chatId) openChat(null);
        else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    };
    const edit = () => void editLast();
    const out = () => void logOut();
    addEventListener('keydown', key);
    addEventListener('pakchat:edit-last', edit);
    addEventListener('pakchat:logout', out);
    return () => {
      removeEventListener('keydown', key);
      removeEventListener('pakchat:edit-last', edit);
      removeEventListener('pakchat:logout', out);
    };
  }, []);
}
