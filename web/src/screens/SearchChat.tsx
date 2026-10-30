// SearchChat.tsx: "Search messages" in the open chat (the header's 🔍, or
// Ctrl+Shift+F). Newest first; click one to go to it. The calendar jumps to
// the first message on a day, like WhatsApp Web.

import type { Message } from '@pakchat/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { core } from '../core/core';
import { useLoaded } from '../core/hooks';
import { clock, listTime, memberName } from '../ui/format';
import { Icon } from '../ui/Icon';
import { plainText } from '../ui/richText';
import { toast } from '../ui/overlay';
import { msgKey, setView } from '../ui/view';

export function SearchChat({ chatId }: { chatId: string }) {
  const [q, setQ] = useState('');
  const [words, setWords] = useState('');
  const day = useRef<HTMLInputElement>(null);
  // No days after today.
  const [max] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  useEffect(() => {
    const id = setTimeout(() => setWords(q.trim().toLowerCase()), 150);
    return () => clearTimeout(id);
  }, [q]);

  const all = useLoaded<Message[]>([`messages:${chatId}`], () => core.storage.listMessages(chatId, { limit: 100_000 }), [chatId], []);
  const found = useMemo(() => {
    if (!words) return [];
    return all
      .filter((m) => !m.deleted && !m.file?.once && m.text && plainText(m.text).toLowerCase().includes(words))
      .reverse()
      .slice(0, 200);
  }, [all, words]);

  // The first message on or after the day picked.
  const jumpToDay = (value: string) => {
    const [y, mo, d] = value.split('-').map(Number);
    if (!y || !mo || !d) return;
    const from = new Date(y, mo - 1, d).getTime();
    const m = all.find((x) => x.kind !== 'system' && !x.deleted && x.sentAt >= from);
    if (m) setView({ jumpTo: msgKey(m) });
    else toast('No messages on or after that day');
  };

  return (
    <>
      <div className="dh">
        <button className="ib" onClick={() => setView({ drawer: null })} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
        Search messages
      </div>
      <div className="ssrow">
        <label className="search ss">
          <Icon name="search" size={20} />
          <input autoFocus value={q} placeholder="Search…" onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="ib" aria-label="Go to date" data-tip="Go to date" onClick={() => (day.current && 'showPicker' in day.current ? day.current.showPicker() : day.current?.click())}>
          <Icon name="calendar" size={22} />
        </button>
        <input ref={day} className="dpick" type="date" max={max} tabIndex={-1} aria-hidden onChange={(e) => e.target.value && jumpToDay(e.target.value)} />
      </div>
      <div className="db scroll">
        {!words && <p className="none">Search for messages in this chat.</p>}
        {words && found.length === 0 && <p className="none">No messages found</p>}
        {found.map((m) => (
          <button key={msgKey(m)} className="hit" onClick={() => setView({ jumpTo: msgKey(m) })}>
            <small>
              {listTime(m.sentAt)} · {clock(m.sentAt)}
            </small>
            <span>
              {m.author === core.myId ? <Icon name="ticks" size={16} /> : <b>{memberName(m.author)}: </b>}
              <Highlight text={plainText(m.text!)} words={words} />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function Highlight({ text, words }: { text: string; words: string }) {
  const i = text.toLowerCase().indexOf(words);
  if (i < 0) return <>{text}</>;
  const from = Math.max(0, i - 40);
  return (
    <>
      {from > 0 && '…'}
      {text.slice(from, i)}
      <mark>{text.slice(i, i + words.length)}</mark>
      {text.slice(i + words.length, i + words.length + 120)}
    </>
  );
}
