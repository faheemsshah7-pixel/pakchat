// Menu.tsx: the ⋮ button that opens a small list of actions.
import { useState } from 'react'

export type MenuItem = { label: string; onClick: () => void; danger?: boolean }

export default function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu">
      <button className="icon" aria-label={label} onClick={() => setOpen(!open)}>
        ⋮
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
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
