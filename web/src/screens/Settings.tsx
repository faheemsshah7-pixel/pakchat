// Settings.tsx: the Settings panel (the rail's gear, or your photo), with
// its pages: Privacy, Chats, Notifications, Keyboard shortcuts, Help.

import { useEffect, useState } from 'react';

import { core, type Theme, WALLPAPERS } from '../core/core';
import { useSettings, useTopic } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { memberName } from '../ui/format';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { choose, closeLayer, Dialog, openLayer, toast } from '../ui/overlay';
import { setView } from '../ui/view';
import { appLockSetting, setLockAfter } from '../core/lock';
import { askToTurnOff, setUpAppLock } from './LockScreen';
import { logOut, SHORTCUTS } from './shortcuts';
import { getLang, type Lang, setLang, tr } from '../i18n';

/** Each language in its own words. */
const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'اردو' },
];

type Page = null | 'privacy' | 'chats' | 'notifications' | 'devices' | 'help';

/** Everything Settings › Search finds, and where it is (like WhatsApp Web's settings search). */
const FINDABLE: { title: string; where: string; page: Exclude<Page, null> | 'shortcuts' | 'profile' }[] = [
  { title: tr('Blocked contacts'), where: tr('Privacy'), page: 'privacy' },
  { title: tr('App lock'), where: tr('Privacy'), page: 'privacy' },
  { title: tr('Chat lock'), where: tr('Privacy'), page: 'privacy' },
  { title: tr('Privacy'), where: tr('Settings'), page: 'privacy' },
  { title: tr('Theme'), where: tr('Chats'), page: 'chats' },
  { title: tr('Chat wallpaper'), where: tr('Chats'), page: 'chats' },
  { title: tr('Language'), where: tr('Chats'), page: 'chats' },
  { title: tr('Enter is send'), where: tr('Chats'), page: 'chats' },
  { title: tr('Message notifications'), where: tr('Notifications'), page: 'notifications' },
  { title: tr('Show previews'), where: tr('Notifications'), page: 'notifications' },
  { title: tr('Sounds'), where: tr('Notifications'), page: 'notifications' },
  { title: tr('Linked devices'), where: tr('Settings'), page: 'devices' },
  { title: tr('Keyboard shortcuts'), where: tr('Settings'), page: 'shortcuts' },
  { title: tr('Help'), where: tr('Settings'), page: 'help' },
  { title: tr('Profile photo'), where: tr('Profile'), page: 'profile' },
  { title: tr('Name'), where: tr('Profile'), page: 'profile' },
  { title: tr('About'), where: tr('Profile'), page: 'profile' },
];

