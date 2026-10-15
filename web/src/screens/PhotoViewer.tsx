// PhotoViewer.tsx: a photo on the whole screen, like WhatsApp.
// It opens fitted inside the screen, the right shape, never stretched. To see details, zoom in:
//   the + and − buttons at the top, the mouse wheel (or pinching on a trackpad),
//   double-clicking (or double-tapping) a spot, or pinching with two fingers on a phone.
// Zoomed in, drag the photo to look around. Esc, ✕, or a click beside the photo closes it.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../lang'
import Icon from './Icon'

const MAX = 5 // at most 5 times bigger
const STEP = 1.6 // one press of + or −
// How big the photo is, and how far it was moved from the middle of the screen (in pixels).
// smooth: glide to it (buttons, double-click), instead of following a finger exactly.
type View = { scale: number; x: number; y: number; smooth?: boolean }
const FITTED: View = { scale: 1, x: 0, y: 0, smooth: true }

type Props = { src: string; who: string; when: string; caption?: string; fileName: string; onClose: () => void }

export default function PhotoViewer({ src, who, when, caption, fileName, onClose }: Props) {
  const { t } = useT()
  const [view, setView] = useState<View>(FITTED)
  const viewer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const photo = useRef<HTMLImageElement>(null)
  const fingers = useRef(new Map<number, { x: number; y: number }>()) // fingers (or the mouse) on the screen
  const press = useRef({ x: 0, y: 0, moved: false, onPhoto: false })
  const lastTap = useRef({ time: 0, x: 0, y: 0 })

  // Keep the photo on screen: no smaller than fitted, and no dragging its edge in past the screen's.
  // (x and y are how far the photo's middle moved; it starts in the middle of its space.)
  function limit(next: View): View {
    const scale = Math.min(MAX, Math.max(1, next.scale))
    const img = photo.current
    // (Under 1.01 counts as fitted: 1.6 × 1.6 ÷ 1.6 ÷ 1.6 comes out as 1.0000000000000002.)
    if (scale < 1.01 || !stage.current || !img) return { ...FITTED, smooth: next.smooth }
    function clamp(move: number, middle: number, size: number, screen: number) {
      const half = (size * scale) / 2
      if (half * 2 <= screen) return 0 // still narrower than the screen: keep it in the middle
      return Math.min(half - middle, Math.max(screen - middle - half, move))
    }
    return {
      scale,
      x: clamp(next.x, img.offsetLeft + img.offsetWidth / 2, img.offsetWidth, stage.current.clientWidth),
      y: clamp(next.y, img.offsetTop + img.offsetHeight / 2, img.offsetHeight, stage.current.clientHeight),
      smooth: next.smooth,
    }
  }

  // Zoom by `factor`, keeping the spot under the pointer where it is (or the middle, for buttons).
  function zoomAt(factor: number, smooth: boolean, clientX?: number, clientY?: number) {
    setView((v) => {
      const img = photo.current!
      const box = stage.current!.getBoundingClientRect()
      // The pointer (or the middle of the screen), measured from where the photo's middle starts
      const px = (clientX ?? box.left + box.width / 2) - (box.left + img.offsetLeft + img.offsetWidth / 2)
      const py = (clientY ?? box.top + box.height / 2) - (box.top + img.offsetTop + img.offsetHeight / 2)
      const scale = Math.min(MAX, Math.max(1, v.scale * factor))
      const k = scale / v.scale
      return limit({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k, smooth })
    })
  }

  // The mouse wheel, and pinching on a Mac trackpad (it arrives as a wheel with Ctrl held).
  // { passive: false } so we can stop the browser zooming the whole page instead.
  useEffect(() => {
    const el = stage.current!
    function wheel(e: WheelEvent) {
      e.preventDefault()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), false, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })

  // Take the keyboard from the message box behind, so + and − zoom instead of typing.
  useEffect(() => {
    viewer.current?.focus()
  }, [])

  // Keys: + and − zoom, 0 fits it again. (Esc is ChatRoom.tsx's: it closes the photo.)
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === '+' || e.key === '=') zoomAt(STEP, true)
      else if (e.key === '-') zoomAt(1 / STEP, true)
      else if (e.key === '0') setView(FITTED)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  function down(e: React.PointerEvent) {
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId) // keep getting the moves, even off the photo
    if (fingers.current.size === 1) press.current = { x: e.clientX, y: e.clientY, moved: false, onPhoto: e.target === photo.current }
  }

  function move(e: React.PointerEvent) {
    const was = fingers.current.get(e.pointerId)
    if (!was) return
    const now = { x: e.clientX, y: e.clientY }
    if (Math.hypot(now.x - press.current.x, now.y - press.current.y) > 6) press.current.moved = true
    const other = [...fingers.current].find(([id]) => id !== e.pointerId)?.[1]
    if (other) {
      // Two fingers: zoom by how much they spread apart, around the point between them.
      const before = Math.hypot(was.x - other.x, was.y - other.y)
      const after = Math.hypot(now.x - other.x, now.y - other.y)
      if (before > 0) zoomAt(after / before, false, (now.x + other.x) / 2, (now.y + other.y) / 2)
    } else {
      // One finger (or the mouse): move the zoomed-in photo along with it.
      setView((v) => (v.scale > 1 ? limit({ scale: v.scale, x: v.x + now.x - was.x, y: v.y + now.y - was.y }) : v))
    }
    fingers.current.set(e.pointerId, now)
  }

  function up(e: React.PointerEvent) {
    if (!fingers.current.delete(e.pointerId) || fingers.current.size > 0 || press.current.moved) return
    // A tap (or click) that didn't move. (Where it started: after setPointerCapture,
    // e.target here is always the stage.)
    if (!press.current.onPhoto) {
      if (view.scale === 1) onClose() // beside the photo: close it
      return
    }
    const last = lastTap.current
    const double = e.timeStamp - last.time < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30
    lastTap.current = double ? { time: 0, x: 0, y: 0 } : { time: e.timeStamp, x: e.clientX, y: e.clientY }
    // Second tap on the photo: zoom in on that spot, or back out.
    if (double) {
      if (view.scale > 1) setView(FITTED)
      else zoomAt(2.5, true, e.clientX, e.clientY)
    }
  }

  const zoomed = view.scale > 1
  return createPortal(
    <div className={['viewer', zoomed && 'zoomed', caption && 'has-caption'].filter(Boolean).join(' ')} ref={viewer} tabIndex={-1} role="dialog" aria-label={who}>
      <div
        className="viewer-stage"
        ref={stage}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => fingers.current.delete(e.pointerId)}
      >
        <img
          ref={photo}
          className={view.smooth ? 'smooth' : ''}
          src={src}
          alt=""
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <header>
        <span className="viewer-who">
          <strong dir="auto">{who}</strong>
          <small>{when}</small>
        </span>
        <button className="icon" aria-label={t.zoomOut} title={t.zoomOut} disabled={!zoomed} onClick={() => zoomAt(1 / STEP, true)}>
          <Icon name="zoomOut" />
        </button>
        <button className="icon" aria-label={t.zoomIn} title={t.zoomIn} disabled={view.scale >= MAX} onClick={() => zoomAt(STEP, true)}>
          <Icon name="zoomIn" />
        </button>
        <a className="icon" href={src} download={fileName} aria-label={t.download} title={t.download}>
          <Icon name="download" />
        </a>
        <button className="icon" aria-label={t.close} title={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {caption && (
        <p className="viewer-caption" dir="auto">
          {caption}
        </p>
      )}
    </div>,
    document.body,
  )
}
