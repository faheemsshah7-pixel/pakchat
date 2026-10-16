// PhotoEditor.tsx: change a photo before sending it, like WhatsApp. Opened from PhotoSender.tsx.
//   Crop and rotate: drag the corners (or the middle) of the box, ↺ turns the photo left.
//   Draw: pick a colour and draw with your finger or the mouse.
//   Text: write something, pick a colour, then drag it where you want. Tap it to change it.
// Undo takes back the last change. Done gives the finished photo back. The sums are in photoEdit.ts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { COLOURS, dragCrop, drawEdit, FRESH, isFresh, labelBox, loadForEditing, PEN, renderEdit, TEXT, turnedSize, turnLeft, WHOLE, type Edit, type Handle, type Point, type Stroke } from '../photoEdit'
import Icon from './Icon'

type Mode = 'crop' | 'draw' | null
// start: which tool to open with (the button you pressed in PhotoSender.tsx).
type Props = { file: File; start?: Mode | 'text'; onDone: (file: File) => void; onClose: () => void }
// Something being dragged: a crop corner, or some words.
type Drag = { kind: 'crop'; handle: Handle } | { kind: 'label'; id: number }

const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se']
let nextLabel = 1

export default function PhotoEditor({ file, start = null, onDone, onClose }: Props) {
  const { t } = useT()
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [failed, setFailed] = useState(false)
  const [edit, setEdit] = useState<Edit>(FRESH)
  const [history, setHistory] = useState<Edit[]>([]) // the edits before, for Undo
  const [mode, setMode] = useState<Mode>(start === 'text' ? null : start)
  const [colour, setColour] = useState(COLOURS[2])
  const [line, setLine] = useState<Stroke | null>(null) // the line you're drawing right now
  // The box for writing words (id: the words being changed, or null for new ones).
  const [typing, setTyping] = useState<{ id: number | null; text: string; colour: string } | null>(start === 'text' ? { id: null, text: '', colour: COLOURS[0] } : null)
  const [saving, setSaving] = useState(false)
  const [space, setSpace] = useState({ w: 0, h: 0 }) // room for the photo on screen
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // While dragging: where it started, and whether the edit before it is saved for Undo yet.
  const drag = useRef<{ what: Drag; x: number; y: number; start: Edit; saved: boolean } | null>(null)

  useBack(true, LEVEL.cover, onClose)

  // Open the photo.
  useEffect(() => {
    let stillHere = true
    let opened: ImageBitmap | null = null
    loadForEditing(file)
      .then((bitmap) => {
        opened = bitmap
        if (stillHere) setImage(bitmap)
        else bitmap.close()
      })
      .catch((err) => {
        console.error(err)
        if (stillHere) setFailed(true)
      })
    return () => {
      stillHere = false
      opened?.close()
    }
  }, [file])

  // How much room there is (it changes when the window is resized or a phone is turned).
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setSpace({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [])

  // What's on screen: the whole turned photo while cropping, otherwise just the part that's kept.
  const shown = mode === 'crop' ? WHOLE : edit.crop
  const [tw, th] = image ? turnedSize(image.width, image.height, edit.turns) : [1, 1]
  const aspect = (shown.w * tw) / (shown.h * th)
  const fit = Math.min(space.w / aspect, space.h)
  const size = { w: Math.max(1, Math.floor(fit * aspect)), h: Math.max(1, Math.floor(fit)) }

  // Draw it again whenever something changes. (Sharp on phone screens: more pixels than CSS pixels.)
  useEffect(() => {
    const el = canvas.current
    if (!el || !image) return
    const ratio = window.devicePixelRatio || 1
    el.width = Math.round(size.w * ratio)
    el.height = Math.round(size.h * ratio)
    const now = line ? { ...edit, strokes: [...edit.strokes, line] } : edit
    drawEdit(el.getContext('2d')!, image, now, el.width, el.height, mode !== 'crop')
  }, [image, edit, line, mode, size.w, size.h])

  // A change you can undo.
  const change = useCallback((next: Edit) => {
    setHistory((h) => [...h, edit])
    setEdit(next)
  }, [edit])
  function undo() {
    if (!history.length) return
    setEdit(history[history.length - 1])
    setHistory(history.slice(0, -1))
  }

  // Where the pointer is, as a fraction of the turned photo.
  function spot(e: React.PointerEvent): Point {
    const r = canvas.current!.getBoundingClientRect()
    const u = (e.clientX - r.left) / r.width
    const v = (e.clientY - r.top) / r.height
    return [shown.x + u * shown.w, shown.y + v * shown.h]
  }

  // ----- Pressing on the photo: draw, or pick up some words -----
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!image || mode === 'crop') return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = spot(e)
    if (mode === 'draw') return setLine({ colour, size: PEN, points: [[x, y]] })
    const ctx = canvas.current!.getContext('2d')!
    const hit = [...edit.labels].reverse().find((l) => {
      const b = labelBox(ctx, l, tw, th)
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
    })
    if (hit) drag.current = { what: { kind: 'label', id: hit.id }, x: e.clientX, y: e.clientY, start: edit, saved: false }
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (line) {
      const [x, y] = spot(e)
      setLine({ ...line, points: [...line.points, [x, y]] })
      return
    }
    dragTo(e)
  }
  function up() {
    if (line) {
      change({ ...edit, strokes: [...edit.strokes, line] })
      setLine(null)
      return
    }
    const d = drag.current
    drag.current = null
    // A tap on some words (no dragging): change them.
    if (d?.what.kind === 'label' && !d.saved) {
      const id = d.what.id
      const label = edit.labels.find((l) => l.id === id)
      if (label) setTyping({ id, text: label.text, colour: label.colour })
    }
  }

  // Dragging words or a crop corner. The edit before the drag is saved for Undo once it really moves.
  function dragTo(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const r = canvas.current!.getBoundingClientRect()
    const dx = ((e.clientX - d.x) / r.width) * shown.w
    const dy = ((e.clientY - d.y) / r.height) * shown.h
    if (!d.saved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) return
    if (!d.saved) {
      setHistory((h) => [...h, d.start])
      d.saved = true
    }
    const what = d.what
    if (what.kind === 'crop') setEdit({ ...d.start, crop: dragCrop(d.start.crop, what.handle, dx, dy) })
    else setEdit({ ...d.start, labels: d.start.labels.map((l) => (l.id === what.id ? { ...l, x: l.x + dx, y: l.y + dy } : l)) })
  }
  function startCropDrag(e: React.PointerEvent<HTMLElement>, handle: Handle) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { what: { kind: 'crop', handle }, x: e.clientX, y: e.clientY, start: edit, saved: false }
  }

  // ----- Words -----
  function saveWords() {
    if (!typing) return
    const text = typing.text.trim()
    setTyping(null)
    if (typing.id === null) {
      if (!text) return
      const middle = { x: edit.crop.x + edit.crop.w / 2, y: edit.crop.y + edit.crop.h / 2 }
      change({ ...edit, labels: [...edit.labels, { id: nextLabel++, text, colour: typing.colour, ...middle, size: TEXT, turns: 0 }] })
    } else {
      // (Emptied: the words are taken off.)
      const labels = text
        ? edit.labels.map((l) => (l.id === typing.id ? { ...l, text, colour: typing.colour } : l))
        : edit.labels.filter((l) => l.id !== typing.id)
      change({ ...edit, labels })
    }
  }

  // ----- Crop and rotate -----
  // Back to the photo as it came: turn it until it's the right way up, keep all of it.
  function reset() {
    let next = edit
    while (next.turns) next = turnLeft(next)
    change({ ...next, crop: WHOLE })
  }

  async function finish() {
    if (!image || saving) return
    if (isFresh(edit)) return onClose() // nothing changed
    setSaving(true)
    try {
      onDone(await renderEdit(image, edit))
    } catch (err) {
      console.error(err)
      setSaving(false)
      setFailed(true)
    }
  }

  // Esc closes the words box, then the tool, then the editor.
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (typing) setTyping(null)
      else if (mode) setMode(null)
      else onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [typing, mode, onClose])

  const pct = (v: number) => `${v * 100}%`
  const tool = (name: Mode, icon: 'crop' | 'pen', label: string) => (
    <button className={mode === name ? 'icon on' : 'icon'} aria-label={label} title={label} aria-pressed={mode === name} onClick={() => setMode(mode === name ? null : name)}>
      <Icon name={icon} />
    </button>
  )
  const colours = (picked: string, pick: (c: string) => void) => (
    <div className="colour-dots" role="radiogroup" aria-label={t.colour}>
      {COLOURS.map((c, i) => (
        <button key={c} role="radio" aria-checked={picked === c} aria-label={`${t.colour} ${i + 1}`} className={picked === c ? 'on' : ''} style={{ background: c }} onClick={() => pick(c)} />
      ))}
    </div>
  )

  return createPortal(
    <div className="photo-editor" role="dialog" aria-label={t.editPhoto}>
      <header>
        <button className="icon" aria-label={t.cancel} title={t.cancel} onClick={onClose}>
          <Icon name="close" />
        </button>
        <span className="spacer" />
        <button className="icon" aria-label={t.undo} title={t.undo} disabled={!history.length} onClick={undo}>
          <Icon name="undo" />
        </button>
        {tool('crop', 'crop', t.cropRotate)}
        <button className="icon" aria-label={t.addText} title={t.addText} onClick={() => (setMode(null), setTyping({ id: null, text: '', colour: COLOURS[0] }))}>
          <Icon name="text" />
        </button>
        {tool('draw', 'pen', t.draw)}
      </header>

      <div className="editor-stage" ref={stage}>
        {failed ? (
          <p className="error">{t.photoNotSent}</p>
        ) : !image ? (
          <span className="spinner" />
        ) : (
          <div className="editor-photo" style={{ width: size.w, height: size.h }}>
            <canvas
              ref={canvas}
              className={mode === 'draw' ? 'drawing' : ''}
              style={{ width: size.w, height: size.h }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
            {mode === 'crop' && (
              <div
                className="crop-box"
                style={{ left: pct(edit.crop.x), top: pct(edit.crop.y), width: pct(edit.crop.w), height: pct(edit.crop.h) }}
                onPointerDown={(e) => startCropDrag(e, 'move')}
                onPointerMove={dragTo}
                onPointerUp={() => (drag.current = null)}
              >
                {HANDLES.map((h) => (
                  <span
                    key={h}
                    className={'crop-handle ' + h}
                    onPointerDown={(e) => startCropDrag(e, h)}
                    onPointerMove={dragTo}
                    onPointerUp={() => (drag.current = null)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer>
        {mode === 'draw' && colours(colour, setColour)}
        {mode === 'crop' && (
          <div className="crop-tools">
            <button className="icon" aria-label={t.rotate} title={t.rotate} onClick={() => change(turnLeft(edit))}>
              <Icon name="rotate" />
            </button>
            <button className="link" onClick={reset}>
              {t.reset}
            </button>
          </div>
        )}
        <span className="spacer" />
        <button className="round-btn" aria-label={t.done} title={t.done} disabled={!image || saving} onClick={() => (mode ? setMode(null) : finish())}>
          {saving ? <span className="spinner" /> : <Icon name="check" />}
        </button>
      </footer>

      {typing && (
        <div className="text-entry" role="dialog" aria-label={t.addText}>
          <textarea
            dir="auto"
            autoFocus
            rows={2}
            maxLength={200}
            placeholder={t.typeSomething}
            aria-label={t.addText}
            value={typing.text}
            style={{ color: typing.colour }}
            onChange={(e) => setTyping({ ...typing, text: e.target.value })}
          />
          {colours(typing.colour, (c) => setTyping({ ...typing, colour: c }))}
          <div className="text-entry-buttons">
            <button className="link" onClick={() => setTyping(null)}>
              {t.cancel}
            </button>
            <button className="btn small" onClick={saveWords}>
              {t.done}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
