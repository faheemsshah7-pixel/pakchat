// Popover.tsx: a small menu that pops up where you clicked (or next to a button),
// like the menu on a message or on a chat in the list. It moves itself so it never
// goes off the edge of the screen.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import Icon, { type IconName } from './Icon'

export type PopoverItem = { label: string; onClick: () => void; icon?: IconName; danger?: boolean }

type Props = {
  x: number // where to open (the click, or a button's corner)
  y: number
  onClose: () => void
  items: PopoverItem[]
  top?: ReactNode // something above the items (the message menu puts emoji reactions here)
}

export default function Popover({ x, y, onClose, items, top }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: x, top: y, ready: false })
  useBack(true, LEVEL.menu, onClose)

  // Measure the menu, then nudge it back on screen if it would stick out.
  useLayoutEffect(() => {
    const rect = box.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height) : y
    setPlace({ left, top, ready: true })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div className="menu-backdrop top" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={box}
        className="menu-items popover"
        role="menu"
        style={{ left: place.left, top: place.top, visibility: place.ready ? 'visible' : 'hidden' }}
      >
        {top}
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.icon && <Icon name={item.icon} size={18} />}
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}
