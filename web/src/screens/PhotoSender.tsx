// PhotoSender.tsx: the window you see before sending photos and videos.
// Look at each one, write a caption under it, add more (up to 10) or take some out, then Send.
// They come from the paperclip menu, from pasting (Ctrl+V), or from dragging them onto the chat.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { isPhotoOrVideo, MAX_PHOTOS } from '../media'
import Icon from './Icon'

export type PickedPhoto = { file: File; caption: string }
type Item = PickedPhoto & { id: number; url: string; video: boolean }

let nextId = 1
const toItems = (files: File[]) =>
  files.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), caption: '', video: file.type.startsWith('video/') }))

// Free "object URLs" (blob:...) so the browser can let go of the files. A video showing one
// is stopped first, or it keeps trying to read a file that's gone.
function release(box: HTMLElement | null, gone: string[]) {
  box?.querySelectorAll('video').forEach((video) => {
    if (!gone.includes(video.src)) return
    video.removeAttribute('src')
    video.load()
  })
  gone.forEach((url) => URL.revokeObjectURL(url))
}

export default function PhotoSender({ files, onSend, onClose }: { files: File[]; onSend: (photos: PickedPhoto[]) => void; onClose: () => void }) {
  const { t } = useT()
  const [items, setItems] = useState<Item[]>(() => toItems(files.slice(0, MAX_PHOTOS)))
  const [current, setCurrent] = useState(0)
  const more = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const urls = useRef<string[]>([])

  // Photos shown from your computer use "object URLs" (blob:...). We free them when you
  // send or close, so the browser can let go of the files.
  useEffect(() => {
    urls.current = items.map((item) => item.url)
  })
  const close = useCallback(() => {
    release(root.current, urls.current)
    onClose()
  }, [onClose])
  useBack(true, LEVEL.cover, close)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const shown = items[Math.min(current, items.length - 1)]
  if (!shown) return null

  function setCaption(caption: string) {
    setItems(items.map((item) => (item.id === shown.id ? { ...item, caption } : item)))
  }
  function remove(id: number) {
    const left = items.filter((item) => item.id !== id)
    if (left.length === 0) return close()
    release(root.current, [items.find((item) => item.id === id)!.url])
    setItems(left)
    setCurrent(Math.min(current, left.length - 1))
  }
  function addMore(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])].filter(isPhotoOrVideo)
    e.target.value = ''
    setItems([...items, ...toItems(picked)].slice(0, MAX_PHOTOS))
  }

  return createPortal(
    <div className="photo-sender" ref={root} role="dialog" aria-label={t.sendPhotos}>
      <header>
        <button className="icon" aria-label={t.cancel} onClick={close}>
          <Icon name="close" />
        </button>
        <span>{items.length > 1 ? `${Math.min(current, items.length - 1) + 1} / ${items.length}` : ''}</span>
      </header>
      <div className="stage">{shown.video ? <video key={shown.id} src={shown.url} controls playsInline /> : <img src={shown.url} alt="" />}</div>
      <form
        className="caption-row"
        onSubmit={(e) => {
          e.preventDefault()
          onSend(items.map(({ file, caption }) => ({ file, caption: caption.trim() })))
          release(root.current, items.map((item) => item.url))
        }}
      >
        <input dir="auto" placeholder={t.addCaption} value={shown.caption} maxLength={1024} onChange={(e) => setCaption(e.target.value)} autoFocus />
        <div className="thumbs">
          {items.map((item, i) => (
            <span key={item.id} className={item.id === shown.id ? 'thumb on' : 'thumb'}>
              {item.video ? (
                <video src={item.url} muted preload="metadata" onClick={() => setCurrent(i)} />
              ) : (
                <img src={item.url} alt="" onClick={() => setCurrent(i)} />
              )}
              {item.video && (
                <span className="thumb-video">
                  <Icon name="video" size={12} />
                </span>
              )}
              <button type="button" aria-label={t.remove} onClick={() => remove(item.id)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          {items.length < MAX_PHOTOS && (
            <button type="button" className="thumb add" aria-label={t.addMorePhotos} onClick={() => more.current?.click()}>
              <Icon name="plus" />
            </button>
          )}
          <input ref={more} type="file" accept="image/*,video/*" multiple hidden onChange={addMore} />
        </div>
        <button className="round-btn" aria-label={t.send} title={t.send}>
          <Icon name="send" />
          {items.length > 1 && <span className="badge">{items.length}</span>}
        </button>
      </form>
    </div>,
    document.body,
  )
}
