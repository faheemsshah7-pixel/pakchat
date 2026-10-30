// ChatList.tsx: the chat list panel, like WhatsApp Web's: header, search,
// filter chips, Archived, and the chats in fixed 76px slots. Only the rows
// on screen are drawn, so 500 chats scroll as smoothly as 5.

import type { Message } from '@pakchat/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { core, openChat } from '../core/core';
import { type ChatRow, useLockedRows, usePrefs, useTopic, useTyping, useViewing } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { listTime, memberName, phoneOf, preview } from '../ui/format';
import { Icon } from '../ui/Icon';
import { askText, type MenuItem, openMenu } from '../ui/overlay';
import { Ticks } from '../ui/Ticks';
import { msgKey, setView, toggleChatPick, useView } from '../ui/view';
import { archiveMany, chatMenu, deleteMany, favouriteMany, isMuted, markManyRead, muteMany, pinMany } from './chatActions';
import { appLockSetting, closeFolder, isFolderOpen, lockApp, openFolder, rightCode } from '../core/lock';
import { askSecretCode } from './LockScreen';
import { NewChat, NewGroup } from './NewChat';
import { Starred } from './Starred';
import { tr } from '../i18n';

const SLOT = 76;
type Filter = 'all' | 'unread' | 'favourites' | 'groups' | `list:${string}`;

/** The small icon before a file's preview line, like WhatsApp's. */
const FILE_ICON = { image: 'photo', video: 'video', audio: 'music', voice: 'mic', doc: 'doc', sticker: 'sticker' } as const;

export function ChatList({ rows }: { rows: ChatRow[] | null }) {
  const view = useView();
  if (view.side === 'newChat') return <NewChat />;
  if (view.side === 'newGroup') return <NewGroup />;
  if (view.side === 'starred') return <Starred />;
  if (view.side === 'locked') return <LockedChats />;
  return <Chats rows={rows} archived={view.side === 'archived'} />;
}

/** The Locked chats folder, once its secret code was typed. */
function LockedChats() {
  const rows = useLockedRows();
  const open = useTopic(['lock'], isFolderOpen);
  useEffect(() => {
    if (!open) setView({ side: null });
  }, [open]);
  return <Chats rows={rows} archived={false} folder />;
}

/** Opens the Locked chats folder with the secret code. */
async function openLockedChats() {
  if (await askSecretCode(tr('Locked chats'))) {
    openFolder();
    setView({ side: 'locked' });
  }
}

