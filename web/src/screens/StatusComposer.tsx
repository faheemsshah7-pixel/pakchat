// StatusComposer.tsx: writing a words-only status, full screen, like WhatsApp's pencil.
// Type on the colour. The T button changes the letters, the palette changes the colour.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { MAX_STATUS_TEXT, STATUS_COLOURS, STATUS_FONTS, statusTextSize } from '../status'
import Icon from './Icon'

type Props = { privacy: string; onPost: (text: string, bg: number, font: number) => void; onClose: () => void }

export default function StatusComposer({ privacy, onPost, onClose }: Props) {
  const { t } = useT()
  const [text, setText] = useState('')
  const [bg, setBg] = useState(() => Math.floor(Math.random() * STATUS_COLOURS.length))
  const [font, setFont] = useState(0)
  const box = useRef<HTMLTextAreaElement>(null)
  useBack(true, LEVEL.cover, onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The box grows with the words, so they stay in the middle.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [text, font])

  const words = text.trim()
  return createPortal(
    <div className="status-composer" style={{ background: STATUS_COLOURS[bg] }} role="dialog" aria-label={t.textStatus}>
      <header>
        <button className="icon" aria-label={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
        <span className="grow" />
        <button className="icon" aria-label={t.changeFont} title={t.changeFont} onClick={() => setFont((font + 1) % STATUS_FONTS.length)}>
          <Icon name="font" />
        </button>
        <button className="icon" aria-label={t.changeColour} title={t.changeColour} onClick={() => setBg((bg + 1) % STATUS_COLOURS.length)}>
          <Icon name="palette" />
        </button>
      </header>
      <div className="composer-stage" onClick={() => box.current?.focus()}>
        <textarea
          ref={box}
          dir="auto"
          rows={1}
          placeholder={t.typeStatus}
          aria-label={t.typeStatus}
          maxLength={MAX_STATUS_TEXT}
          value={text}
          autoFocus
          style={{ fontFamily: STATUS_FONTS[font], fontSize: statusTextSize(text) }}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <footer>
        <span className="privacy-note">
          <Icon name="lock" size={14} /> {privacy}
        </span>
        <button className="round-btn" aria-label={t.postStatus} title={t.postStatus} disabled={!words} onClick={() => onPost(words, bg, font)}>
          <Icon name="send" />
        </button>
      </footer>
    </div>,
    document.body,
  )
}
