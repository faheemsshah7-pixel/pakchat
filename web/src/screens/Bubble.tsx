// Bubble.tsx: one message in a chat, drawn like WhatsApp Web's: the tail on
// the first of a run, the time and ticks in the corner, the hover chevron and
// react button, reactions underneath.

import { forwardedMany, type Chat, type Message } from '@pakchat/shared';
import { memo, useEffect, useRef, useState } from 'react';

import { core, openChat } from '../core/core';
import { useLoaded } from '../core/hooks';
import { bodyLine, chatTitle, clock, duration, fileSize, fileWord, groupName, hash, memberName, systemText } from '../ui/format';
import { Icon, Tail } from '../ui/Icon';
import { closeLayer, openLayer, openMenu, usePlace } from '../ui/overlay';
import { emojiOnly, parseRich, plainText, readMoreCut, type Span } from '../ui/richText';
import { Ticks } from '../ui/Ticks';
import { msgKey, setView, toggleSelected } from '../ui/view';
import { download, messageMenu, QUICK_REACTIONS, react } from './messageActions';

// Group members' names, each in its own colour (like WhatsApp's).
const NAME_COLOURS = ['#1F7AEC', '#C2185B', '#7B1FA2', '#00897B', '#E65100', '#5D4037', '#3949AB', '#2E7D32'];

/** `selected`: ticked (true) or not (false) while selecting messages; null when not selecting. */
type Props = { m: Message; chat: Chat; first: boolean; canSend: boolean; flash: boolean; selected: boolean | null; openViewer: (m: Message) => void };

export const Bubble = memo(function Bubble({ m, chat, first, canSend, flash, selected, openViewer }: Props) {
  const mine = m.author === core.myId;
  const group = chat.kind === 'group';
  const side = mine ? 'out' : 'in';
  const row = useRef<HTMLDivElement>(null);

  // "React" from the menu opens the bar on this bubble.
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== msgKey(m) || !row.current) return;
      const r = row.current.querySelector('.bub')!.getBoundingClientRect();
      reactBar(m, mine ? r.right : r.left, r.top - 8, mine);
    };
    addEventListener('pakchat:react', on);
    return () => removeEventListener('pakchat:react', on);
  }, [m, mine]);

  if (m.kind === 'system') {
    const text = systemText(m);
    return text ? (
      <div className="day sys">
        <span>{text}</span>
      </div>
    ) : null;
  }

  const sticker = m.file?.kind === 'sticker' && !m.deleted;
  const media = !m.deleted && (m.file?.kind === 'image' || m.file?.kind === 'video') && !m.file.once;
  const big = !m.deleted && m.kind === 'text' && !m.replyTo ? emojiOnly(m.text ?? '') : 0;

  const menu = (x: number, y: number) => openMenu(messageMenu(m, { group, canSend }), x, y, { cls: 'msgm' });

  return (
    <div
      ref={row}
      className={`mrow ${side} ${first ? 'first' : ''} ${m.reactions && Object.keys(m.reactions).length ? 'hasrx' : ''} ${flash ? 'flash' : ''} ${selected === null ? '' : 'sel'} ${selected ? 'on' : ''}`}
      data-key={msgKey(m)}
      data-at={m.sentAt}
      // Selecting: a click anywhere on the row ticks it, and nothing else happens.
      onClickCapture={(e) => {
        if (selected === null) return;
        e.preventDefault();
        e.stopPropagation();
        toggleSelected(m);
      }}
      onContextMenu={(e) => {
        if (selected !== null) return e.preventDefault();
        if ((e.target as HTMLElement).closest('a')) return;
        e.preventDefault();
        // Right-click: the menu at the pointer, with the reactions on top.
        openMenu(messageMenu(m, { group, canSend }), e.clientX, e.clientY, { cls: 'msgm', head: canSend ? <QuickReactions m={m} /> : null });
      }}
    >
      {selected !== null && (
        <span className={`chk ${selected ? '' : 'off'}`} aria-label={selected ? 'Selected' : 'Not selected'}>
          {selected && <Icon name="check" size={13} stroke={3} />}
        </span>
      )}
      <div className="bubw">
        <div className={`bub ${side} ${media ? 'media' : ''} ${sticker ? 'stk' : ''} ${big ? 'big' : ''}`}>
          {first && !sticker && <Tail out={mine} />}
          {group && !mine && first && (
            <div className="who3" style={{ color: NAME_COLOURS[hash(m.author) % NAME_COLOURS.length] }}>
              {groupName(m.author)}
            </div>
          )}
          {m.forwarded && !m.deleted && (
            <div className="fwdl">
              <Icon name="forward" size={14} />
              {forwardedMany(m) && <Icon name="forward" size={14} />}
              {forwardedMany(m) ? 'Forwarded many times' : 'Forwarded'}
            </div>
          )}
          <Body m={m} openViewer={openViewer} big={big} />
          {(!media || !!m.text) && !sticker && <Meta m={m} />}
          {!m.deleted && (
            <button
              className="mchev"
              aria-label="Message menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                menu(r.right - 4, r.bottom + 2);
              }}
            >
              <Icon name="down" size={18} stroke={2} />
            </button>
          )}
          <Reactions m={m} />
        </div>
        {!m.deleted && canSend && (
          <button
            className="rbtn"
            aria-label="React"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              reactBar(m, mine ? r.right : r.left, r.top - 8, mine);
            }}
          >
            <Icon name="smile" size={20} />
          </button>
        )}
      </div>
    </div>
  );
});

