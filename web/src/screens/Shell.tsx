// Shell.tsx: the app, WhatsApp Web's frame: the rail on the left, the chat
// list (or another tab's panel), the open chat, and a drawer on the right.

import { lazy, Suspense, useEffect, useMemo } from 'react';

import { core, openChat } from '../core/core';
import { useChatRows, useConnected, usePrefs, useViewing } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { setFavicon } from '../ui/favicon';
import { Icon, StatusIcon } from '../ui/Icon';
import { setView, useView } from '../ui/view';
import { ChatList } from './ChatList';
import { Conversation } from './Conversation';
import { EmptyMain } from './EmptyMain';
import { useShortcuts } from './shortcuts';

// Opened less often, so they load the first time they're needed.
const Settings = lazy(() => import('./Settings').then((m) => ({ default: m.Settings })));
const ContactInfo = lazy(() => import('./ContactInfo').then((m) => ({ default: m.ContactInfo })));
const Verify = lazy(() => import('./ContactInfo').then((m) => ({ default: m.Verify })));
const MessageInfo = lazy(() => import('./ContactInfo').then((m) => ({ default: m.MessageInfo })));
const MediaGallery = lazy(() => import('./MediaGallery').then((m) => ({ default: m.MediaGallery })));
const SearchChat = lazy(() => import('./SearchChat').then((m) => ({ default: m.SearchChat })));
const Communities = lazy(() => import('./Communities').then((m) => ({ default: m.Communities })));
const Profile = lazy(() => import('./Profile').then((m) => ({ default: m.Profile })));
const StatusPanel = lazy(() => import('./Status').then((m) => ({ default: m.StatusPanel })));

export function Shell() {
  const view = useView();
  const viewing = useViewing();
  const rows = useChatRows();
  const prefs = usePrefs();
  const connected = useConnected();
  useShortcuts();

  // "(3) PakChat": chats with something unread, not muted or archived, like WhatsApp Web.
  const unread = useMemo(
    () => (rows ?? []).filter((r) => (r.chat.unread > 0 || r.prefs.markedUnread) && !r.prefs.archived && !(r.prefs.muted && (!r.prefs.mutedUntil || r.prefs.mutedUntil > Date.now()))).length,
    [rows],
  );
  useEffect(() => {
    document.title = unread ? `(${unread}) PakChat` : 'PakChat';
    void (navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge?.(unread || undefined).catch(() => {});
  }, [unread]);
  // The tab's icon: the unread number, or grey after a few seconds without the server.
  useEffect(() => {
    if (connected) return setFavicon(unread, false);
    const t = setTimeout(() => setFavicon(unread, true), 3000);
    return () => clearTimeout(t);
  }, [unread, connected]);

  // A chat that's gone from the list (deleted, or the chat lock's folder) closes.
  useEffect(() => {
    if (viewing && prefs[viewing]?.lock === 'folder') openChat(null);
  }, [viewing, prefs]);

  const tab = view.tab;
  const me = core.client.me;
  return (
    <>
      <nav className="rail">
        <RailButton label="Chats" on={tab === 'chats'} badge={unread} onClick={() => setView({ tab: 'chats' })}>
          <Icon name={tab === 'chats' ? 'chatFill' : 'chatO'} size={24} />
        </RailButton>
        <RailButton label="Status" on={tab === 'status'} onClick={() => setView({ tab: 'status' })}>
          <StatusIcon size={24} />
        </RailButton>
        <RailButton label="Communities" on={tab === 'communities'} onClick={() => setView({ tab: 'communities' })}>
          <Icon name="community" size={24} />
        </RailButton>
        <div className="grow" />
        <RailButton label="Settings" on={tab === 'settings'} onClick={() => setView({ tab: 'settings' })}>
          <Icon name="settings" size={24} />
        </RailButton>
        <RailButton label="Profile" on={tab === 'profile'} onClick={() => setView({ tab: 'profile' })}>
          <Avatar id={me?.userId ?? ''} name={me?.me.name ?? ''} photo={photoOf(me?.userId ?? null)} className="me" />
        </RailButton>
      </nav>

      <section className="side">
        {!connected && <Offline />}
        <Suspense fallback={null}>
          {tab === 'settings' ? <Settings /> : tab === 'profile' ? <Profile /> : tab === 'communities' ? <Communities /> : tab === 'status' ? <StatusPanel /> : <ChatList rows={rows} />}
        </Suspense>
      </section>

      <main className="main">{viewing ? <Conversation key={viewing} chatId={viewing} /> : <EmptyMain />}</main>

      {viewing && view.drawer && (
        <aside className="drawer">
          <Suspense fallback={null}>
            {view.drawer === 'verify' ? (
              <Verify chatId={viewing} />
            ) : view.drawer === 'msginfo' ? (
              <MessageInfo chatId={viewing} />
            ) : view.drawer === 'media' ? (
              <MediaGallery chatId={viewing} />
            ) : view.drawer === 'search' ? (
              <SearchChat chatId={viewing} />
            ) : (
              <ContactInfo chatId={viewing} />
            )}
          </Suspense>
        </aside>
      )}
    </>
  );
}

function RailButton({ label, on, badge, onClick, children }: { label: string; on: boolean; badge?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`ib rb ${on ? 'on' : ''}`} onClick={onClick} aria-label={label} data-tip={label}>
      {children}
      {!!badge && <span className="badge rbn">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

/** The yellow strip when the connection to the server drops; messages wait and go when it's back. */
function Offline() {
  return (
    <div className="offline">
      <Icon name="warning" size={20} />
      <div>
        <b>Connecting…</b>
        <span>Messages you send go when the internet is back.</span>
      </div>
    </div>
  );
}
