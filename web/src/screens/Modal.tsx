// Modal.tsx: a window on top of everything, with a title and a close button.
// Esc or a click outside closes it. Used for forwarding, message info, deleting, and more.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import Icon from './Icon'

type Props = { title: string; onClose: () => void; children: ReactNode; className?: string }

export default function Modal({ title, onClose, children, className = '' }: Props) {
  const { t } = useT()
  useBack(true, LEVEL.window, onClose) // the phone's Back button closes it too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // createPortal puts the window at the end of the page, so it covers everything.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={'modal ' + className} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon" aria-label={t.close} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}
