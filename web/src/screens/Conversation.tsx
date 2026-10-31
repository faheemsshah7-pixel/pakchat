// Conversation.tsx: the open chat. Header, the messages over the wallpaper,
// and the composer. It opens at the first unread message (or the newest),
// loads older ones as you scroll up, and marks what you see as read.

import { MAX_CALL_PEOPLE, type Chat, type Message } from '@pakchat/shared';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { core } from '../core/core';
import { isChatOpen, openLockedChat } from '../core/lock';
import { useChat, useLoaded, useMessages, usePrefs, usePresence, useTopic, useTyping } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { bodyLine, chatTitle, dayLabel, isSelfChat, lastSeen, memberName, otherPerson, sameDay } from '../ui/format';
import { Icon } from '../ui/Icon';
import { closeLayer, openLayer, openMenu, toast } from '../ui/overlay';
import { getView, msgKey, setView, useView } from '../ui/view';
import { Bubble } from './Bubble';
import { startCall } from './Call';
import { askSecretCode } from './LockScreen';
import { chatMenu, disappearing, exportChat } from './chatActions';
import { Composer } from './Composer';
import { deleteMessages, forward } from './dialogs';
import { download } from './messageActions';
import { plainText } from '../ui/richText';
import { tr } from '../i18n';

const Viewer = lazy(() => import('./Viewer').then((m) => ({ default: m.Viewer })));
const SendPreview = lazy(() => import('./SendPreview').then((m) => ({ default: m.SendPreview })));

export function Conversation({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const view = useView();
  const prefs = usePrefs();
  const [dragging, setDragging] = useState(false);

  // A reply, an edit or a selection belongs to the chat it was started in.
  useEffect(() => {
    setView({ replyTo: null, editing: null, selecting: null, ...(getView().privateReply?.to === chatId ? {} : { privateReply: null }) });
    return () => setView({ replyTo: null, editing: null, files: null, selecting: null });
  }, [chatId]);

  // Locked: its messages aren't even drawn here until the secret code is typed.
  const opened = useTopic(['lock'], () => isChatOpen(chatId));

  if (!chat) return <div className="wall" />;

  const me = chat.members.find((m) => m.userId === core.myId);
  const locked = prefs[chat.id]?.lock === 'list' && !opened;
  const canSend = !locked && !chat.left && !!me && !(chat.onlyAdminsSend && me.role !== 'admin');

  return (
    <>
      <Header chat={chat} />
      <div
        className={`wall ${view.selecting ? 'selecting' : ''}`}
        onDragEnter={(e) => e.dataTransfer.types.includes('Files') && canSend && setDragging(true)}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...e.dataTransfer.files];
          if (files.length && canSend) setView({ files });
        }}
      >
        <div className="doodle" />
        {locked ? <LockedNote chatId={chat.id} /> : <Messages chat={chat} canSend={canSend} />}
        {locked ? null : view.selecting ? (
          <SelectBar list={view.selecting} />
        ) : canSend ? (
          <Composer chat={chat} />
        ) : (
          <div className="cant">{chat.left ? tr('You can\'t send messages to this group because you\'re no longer a member.') : tr('Only admins can send messages.')}</div>
        )}
        {dragging && (
          <div className="dropzone">
            <Icon name="upload" size={40} />
            {tr('Drop files here')}
          </div>
        )}
      </div>
      {view.files && (
        <Suspense fallback={null}>
          <SendPreview chat={chat} files={view.files} />
        </Suspense>
      )}
    </>
  );
}

