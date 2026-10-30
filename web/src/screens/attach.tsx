// attach.tsx: the + menu's other items, like WhatsApp Web's: Camera (a photo
// from the computer's camera), Contact, Poll and Event.

import type { Chat, SharedContact } from '@pakchat/shared';
import { useEffect, useRef, useState } from 'react';

import { core } from '../core/core';
import { Avatar, photoOf } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { closeLayer, Dialog, openLayer, toast } from '../ui/overlay';
import { setView } from '../ui/view';

const MAX_OPTIONS = 12;

// ---- Camera ----

/** The computer's camera, full screen: take a photo, then it goes to the send preview. */
export function openCamera() {
  const id: number = openLayer(<Camera onClose={() => closeLayer(id)} />, true);
}

function Camera({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    // A mirror, like the preview, so the photo looks the way you saw it.
    const g = c.getContext('2d')!;
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        onClose();
        setView({ files: [new File([blob], `Photo ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jpg`, { type: 'image/jpeg' })] });
      },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <div className="camera" role="dialog" aria-label="Take photo">
      <div className="cambar">
        <button className="ib" onClick={onClose} aria-label="Close">
          <Icon name="close" size={24} />
        </button>
        <span>Take photo</span>
      </div>
      {failed ? (
        <p className="camfail">Allow PakChat to use your camera in your browser, then try again.</p>
      ) : (
        <video ref={video} autoPlay playsInline muted />
      )}
      {!failed && (
        <button className="snap" onClick={snap} aria-label="Take photo">
          <Icon name="camera" size={28} />
        </button>
      )}
    </div>
  );
}

// ---- Contact ----

/** Pick saved contacts to send as cards. */
export function sendContact(chat: Chat) {
  const id: number = openLayer(<ContactPicker chat={chat} onClose={() => closeLayer(id)} />, true);
}

function ContactPicker({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const all = Object.entries(core.contacts).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const words = q.trim().toLowerCase();
  const shown = all.filter(([, c]) => !words || c.name.toLowerCase().includes(words) || (c.phone ?? '').includes(words));
  async function send() {
    const cards: SharedContact[] = picked.map((uid) => {
      const c = core.contacts[uid];
      return { name: c.name, phones: c.phone ? [c.phone] : [], ...(c.email ? { emails: [c.email] } : {}), user: uid };
    });
    await core.client.sendContacts(chat.id, cards).catch(() => toast("Couldn't send. Try again."));
  }
  return (
    <Dialog title="Send contacts" wide onClose={onClose} buttons={[{ label: 'Cancel' }, { label: 'Send', fill: true, disabled: !picked.length, run: () => void send() }]}>
      <label className="search">
        <Icon name="search" size={20} />
        <input autoFocus value={q} placeholder="Search name or number" onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="fl scroll pick">
        {shown.length === 0 && <p className="none">{all.length ? 'No contacts found' : 'Contacts you save on your phone show here'}</p>}
        {shown.map(([uid, c]) => {
          const on = picked.includes(uid);
          return (
            <button key={uid} className="row" onClick={() => setPicked(on ? picked.filter((x) => x !== uid) : [...picked, uid])}>
              <span className={`chk ${on ? '' : 'off'}`}>{on && <Icon name="check" size={13} stroke={3} />}</span>
              <Avatar id={uid} name={c.name} photo={photoOf(uid)} />
              <div className="rt">
                <span className="nm">{c.name}</span>
                <span className="pv">{c.phone ?? c.email ?? ''}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

// ---- Poll ----

/** "Create poll": a question, 2 to 12 options, and "Allow multiple answers". */
export function sendPoll(chat: Chat) {
  const id: number = openLayer(<PollMaker chat={chat} onClose={() => closeLayer(id)} />, true);
}

function PollMaker({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(true);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ok = question.trim().length > 0 && filled.length >= 2 && new Set(filled).size === filled.length;
  const change = (i: number, v: string) => {
    const next = options.map((o, j) => (j === i ? v : o));
    // A new empty box appears under the last one once it's typed in, like WhatsApp.
    if (i === next.length - 1 && v.trim() && next.length < MAX_OPTIONS) next.push('');
    setOptions(next);
  };
  return (
    <Dialog
      title="Create poll"
      onClose={onClose}
      buttons={[
        { label: 'Cancel' },
        { label: 'Send', fill: true, disabled: !ok, run: () => void core.client.sendPoll(chat.id, question.trim(), filled, multi).catch(() => toast("Couldn't send. Try again.")) },
      ]}
    >
      <label className="flab">Question</label>
      <input className="dinput" autoFocus maxLength={255} placeholder="Ask question" value={question} onChange={(e) => setQuestion(e.target.value)} />
      <label className="flab">Options</label>
      {options.map((o, i) => (
        <input key={i} className="dinput opt" maxLength={100} placeholder="+ Add" value={o} onChange={(e) => change(i, e.target.value)} />
      ))}
      {filled.length !== new Set(filled).size && <p className="ferr">Each option must be different</p>}
      <label className="switchrow">
        <span>Allow multiple answers</span>
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
      </label>
    </Dialog>
  );
}

// ---- Event ----

/** "Create event": a name, when, and optionally where and a note. */
export function sendEvent(chat: Chat) {
  const id: number = openLayer(<EventMaker chat={chat} onClose={() => closeLayer(id)} />, true);
}

const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function EventMaker({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const soon = Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000;
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(localInput(soon));
  const [place, setPlace] = useState('');
  const [about, setAbout] = useState('');
  const at = new Date(when).getTime();
  const ok = title.trim().length > 0 && Number.isFinite(at) && at > Date.now();
  async function send() {
    await core.client
      .sendPlan(chat.id, { title: title.trim(), at, video: false, general: true, ...(place.trim() ? { place: place.trim() } : {}), ...(about.trim() ? { about: about.trim() } : {}) })
      .catch(() => toast("Couldn't send. Try again."));
  }
  return (
    <Dialog title="Create event" onClose={onClose} buttons={[{ label: 'Cancel' }, { label: 'Send', fill: true, disabled: !ok, run: () => void send() }]}>
      <input className="dinput" autoFocus maxLength={100} placeholder="Event name" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="flab">Date and time</label>
      <input className="dinput" type="datetime-local" value={when} min={localInput(Date.now())} onChange={(e) => setWhen(e.target.value)} />
      {Number.isFinite(at) && at <= Date.now() && <p className="ferr">Pick a time in the future</p>}
      <input className="dinput" maxLength={200} placeholder="Location (optional)" value={place} onChange={(e) => setPlace(e.target.value)} />
      <textarea className="dinput" rows={3} maxLength={2000} placeholder="Description (optional)" value={about} onChange={(e) => setAbout(e.target.value)} />
    </Dialog>
  );
}
