// Popover.tsx: a small menu that pops up where you clicked (or next to a button),
// like the menu on a message or on a chat in the list. It moves itself so it never
// goes off the edge of the screen.
// An item can have a line above it (divider), or its own small menu that opens beside it (sub),
// like WhatsApp's "Mute ›" with 8 hours, 1 week and Always.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import Icon, { type IconName } from './Icon'

export type PopoverItem = { label: string; onClick?: () => void; icon?: IconName; danger?: boolean; divider?: boolean; sub?: PopoverItem[] }

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
  const [sub, setSub] = useState<{ item: PopoverItem; at: DOMRect } | null>(null) // the small menu beside an item
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
        {items.map((item) => {
          const classes = [item.danger && 'danger', item.divider && 'divider', item.sub && 'has-sub', sub?.item === item && 'on'].filter(Boolean).join(' ')
          const openSub = (e: React.SyntheticEvent<HTMLButtonElement>) => setSub({ item, at: e.currentTarget.getBoundingClientRect() })
          return (
            <button
              key={item.label}
              role="menuitem"
              aria-haspopup={item.sub ? 'menu' : undefined}
              className={classes}
              onMouseEnter={item.sub ? openSub : () => setSub(null)}
              onClick={(e) => {
                if (item.sub) return openSub(e)
                onClose()
                item.onClick?.()
              }}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              {item.label}
              {item.sub && <Icon name="chevronRight" size={16} />}
            </button>
          )
        })}
      </div>
      {sub?.item.sub && <SubMenu items={sub.item.sub} at={sub.at} onClose={onClose} />}
    </>,
    document.body,
  )
}

// The small menu beside an item: on its right, or its left if there's no room.
function SubMenu({ items, at, onClose }: { items: PopoverItem[]; at: DOMRect; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: at.right, top: at.top, ready: false })
  useLayoutEffect(() => {
    const rect = box.current!.getBoundingClientRect()
    const left = at.right + rect.width + 4 > window.innerWidth ? Math.max(8, at.left - rect.width - 4) : at.right + 4
    const top = Math.max(8, Math.min(at.top - 6, window.innerHeight - rect.height - 8))
    setPlace({ left, top, ready: true })
  }, [at])
  return (
    <div ref={box} className="menu-items popover sub-menu" role="menu" style={{ left: place.left, top: place.top, visibility: place.ready ? 'visible' : 'hidden' }}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose()
            item.onClick?.()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
