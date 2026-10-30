// Status.tsx: the Status tab. Everyone's updates from the last 24 hours,
// newest first; click one to watch, reply or ❤️ it. "+" posts one: words on a
// colour, or a photo or video with a caption, like WhatsApp Web.

import { type Chat, type Message, statusOwner } from '@pakchat/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { core } from '../core/core';
import { useLoaded } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { clock, dayLabel, memberName } from '../ui/format';
import { Icon, StatusIcon } from '../ui/Icon';
import { openMenu, toast } from '../ui/overlay';

const STATUS_BG = ['#2F6BF0', '#7C3AED', '#DB2777', '#E11D48', '#EA580C', '#B45309', '#16A34A', '#0D9488', '#0891B2', '#4F46E5', '#334155', '#9333EA'];
const SHOW_MS = 5_000;

type Person = { chat: Chat; owner: string; items: Message[]; latest: number; seen: boolean };

/**
 * My status chat, ready to post in. Who sees it is set on the phone (Settings › Status
 * privacy), so a chat I have already keeps its audience; the first one goes to all my contacts.
 */
async function readyMyStatus(): Promise<Chat> {
  const mine = await core.client.myStatus();
  if (mine) return mine;
  return core.client.setStatusAudience(Object.keys(core.contacts).filter((id) => id !== core.myId));
}

async function loadStatuses(): Promise<{ mine: Person | null; others: Person[] }> {
  const now = Date.now();
  let mine: Person | null = null;
  const others: Person[] = [];
  for (const chat of (await core.storage.listChats()).filter((c) => c.kind === 'status')) {
    const owner = statusOwner(chat);
    if (!owner) continue;
    const items = (await core.storage.listMessages(chat.id, { limit: 100 })).filter((m) => m.kind !== 'system' && !m.deleted && m.author === owner && (!m.expiresAt || m.expiresAt > now));
    const p = { chat, owner, items, latest: items.at(-1)?.sentAt ?? 0, seen: items.every((m) => m.seq !== null && m.seq <= chat.readUpTo) };
    if (owner === core.myId) mine = p;
    else if (items.length) others.push(p);
  }
  others.sort((a, b) => b.latest - a.latest);
  return { mine, others };
}

export function StatusPanel() {
  const data = useLoaded(['chats', 'people'], loadStatuses, [], { mine: null, others: [] });
  const [watching, setWatching] = useState<Person | null>(null);
  const [writing, setWriting] = useState(false);
  const [posting, setPosting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const me = core.client.me!;

  const addMenu = (x: number, y: number) =>
    openMenu(
      [
        { label: 'Photos & videos', icon: 'photo', run: () => file.current?.click() },
        { label: 'Text', icon: 'edit', run: () => setWriting(true) },
      ],
      x,
      y,
    );

  async function postFile(f: File) {
    if (!/^(image|video)\//.test(f.type)) return toast('Only photos and videos can be a status');
    setPosting(true);
    try {
      const chat = await readyMyStatus();
      await core.sendFiles(chat.id, [f]);
      toast('Status posted');
    } catch {
      toast("Couldn't post your status. Check your internet connection.");
    } finally {
      setPosting(false);
    }
  }
  const recent = data.others.filter((p) => !p.seen);
  const viewed = data.others.filter((p) => p.seen);

  const row = (p: Person) => (
    <button key={p.chat.id} className="row" onClick={() => setWatching(p)}>
      <span className={`ring ${p.seen ? 'seen' : ''}`}>
        <Avatar id={p.owner} name={memberName(p.owner)} photo={photoOf(p.owner)} />
      </span>
      <div className="rt">
        <span className="nm">{p.owner === core.myId ? 'My status' : memberName(p.owner)}</span>
        <span className="pv">
          {dayLabel(p.latest)} at {clock(p.latest)}
        </span>
      </div>
    </button>
  );

  return (
    <>
      <header className="lh">
        <span className="ptitle">Status</span>
        <div className="grow" />
        <button className="ib" aria-label="Add status" data-tip="Add status" disabled={posting} onClick={(e) => addMenu(e.clientX, e.clientY)}>
          <Icon name="plus" size={22} />
        </button>
      </header>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void postFile(f);
        }}
      />
      <div className="rows scroll list">
        {data.mine?.items.length ? (
          row(data.mine)
        ) : (
          <button className="row" onClick={(e) => addMenu(e.clientX, e.clientY)}>
            <span className="stadd">
              <Avatar id={me.userId} name={me.me.name} photo={photoOf(me.userId)} />
              <i>
                <Icon name="plus" size={12} stroke={3} />
              </i>
            </span>
            <div className="rt">
              <span className="nm">My status</span>
              <span className="pv">{posting ? 'Posting…' : 'Click to add status update'}</span>
            </div>
          </button>
        )}
        {recent.length > 0 && <div className="grp">Recent</div>}
        {recent.map(row)}
        {viewed.length > 0 && <div className="grp">Viewed</div>}
        {viewed.map(row)}
        {data.others.length === 0 && (
          <div className="none big">
            <StatusIcon size={48} stroke={1.4} />
            <p>Status updates from your contacts show here for 24 hours.</p>
          </div>
        )}
      </div>
      {writing && <TextStatus onClose={() => setWriting(false)} />}
      {watching && (
        <StatusViewer
          people={[...(data.mine?.items.length ? [data.mine] : []), ...recent, ...viewed]}
          start={watching}
          onClose={() => setWatching(null)}
        />
      )}
    </>
  );
}

