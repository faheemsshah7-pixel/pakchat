// Gifs.tsx: GIFs (gifs.ts). The GIF tab of the smiley panel, how a GIF looks in the chat,
// and the link preview card (links.ts), since they're both a picture from the web in a message.
import { useEffect, useState } from 'react'
import { findGifs, useGifLocale, type Gif } from '../gifs'
import { useT } from '../lang'
import type { LinkPreview } from '../links'
import Icon from './Icon'

// The GIF tab: popular GIFs, or search. Tap one to send it.
export function GifPanel({ onGif }: { onGif: (gif: Gif) => void }) {
  const { t } = useT()
  const locale = useGifLocale()
  const [words, setWords] = useState('')
  const [found, setFound] = useState<Gif[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Look them up a moment after you stop typing (not for every letter).
  useEffect(() => {
    let stale = false
    const timer = setTimeout(
      () =>
        findGifs(words.trim(), locale).then(
          (gifs) => {
            if (stale) return
            setFound(gifs)
            setFailed(false)
          },
          (err) => {
            console.warn('No GIFs:', err)
            if (!stale) setFailed(true)
          },
        ),
      words ? 400 : 0,
    )
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [words, locale])

  return (
    <div className="gif-panel">
      <div className="field gif-search">
        <Icon name="search" size={18} />
        <input dir="auto" placeholder={t.searchGifs} aria-label={t.searchGifs} value={words} onChange={(e) => setWords(e.target.value)} autoFocus />
      </div>
      <div className="gif-grid">
        {!failed &&
          found?.map((gif) => (
            <button key={gif.mp4} type="button" className="gif-pick" aria-label={t.gif} onClick={() => onGif(gif)}>
              <img src={gif.preview} alt="" loading="lazy" style={{ aspectRatio: `${gif.width} / ${gif.height}` }} />
            </button>
          ))}
      </div>
      {failed && <p className="empty">{t.gifsOff}</p>}
      {!failed && found?.length === 0 && <p className="empty">{t.noGifs}</p>}
    </div>
  )
}

// A GIF in the chat: a short silent video on a loop, with "GIF" in the corner.
export function GifBubble({ gif }: { gif: Gif }) {
  const { t } = useT()
  return (
    <span className="gif-msg" style={{ aspectRatio: `${gif.width} / ${gif.height}` }}>
      <video src={gif.mp4} poster={gif.preview} autoPlay loop muted playsInline aria-label={t.gif} />
      <span className="gif-badge">{t.gif}</span>
    </span>
  )
}

// A link's card: the page's picture, title, a line about it, and the website.
// In a message it opens the page; above the message box it has an X to leave it out.
export function LinkCard({ preview, onRemove }: { preview: LinkPreview; onRemove?: () => void }) {
  const { t } = useT()
  const body = (
    <>
      {preview.image && <img src={preview.image} alt="" />}
      <span className="link-words">
        <strong dir="auto">{preview.title}</strong>
        {preview.description && <small dir="auto">{preview.description}</small>}
        {preview.site && <small className="link-site">{preview.site}</small>}
      </span>
    </>
  )
  if (onRemove) {
    return (
      <div className="link-card draft">
        {body}
        <button type="button" className="icon" aria-label={t.removePreview} title={t.removePreview} onClick={onRemove}>
          <Icon name="close" size={18} />
        </button>
      </div>
    )
  }
  return (
    <a className="link-card" href={preview.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {body}
    </a>
  )
}
