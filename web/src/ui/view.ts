// view.ts: what's on screen, shared by the panels: the rail's tab, the
// right-hand drawer, a reply or edit waiting in the composer, and a message
// to jump to.

import { useSyncExternalStore } from 'react';

import type { Message } from '../core/core';

export type Tab = 'chats' | 'status' | 'communities' | 'settings' | 'profile';
export type Drawer = null | 'info' | 'verify' | 'search' | 'starred' | 'msginfo' | 'media';

export type View = {
  tab: Tab;
  drawer: Drawer;
  /** The chat list's own pages: archived chats, or starting a new chat. */
  side: null | 'archived' | 'newChat' | 'newGroup' | 'starred';
  /** Replying to, or editing, one message (cleared when the chat changes). */
  replyTo: Message | null;
  editing: Message | null;
  /** Scroll to this message and flash it ("chatId/author/id"). */
  jumpTo: string | null;
  /** Files dropped on a chat row or pasted, waiting in the send preview. */
  files: File[] | null;
  /** "Message info": the message whose ticks the drawer shows. */
  info: Message | null;
  /** Selecting messages (WhatsApp's "Select"): the ones ticked so far. Null when not selecting. */
  selecting: Message[] | null;
  /** "Reply privately": a group message quoted in the chat with its author (`to`). */
  privateReply: { to: string; m: Message; group: string } | null;
  /** "Select chats" in the chat list: the chat ids ticked so far. Null when not selecting. */
  chatPicks: string[] | null;
};

let view: View = { tab: 'chats', drawer: null, side: null, replyTo: null, editing: null, jumpTo: null, files: null, info: null, selecting: null, privateReply: null, chatPicks: null };
const subs = new Set<() => void>();

export function setView(change: Partial<View>) {
  view = { ...view, ...change };
  subs.forEach((f) => f());
}

export const getView = () => view;

export function useView(): View {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => view,
  );
}

export const msgKey = (m: { chatId: string; author: string; id: string }) => `${m.chatId}/${m.author}/${m.id}`;

/** Ticks or unticks a message while selecting. */
export function toggleSelected(m: Message) {
  const now = view.selecting ?? [];
  const key = msgKey(m);
  setView({ selecting: now.some((x) => msgKey(x) === key) ? now.filter((x) => msgKey(x) !== key) : [...now, m] });
}

/** Ticks or unticks a chat while selecting chats. */
export function toggleChatPick(id: string) {
  const now = view.chatPicks ?? [];
  setView({ chatPicks: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] });
}
