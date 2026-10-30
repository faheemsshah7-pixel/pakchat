// MediaGallery.tsx: Contact info › "Media, links and docs", like WhatsApp Web:
// three tabs. Media is a grid of photos and videos (click one to view it),
// Docs the files (click to download), Links every web address sent.

import type { Message } from '@pakchat/shared';
import { lazy, Suspense, useState } from 'react';

import { core } from '../core/core';
import { useChat, useLoaded } from '../core/hooks';
import { fileSize, memberName } from '../ui/format';
import { Icon } from '../ui/Icon';
import { findLinks } from '../ui/richText';
import { setView } from '../ui/view';
import { download } from './messageActions';

const Viewer = lazy(() => import('./Viewer').then((m) => ({ default: m.Viewer })));

type Tab = 'media' | 'docs' | 'links';
const isFile = (m: Message) => !m.deleted && m.kind === 'file' && !!m.file && !m.file.once && m.file.id !== 'pending';
const isMedia = (m: Message) => isFile(m) && (m.file!.kind === 'image' || m.file!.kind === 'video');
const isDoc = (m: Message) => isFile(m) && (m.file!.kind === 'doc' || m.file!.kind === 'audio');

export function MediaGallery({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const [tab, setTab] = useState<Tab>('media');
  const [viewing, setViewing] = useState<Message | null>(null);
  const all = useLoaded<Message[]>([`messages:${chatId}`], async () => (await core.storage.listMessages(chatId, { limit: 100_000 })).filter((m) => !m.deleted), [chatId], []);
  if (!chat) return null;
  // Newest first, as on WhatsApp.
  const media = all.filter(isMedia).reverse();
  const docs = all.filter(isDoc).reverse();
  const links = all
    .filter((m) => m.text && m.kind !== 'system')
    .flatMap((m) => findLinks(m.text!).filter((l) => l.kind === 'url').map((l) => ({ m, url: l.target })))
    .reverse();

  return (
    <>
      <div className="dh">
        <button className="ib" onClick={() => setView({ drawer: 'info' })} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        Media, links and docs
      </div>
      <div className="mtabs" role="tablist">
        {(['media', 'docs', 'links'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'media' ? 'Media' : t === 'docs' ? 'Docs' : 'Links'}
          </button>
        ))}
      </div>
      <div className="db scroll">
        {tab === 'media' &&
          (media.length ? (
            <div className="mgrid">
              {media.map((m) => (
                <button key={`${m.author}/${m.id}`} onClick={() => setViewing(m)} aria-label={m.file!.kind === 'video' ? 'Video' : 'Photo'}>
                  {m.file!.thumb ? <img src={`data:image/jpeg;base64,${m.file!.thumb}`} alt="" /> : <Icon name="photo" size={28} />}
                  {m.file!.kind === 'video' && (
                    <span className="mvid">
                      <Icon name="play" size={14} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="mempty">No media</p>
          ))}
        {tab === 'docs' &&
          (docs.length ? (
            docs.map((m) => (
              <button key={`${m.author}/${m.id}`} className="drow" onClick={() => void download(m)}>
                <Icon name="doc" size={24} />
                <span className="dt">
                  {m.file!.name ?? 'File'}
                  <small>
                    {fileSize(m.file!.size)} · {new Date(m.sentAt).toLocaleDateString()} · {m.author === core.myId ? 'You' : memberName(m.author)}
                  </small>
                </span>
                <Icon name="download" size={20} />
              </button>
            ))
          ) : (
            <p className="mempty">No docs</p>
          ))}
        {tab === 'links' &&
          (links.length ? (
            links.map(({ m, url }, i) => (
              <a key={`${m.author}/${m.id}/${i}`} className="drow" href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="link" size={22} />
                <span className="dt ellip">
                  {url.replace(/^https?:\/\//, '')}
                  <small>
                    {new Date(m.sentAt).toLocaleDateString()} · {m.author === core.myId ? 'You' : memberName(m.author)}
                  </small>
                </span>
              </a>
            ))
          ) : (
            <p className="mempty">No links</p>
          ))}
      </div>
      {viewing && (
        <Suspense fallback={null}>
          <Viewer chat={chat} start={viewing} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </>
  );
}
