// NewChat.tsx: "New chat" and "New group", sliding over the chat list like
// WhatsApp Web's. The people come from the phone's contacts.

import { useMemo, useState } from 'react';

import { core, openChat } from '../core/core';
import { Avatar, photoOf } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/overlay';
import { setView } from '../ui/view';
import { tr } from '../i18n';

type Person = { id: string; name: string; about: string };

export function usePeopleList(q: string): Person[] {
  return useMemo(() => {
    const words = q.trim().toLowerCase();
    return Object.entries(core.contacts)
      .filter(([id]) => id !== core.myId)
      .map(([id, c]) => ({ id, name: c.name, about: core.people[id]?.about ?? c.phone ?? c.email ?? '' }))
      .filter((p) => !words || p.name.toLowerCase().includes(words) || p.about.toLowerCase().includes(words))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q]);
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sh slide">
      <button className="ib" onClick={onBack} aria-label={tr('Back')}>
        <Icon name="back" size={22} />
      </button>
      <span>{title}</span>
    </header>
  );
}

function SearchBox({ q, setQ, placeholder }: { q: string; setQ: (q: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" size={20} />
      <input autoFocus value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
    </label>
  );
}

async function message(userId: string) {
  try {
    const chat = await core.client.openDirect(userId);
    setView({ side: null });
    openChat(chat.id);
  } catch {
    toast(tr('Couldn\'t open the chat. Check your internet connection.'));
  }
}

export function NewChat() {
  const [q, setQ] = useState('');
  const people = usePeopleList(q);
  const me = core.client.me;
  return (
    <>
      <Header title={tr('New chat')} onBack={() => setView({ side: null })} />
      <SearchBox q={q} setQ={setQ} placeholder={tr('Search name or number')} />
      <div className="rows scroll list">
        {!q && (
          <button className="row act" onClick={() => setView({ side: 'newGroup' })}>
            <div className="av acc">
              <Icon name="group" size={24} />
            </div>
            <div className="rt">
              <span className="nm">{tr('New group')}</span>
            </div>
          </button>
        )}
        <div className="grp">{tr('Contacts on PakChat')}</div>
        {me && !q && (
          <button className="row" onClick={() => void message(me.userId)}>
            <Avatar id={me.userId} name={me.me.name} photo={photoOf(me.userId)} />
            <div className="rt">
              <span className="nm">{me.me.name}{' '}{tr('(You)')}</span>
              <span className="pv">{tr('Message yourself')}</span>
            </div>
          </button>
        )}
        {people.map((p) => (
          <button key={p.id} className="row" onClick={() => void message(p.id)}>
            <Avatar id={p.id} name={p.name} photo={photoOf(p.id)} />
            <div className="rt">
              <span className="nm">{p.name}</span>
              <span className="pv">{p.about}</span>
            </div>
          </button>
        ))}
        {people.length === 0 && <p className="none">{q ? `No results found for "${q}"` : 'Contacts you save on your phone show here.'}</p>}
      </div>
    </>
  );
}

export function NewGroup() {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const [step, setStep] = useState<'people' | 'name'>('people');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const people = usePeopleList(q);

  if (step === 'name') {
    return (
      <>
        <Header title={tr('New group')} onBack={() => setStep('people')} />
        <div className="ngname">
          <div className="av t1 big">
            <Icon name="group" size={56} />
          </div>
          <input autoFocus className="line" maxLength={100} placeholder={tr('Group subject')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="pv">{picked.map((p) => p.name).join(', ')}</p>
          <button
            className="go"
            disabled={!title.trim() || busy}
            aria-label={tr('Create group')}
            onClick={() => {
              setBusy(true);
              core.client
                .createGroup(title.trim(), picked.map((p) => p.id))
                .then((chat) => {
                  setView({ side: null });
                  openChat(chat.id);
                })
                .catch(() => {
                  setBusy(false);
                  toast(tr('Couldn\'t create the group. Check your internet connection.'));
                });
            }}
          >
            <Icon name="check" size={26} stroke={2.4} />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={tr('Add group members')} onBack={() => setView({ side: 'newChat' })} />
      {picked.length > 0 && (
        <div className="picked">
          {picked.map((p) => (
            <button key={p.id} className="pchip" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>
              <Avatar id={p.id} name={p.name} photo={photoOf(p.id)} size={24} />
              {p.name}
              <Icon name="close" size={14} />
            </button>
          ))}
        </div>
      )}
      <SearchBox q={q} setQ={setQ} placeholder={tr('Search name or number')} />
      <div className="rows scroll list">
        {people.map((p) => {
          const on = picked.some((x) => x.id === p.id);
          return (
            <button key={p.id} className="row" onClick={() => setPicked(on ? picked.filter((x) => x.id !== p.id) : [...picked, p])}>
              <Avatar id={p.id} name={p.name} photo={photoOf(p.id)} />
              <div className="rt">
                <span className="nm">{p.name}</span>
                <span className="pv">{p.about}</span>
              </div>
              <span className={`chk ${on ? '' : 'off'}`}>{on && <Icon name="check" size={13} stroke={3} />}</span>
            </button>
          );
        })}
      </div>
      {picked.length > 0 && (
        <button className="go" aria-label={tr('Next')} onClick={() => setStep('name')}>
          <Icon name="forwardArrow" size={26} stroke={2.4} />
        </button>
      )}
    </>
  );
}
