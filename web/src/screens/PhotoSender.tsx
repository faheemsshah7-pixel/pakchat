// PhotoSender.tsx: the window you see before sending photos.
// Look at each photo, write a caption under it, add more (up to 10) or take some out, then Send.
// Photos come from the camera button, from pasting (Ctrl+V), or from dragging them onto the chat.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../lang'
import { MAX_PHOTOS } from '../media'
import Icon from './Icon'

export type PickedPhoto = { file: File; caption: string }
type Item = PickedPhoto & { id: number; url: string }

let nextId = 1
const toItems = (files: File[]) => files.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), caption: '' }))

export default function PhotoSender({ files, onSend, onClose }: { files: File[]; onSend: (photos: PickedPhoto[]) => void; onClose: () => void }) {
  const { t } = useT()
  const [items, setItems] = useState<Item[]>(() => toItems(files.slice(0, MAX_PHOTOS)))
  const [current, setCurrent] = useState(0)
  const more = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])

  // Photos shown from your computer use "object URLs" (blob:...). We free them when you
  // send or close, so the browser can let go of the files.
  useEffect(() => {
    urls.current = items.map((item) => item.url)
  })
  const close = useCallback(() => {
    urls.current.forEach((url) => URL.revokeObjectURL(url))
    onClose()
  }, [onClose])

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
    URL.revokeObjectURL(items.find((item) => item.id === id)!.url)
    setItems(left)
    setCurrent(Math.min(current, left.length - 1))
  }
  function addMore(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    setItems([...items, ...toItems(picked)].slice(0, MAX_PHOTOS))
  }

  return createPortal(
    <div className="photo-sender" role="dialog" aria-label={t.sendPhotos}>
      <header>
        <button className="icon" aria-label={t.cancel} onClick={close}>
          <Icon name="close" />
        </button>
        <span>{items.length > 1 ? `${Math.min(current, items.length - 1) + 1} / ${items.length}` : ''}</span>
      </header>
      <div className="stage">
        <img src={shown.url} alt="" />
      </div>
      <form
        className="caption-row"
        onSubmit={(e) => {
          e.preventDefault()
          onSend(items.map(({ file, caption }) => ({ file, caption: caption.trim() })))
          items.forEach((item) => URL.revokeObjectURL(item.url))
        }}
      >
        <input dir="auto" placeholder={t.addCaption} value={shown.caption} maxLength={1024} onChange={(e) => setCaption(e.target.value)} autoFocus />
        <div className="thumbs">
          {items.map((item, i) => (
            <span key={item.id} className={item.id === shown.id ? 'thumb on' : 'thumb'}>
              <img src={item.url} alt="" onClick={() => setCurrent(i)} />
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
          <input ref={more} type="file" accept="image/*" multiple hidden onChange={addMore} />
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