export function Settings() {
  const [page, setPage] = useState<Page>(null);
  const [q, setQ] = useState('');
  if (page) return <SubPage page={page} back={() => setPage(null)} />;
  const words = q.trim().toLowerCase();
  const found = words ? FINDABLE.filter((f) => f.title.toLowerCase().includes(words) || f.where.toLowerCase().includes(words)) : [];
  const go = (to: (typeof FINDABLE)[number]['page']) => (to === 'shortcuts' ? showShortcuts() : to === 'profile' ? setView({ tab: 'profile' }) : setPage(to));
  const me = core.client.me!;
  const r = (icon: IconName, title: string, sub: string, run: () => void, red = false) => (
    <button className={`srow ${red ? 'red' : ''}`} onClick={run}>
      <span className="di">
        <Icon name={icon} size={24} />
      </span>
      <span className="dt">
        {title}
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
  return (
    <>
      <header className="sh">
        <span>{tr('Settings')}</span>
      </header>
      <label className="search ssearch">
        <Icon name="search" size={20} />
        <input value={q} placeholder={tr('Search settings')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      </label>
      {words ? (
        <div className="sbody scroll">
          {found.length === 0 && <p className="none">{tr('No settings found')}</p>}
          {found.map((f) => (
            <button key={f.title} className="srow" onClick={() => go(f.page)}>
              <span className="dt">
                {f.title}
                <small>{f.where}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sbody scroll">
          <button className="prof" onClick={() => setView({ tab: 'profile' })}>
            <Avatar id={me.userId} name={me.me.name} photo={photoOf(me.userId)} />
            <div>
              <b>{me.me.name}</b>
              <span>{me.me.about ?? core.people[me.userId]?.about ?? 'Hey there! I am using PakChat.'}</span>
            </div>
          </button>
          {r('lock', 'Privacy', 'Blocked contacts, App lock', () => setPage('privacy'))}
          {r('chat', 'Chats', 'Theme, Enter is send', () => setPage('chats'))}
          {r('bell', 'Notifications', 'Message notifications', () => setPage('notifications'))}
          {r('laptop', 'Linked devices', 'This computer is linked to your phone', () => setPage('devices'))}
          {r('keyboard', 'Keyboard shortcuts', 'Quick actions', showShortcuts)}
          {r('help', 'Help', 'About PakChat Web', () => setPage('help'))}
          {r('logout', 'Log out', '', () => void logOut(), true)}
        </div>
      )}
    </>
  );
}

function SubPage({ page, back }: { page: Exclude<Page, null>; back: () => void }) {
  const title = { privacy: 'Privacy', chats: 'Chats', notifications: 'Notifications', devices: 'Linked devices', help: 'Help' }[page];
  return (
    <>
      <header className="sh slide">
        <button className="ib" onClick={back} aria-label={tr('Back')}>
          <Icon name="back" size={22} />
        </button>
        <span>{title}</span>
      </header>
      <div className="sbody scroll">{page === 'privacy' ? <Privacy /> : page === 'chats' ? <Chats /> : page === 'notifications' ? <Notifications /> : page === 'devices' ? <Devices /> : <Help />}</div>
    </>
  );
}

function Toggle({ title, sub, on, set }: { title: string; sub?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button className="srow" onClick={() => set(!on)} role="switch" aria-checked={on}>
      <span className="dt">
        {title}
        {sub && <small>{sub}</small>}
      </span>
      <span className={`sw ${on ? 'on' : ''}`} />
    </button>
  );
}

function Chats() {
  const s = useSettings();
  const themes: { value: Theme; label: string }[] = [
    { value: 'light', label: tr('Light') },
    { value: 'dark', label: tr('Dark') },
    { value: 'system', label: tr('System default') },
  ];
  return (
    <>
      <div className="shd">{tr('Display')}</div>
      <button
        className="srow"
        onClick={() =>
          void choose(tr('Theme'), themes, s.theme).then((t) => {
            if (t) void core.setSettings({ theme: t });
          })
        }
      >
        <span className="dt">
          {tr('Theme')}<small>{themes.find((t) => t.value === s.theme)?.label}</small>
        </span>
      </button>
      <button className="srow" onClick={() => void pickWallpaper(s.wallpaper)}>
        <span className="dt">
          {tr('Chat wallpaper')}<small>{s.wallpaper == null ? tr('Default') : tr('Colour')}</small>
        </span>
      </button>
      <button
        className="srow"
        onClick={() =>
          void choose(tr('Language'), LANGS, getLang()).then((l) => {
            if (l) setLang(l);
          })
        }
      >
        <span className="dt">
          {tr('Language')}
          <small>{LANGS.find((l) => l.value === getLang())?.label}</small>
        </span>
      </button>
      <div className="shd">{tr('Chat settings')}</div>
      <Toggle title={tr('Enter is send')} sub={tr('Enter key will send your message')} on={s.enterSends} set={(v) => void core.setSettings({ enterSends: v })} />
    </>
  );
}

/** Chat wallpaper: the default, or one of the solid colours (each has its own dark one). */
function pickWallpaper(now: number | undefined) {
  function Pick() {
    const [v, setV] = useState(now ?? -1);
    const dark = document.documentElement.classList.contains('dark');
    return (
      <Dialog
        title={tr('Chat wallpaper')}
        onClose={() => closeLayer(id)}
        buttons={[{ label: tr('Cancel') }, { label: tr('Set'), fill: true, run: () => void core.setSettings({ wallpaper: v < 0 ? undefined : v }) }]}
      >
        <div className="walls">
          <button className={`wdef ${v < 0 ? 'on' : ''}`} onClick={() => setV(-1)} aria-label={tr('Default')}>
            {tr('Default')}
          </button>
          {WALLPAPERS.map((w, i) => (
            <button key={i} className={v === i ? 'on' : ''} style={{ background: dark ? w.dark : w.light }} onClick={() => setV(i)} aria-label={`Colour ${i + 1}`} />
          ))}
        </div>
      </Dialog>
    );
  }
  const id: number = openLayer(<Pick />, true);
}

function Notifications() {
  const s = useSettings();
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  return (
    <>
      {perm !== 'granted' && (
        <div className="tipcard">
          <Icon name="bell" size={28} />
          <div>
            <b>{tr('Turn on desktop notifications')}</b>
            <span>{perm === 'denied' ? tr('Notifications are blocked. Allow them for this site in your browser settings.') : tr('Get notified of new messages on this computer.')}</span>
            {perm === 'default' && (
              <button className="lnk" onClick={() => void Notification.requestPermission().then(setPerm)}>
                {tr('Turn on')}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="shd">{tr('Messages')}</div>
      <Toggle title={tr('Message notifications')} sub={tr('Show notifications for new messages')} on={s.notifications} set={(v) => void core.setSettings({ notifications: v })} />
      <Toggle title={tr('Show previews')} sub={tr('Show the message in the notification')} on={s.previews} set={(v) => void core.setSettings({ previews: v })} />
      <Toggle title={tr('Sounds')} sub={tr('Play a sound for incoming messages')} on={s.sounds} set={(v) => void core.setSettings({ sounds: v })} />
    </>
  );
}

function Privacy() {
  const blocked = useTopic(['blocked'], () => core.blocked);
  const lock = useTopic(['lock'], appLockSetting);
  const code = useTopic(['prefs'], () => core.lockCode);
  useEffect(() => {
    void core.loadBlocked().catch(() => toast(tr('Couldn\'t load your blocked contacts. Check your internet connection.')));
  }, []);
  const afters: { value: string; label: string }[] = [
    { value: '1', label: tr('After 1 minute') },
    { value: '15', label: tr('After 15 minutes') },
    { value: '60', label: tr('After 1 hour') },
  ];
  return (
    <>
      <div className="shd">{tr('App lock')}</div>
      <Toggle title={tr('App lock')} sub={tr('Ask for a password to open PakChat on this computer')} on={!!lock} set={(v) => (v ? setUpAppLock() : askToTurnOff())} />
      {lock && (
        <button
          className="srow"
          onClick={() =>
            void choose(tr('Lock automatically'), afters, String(lock.after)).then((v) => {
              if (v) void setLockAfter(Number(v) as 1 | 15 | 60);
            })
          }
        >
          <span className="dt">
            {tr('Lock automatically')}<small>{afters.find((a) => a.value === String(lock.after))?.label}</small>
          </span>
        </button>
      )}
      <div className="shd">{tr('Chat lock')}</div>
      <p className="note">
        {code
          ? tr('Locked chats open here with the secret code you set on your phone. Lock or unlock a chat from its menu.')
          : tr('To lock chats on this computer, first set a secret code on your phone: Settings › Privacy › Chat lock › Secret code.')}
      </p>
      <div className="shd">{tr('Blocked contacts')}</div>
      {blocked === null && <p className="none">{tr('Loading…')}</p>}
      {blocked?.size === 0 && <p className="none">{tr('You haven\'t blocked anyone.')}</p>}
      {[...(blocked ?? [])].map((id) => (
        <div key={id} className="srow">
          <Avatar id={id} name={memberName(id)} photo={photoOf(id)} size={40} />
          <span className="dt">{memberName(id)}</span>
          <button className="btn ghost" onClick={() => void core.block(id, false).catch(() => toast(tr('Couldn\'t unblock. Try again.')))}>
            {tr('Unblock')}
          </button>
        </div>
      ))}
      <p className="note">{tr('Last seen, profile photo, about, read receipts and the other privacy settings are set on your phone, and apply here too.')}</p>
    </>
  );
}

function Devices() {
  return (
    <div className="devnote">
      <div className="ill">
        <Icon name="laptop" size={56} stroke={1.3} />
      </div>
      <p>
        {tr('This computer is linked to your phone. It keeps working when your phone is off, and you can link up to 4 devices.')}
      </p>
      <p>
        {tr('To see your linked devices or log one out, open PakChat on your phone and tap')}{' '}<b>⋮</b> › <b>{tr('Linked devices')}</b>.
      </p>
    </div>
  );
}

function Help() {
  return (
    <div className="devnote">
      <p>
        <b>{tr('PakChat Web')}</b>{tr(', version')}{' '}{__APP_VERSION__}
      </p>
      <p>{tr('Your messages are end-to-end encrypted. They\'re kept in this browser\'s own storage, locked to this computer, and never readable by PakChat\'s server.')}</p>
    </div>
  );
}

function showShortcuts() {
  const id: number = openLayer(
    <Dialog title={tr('Keyboard shortcuts')} wide onClose={() => closeLayer(id)} buttons={[{ label: tr('OK'), fill: true }]}>
      <div className="keys">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label} className="krow">
            <span>{label}</span>
            <span>
              {keys.split('+').map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Dialog>,
    true,
  );
}