function Header({ chat }: { chat: Chat }) {
  const prefs = usePrefs();
  const other = otherPerson(chat);
  const self = isSelfChat(chat);
  const presence = usePresence(self ? null : other);
  const typing = useTyping(chat.id);
  useTopic(['people', 'photos'], () => core.photosVersion + Object.keys(core.people).length);
  const title = chatTitle(chat);

  // Online and last seen, for as long as the chat is open.
  useEffect(() => {
    if (!other || self) return;
    void core.refreshPresence(other);
    void core.client.watch(other).catch(() => {});
    return () => void core.client.unwatch(other).catch(() => {});
  }, [other, self]);

  const who = Object.entries(typing ?? {}).filter(([id, at]) => id !== core.myId && Date.now() - at < 6000);
  let sub: string;
  const doing = who.length && core.isRecordingAudio(chat.id, who[0][0]) ? tr('recording audio…') : tr('typing…');
  if (who.length) sub = chat.kind === 'group' ? `${memberName(who[0][0])} is ${doing}` : doing;
  else if (chat.kind === 'group')
    sub = chat.members
      .map((m) => (m.userId === core.myId ? 'You' : memberName(m.userId)))
      .sort((a, b) => (a === 'You' ? 1 : b === 'You' ? -1 : a.localeCompare(b)))
      .join(', ');
  else if (self) sub = 'Message yourself';
  else sub = lastSeen(presence);

  // Calls, like WhatsApp: with one person, or a group of up to 8 that I'm still in. A locked chat calls from the phone.
  const canCall = !self && !chat.left && !prefs[chat.id]?.lock && chat.members.some((m) => m.userId === core.myId) && (chat.kind === 'direct' || (chat.kind === 'group' && chat.members.length <= MAX_CALL_PEOPLE));
  const info = () => setView({ drawer: getView().drawer === 'info' ? null : 'info' });
  return (
    <header className="chd">
      <button className="hwho" onClick={info} aria-label={`${title}, contact info`}>
        <Avatar id={other ?? chat.id} name={title} photo={other ? photoOf(other) : chat.photo} group={chat.kind === 'group'} />
        <span className="who2">
          <b className="ellip">{title}</b>
          <span className={`ellip ${who.length ? 'typ' : ''}`}>{sub || (chat.kind === 'group' ? 'click here for group info' : 'click here for contact info')}</span>
        </span>
      </button>
      {canCall && (
        <>
          <button className="ib" aria-label={tr('Video call')} data-tip={tr('Video call')} onClick={() => void startCall(chat.id, true)}>
            <Icon name="video" size={24} />
          </button>
          <button className="ib" aria-label={tr('Voice call')} data-tip={tr('Voice call')} onClick={() => void startCall(chat.id, false)}>
            <Icon name="calls" size={22} />
          </button>
        </>
      )}
      <button className="ib" aria-label={tr('Search')} data-tip={tr('Search')} onClick={() => setView({ drawer: getView().drawer === 'search' ? null : 'search' })}>
        <Icon name="search" size={22} />
      </button>
      <button
        className="ib"
        aria-label={tr('Menu')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(
            [
              { label: chat.kind === 'group' ? tr('Group info') : tr('Contact info'), icon: 'info', run: () => setView({ drawer: 'info' }) },
              { label: tr('Select messages'), icon: 'select', run: () => setView({ selecting: [] }) },
              ...(chat.kind !== 'group' || !chat.onlyAdminsSend || chat.members.some((m) => m.userId === core.myId && m.role === 'admin')
                ? [{ label: tr('Disappearing messages'), icon: 'timer' as const, run: () => void disappearing(chat) }]
                : []),
              { label: tr('Export chat'), icon: 'export', run: () => void exportChat(chat) },
              '-',
              ...chatMenu(chat, { open: true }),
            ],
            r.right - 200,
            r.bottom + 4,
          );
        }}
      >
        <Icon name="more" size={24} />
      </button>
    </header>
  );
}

type Item = { kind: 'day'; at: number; key: string } | { kind: 'unread'; n: number; key: string } | { kind: 'msg'; m: Message; first: boolean; key: string };

