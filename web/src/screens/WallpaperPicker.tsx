// WallpaperPicker.tsx: pick the background behind a chat's messages (wallpaper.ts):
// "Default", a colour (with or without little drawings), or one of your photos.
// The preview at the top shows how the chat will look, before you save it.
// For one chat, "Default" is the wallpaper for all chats (from Settings). In Settings, it's the look's own.
import { useRef, useState } from 'react'
import { useT } from '../lang'
import { shrinkPhoto } from '../media'
import { MAX_DIM, WALL_COLOURS, wallStyle, type Wallpaper } from '../wallpaper'
import Icon from './Icon'
import Modal from './Modal'
import Switch from './Switch'

type Props = {
  title: string
  current: Wallpaper | null // what's saved now (null = Default)
  usual: Wallpaper | null // what "Default" looks like (null = the look's own)
  onSave: (wall: Wallpaper | null) => Promise<unknown>
  onClose: () => void
}

export default function WallpaperPicker({ title, current, usual, onSave, onClose }: Props) {
  const { t } = useT()
  const [wall, setWall] = useState<Wallpaper | null>(current)
  // Your photo, once there is one (so you can try a colour, then go back to it).
  const [photo, setPhoto] = useState(current?.kind === 'photo' ? current.data : undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // A photo from your device, made smaller so it fits in one document (like a photo message, media.ts).
  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const { data } = await shrinkPhoto(file)
      setPhoto(data)
      setWall({ kind: 'photo', data, dim: 0 })
    } catch (err) {
      console.warn(err)
      setError(t.wallPhotoProblem)
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await onSave(wall)
      onClose()
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
      setBusy(false)
    }
  }

  const tile = (on: boolean) => (on ? 'wall-tile on' : 'wall-tile')
  return (
    <Modal title={title} onClose={onClose} className="narrow wall-picker">
      {/* How the chat will look: two messages on the wallpaper */}
      <div className="wall wall-preview" style={wallStyle(wall ?? usual)} aria-hidden>
        <span className="sample" dir="auto">
          {t.wallSampleIn}
        </span>
        <span className="sample mine" dir="auto">
          {t.wallSampleOut}
        </span>
      </div>

      <div className="wall-tiles" role="radiogroup" aria-label={title}>
        <button role="radio" aria-checked={!wall} className={tile(!wall)} onClick={() => setWall(null)}>
          <span className="wall wall-swatch" style={wallStyle(usual)} />
          <small>{t.wallDefault}</small>
        </button>
        {WALL_COLOURS.map((colour) => {
          const on = wall?.kind === 'colour' && wall.colour === colour
          // (A new colour keeps the doodles setting you had.)
          const doodles = wall?.kind === 'colour' ? wall.doodles !== false : true
          return (
            <button key={colour} role="radio" aria-checked={on} aria-label={`${t.colour} ${colour}`} className={tile(on)} onClick={() => setWall({ kind: 'colour', colour, doodles })}>
              <span className="wall-swatch" style={{ background: colour }} />
            </button>
          )
        })}
        <button
          role="radio"
          aria-checked={wall?.kind === 'photo'}
          className={tile(wall?.kind === 'photo')}
          onClick={() => (photo ? setWall({ kind: 'photo', data: photo, dim: wall?.kind === 'photo' ? wall.dim : 0 }) : input.current?.click())}
        >
          <span className="wall-swatch photo" style={photo ? { backgroundImage: `url("${photo}")` } : undefined}>
            {!photo && <Icon name="image" />}
          </span>
          <small>{t.wallPhoto}</small>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={pickPhoto} />
      </div>

      {wall?.kind === 'colour' && <Switch label={t.doodles} hint={t.doodlesHint} on={wall.doodles !== false} onChange={(on) => setWall({ ...wall, doodles: on })} />}
      {wall?.kind === 'photo' && (
        <div className="setting static wall-dim">
          <span className="setting-text">
            <span>{t.dim}</span>
          </span>
          <input type="range" min={0} max={MAX_DIM} step={0.05} value={wall.dim ?? 0} aria-label={t.dim} onChange={(e) => setWall({ ...wall, dim: Number(e.target.value) })} />
          <button className="btn small secondary" onClick={() => input.current?.click()}>
            {t.changePhoto}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy} onClick={save}>
        <Icon name="check" size={18} /> {t.setWallpaper}
      </button>
    </Modal>
  )
}