/** The time, "Edited", a star, and my ticks, in the bubble's corner. */
function Meta({ m, over }: { m: Message; over?: boolean }) {
  return (
    <span className={`meta ${over ? 'over' : ''}`}>
      {m.pinnedUntil && m.pinnedUntil > Date.now() && <Icon name="pin" size={12} />}
      {core.starred[msgKey(m)] && <Icon name="starFilled" size={12} />}
      {m.keptBy && !m.deleted && <span className="ed">Kept</span>}
      {m.editedAt && !m.deleted && <span className="ed">Edited</span>}
      {clock(m.sentAt)}
      {m.author === core.myId && !m.deleted && <Ticks status={m.status} size={16} />}
    </span>
  );
}

function Body({ m, openViewer, big }: { m: Message; openViewer: (m: Message) => void; big: number }) {
  if (m.deleted)
    return (
      <span className="gone">
        <Icon name="block" size={16} /> {m.author === core.myId ? 'You deleted this message' : 'This message was deleted'}
      </span>
    );
  return (
    <>
      {m.replyTo && <Quote m={m} />}
      {m.statusReply && (
        <div className="quote">
          <i />
          <div>
            <b>{memberName(m.statusReply.author)} · Status</b>
            {m.statusReply.text ?? (m.statusReply.kind === 'video' ? 'Video' : 'Photo')}
          </div>
        </div>
      )}
      {m.quote && <PrivateQuote q={m.quote} />}
      {m.kind === 'file' && m.file && <FileBody m={m} openViewer={openViewer} />}
      {m.kind === 'poll' && <Poll m={m} />}
      {m.kind === 'location' && m.location && (
        <a className="loc" href={`https://www.google.com/maps?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noreferrer">
          <span className="pin">
            <Icon name="place" size={28} />
          </span>
          <span>
            <b>{m.location.live ? 'Live location' : (m.location.name ?? 'Location')}</b>
            {m.location.address && <small>{m.location.address}</small>}
            <small className="lnk">Open in Google Maps</small>
          </span>
        </a>
      )}
      {m.kind === 'contact' &&
        m.contacts?.map((c, i) => (
          <div key={i} className="card2">
            <div className="av t2 sm">{c.name.slice(0, 1).toUpperCase()}</div>
            <div>
              <b>{c.name}</b>
              <small>{c.phones.join(', ')}</small>
            </div>
          </div>
        ))}
      {m.kind === 'event' && m.plan && (
        <div className="card2">
          <span className="pin">
            <Icon name="calendar" size={26} />
          </span>
          <div>
            <b>{m.plan.title}</b>
            <small>{new Date(m.plan.at).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</small>
            {m.plan.place && <small>{m.plan.place}</small>}
          </div>
        </div>
      )}
      {m.link && m.text && (
        <a className="lprev" href={m.link.url} target="_blank" rel="noreferrer noopener">
          {m.link.thumb && <img src={`data:image/jpeg;base64,${m.link.thumb}`} alt="" />}
          <span>
            <b>{m.link.title ?? m.link.url}</b>
            {m.link.description && <small>{m.link.description}</small>}
            <small className="site">{m.link.site ?? new URL(m.link.url).hostname}</small>
          </span>
        </a>
      )}
      {m.text && !(m.kind === 'file' && m.file?.once) && <Words text={m.text} big={big} mentions={m.mentions} />}
    </>
  );
}

/** The words, with *bold*, _italic_, ~strike~, `code`, links, bullets and quotes. */
function Words({ text, big, mentions }: { text: string; big: number; mentions?: string[] }) {
  const names = (mentions ?? []).map((id) => `@${core.nameOf(id)}`).filter((n) => n.length > 1);
  const [all, setAll] = useState(false);
  const cut = all ? null : readMoreCut(text);
  const shown = cut == null ? text : text.slice(0, cut);
  return (
    <span className={`txt ${big ? `e${big}` : ''}`}>
      {parseRich(shown).map((line, i) => (
        <span key={i} className={`ln ${line.kind}`}>
          {line.kind === 'bullet' && '• '}
          {line.kind === 'number' && `${line.number}. `}
          {line.spans.map((s, j) => (
            <SpanView key={j} s={s} names={names} />
          ))}
          {'\n'}
        </span>
      ))}
      {cut != null && (
        <button className="more" onClick={() => setAll(true)}>
          Read more
        </button>
      )}
    </span>
  );
}

function SpanView({ s, names }: { s: Span; names: string[] }) {
  let el: React.ReactNode = s.link ? s.text : withMentions(s.text, names);
  if (s.code) el = <code>{el}</code>;
  if (s.strike) el = <s>{el}</s>;
  if (s.italic) el = <em>{el}</em>;
  if (s.bold) el = <strong>{el}</strong>;
  if (s.link) {
    const href = s.link.kind === 'email' ? `mailto:${s.link.target}` : s.link.kind === 'phone' ? `tel:${s.link.target}` : /^https?:/i.test(s.link.target) ? s.link.target : `https://${s.link.target}`;
    el = (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {el}
      </a>
    );
  }
  return <>{el}</>;
}

/** "Reply privately": the group message this answers, with the group's name. Click to go to it. */
function PrivateQuote({ q }: { q: NonNullable<Message['quote']> }) {
  const group = useLoaded<string>(['chats'], async () => {
    const c = await core.storage.getChat(q.chat);
    return c ? chatTitle(c) : 'Group';
  }, [q.chat], 'Group');
  const words = q.text ? plainText(q.text) : q.kind === 'image' ? 'Photo' : q.kind === 'video' ? 'Video' : q.kind === 'voice' ? 'Voice message' : q.kind === 'poll' ? 'Poll' : 'Message';
  return (
    <button
      className="quote"
      onClick={() => {
        openChat(q.chat);
        setView({ jumpTo: msgKey({ chatId: q.chat, author: q.author, id: q.id }) });
      }}
    >
      <i />
      <div>
        <b>
          {q.author === core.myId ? 'You' : memberName(q.author)} · {group}
        </b>
        <span className="qt">{words}</span>
      </div>
      {q.thumb && <img className="qthumb" src={`data:image/jpeg;base64,${q.thumb}`} alt="" />}
    </button>
  );
}

/** "@Name" in the accent colour, for the people a group message mentions. */
function withMentions(text: string, names: string[]): React.ReactNode {
  if (!names.length) return text;
  const parts = text.split(new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g'));
  return parts.map((part, i) =>
    names.includes(part) ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** The message this one replies to; click to go to it. */
function Quote({ m }: { m: Message }) {
  const r = m.replyTo!;
  const q = useLoaded<Message | null>([`messages:${m.chatId}`], () => core.storage.getMessage(m.chatId, r.author, r.id), [m.chatId, r.author, r.id], null);
  const colour = NAME_COLOURS[hash(r.author) % NAME_COLOURS.length];
  return (
    <button className="quote" onClick={() => q && setView({ jumpTo: msgKey(q) })} style={{ ['--qc' as string]: r.author === core.myId ? undefined : colour }}>
      <i />
      <div>
        <b>{r.author === core.myId ? 'You' : memberName(r.author)}</b>
        <span className="qt">{q ? (q.deleted ? 'This message was deleted' : bodyLine(q)) : '…'}</span>
      </div>
      {q?.file?.thumb && !q.file.once && <img className="qthumb" src={`data:image/jpeg;base64,${q.file.thumb}`} alt="" />}
    </button>
  );
}

// ---- Files ----

/** Fetches a file once it's on screen (not before), and gives its address. */
function useFileUrl(m: Message, el: React.RefObject<HTMLElement | null>, auto: boolean) {
  const f = m.file!;
  const [url, setUrl] = useState<string | null>(() => (f.id !== 'pending' && core.knownFile(f.id)) || null);
  const [failed, setFailed] = useState(false);
  const [want, setWant] = useState(auto);
  useEffect(() => {
    if (!want || url || f.id === 'pending') return;
    const node = el.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      core
        .fileUrl(f)
        .then(setUrl)
        .catch(() => setFailed(true));
    });
    io.observe(node);
    return () => io.disconnect();
  }, [want, url, f, el]);
  return { url, failed, get: () => setWant(true) };
}

function FileBody({ m, openViewer }: { m: Message; openViewer: (m: Message) => void }) {
  const f = m.file!;
  const box = useRef<HTMLDivElement>(null);
  const isMedia = f.kind === 'image' || f.kind === 'video' || f.kind === 'sticker';
  const { url, failed } = useFileUrl(m, box, isMedia && !f.once);

  if (f.once) {
    return (
      <div className="once">
        <span className="oi">1</span>
        <span>
          <b>{fileWord(m)}</b>
          <small>View once. Open it on your phone.</small>
        </span>
      </div>
    );
  }

  if (f.kind === 'sticker') {
    return <div ref={box} className="stkimg">{url ? <img src={url} alt="Sticker" /> : <div className="ph" />}</div>;
  }

  if (f.kind === 'image' || f.kind === 'video') {
    // Keep the shape the photo will have, so nothing jumps when it arrives.
    const w = f.width ?? 4;
    const h = f.height ?? 3;
    const width = Math.min(330, w >= h ? 330 : Math.round((330 * w) / h));
    const height = Math.round(Math.min(Math.max((width * h) / w, 120), 400));
    return (
      <>
        <div ref={box} className={`img ${f.round ? 'round' : ''}`} style={{ width, height }} onClick={() => openViewer(m)} role="button" aria-label={f.kind === 'video' ? 'Play video' : 'Open photo'}>
          {f.thumb && <img className="blur" src={`data:image/jpeg;base64,${f.thumb}`} alt="" />}
          {url && f.kind === 'image' && <img className="full" src={url} alt="" />}
          {url && f.kind === 'video' && <video className="full" src={url} muted={!!f.gif} autoPlay={!!f.gif} loop={!!f.gif} playsInline preload="metadata" />}
          {f.kind === 'video' && !f.gif && (
            <span className="play">
              <Icon name="play" size={28} />
            </span>
          )}
          {f.kind === 'video' && f.duration ? (
            <span className="vlen">
              <Icon name="video" size={14} /> {duration(f.duration)}
            </span>
          ) : null}
          {f.gif && <span className="vlen">GIF</span>}
          {failed && <span className="ferr">Couldn't load</span>}
          {f.id === 'pending' && <span className="spin over" />}
          {!m.text && <Meta m={m} over />}
        </div>
      </>
    );
  }

  if (f.kind === 'voice' || f.kind === 'audio') return <Voice m={m} />;

  return (
    <button className="doc" onClick={() => void download(m)} aria-label={`Download ${f.name ?? 'document'}`}>
      <span className="dico">
        <Icon name="doc" size={26} />
        <small>{(f.name?.split('.').pop() ?? f.mime.split('/')[1] ?? '').slice(0, 4).toUpperCase()}</small>
      </span>
      <span className="dn">
        <b>{f.name ?? 'Document'}</b>
        <small>
          {fileSize(f.size)} · {(f.mime.split('/')[1] ?? 'file').split(';')[0].toUpperCase()}
        </small>
      </span>
      {f.id === 'pending' ? <span className="spin" /> : <Icon name="download" size={22} />}
    </button>
  );
}

/** A voice message or audio file: play, the bars moving, and 1×/1.5×/2×. */
function Voice({ m }: { m: Message }) {
  const f = m.file!;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const total = f.duration ?? 0;
  const bars = waveBars(f.waveform);

  async function toggle() {
    if (!audio.current) {
      setLoading(true);
      try {
        const a = new Audio(await core.fileUrl(f));
        a.playbackRate = speed;
        a.ontimeupdate = () => setAt(a.currentTime * 1000);
        a.onended = () => (setPlaying(false), setAt(0));
        audio.current = a;
      } catch {
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    const a = audio.current;
    if (a.paused) {
      // One voice message at a time, like WhatsApp.
      dispatchEvent(new CustomEvent('pakchat:playing', { detail: msgKey(m) }));
      void a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  }

  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== msgKey(m) && audio.current && !audio.current.paused) {
        audio.current.pause();
        setPlaying(false);
      }
    };
    addEventListener('pakchat:playing', stop);
    return () => {
      removeEventListener('pakchat:playing', stop);
      audio.current?.pause();
    };
  }, [m]);

  const progress = total ? at / total : 0;
  return (
    <div className="voice">
      <button className="play" onClick={() => void toggle()} aria-label={playing ? 'Pause' : 'Play'}>
        {loading ? <span className="spin" /> : <Icon name={playing ? 'pause' : 'play'} size={26} />}
      </button>
      <div
        className="wave"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const p = (e.clientX - r.left) / r.width;
          if (audio.current) audio.current.currentTime = (p * total) / 1000;
        }}
      >
        {bars.map((h, i) => (
          <i key={i} className={i / bars.length < progress ? 'p' : ''} style={{ height: h }} />
        ))}
      </div>
      {playing || at > 0 ? (
        <button
          className="spd"
          onClick={() => {
            const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
        >
          {next(speed)}
        </button>
      ) : (
        <span className="vico">
          <Icon name={f.kind === 'voice' ? 'mic' : 'music'} size={20} />
        </span>
      )}
      <span className="vlen2">{duration(at > 0 ? at : total)}</span>
    </div>
  );
}

const next = (s: number) => `${s}×`;

/** The bars of a voice message: from its waveform (one byte per moment), or a gentle default. */
function waveBars(b64?: string): number[] {
  const n = 40;
  if (!b64) return Array.from({ length: n }, (_, i) => 6 + ((i * 7) % 13));
  let bytes: number[];
  try {
    bytes = [...atob(b64)].map((c) => c.charCodeAt(0));
  } catch {
    return Array.from({ length: n }, () => 8);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * bytes.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * bytes.length) / n));
    out.push(4 + Math.round((Math.max(...bytes.slice(from, to)) / 255) * 22));
  }
  return out;
}

// ---- Polls ----

function Poll({ m }: { m: Message }) {
  const p = m.poll!;
  const votes = m.votes ?? {};
  const mine = votes[core.myId] ?? [];
  const counts = p.options.map((_, i) => Object.values(votes).filter((v) => v.includes(i)).length);
  const people = Object.keys(votes).filter((k) => votes[k].length).length;
  const most = Math.max(1, ...counts);
  const vote = (i: number) => {
    const picked = mine.includes(i) ? mine.filter((x) => x !== i) : p.multi ? [...mine, i] : [i];
    void core.client.vote(m.chatId, { author: m.author, id: m.id }, picked);
  };
  return (
    <div className="poll">
      <b className="pq">{p.question}</b>
      <small>{p.multi ? 'Select one or more' : 'Select one'}</small>
      {p.options.map((o, i) => (
        <button key={i} className="po" onClick={() => vote(i)}>
          <span className={`chk round ${mine.includes(i) ? '' : 'off'}`}>{mine.includes(i) && <Icon name="check" size={12} stroke={3} />}</span>
          <span className="pt">
            <span className="l">
              <span>{o}</span>
              <span>{counts[i]}</span>
            </span>
            <span className="bar">
              <i style={{ width: `${(counts[i] / most) * 100}%` }} />
            </span>
          </span>
        </button>
      ))}
      <small className="pv2">{people === 1 ? '1 vote' : `${people} votes`}</small>
    </div>
  );
}

// ---- Reactions ----

function Reactions({ m }: { m: Message }) {
  const list = Object.entries(m.reactions ?? {});
  if (!list.length) return null;
  const emojis = [...new Set(list.map(([, e]) => e))].slice(0, 3);
  return (
    <button
      className="rx"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openLayer(<ReactionList m={m} x={r.left} y={r.bottom + 6} />);
      }}
    >
      {emojis.join('')}
      {list.length > 1 && <span className="rn">{list.length}</span>}
    </button>
  );
}

