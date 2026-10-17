// MediaViewer.tsx: a chat's photos and videos full screen, one after another, like WhatsApp.
//   ‹ and › at the sides (or the ← and → keys) go to the one before or after.
//   The strip at the bottom shows them all as small squares; tap one to jump to it.
//   "All media" opens the chat's Media, links and docs (MediaPage.tsx).
// The photo or video itself is shown by PhotoViewer.tsx or VideoViewer.tsx.
// (A GIF from the Media page plays here like a video.)
import { Suspense, useEffect, useRef, useState } from 'react'
import type { Message } from '../chats'
import { useT } from '../lang'
import { knownMediaUrl, loadMediaUrl, useMedia, videoExtension } from '../media'
import Icon from './Icon'
import { PhotoViewer, VideoViewer } from './lazy' // (they load the first time they're needed)
import { Thumb } from './MediaGrid'

type Props = {
  chatId: string
  start: Message
  list: Message[] // oldest first
  describe: (m: Message) => { who: string; when: string } // "You", "Today, 5:04 PM"
  onClose: () => void
  onAllMedia?: () => void
}

export default function MediaViewer({ chatId, start, list, describe, onClose, onAllMedia }: Props) {
  const { t } = useT()
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((m) => m.id === start.id)))
  const m = list[index] ?? start
  const video = m.kind === 'video' || m.kind === 'gif'
  const photo = useMedia(chatId, video ? undefined : m.mediaId)
  const [clip, setClip] = useState<{ id: string; url: string } | null>(null)
  const strip = useRef<HTMLDivElement>(null)

  // A video: get it ready to play. (A GIF is already a web address.)
  useEffect(() => {
    if (m.kind !== 'video' || !m.mediaId || knownMediaUrl(m.mediaId)) return
    let stillHere = true
    loadMediaUrl(chatId, m.mediaId)
      .then((url) => stillHere && setClip({ id: m.id, url }))
      .catch(console.error)
    return () => {
      stillHere = false
    }
  }, [chatId, m.id, m.kind, m.mediaId])

  // ← and → go back and forward.
  const go = (step: number) => setIndex((i) => Math.min(list.length - 1, Math.max(0, i + step)))
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  // Keep the one you're looking at in sight in the strip.
  useEffect(() => {
    strip.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [index])

  const src = m.gif ? m.gif.mp4 : video ? (knownMediaUrl(m.mediaId) ?? (clip?.id === m.id ? clip.url : '')) : (photo ?? '')
  const extra = (list.length > 1 || onAllMedia) && (
    <>
      {index > 0 && (
        <button className="viewer-step back" aria-label={t.previous} title={t.previous} onClick={() => go(-1)}>
          <Icon name="chevronLeft" size={30} />
        </button>
      )}
      {index < list.length - 1 && (
        <button className="viewer-step next" aria-label={t.next} title={t.next} onClick={() => go(1)}>
          <Icon name="chevronRight" size={30} />
        </button>
      )}
      <div className="viewer-strip">
        {onAllMedia && (
          <button className="btn all-media" onClick={onAllMedia}>
            {t.allMedia}
          </button>
        )}
        <div className="viewer-thumbs" ref={strip}>
          {list.map((item, i) => (
            <Thumb key={item.id} chatId={chatId} m={item} lazy active={i === index} onOpen={() => setIndex(i)} />
          ))}
        </div>
      </div>
    </>
  )
  const shown = { src, ...describe(m), caption: m.caption, onClose, extra: extra || undefined }
  if (!src) {
    // Still loading: a dark screen with a spinner (and the strip, so you can move on).
    return (
      <Suspense fallback={null}>
        <PhotoViewer {...shown} fileName="" loading />
      </Suspense>
    )
  }
  return (
    <Suspense fallback={null}>
      {video ? (
        <VideoViewer {...shown} loop={!!m.gif} fileName={`PakChat video ${m.id}.${m.gif ? 'mp4' : videoExtension(src)}`} />
      ) : (
        <PhotoViewer {...shown} fileName={`PakChat photo ${m.id}.jpg`} />
      )}
    </Suspense>
  )
}