/** A status in words, on a colour: click the palette for the next colour. */
function TextStatus({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(0);
  const [busy, setBusy] = useState(false);

  async function send() {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    try {
      const chat = await readyMyStatus();
      await core.client.sendText(chat.id, words, { bg });
      toast('Status posted');
      onClose();
    } catch {
      setBusy(false);
      toast("Couldn't post your status. Check your internet connection.");
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);

  return createPortal(
    <div className="stview stnew" role="dialog" aria-modal style={{ background: STATUS_BG[bg] }}>
      <div className="sttop">
        <button className="ib" onClick={onClose} aria-label="Close">
          <Icon name="close" size={24} />
        </button>
        <div className="grow" />
        <button className="ib" onClick={() => setBg((bg + 1) % STATUS_BG.length)} aria-label="Colour" data-tip="Colour">
          <Icon name="palette" size={22} />
        </button>
      </div>
      <textarea autoFocus maxLength={700} placeholder="Type a status" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="stsend">
        <span>Your contacts can see it for 24 hours</span>
        <button className="send" disabled={!text.trim() || busy} onClick={() => void send()} aria-label="Send">
          <Icon name="send" size={22} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function StatusViewer({ people, start, onClose }: { people: Person[]; start: Person; onClose: () => void }) {
  const [who, setWho] = useState(Math.max(0, people.findIndex((p) => p.chat.id === start.chat.id)));
  const p = people[who];
  const firstUnseen = p.items.findIndex((m) => m.seq !== null && m.seq > p.chat.readUpTo);
  const [i, setI] = useState(firstUnseen >= 0 ? firstUnseen : 0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const m = p.items[Math.min(i, p.items.length - 1)];

  const next = () => {
    if (i < p.items.length - 1) setI(i + 1);
    else if (who < people.length - 1) {
      setWho(who + 1);
      setI(0);
    } else onClose();
  };
  const prev = () => {
    if (i > 0) setI(i - 1);
    else if (who > 0) {
      setWho(who - 1);
      setI(0);
    }
  };

  // Seen: up to this one.
  useEffect(() => {
    if (m?.seq != null && p.owner !== core.myId && m.seq > p.chat.readUpTo) void core.client.markRead(p.chat.id, m.seq);
    setProgress(0);
  }, [m, p]);

  // Photos and words show for 5 seconds; videos play to their end.
  useEffect(() => {
    if (paused || m?.file?.kind === 'video') return;
    const started = Date.now() - progress * SHOW_MS;
    const id = setInterval(() => {
      const t = (Date.now() - started) / SHOW_MS;
      if (t >= 1) next();
      else setProgress(t);
    }, 50);
    return () => clearInterval(id);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [m, paused]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  const url = useLoaded<string | null>([], async () => (m?.file ? core.fileUrl(m.file) : null), [m?.id], null);
  if (!m) return null;

  async function send() {
    const text = reply.trim();
    if (!text) return;
    setReply('');
    try {
      const chat = await core.client.openDirect(m.author);
      const kind = m.file ? (m.file.kind === 'video' ? 'video' : 'image') : 'text';
      await core.client.sendText(chat.id, text, { status: { author: m.author, id: m.id, kind, ...(m.text ? { text: m.text.slice(0, 700) } : {}), ...(m.file?.thumb ? { thumb: m.file.thumb } : {}) } });
      toast('Reply sent');
    } catch {
      toast("Couldn't send. Try again.");
    }
  }

  return createPortal(
    <div className="stview" role="dialog" aria-modal>
      <div className="stbars">
        {p.items.map((x, j) => (
          <span key={x.id}>
            <i style={{ width: `${j < i ? 100 : j === i ? progress * 100 : 0}%` }} />
          </span>
        ))}
      </div>
      <div className="sttop">
        <Avatar id={p.owner} name={memberName(p.owner)} photo={photoOf(p.owner)} size={40} />
        <div>
          <b>{p.owner === core.myId ? 'My status' : memberName(p.owner)}</b>
          <span>
            {dayLabel(m.sentAt)} at {clock(m.sentAt)}
          </span>
        </div>
        <div className="grow" />
        <button className="ib" onClick={() => setPaused(!paused)} aria-label={paused ? 'Play' : 'Pause'}>
          <Icon name={paused ? 'play' : 'pause'} size={22} />
        </button>
        <button className="ib" onClick={onClose} aria-label="Close">
          <Icon name="close" size={24} />
        </button>
      </div>
      <button className="stnav l" onClick={prev} aria-label="Previous">
        <Icon name="back" size={24} />
      </button>
      <div className="stbody">
        {m.file ? (
          m.file.kind === 'video' ? (
            url && <video ref={video} src={url} autoPlay onEnded={next} onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))} />
          ) : url ? (
            <img src={url} alt="" />
          ) : m.file.thumb ? (
            <img className="blur" src={`data:image/jpeg;base64,${m.file.thumb}`} alt="" />
          ) : null
        ) : (
          <div className="sttext" style={{ background: STATUS_BG[(m.bg ?? 0) % STATUS_BG.length] }}>
            {m.text}
          </div>
        )}
        {m.file && m.text && <div className="stcap">{m.text}</div>}
      </div>
      <button className="stnav r" onClick={next} aria-label="Next">
        <Icon name="forwardArrow" size={24} />
      </button>
      {p.owner !== core.myId && (
        <div className="streply">
          <input
            value={reply}
            placeholder="Type a reply…"
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
          />
          <button
            className="ib"
            aria-label="Like"
            onClick={() => void core.client.react(m.chatId, { author: m.author, id: m.id }, m.reactions?.[core.myId] ? null : '❤️')}
          >
            {m.reactions?.[core.myId] ? '❤️' : <Icon name="heart" size={22} />}
          </button>
          <button className="send" onClick={() => void send()} aria-label="Send">
            <Icon name="send" size={20} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