function ReactionList({ m, x, y }: { m: Message; x: number; y: number }) {
  const { ref, style } = usePlace(x, y);
  const list = Object.entries(m.reactions ?? {});
  const [tab, setTab] = useState<string | null>(null);
  const tabs = [...new Set(list.map(([, e]) => e))];
  const shown = list.filter(([, e]) => !tab || e === tab);
  return (
    <div ref={ref} className="menu pop rxl" style={style}>
      <div className="rxt">
        <button className={tab === null ? 'on' : ''} onClick={() => setTab(null)}>
          All {list.length}
        </button>
        {tabs.map((e) => (
          <button key={e} className={tab === e ? 'on' : ''} onClick={() => setTab(e)}>
            {e} {list.filter(([, x]) => x === e).length}
          </button>
        ))}
      </div>
      {shown.map(([who, e]) => (
        <button
          key={who}
          className="mi"
          onClick={() => {
            if (who === core.myId) {
              react(m, e);
              closeLayer();
            }
          }}
        >
          <span className="ml">
            {who === core.myId ? 'You' : memberName(who)}
            {who === core.myId && <small>Click to remove</small>}
          </span>
          <span className="rxe">{e}</span>
        </button>
      ))}
    </div>
  );
}

/** 👍 ❤️ 😂 😮 😢 🙏 and +, above the message. */
function reactBar(m: Message, x: number, y: number, alignRight: boolean) {
  openLayer(<ReactBar m={m} x={x} y={y} alignRight={alignRight} />);
}

function ReactBar({ m, x, y, alignRight }: { m: Message; x: number; y: number; alignRight: boolean }) {
  const { ref, style } = usePlace(x, y, { above: true, alignRight });
  return (
    <div ref={ref} className="reactbar pop" style={style}>
      <QuickReactions m={m} />
    </div>
  );
}

function QuickReactions({ m }: { m: Message }) {
  const mine = m.reactions?.[core.myId];
  return (
    <div className="rxrow">
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          className={mine === e ? 'mine' : ''}
          onClick={() => {
            react(m, e);
            closeLayer();
          }}
        >
          {e}
        </button>
      ))}
      <button
        className="plus"
        aria-label="More reactions"
        onClick={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          closeLayer();
          void import('./EmojiPanel').then(({ openEmojiPicker }) => openEmojiPicker(r.left, r.bottom + 6, (e) => react(m, e)));
        }}
      >
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}
