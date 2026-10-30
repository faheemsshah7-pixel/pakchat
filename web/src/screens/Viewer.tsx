// Viewer.tsx: the photo and video viewer, over everything. ← and → go
// through the chat's photos and videos, Esc closes; the strip at the bottom
// shows the ones around it.

import type { Chat, Message } from '@pakchat/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { core } from '../core/core';
import { useLoaded } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { clock, dayLabel, memberName } from '../ui/format';
import { Icon } from '../ui/Icon';
import { msgKey, setView } from '../ui/view';
import { download } from './messageActions';
import { forward } from './dialogs';

const isMedia = (m: Message) => !m.deleted && m.kind === 'file' && !!m.file && (m.file.kind === 'image' || m.file.kind === 'video') && !m.file.once && m.file.id !== 'pending';

export function Viewer({ chat, start, onClose }: { chat: Chat; start: Message; onClose: () => void }) {
  const all = useLoaded<Message[]>([`messages:${chat.id}`], async () => (await core.storage.listMessages(chat.id, { limit: 100_000 })).filter(isMedia), [chat.id], [start]);
  const [key, setKey] = useState(msgKey(start));
  const i = Math.max(0, all.findIndex((m) => msgKey(m) === key));
  const m = all[i] ?? start;

  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && i > 0) setKey(msgKey(all[i - 1]));
      if (e.key === 'ArrowRight' && i < all.length - 1) setKey(msgKey(all[i + 1]));
    };
    addEventListener('keydown', keyDown);
    return () => removeEventListener('keydown', keyDown);
  }, [i, all, onClose]);

  const strip = all.slice(Math.max(0, i - 6), i + 7);
  return createPortal(
    <div className="viewer" role="dialog" aria-modal>
      <div className="vbar">
        <Avatar id={m.author} name={memberName(m.author)} photo={photoOf(m.author)} />
        <div className="vw">
          <b>{m.author === core.myId ? 'You' : memberName(m.author)}</b>
          <span>
            {dayLabel(m.sentAt)} at {clock(m.sentAt)}
          </span>
        </div>
        <div className="grow" />
        <button
          className="ib"
          aria-label="Go to message"
          data-tip="Go to message"
          onClick={() => {
            onClose();
            setView({ jumpTo: msgKey(m) });
          }}
        >
          <Icon name="chat" size={22} />
        </button>
        <button className="ib" aria-label="Star" onClick={() => void core.toggleStar(m)}>
          <Icon name={core.starred[msgKey(m)] ? 'starFilled' : 'star'} size={22} />
        </button>
        <button className="ib" aria-label="Forward" onClick={() => forward([m])}>
          <Icon name="forward" size={22} />
        </button>
        <button className="ib" aria-label="Download" onClick={() => void download(m)}>
          <Icon name="download2" size={22} />
        </button>
        <button className="ib" style={{ marginLeft: 12 }} aria-label="Close" onClick={onClose}>
          <Icon name="close" size={24} />
        </button>
      </div>
      <div className="vstage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {i > 0 && (
          <button className="varr" style={{ left: 28 }} onClick={() => setKey(msgKey(all[i - 1]))} aria-label="Previous">
            <Icon name="back" size={24} />
          </button>
        )}
        <Big m={m} />
        {m.text && <div className="vcap">{m.text}</div>}
        {i < all.length - 1 && (
          <button className="varr" style={{ right: 28 }} onClick={() => setKey(msgKey(all[i + 1]))} aria-label="Next">
            <Icon name="forwardArrow" size={24} />
          </button>
        )}
      </div>
      <div className="vstrip">
        {strip.map((s) => (
          <button key={msgKey(s)} className={msgKey(s) === msgKey(m) ? 'on' : ''} onClick={() => setKey(msgKey(s))}>
            {s.file?.thumb ? <img src={`data:image/jpeg;base64,${s.file.thumb}`} alt="" /> : <Icon name={s.file?.kind === 'video' ? 'video' : 'photo'} size={20} />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function Big({ m }: { m: Message }) {
  const f = m.file!;
  const [url, setUrl] = useState<string | null>(() => core.knownFile(f.id));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setUrl(core.knownFile(f.id));
    let alive = true;
    core
      .fileUrl(f)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [f]);
  if (failed) return <div className="vimg msg">This file is no longer on the server. Ask the sender to send it again.</div>;
  if (!url) return <div className="vimg">{f.thumb ? <img className="blur" src={`data:image/jpeg;base64,${f.thumb}`} alt="" /> : null}<span className="spin over" /></div>;
  return <div className="vimg">{f.kind === 'video' ? <video src={url} controls autoPlay loop={!!f.gif} muted={!!f.gif} /> : <img src={url} alt="" />}</div>;
}
