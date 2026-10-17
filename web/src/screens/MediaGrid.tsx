// MediaGrid.tsx: "Media, links and docs" in contact, group and broadcast list info.
// A row that opens the full page (MediaPage.tsx: Media, Links and Docs tabs), with the newest
// photos and videos under it as small squares. (From the messages already loaded.)
// Thumb is one square, also used on the full page and in the viewer's strip (MediaViewer.tsx).
// (Not "view once" ones, which can't be seen again, or round video messages, which are more like voice notes.)
import { useEffect, useRef, useState } from 'react'
import type { Message } from '../chats'
import { useT } from '../lang'
import { useMedia } from '../media'
import { viewable, type SharedTab } from '../shared'
import { duration } from '../time'
import Icon from './Icon'

export type ViewMedia = (m: Message, list?: Message[]) => void

type Props = { chatId: string; messages: Message[]; onView: ViewMedia; onOpenMedia: (tab: SharedTab) => void }

export default function MediaGrid({ chatId, messages, onView, onOpenMedia }: Props) {
  const { t } = useT()
  const media = messages.filter(viewable).reverse() // newest first
  return (
    <section className="info-section">
      <button className="row action media-row" onClick={() => onOpenMedia('media')}>
        <Icon name="image" />
        <span className="row-main">{t.mediaLinksDocs}</span>
        <Icon name="chevronRight" size={18} />
      </button>
      {media.length > 0 && (
        <div className="media-grid strip">
          {media.slice(0, 6).map((m) => (
            <Thumb key={m.id} chatId={chatId} m={m} onOpen={() => onView(m, media)} />
          ))}
        </div>
      )}
    </section>
  )
}

// One square: a photo, a video's first picture (with ▶ and how long it is), or a GIF (with "GIF").
// lazy: only load the picture when it scrolls into sight (the full page can have hundreds).
type ThumbProps = { chatId: string; m: Message; onOpen: () => void; lazy?: boolean; active?: boolean }
export function Thumb({ chatId, m, onOpen, lazy, active }: ThumbProps) {
  const box = useRef<HTMLButtonElement>(null)
  const [seen, setSeen] = useState(!lazy)
  useEffect(() => {
    if (seen || !box.current) return
    const watch = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: '300px' })
    watch.observe(box.current)
    return () => watch.disconnect()
  }, [seen])
  const video = m.kind === 'video'
  const picture = useMedia(chatId, seen && !m.gif ? (video ? m.posterId : m.mediaId) : undefined)
  const src = m.gif ? m.gif.preview : picture
  const waiting = !src && !m.gif && (!video || !!m.posterId) // (a video without a first picture shows just ▶)
  const classes = ['thumb-box', waiting && 'loading', active && 'active'].filter(Boolean).join(' ')
  return (
    <button ref={box} type="button" className={classes} onClick={onOpen} aria-label={m.caption || (m.gif ? 'GIF' : video ? 'video' : 'photo')}>
      {src && <img src={src} alt="" />}
      {video && (
        <span className="thumb-play">
          <Icon name="play" size={18} />
        </span>
      )}
      {video && !!m.seconds && <span className="thumb-time">{duration(m.seconds)}</span>}
      {m.gif && <span className="gif-badge">GIF</span>}
    </button>
  )
}
