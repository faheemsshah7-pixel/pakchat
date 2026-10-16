// Menu.tsx: the ⋮ button that opens a small list of actions. Esc or a click outside closes it.
import { useEffect, useState } from 'react'
import { LEVEL, useBack } from '../back'
import Icon, { type IconName } from './Icon'

export type MenuItem = { label: string; onClick: () => void; icon?: IconName; danger?: boolean }

export default function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  useBack(open, LEVEL.menu, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="menu">
      <button className="icon" aria-label={label} title={label} onClick={() => setOpen(!open)}>
        <Icon name="dots" />
      </button>
      {open && (
        <>
          {/* An invisible layer over the page: clicking anywhere else closes the menu. */}
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-items">
            {items.map((item) => (
              <button
                key={item.label}
                className={item.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
