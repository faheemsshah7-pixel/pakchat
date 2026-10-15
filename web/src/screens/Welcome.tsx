// Welcome.tsx: what the right-hand panel shows on a computer when no chat is open.
import { useState } from 'react'
import { useT } from '../lang'
import Icon from './Icon'
import Logo from './Logo'
import ThemePicker from './ThemePicker'

export default function Welcome() {
  const { t } = useT()
  const [picking, setPicking] = useState(false)
  return (
    <div className="pane welcome">
      <div className="glow">
        <Logo size={96} />
      </div>
      <h2>{t.welcomeTitle}</h2>
      <p>{t.welcomeText}</p>
      <button className="btn soft" onClick={() => setPicking(true)}>
        <Icon name="palette" size={18} /> {t.tryLook}
      </button>
      {picking && <ThemePicker onClose={() => setPicking(false)} />}
    </div>
  )
}
