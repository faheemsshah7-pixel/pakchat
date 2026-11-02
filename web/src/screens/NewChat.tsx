// NewChat.tsx: "New chat" and "New group", sliding over the chat list like
// WhatsApp Web's. The people come from the phone's contacts. Typing a number
// (03xx… or +92…) checks whether it's on PakChat, as the phone app does, and
// "New contact" saves someone by their number (owner, 1 Nov).

import { normalizePhone } from '@pakchat/shared';
import { useEffect, useMemo, useState } from 'react';

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

/** Only digits (and + - ( ) spaces), and enough of them: a phone number. */
const looksLikeNumber = (q: string) => /^[+0-9][0-9\s\-()]{6,}$/.test(q.trim());

/** Is this typed number on PakChat? (undefined while checking or not a number; null if not on it.) */
function useNumberCheck(q: string) {
  const phone = looksLikeNumber(q) ? normalizePhone(q.trim()) : null;
  const [found, setFound] = useState<{ phone: string; person: { id: string; name: string } | null }>();
  useEffect(() => {
    if (!phone) return;
    let live = true;
    // A moment after the typing stops, not on every key.
    const wait = setTimeout(() => {
      core
        .lookup(phone)
        .then((p) => live && setFound({ phone, person: p }))
        .catch(() => live && setFound({ phone, person: null }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [phone]);
  return { phone, result: found && found.phone === phone ? found : undefined };
}

export function NewChat() {
  const [q, setQ] = useState('');
  const people = usePeopleList(q);
  const me = core.client.me;
  const { phone, result } = useNumberCheck(q);
  const person = result?.person ?? null;
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
        {!q && (
          <button className="row act" onClick={() => setView({ side: 'newContact' })}>
            <div className="av acc">
              <Icon name="userPlus" size={24} />
            </div>
            <div className="rt">
              <span className="nm">{tr('New contact')}</span>
            </div>
          </button>
        )}
        {/* A typed number: who it is on PakChat (with Message), or that they aren't on it. */}
        {phone && !result && <p className="none">{tr('Checking if they\'re on PakChat…')}</p>}
        {phone && person && person.id !== me?.userId && (
          <>
            <button className="row" onClick={() => void message(person.id)}>
              <Avatar id={person.id} name={core.nameOf(person.id) || person.name} photo={photoOf(person.id)} />
              <div className="rt">
                <span className="nm">{core.nameOf(person.id) || person.name}</span>
                <span className="pv">{tr('Message')}</span>
              </div>
            </button>
            {!core.isContact(person.id) && (
              <button className="row act" onClick={() => setView({ side: 'newContact', contactPhone: phone })}>
                <div className="av acc">
                  <Icon name="userPlus" size={24} />
                </div>
                <div className="rt">
                  <span className="nm">{tr('Add to contacts')}</span>
                </div>
              </button>
            )}
          </>
        )}
        {phone && result && !person && <p className="none">{tr('This number isn\'t on PakChat.')}</p>}
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
        {people.length === 0 && !phone && <p className="none">{q ? `No results found for "${q}"` : 'Contacts you save on your phone show here.'}</p>}
      </div>
    </>
  );
}

/** A new contact's number starts with +92 already there; a 0 after it (or a local 03…) loses the 0, like WhatsApp. */
function typedPhone(text: string) {
  const t = text.replace(/^\s+/, '');
  if (/^0(?!0)/.test(t)) return '+92 ' + t.slice(1);
  const after = /^\+92\s*0+(.*)$/.exec(t);
  return after ? '+92 ' + after[1] : t;
}

/** "New contact": a name and a number, checked with PakChat, then saved (on the phone too). */
export function NewContact({ phone: given }: { phone?: string | null }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState(given ? typedPhone(given) : '+92 ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = [first.trim(), last.trim()].filter(Boolean).join(' ');
  const clean = normalizePhone(phone.trim());

  async function save() {
    if (!name || busy) return;
    if (!clean) return setError(tr('That doesn\'t look like a phone number.'));
    setBusy(true);
    setError('');
    try {
      const found = await core.lookup(clean);
      if (!found) return setError(tr('This number isn\'t on PakChat.'));
      if (found.id === core.myId) return setError(tr('That\'s your own number.'));
      core.saveContact(found.id, { name, phone: clean });
      toast(tr('Contact saved'));
      setView({ side: 'newChat', contactPhone: null });
    } catch {
      setError(tr('Couldn\'t check the number. Check your internet connection.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header title={tr('New contact')} onBack={() => setView({ side: 'newChat', contactPhone: null })} />
      <form
        className="ngname"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="av t1 big">
          <Icon name="userPlus" size={56} />
        </div>
        <input autoFocus className="line" maxLength={30} placeholder={tr('First name')} value={first} onChange={(e) => setFirst(e.target.value)} />
        <input className="line" maxLength={30} placeholder={tr('Last name')} value={last} onChange={(e) => setLast(e.target.value)} />
        <input className="line" inputMode="tel" placeholder={tr('Phone')} value={phone} onChange={(e) => (setPhone(typedPhone(e.target.value)), setError(''))} />
        {!!error && <p className="pv">{error}</p>}
        <button type="submit" className="go" disabled={!name || !clean || busy} aria-label={tr('Save')}>
          <Icon name="check" size={26} stroke={2.4} />
        </button>
      </form>
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
