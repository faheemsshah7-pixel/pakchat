// PhotoSender.tsx: the window you see before sending photos and videos.
// Look at each one, write a caption under it, add more (up to 10) or take some out, then Send.
// They come from the paperclip menu, from pasting (Ctrl+V), or from dragging them onto the chat.
// At the top: crop and rotate, write on or draw on a photo (PhotoEditor.tsx), and HD (sharper photos).
// By the caption: ① view once (once.ts), so it can be opened only once.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { isPhotoOrVideo, MAX_PHOTOS } from '../media'
import { getSetting } from '../settings'
import Icon from './Icon'
import { PhotoEditor } from './lazy' // (the editor loads the first time you open it)

export type PickedPhoto = { file: File; caption: string; once: boolean }
type Item = PickedPhoto & { id: number; url: string; video: boolean }
type Tool = 'crop' | 'text' | 'draw'

let nextId = 1
const toItems = (files: File[]) =>
  files.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), caption: '', once: false, video: file.type.startsWith('video/') }))

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

type Props = {
  files: File[]
  canOnce: boolean // view once is offered (not in "Message yourself")
  onSend: (photos: PickedPhoto[], hd: boolean) => void
  onClose: () => void
}

export default function PhotoSender({ files, canOnce, onSend, onClose }: Props) {
  const { t } = useT()
  const [items, setItems] = useState<Item[]>(() => toItems(files.slice(0, MAX_PHOTOS)))
  const [current, setCurrent] = useState(0)
  const [hd, setHd] = useState(() => getSetting('photoHD')) // starts as Settings > Chats > Photo quality says
  const [editing, setEditing] = useState<{ id: number; tool: Tool } | null>(null)
  const [hint, setHint] = useState('') // "HD quality", "View once: …"
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

  // Esc closes this window (but while the editor is open, Esc is the editor's).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close, editing])

  // The little note at the top goes away by itself.
  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(''), 3500)
    return () => clearTimeout(timer)
  }, [hint])

  const shown = items[Math.min(current, items.length - 1)]
  if (!shown) return null

  function update(id: number, change: Partial<Item>) {
    setItems((all) => all.map((item) => (item.id === id ? { ...item, ...change } : item)))
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
  // The editor gave back the changed photo: show (and send) that instead.
  function edited(id: number, file: File) {
    const old = items.find((item) => item.id === id)
    if (old) URL.revokeObjectURL(old.url)
    update(id, { file, url: URL.createObjectURL(file) })
    setEditing(null)
  }
  function toggleOnce() {
    const on = !shown.once
    update(shown.id, { once: on, caption: on ? '' : shown.caption })
    setHint(on ? t.viewOnceOn : t.viewOnceOff)
  }
  function toggleHd() {
    setHd(!hd)
    setHint(!hd ? t.hdOn : t.hdOff)
  }

  const tool = (name: Tool, icon: 'crop' | 'text' | 'pen', label: string) => (
    <button type="button" className="icon" aria-label={label} title={label} onClick={() => setEditing({ id: shown.id, tool: name })}>
      <Icon name={icon} />
    </button>
  )
  const anyPhoto = items.some((item) => !item.video)

  return createPortal(
    <div className="photo-sender" ref={root} role="dialog" aria-label={t.sendPhotos}>
      <header>
        <button className="icon" aria-label={t.cancel} onClick={close}>
          <Icon name="close" />
        </button>
        <span className="sender-count">{items.length > 1 ? `${Math.min(current, items.length - 1) + 1} / ${items.length}` : ''}</span>
        <span className="sender-tools">
          {anyPhoto && (
            <button type="button" className={hd ? 'hd-toggle on' : 'hd-toggle'} aria-pressed={hd} aria-label={t.hdOn} title={hd ? t.hdOn : t.hdOff} onClick={toggleHd}>
              {t.hd}
            </button>
          )}
          {!shown.video && (
            <>
              {tool('crop', 'crop', t.cropRotate)}
              {tool('text', 'text', t.addText)}
              {tool('draw', 'pen', t.draw)}
            </>
          )}
        </span>
      </header>
      {hint && (
        <p className="sender-hint" role="status">
          {hint}
        </p>
      )}
      <div className="stage">{shown.video ? <video key={shown.id} src={shown.url} controls playsInline /> : <img src={shown.url} alt="" />}</div>
      <form
        className="caption-row"
        onSubmit={(e) => {
          e.preventDefault()
          onSend(
            items.map(({ file, caption, once }) => ({ file, caption: once ? '' : caption.trim(), once })),
            hd,
          )
          release(root.current, items.map((item) => item.url))
        }}
      >
        <div className="caption-line">
          <input
            dir="auto"
            placeholder={shown.once ? t.onceNoCaption : t.addCaption}
            value={shown.caption}
            maxLength={1024}
            disabled={shown.once}
            onChange={(e) => update(shown.id, { caption: e.target.value })}
            autoFocus
          />
          {canOnce && (
            <button type="button" className={shown.once ? 'icon once-toggle on' : 'icon once-toggle'} aria-pressed={shown.once} aria-label={t.viewOnce} title={t.viewOnce} onClick={toggleOnce}>
              <Icon name="once" />
            </button>
          )}
        </div>
        <div className="thumbs">
          {items.map((item, i) => (
            <span key={item.id} className={item.id === shown.id ? 'thumb on' : 'thumb'}>
              {item.video ? (
                <video src={item.url} muted preload="metadata" onClick={() => setCurrent(i)} />
              ) : (
                <img src={item.url} alt="" onClick={() => setCurrent(i)} />
              )}
              {(item.video || item.once) && (
                <span className="thumb-video">
                  <Icon name={item.once ? 'once' : 'video'} size={12} />
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
      {editing && (
        <Suspense fallback={null}>
          <PhotoEditor
            key={editing.id}
            file={items.find((item) => item.id === editing.id)!.file}
            start={editing.tool}
            onDone={(file) => edited(editing.id, file)}
            onClose={() => setEditing(null)}
          />
        </Suspense>
      )}
    </div>,
    document.body,
  )
}
