// ThemePicker.tsx: a window showing every look side by side. Tap one to switch.
// Each little preview is drawn with that look's own colours (data-theme on the preview).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../lang'
import { applyTheme, savedTheme, THEMES, type Theme } from '../theme'
import Icon from './Icon'

export default function ThemePicker({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const [current, setCurrent] = useState<Theme>(savedTheme)

  // Esc closes the window too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function choose(theme: Theme) {
    applyTheme(theme)
    setCurrent(theme)
  }

  // createPortal puts the window at the end of the page, so it covers everything.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      {/* Clicks inside the window shouldn't close it. */}
      <div className="modal" role="dialog" aria-label={t.chooseLook} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t.chooseLook}</h2>
          <button className="icon" aria-label={t.cancel} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="themes">
          {THEMES.map((theme) => (
            <button
              key={theme}
              className={theme === current ? 'theme-card on' : 'theme-card'}
              aria-pressed={theme === current}
              onClick={() => choose(theme)}
            >
              {theme === 'auto' ? (
                // Auto: half Emerald, half Midnight.
                <span className="preview split">
                  <Preview theme="emerald" />
                  <Preview theme="midnight" />
                </span>
              ) : (
                <span className="preview">
                  <Preview theme={theme} />
                </span>
              )}
              <span className="theme-name">
                {t.themeNames[theme]}
                {theme === current && <Icon name="check" size={16} />}
              </span>
              <span className="theme-about">{t.themeAbout[theme]}</span>
            </button>
          ))}
        </div>
        <button className="btn" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </div>,
    document.body,
  )
}

// A tiny drawing of the app: a top bar, and three chat bubbles.
function Preview({ theme }: { theme: Exclude<Theme, 'auto'> }) {
  return (
    <span className="mini" data-theme={theme}>
      <span className="mini-bar" />
      <span className="mini-wall">
        <span className="mini-in" />
        <span className="mini-out" />
        <span className="mini-in short" />
      </span>
    </span>
  )
}