function Messages({ chat, canSend }: { chat: Chat; canSend: boolean }) {
  const { messages, all, more } = useMessages(chat.id);
  const view = useView();
  const selecting = useMemo(() => (view.selecting ? new Set(view.selecting.map(msgKey)) : null), [view.selecting]);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Messages from after the chat opened glide in (Bubble's `fresh`); the ones already there just show.
  const [openedAt] = useState(Date.now);
  const [newCount, setNewCount] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Message | null>(null);
  const [sticky, setSticky] = useState<{ text: string; show: boolean }>({ text: '', show: false });
  const stickyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Where the unread ones start, fixed when the chat opens (like WhatsApp's "3 unread messages").
  const [unreadAt] = useState(() => ({ count: chat.unread, readUpTo: chat.readUpTo }));
  const opened = useRef(false);
  const before = useRef<{ height: number; top: number; count: number; last: string | null } | null>(null);

  const items = useMemo(() => {
    const out: Item[] = [];
    if (!messages) return out;
    let prev: Message | null = null;
    let unreadDone = false;
    for (const m of messages) {
      if (!prev || !sameDay(prev.sentAt, m.sentAt)) {
        out.push({ kind: 'day', at: m.sentAt, key: `day-${m.sentAt}` });
        prev = null;
      }
      if (!unreadDone && unreadAt.count > 0 && m.author !== core.myId && m.seq != null && m.seq > unreadAt.readUpTo && m.kind !== 'system') {
        unreadDone = true;
        out.push({ kind: 'unread', n: unreadAt.count, key: 'unread' });
        prev = null;
      }
      const first = !prev || prev.author !== m.author || prev.kind === 'system';
      out.push({ kind: 'msg', m, first, key: msgKey(m) });
      prev = m;
    }
    return out;
  }, [messages, unreadAt]);

  // Where we were before the list changed (kept up to date while scrolling), so older
  // messages added above don't move what's on screen.
  const last = messages?.at(-1) ?? null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    if (!opened.current) {
      const divider = el.querySelector('.unreadbar') as HTMLElement | null;
      // More unread than the first page: load older ones until the first unread is here (up to a few hundred).
      if (!divider && unreadAt.count > 0 && !all && messages.length < Math.min(unreadAt.count + 1, 600)) {
        more();
        return;
      }
      opened.current = true;
      if (divider) el.scrollTop = divider.offsetTop - 80;
      else el.scrollTop = el.scrollHeight;
    } else if (before.current) {
      const b = before.current;
      const lastKey = last ? msgKey(last) : null;
      if (b.last === lastKey && messages.length > b.count) {
        // Older messages came in above: keep the same message under the eye.
        el.scrollTop = el.scrollHeight - b.height + b.top;
      } else if (atBottom || (last && last.author === core.myId && b.last !== lastKey)) {
        el.scrollTop = el.scrollHeight;
      } else if (b.last !== lastKey && last && last.author !== core.myId) {
        // However many came at once (not just one).
        const from = messages.findIndex((m) => msgKey(m) === b.last);
        const fresh = from < 0 ? 1 : messages.slice(from + 1).filter((m) => m.author !== core.myId && m.kind !== 'system').length;
        setNewCount((n) => n + Math.max(1, fresh));
      }
    }
    before.current = { height: el.scrollHeight, top: el.scrollTop, count: messages.length, last: last ? msgKey(last) : null };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Seen it: blue ticks for them, and the chat's unread count goes, as soon as the chat is open
  // and the window in front (like WhatsApp Web), wherever it's scrolled to.
  useEffect(() => {
    if (!messages) return;
    const read = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      void core.storage.getChat(chat.id).then((c) => {
        if (c && c.unread > 0) void core.client.markRead(chat.id);
      });
      if (core.prefs[chat.id]?.markedUnread) void core.setPrefs(chat.id, { markedUnread: false });
    };
    read();
    addEventListener('focus', read);
    return () => removeEventListener('focus', read);
  }, [messages, chat.id]);

  // Jump to a message (a reply's quote, a search result, a starred one).
  useEffect(() => {
    const target = view.jumpTo;
    if (!target || !target.startsWith(`${chat.id}/`) || !messages) return;
    const el = scroller.current?.querySelector(`[data-key="${CSS.escape(target)}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(target);
      setView({ jumpTo: null });
      setTimeout(() => setFlash(null), 1800);
    } else if (!all) more();
    else {
      setView({ jumpTo: null });
      toast(tr('That message is no longer here'));
    }
  }, [view.jumpTo, messages, all, more, chat.id]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    if (before.current) before.current = { ...before.current, height: el.scrollHeight, top: el.scrollTop };
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) setNewCount(0);
    if (el.scrollTop < 400) more();
    // The date of the message at the top, floating while you scroll.
    // Rows go down the page in order, so halving finds the top one in a few looks, even in long chats.
    const rows = el.querySelectorAll<HTMLElement>('.mrow');
    const top = el.getBoundingClientRect().top + 40;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].getBoundingClientRect().bottom > top) hi = mid;
      else lo = mid + 1;
    }
    if (rows.length && rows[lo].getBoundingClientRect().bottom > top) setSticky({ text: dayLabel(Number(rows[lo].dataset.at)), show: true });
    if (stickyTimer.current) clearTimeout(stickyTimer.current);
    stickyTimer.current = setTimeout(() => setSticky((s) => ({ ...s, show: false })), 1000);
  }, [more]);

  const openViewer = useCallback((m: Message) => setViewer(m), []);

  return (
    <>
      <PinnedBar chat={chat} />
      <div ref={scroller} className="msgs scroll" onScroll={onScroll}>
        {all && (
          <div className="e2e">
            <span>
              <Icon name="lock" size={12} stroke={2.4} />
              {tr('Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.')}
            </span>
          </div>
        )}
        {!all && messages && <div className="loadmore">{messages.length > 0 && <span className="spin" />}</div>}
        {items.map((it) =>
          it.kind === 'day' ? (
            <div key={it.key} className="day">
              <span>{dayLabel(it.at)}</span>
            </div>
          ) : it.kind === 'unread' ? (
            <div key={it.key} className="unreadbar">
              <span>{it.n === 1 ? '1 unread message' : `${it.n} unread messages`}</span>
            </div>
          ) : (
            <Bubble
              key={it.key}
              m={it.m}
              chat={chat}
              first={it.first}
              canSend={canSend}
              flash={flash === it.key}
              selected={selecting ? selecting.has(it.key) : null}
              openViewer={openViewer}
              fresh={it.m.sentAt > openedAt}
            />
          ),
        )}
        {messages?.length === 0 && isSelfChat(chat) && (
          <div className="e2e">
            <span>{tr('Message yourself: notes, links and files you want on all your devices.')}</span>
          </div>
        )}
      </div>
      <div className={`sticky ${sticky.show && !atBottom ? 'show' : ''}`}>
        <div className="day" style={{ margin: 0 }}>
          <span>{sticky.text}</span>
        </div>
      </div>
      {!atBottom && (
        <button
          className="jump"
          aria-label={tr('Scroll to bottom')}
          onClick={() => {
            const el = scroller.current!;
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          <Icon name="down" size={22} stroke={2} />
          {newCount > 0 && <span className="badge">{newCount}</span>}
        </button>
      )}
      {viewer && (
        <Suspense fallback={null}>
          <Viewer chat={chat} start={viewer} onClose={() => setViewer(null)} />
        </Suspense>
      )}
    </>
  );
}

/** The phone's chat lock keeps the chat closed here too, until its secret code is typed. */
function LockedNote({ chatId }: { chatId: string }) {
  const code = useTopic(['prefs', 'lock'], () => !!core.lockCode);
  const unlock = useCallback(() => {
    void askSecretCode(tr('Unlock chat')).then((ok) => ok && openLockedChat(chatId));
  }, [chatId]);
  useEffect(() => {
    if (code) return;
    const id = openLayer(
      <div className="dialog pop">
        <h3>{tr('This chat is locked')}</h3>
        <p className="dtext">{tr('You locked this chat on your phone. Set a secret code there (Settings › Privacy › Chat lock) to open it here, or unlock it on your phone.')}</p>
        <div className="btns">
          <button className="btn fill" onClick={() => closeLayer(id)}>
            {tr('OK')}
          </button>
        </div>
      </div>,
      true,
    );
    return () => closeLayer(id);
  }, [code]);
  return (
    <div className="lockcover">
      {code && (
        <button className="btn fill" onClick={unlock}>
          <Icon name="lock" size={18} />{' '}{tr('Unlock chat')}
        </button>
      )}
    </div>
  );
}

/** Pinned messages: a bar under the header with the newest one. Click it to go there; with more than one, each click shows the next. */
function PinnedBar({ chat }: { chat: Chat }) {
  const pinned = useLoaded<Message[]>(
    [`messages:${chat.id}`],
    () => core.storage.pinnedMessages(chat.id),
    [chat.id],
    [],
  );
  const [at, setAt] = useState(0);
  if (!pinned.length) return null;
  const i = at % pinned.length;
  const m = pinned[i];
  return (
    <button
      className="pinbar"
      onClick={() => {
        setView({ jumpTo: msgKey(m) });
        setAt(i + 1);
      }}
    >
      {pinned.length > 1 && (
        <span className="pinsteps">
          {pinned.map((x, j) => (
            <i key={msgKey(x)} className={j === i ? 'on' : ''} />
          ))}
        </span>
      )}
      <Icon name="pin" size={18} />
      <span className="ellip">{bodyLine(m)}</span>
    </button>
  );
}

/** Selecting messages: "× N selected" with Copy, Star, Delete, Forward and Download, in place of the message box. */
function SelectBar({ list }: { list: Message[] }) {
  const n = list.length;
  const ordered = [...list].sort((a, b) => a.order - b.order);
  const done = () => setView({ selecting: null });
  const allText = n > 0 && list.every((m) => m.text && !m.deleted);
  const allFiles = n > 0 && list.every((m) => m.file && !m.file.once && !m.deleted);
  const forwardable = n > 0 && list.every((m) => !m.deleted && !m.file?.once && m.kind !== 'poll');
  return (
    <footer className="selbar">
      <button className="ib" aria-label={tr('Cancel selection')} onClick={done}>
        <Icon name="close" size={22} />
      </button>
      <span className="selcount">{n} selected</span>
      {allText && (
        <button
          className="ib"
          aria-label={tr('Copy')}
          data-tip={tr('Copy')}
          onClick={() => {
            const text = ordered.map((m) => (n > 1 ? `[${new Date(m.sentAt).toLocaleString()}] ${memberName(m.author)}: ${plainText(m.text!)}` : plainText(m.text!))).join('\n');
            void navigator.clipboard.writeText(text).then(() => toast(n === 1 ? tr('Message copied') : tr('Messages copied')));
            done();
          }}
        >
          <Icon name="copy" size={22} />
        </button>
      )}
      <button
        className="ib"
        aria-label={tr('Star')}
        data-tip={tr('Star')}
        disabled={!n}
        onClick={() => {
          // Like WhatsApp: if any aren't starred, star them all; if all are, unstar them.
          const allStarred = list.every((m) => core.starred[msgKey(m)]);
          void (async () => {
            for (const m of list) if (!!core.starred[msgKey(m)] === allStarred) await core.toggleStar(m);
          })();
          done();
        }}
      >
        <Icon name="star" size={22} />
      </button>
      <button
        className="ib"
        aria-label={tr('Delete')}
        data-tip={tr('Delete')}
        disabled={!n}
        onClick={() => {
          void deleteMessages(ordered);
          done();
        }}
      >
        <Icon name="trash" size={22} />
      </button>
      <button
        className="ib"
        aria-label={tr('Forward')}
        data-tip={tr('Forward')}
        disabled={!forwardable}
        onClick={() => {
          forward(ordered);
          done();
        }}
      >
        <Icon name="forward" size={22} />
      </button>
      {allFiles && (
        <button
          className="ib"
          aria-label={tr('Download')}
          data-tip={tr('Download')}
          onClick={() => {
            void (async () => {
              for (const m of ordered) await download(m);
            })();
            done();
          }}
        >
          <Icon name="download" size={22} />
        </button>
      )}
    </footer>
  );
}
