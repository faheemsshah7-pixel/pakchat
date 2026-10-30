// SendPreview.tsx: files about to be sent (picked, dropped or pasted): a big
// preview, a caption, the strip of files with + to add more, and Send.

import type { Chat } from '@pakchat/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { core } from '../core/core';
import { fileSize } from '../ui/format';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/overlay';
import { getView, setView } from '../ui/view';

/** The server takes files up to this size, like the phone. */
const MAX_FILE = 100 * 1024 * 1024;
const MAX_FILES = 30;

export function SendPreview({ chat, files: start }: { chat: Chat; files: File[] }) {
  const [files, setFiles] = useState(() => start.slice(0, MAX_FILES));
  const [at, setAt] = useState(0);
  const [caption, setCaption] = useState('');
  const more = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => (f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  const close = () => setView({ files: null });

  useEffect(() => {
    const big = start.filter((f) => f.size > MAX_FILE);
    if (big.length) {
      toast(`Files over 100 MB can't be sent (${big.map((f) => f.name).join(', ')})`);
      setFiles((l) => l.filter((f) => f.size <= MAX_FILE));
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [start]);

  useEffect(() => {
    if (!files.length) close();
  }, [files.length]);

  const f = files[Math.min(at, files.length - 1)];
  if (!f) return null;
  const url = urls[Math.min(at, files.length - 1)];

  async function send() {
    const reply = getView().replyTo;
    close();
    setView({ replyTo: null });
    try {
      await core.sendFiles(chat.id, files, caption.trim() || undefined, reply?.chatId === chat.id ? { author: reply.author, id: reply.id } : undefined);
    } catch {
      toast("Couldn't send. Try again.");
    }
  }

  return (
    <div className="sendpv">
      <div className="spbar">
        <button className="ib" onClick={close} aria-label="Close">
          <Icon name="close" size={24} />
        </button>
        <span className="ellip">{f.name}</span>
      </div>
      <div className="spstage">
        {f.type.startsWith('image/') && url ? (
          <img src={url} alt="" />
        ) : f.type.startsWith('video/') && url ? (
          <video src={url} controls />
        ) : (
          <div className="spdoc">
            <Icon name="doc" size={72} stroke={1.2} />
            <b>{f.name}</b>
            <span>
              {fileSize(f.size)} · {(f.name.split('.').pop() ?? '').toUpperCase()}
            </span>
          </div>
        )}
      </div>
      <div className="spcap">
        <input
          autoFocus
          value={caption}
          placeholder="Add a caption"
          maxLength={4096}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
        />
      </div>
      <div className="spstrip">
        {files.map((x, i) => (
          <button key={i} className={`spt ${i === at ? 'on' : ''}`} onClick={() => setAt(i)} aria-label={x.name}>
            {urls[i] && x.type.startsWith('image/') ? <img src={urls[i]!} alt="" /> : <Icon name={x.type.startsWith('video/') ? 'video' : 'doc'} size={24} />}
            <span
              className="spx"
              role="button"
              aria-label="Remove"
              onClick={(e) => {
                e.stopPropagation();
                setFiles(files.filter((_, j) => j !== i));
                setAt(Math.max(0, Math.min(at, files.length - 2)));
              }}
            >
              <Icon name="close" size={12} stroke={2.6} />
            </span>
          </button>
        ))}
        <button className="spt add" onClick={() => more.current?.click()} aria-label="Add file">
          <Icon name="plus" size={24} />
        </button>
        <input
          ref={more}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            setFiles([...files, ...[...(e.target.files ?? [])].filter((x) => x.size <= MAX_FILE)].slice(0, MAX_FILES));
            e.target.value = '';
          }}
        />
        <button className="send big" onClick={() => void send()} aria-label="Send">
          <Icon name="send" size={26} />
          {files.length > 1 && <span className="badge">{files.length}</span>}
        </button>
      </div>
    </div>
  );
}