function Chats({ rows, archived, folder = false }: { rows: ChatRow[] | null; archived: boolean; folder?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const lists = useTopic(['prefs'], () => core.lists);
  const search = useRef<HTMLInputElement>(null);
  const picks = useView().chatPicks;

  // Selecting ends when leaving this page.
  useEffect(() => () => setView({ chatPicks: null }), [archived]);

  useEffect(() => {
    const focus = () => search.current?.focus();
    addEventListener('pakchat:search', focus);
    return () => removeEventListener('pakchat:search', focus);
  }, []);

  const all = rows ?? [];
  const archivedCount = folder ? 0 : all.filter((r) => r.prefs.archived).length;
  // Locked chats folder: shown at the top when it has chats and this computer has the phone's secret code.
  const prefsNow = usePrefs();
  const lockCode = useTopic(['prefs'], () => core.lockCode);
  const lockedCount = folder || !lockCode ? 0 : Object.values(prefsNow).filter((p) => p.lock === 'folder' && !p.deletedAt).length;
  const shown = useMemo(() => {
    let list = folder ? all : all.filter((r) => !!r.prefs.archived === archived);
    if (!archived && !folder) {
      if (filter === 'unread') list = list.filter((r) => r.chat.unread > 0 || r.prefs.markedUnread || r.chat.id === core.viewing);
      else if (filter === 'favourites') list = list.filter((r) => r.prefs.favourite);
      else if (filter === 'groups') list = list.filter((r) => r.chat.kind === 'group');
      else if (filter.startsWith('list:')) {
        const l = lists.find((x) => x.id === filter.slice(5));
        list = list.filter((r) => l?.chatIds.includes(r.chat.id));
      }
    }
    const words = q.trim().toLowerCase();
    if (words) list = all.filter((r) => r.title.toLowerCase().includes(words) || (r.other && phoneOf(r.other).replace(/\s/g, '').includes(words.replace(/\s/g, ''))));
    return list;
  }, [all, archived, folder, filter, q, lists]);

  // Search also finds saved contacts I have no chat with yet.
  const contacts = useMemo(() => {
    const words = q.trim().toLowerCase();
    if (!words) return [];
    const inChats = new Set(all.map((r) => r.other));
    return Object.entries(core.contacts)
      .filter(([id, c]) => !inChats.has(id) && (c.name.toLowerCase().includes(words) || (c.phone ?? '').replace(/\s/g, '').includes(words.replace(/\s/g, ''))))
      .slice(0, 30);
  }, [q, all]);

  // And messages with those words, in any chat (WhatsApp's "Messages" part), after a short pause in typing.
  const [found, setFound] = useState<Message[]>([]);
  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) return setFound([]);
    let live = true;
    const t = setTimeout(() => void core.storage.searchText(words, 60).then((l) => live && setFound(l)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const titles = useMemo(() => new Map(all.map((r) => [r.chat.id, r] as const)), [all]);
  // A locked chat's words stay out of search (the phone's chat lock).
  const hits = found.filter((m) => titles.has(m.chatId) && !titles.get(m.chatId)!.prefs.lock);

  return (
    <>
      {picks ? (
        <PickBar picks={picks} rows={all} shown={shown} />
      ) : archived || folder ? (
        <header className="sh">
          <button className="ib" onClick={() => (folder && closeFolder(), setView({ side: null }))} aria-label={tr('Back')}>
            <Icon name="back" size={22} />
          </button>
          <span>{folder ? tr('Locked chats') : tr('Archived')}</span>
        </header>
      ) : (
        <header className="lh">
          <div className="brand">{tr('PakChat')}</div>
          <div className="grow" />
          <button className="ib" aria-label={tr('Menu')} onClick={(e) => openMenu(listMenu(), e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().bottom + 4)}>
            <Icon name="more" size={24} />
          </button>
          <button className="ib fab" aria-label={tr('New chat')} data-tip={tr('New chat')} onClick={() => setView({ side: 'newChat' })}>
            <Icon name="newChat" size={22} />
          </button>
        </header>
      )}
      {!archived && !folder && (
        <>
          <label className="search">
            {q ? (
              <button className="sback" onClick={() => setQ('')} aria-label={tr('Clear search')}>
                <Icon name="back" size={20} />
              </button>
            ) : (
              <Icon name="search" size={20} />
            )}
            <input
              ref={search}
              value={q}
              placeholder={tr('Search or start a new chat')}
              onChange={(e) => {
                const typed = e.target.value;
                setQ(typed);
                // The phone's secret code typed in search opens Locked chats, like WhatsApp.
                if (core.lockCode && typed.trim().length >= 4)
                  void rightCode(typed).then((ok) => {
                    if (!ok) return;
                    setQ('');
                    openFolder();
                    setView({ side: 'locked' });
                  });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
                if (e.key === 'Enter' && shown[0]) openChat(shown[0].chat.id);
              }}
            />
          </label>
          {!q && (
            <div className="chips">
              <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
                {tr('All')}
              </Chip>
              <Chip on={filter === 'unread'} onClick={() => setFilter('unread')}>
                {tr('Unread')}
              </Chip>
              <Chip on={filter === 'favourites'} onClick={() => setFilter('favourites')}>
                {tr('Favourites')}
              </Chip>
              <Chip on={filter === 'groups'} onClick={() => setFilter('groups')}>
                {tr('Groups')}
              </Chip>
              {lists.map((l) => (
                <Chip key={l.id} on={filter === `list:${l.id}`} onClick={() => setFilter(`list:${l.id}`)}>
                  {l.name}
                </Chip>
              ))}
              {/* "+": a new list, like WhatsApp Web. Chats go in from their menu (Add to list). */}
              <button
                className="chip add"
                aria-label={tr('New list')}
                data-tip={tr('New list')}
                onClick={() =>
                  void askText('New list', 'Name, like Family or Work').then((name) => {
                    if (!name) return;
                    const id = crypto.randomUUID();
                    void core.setLists([...core.lists, { id, name, chatIds: [] }]).then(() => setFilter(`list:${id}`));
                  })
                }
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
          )}
          {!q && <NotifyBanner />}
        </>
      )}
      <Rows
        rows={shown}
        picks={picks}
        topHeight={q.trim() ? 44 : !archived && !folder && filter === 'all' ? 49 * ((archivedCount > 0 ? 1 : 0) + (lockedCount > 0 ? 1 : 0) || 1) : 49}
        top={
          q.trim() && shown.length > 0 ? (
            <div className="grp">{tr('Chats')}</div>
          ) : !archived && !folder && !q && filter === 'all' && (archivedCount > 0 || lockedCount > 0) ? (
            <>
              {lockedCount > 0 && (
                <button className="arch lockd" onClick={() => void openLockedChats()}>
                  <Icon name="lock" size={22} />
                  <span>{tr('Locked chats')}</span>
                  <em>{lockedCount}</em>
                </button>
              )}
              {archivedCount > 0 && (
                <button className="arch" onClick={() => setView({ side: 'archived' })}>
                  <Icon name="archive" size={22} />
                  <span>{tr('Archived')}</span>
                  <em>{archivedCount}</em>
                </button>
              )}
            </>
          ) : null
        }
        empty={
          rows === null ? null : q ? (
            contacts.length || hits.length ? null : (
              <p className="none">{tr('No chats, contacts or messages found')}</p>
            )
          ) : folder ? (
            <p className="none">{tr('No locked chats')}</p>
          ) : archived ? (
            <p className="none">{tr('No archived chats')}</p>
          ) : filter === 'unread' ? (
            <p className="none">{tr('No unread chats')}</p>
          ) : filter === 'favourites' ? (
            <p className="none">{tr('Add people or groups to Favourites from their chat\'s menu')}</p>
          ) : filter === 'groups' ? (
            <p className="none">{tr('No groups yet')}</p>
          ) : filter.startsWith('list:') ? (
            <p className="none">{tr('Add chats to this list from their menu (Add to list)')}</p>
          ) : (
            <p className="none">{tr('Your chats from your phone show here')}</p>
          )
        }
        after={
          contacts.length > 0 || hits.length > 0 ? (
            <>
              {contacts.length > 0 && <div className="grp">{tr('Contacts')}</div>}
              {contacts.map(([id, c]) => (
                <button key={id} className="row" onClick={() => void core.client.openDirect(id).then((chat) => openChat(chat.id))}>
                  <Avatar id={id} name={c.name} photo={photoOf(id)} />
                  <div className="rt">
                    <div className="l1">
                      <span className="nm">{c.name}</span>
                    </div>
                    <div className="l2">
                      <span className="pv">{core.people[id]?.about ?? c.phone ?? ''}</span>
                    </div>
                  </div>
                </button>
              ))}
              {hits.length > 0 && <div className="grp">{tr('Messages')}</div>}
              {hits.map((m) => (
                <button
                  key={msgKey(m)}
                  className="row msr"
                  onClick={() => {
                    openChat(m.chatId);
                    setView({ jumpTo: msgKey(m) });
                  }}
                >
                  <div className="rt">
                    <div className="l1">
                      <span className="nm">{titles.get(m.chatId)!.title}</span>
                      <span className="tm">{listTime(m.sentAt)}</span>
                    </div>
                    <div className="l2">
                      {m.author === core.myId && <Ticks status={m.status} />}
                      <span className="pv">
                        <Marked text={preview(m, titles.get(m.chatId)!.chat.kind === 'group')} words={q.trim()} />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </>
          ) : null
        }
      />
    </>
  );
}

/** "Select chats": the bar that takes the header's place, with what to do to the ticked chats. */
function PickBar({ picks, rows, shown }: { picks: string[]; rows: ChatRow[]; shown: ChatRow[] }) {
  const chats = rows.filter((r) => picks.includes(r.chat.id)).map((r) => r.chat);
  const none = chats.length === 0;
  const done = (p: Promise<unknown>) => void p.then(() => setView({ chatPicks: null }));
  const allRead = chats.every((c) => c.unread === 0 && !core.prefs[c.id]?.markedUnread);
  const allArchived = chats.length > 0 && chats.every((c) => core.prefs[c.id]?.archived);
  const allMuted = chats.length > 0 && chats.every((c) => isMuted(core.prefs[c.id]));
  const more = (): MenuItem[] => [
    { label: chats.length > 0 && chats.every((c) => core.prefs[c.id]?.pinnedAt) ? tr('Unpin chats') : tr('Pin chats'), icon: 'pin', run: () => done(pinMany(chats)) },
    { label: chats.length > 0 && chats.every((c) => core.prefs[c.id]?.favourite) ? tr('Remove from Favourites') : tr('Add to Favourites'), icon: 'heart', run: () => done(favouriteMany(chats)) },
    { label: tr('Mark as unread'), icon: 'unread', run: () => done(markManyRead(chats, false)) },
    '-',
    { label: tr('Select all'), icon: 'select', run: () => setView({ chatPicks: shown.map((r) => r.chat.id) }) },
  ];
  return (
    <header className="lh pickh">
      <button className="ib" aria-label={tr('Cancel')} onClick={() => setView({ chatPicks: null })}>
        <Icon name="close" size={22} />
      </button>
      <span className="selcount">{chats.length} selected</span>
      <button className="ib" disabled={none} aria-label={allArchived ? tr('Unarchive') : tr('Archive')} data-tip={allArchived ? tr('Unarchive') : tr('Archive')} onClick={() => done(archiveMany(chats, !allArchived))}>
        <Icon name="archive" size={22} />
      </button>
      <button className="ib" disabled={none} aria-label={allMuted ? tr('Unmute') : tr('Mute')} data-tip={allMuted ? tr('Unmute') : tr('Mute')} onClick={() => void muteMany(chats).then(() => setView({ chatPicks: null }))}>
        <Icon name={allMuted ? 'bell' : 'muted'} size={22} />
      </button>
      <button className="ib" disabled={none || allRead} aria-label={tr('Mark as read')} data-tip={tr('Mark as read')} onClick={() => done(markManyRead(chats, true))}>
        <Icon name="unread" size={22} />
      </button>
      <button className="ib" disabled={none} aria-label={tr('Delete')} data-tip={tr('Delete')} onClick={() => void deleteMany(chats).then((ok) => ok && setView({ chatPicks: null }))}>
        <Icon name="trash" size={22} />
      </button>
      <button className="ib" disabled={none} aria-label={tr('More')} onClick={(e) => openMenu(more(), e.currentTarget.getBoundingClientRect().right - 220, e.currentTarget.getBoundingClientRect().bottom + 4)}>
        <Icon name="more" size={22} />
      </button>
    </header>
  );
}

const BANNER_KEY = 'pakchat-notify-banner';

/** WhatsApp Web's "Get notified of new messages" box, until notifications are on or it's closed. */
function NotifyBanner() {
  const ask = () => (typeof Notification !== 'undefined' && Notification.permission === 'default' ? !readFlag(BANNER_KEY) : false);
  const [show, setShow] = useState(ask);
  if (!show) return null;
  return (
    <div className="nbanner">
      <span className="nbi">
        <Icon name="bell" size={22} />
      </span>
      <button
        className="nbt"
        onClick={() =>
          void Notification.requestPermission().then((p) => {
            if (p === 'granted') void core.setSettings({ notifications: true });
            setShow(ask());
          })
        }
      >
        <b>{tr('Get notified of new messages')}</b>
        <span>
          {tr('Turn on desktop notifications')}{' '}<Icon name="chevron" size={14} />
        </span>
      </button>
      <button
        className="ib nbx"
        aria-label={tr('Close')}
        onClick={() => {
          writeFlag(BANNER_KEY);
          setShow(false);
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Private windows can refuse; the box just comes back next time.
  }
}

/** The searched words in bold, like WhatsApp's search results. */
function Marked({ text, words }: { text: string; words: string }) {
  const at = text.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0 || !words) return <>{text}</>;
  // Long lines start a little before the match, so it shows.
  const from = at > 40 ? at - 20 : 0;
  return (
    <>
      {from ? '…' : ''}
      {text.slice(from, at)}
      <b>{text.slice(at, at + words.length)}</b>
      {text.slice(at + words.length)}
    </>
  );
}

function listMenu() {
  return [
    { label: tr('New group'), icon: 'group' as const, run: () => setView({ side: 'newGroup' }) },
    { label: tr('Starred messages'), icon: 'star' as const, run: () => setView({ side: 'starred' }) },
    { label: tr('Select chats'), icon: 'select' as const, run: () => setView({ chatPicks: [] }) },
    {
      label: tr('Mark all as read'),
      icon: 'unread' as const,
      run: () =>
        void (async () => {
          for (const c of await core.storage.listChats()) {
            if (c.unread > 0) await core.client.markRead(c.id);
            if (core.prefs[c.id]?.markedUnread) await core.setPrefs(c.id, { markedUnread: false });
          }
        })(),
    },
    ...(appLockSetting() ? [{ label: tr('Lock app'), icon: 'lock' as const, run: lockApp }] : []),
    '-' as const,
    { label: tr('Settings'), icon: 'settings' as const, run: () => setView({ tab: 'settings' }) },
    { label: tr('Log out'), icon: 'logout' as const, run: () => dispatchEvent(new Event('pakchat:logout')) },
  ];
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`chip ${on ? 'on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** The rows, drawn only where they're on screen. */
/** `top`: what's above the rows (the Archived row, 49px, or the search's "Chats" heading, 44px), `topHeight` tall. */
function Rows({ rows, picks, top, topHeight, empty, after }: { rows: ChatRow[]; picks: string[] | null; top: React.ReactNode; topHeight: number; empty: React.ReactNode; after: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(800);
  const viewing = useViewing();
  const [dropOn, setDropOn] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const head = top ? topHeight : 0;
  const first = Math.max(0, Math.floor((scroll - head) / SLOT) - 4);
  const last = Math.min(rows.length, Math.ceil((scroll - head + height) / SLOT) + 4);

  const move = (step: number) => {
    const i = rows.findIndex((r) => r.chat.id === viewing);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + step))];
    if (next) {
      openChat(next.chat.id);
      const el = box.current!;
      const y = head + rows.indexOf(next) * SLOT;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + SLOT > el.scrollTop + el.clientHeight) el.scrollTop = y + SLOT - el.clientHeight;
    }
  };

  return (
    <div
      ref={box}
      className="rows scroll"
      tabIndex={0}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        move(e.key === 'ArrowDown' ? 1 : -1);
      }}
    >
      {top}
      {rows.length === 0 && empty}
      <div style={{ height: rows.length * SLOT, position: 'relative', flex: 'none' }}>
        {rows.slice(first, last).map((r, j) => (
          <Row
            key={r.chat.id}
            row={r}
            top={(first + j) * SLOT}
            selected={r.chat.id === viewing}
            picked={picks ? picks.includes(r.chat.id) : null}
            dropping={dropOn === r.chat.id}
            onDrop={(over) => setDropOn(over ? r.chat.id : null)}
          />
        ))}
      </div>
      {after}
    </div>
  );
}

/** `picked`: null when not selecting chats, else whether this one is ticked. */
const Row = memo(function Row({ row, top, selected, picked, dropping, onDrop }: { row: ChatRow; top: number; selected: boolean; picked: boolean | null; dropping: boolean; onDrop: (over: boolean) => void }) {
  const { chat, prefs, last } = row;
  const typing = useTyping(chat.id);
  useTopic(['people', 'photos'], () => core.photosVersion + Object.keys(core.people).length);
  const group = chat.kind === 'group';
  const unread = chat.unread > 0 || !!prefs.markedUnread;
  const muted = isMuted(prefs);
  const [menuOpen, setMenuOpen] = useState(false);

  const whoTypes = Object.entries(typing ?? {}).filter(([, at]) => Date.now() - at < 6000);
  const draft = prefs.draft && !selected ? prefs.draft : null;
  let line: React.ReactNode;
  if (prefs.lock === 'list') line = <span className="pv">{tr('🔒 Locked chat')}</span>;
  else if (whoTypes.length) {
    const doing = core.isRecordingAudio(chat.id, whoTypes[0][0]) ? tr('recording audio…') : tr('typing…');
    line = <span className="pv typ">{group ? `${memberName(whoTypes[0][0])} is ${doing}` : doing}</span>;
  }
  else if (draft)
    line = (
      <span className="pv">
        <span className="dr">{tr('Draft:')}</span> {draft}
      </span>
    );
  else
    line = (
      <>
        {last && last.author === core.myId && last.kind !== 'system' && !last.deleted && <Ticks status={last.status} />}
        {last?.kind === 'file' && last.file && !last.deleted && !last.file.once && (!group || last.author === core.myId) && (
          <span className="pvi">
            <Icon name={FILE_ICON[last.file.kind]} size={16} />
          </span>
        )}
        <span className="pv">{preview(last, group)}</span>
      </>
    );

  const menu = (x: number, y: number) => {
    // The chevron stays while its menu is open, and goes with it.
    setMenuOpen(true);
    openMenu(chatMenu(chat, { open: selected }), x, y, { gone: () => setMenuOpen(false) });
  };

  return (
    <div
      className={`row ${selected && picked === null ? 'sel' : ''} ${picked ? 'picked' : ''} ${picked !== null ? 'picking' : ''} ${menuOpen ? 'menuopen' : ''} ${dropping ? 'drop' : ''}`}
      style={{ position: 'absolute', left: 0, right: 0, top }}
      role="button"
      aria-label={row.title}
      aria-pressed={picked ?? undefined}
      onClick={() => (picked !== null ? toggleChatPick(chat.id) : openChat(chat.id))}
      onContextMenu={(e) => {
        e.preventDefault();
        if (picked === null) menu(e.clientX, e.clientY);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        onDrop(true);
      }}
      onDragLeave={() => onDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(false);
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        openChat(chat.id);
        setView({ files });
      }}
    >
      {picked !== null && (
        <span className={`chk ${picked ? '' : 'off'}`}>{picked && <Icon name="check" size={13} stroke={3} />}</span>
      )}
      <Avatar id={row.other ?? chat.id} name={row.title} photo={row.other ? photoOf(row.other) : chat.photo} group={group} />
      <div className="rt">
        <div className="l1">
          <span className="nm">{row.title}</span>
          <span className={`tm ${unread && !muted ? 'u' : ''}`}>{row.at ? listTime(last?.sentAt ?? row.at) : ''}</span>
        </div>
        <div className="l2">
          {line}
          <span className="ics">
            {muted && <Icon name="muted" size={18} />}
            {prefs.pinnedAt && <Icon name="pin" size={18} />}
            {unread && <span className={`badge ${muted ? 'm' : ''}`}>{chat.unread > 0 ? (chat.unread > 999 ? '999+' : chat.unread) : ''}</span>}
            <button
              className="chev"
              aria-label={tr('Open chat menu')}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                menu(r.left, r.bottom + 2);
              }}
            >
              <Icon name="down" size={20} stroke={2} />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
});
