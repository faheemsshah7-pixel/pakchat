// OnceViewer.tsx: a "view once" photo, video or voice note, open on the whole screen (once.ts).
// Like the photo viewer, but with no Download, zoom or right-click menu, and a note that it's view once.
// When you close it (✕, Esc or Back), it's gone for good.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { duration } from '../time'
import Icon from './Icon'

type Props = { kind: 'photo' | 'video' | 'voice'; src: string; who: string; onClose: () => void }

export default function OnceViewer({ kind, src, who, onClose }: Props) {
  const { t } = useT()
  useBack(true, LEVEL.cover, onClose)
  const viewer = useRef<HTMLDivElement>(null)
  useEffect(() => viewer.current?.focus(), [])

  return createPortal(
    <div
      className={kind === 'photo' ? 'viewer once-viewer' : 'viewer once-viewer is-video'}
      ref={viewer}
      tabIndex={-1}
      role="dialog"
      aria-label={t.viewOnce}
      onContextMenu={(e) => e.preventDefault()} // (no "Save image as…")
    >
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {kind === 'photo' && <img src={src} alt="" draggable={false} />}
        {kind === 'video' && <video src={src} autoPlay playsInline controls controlsList="nodownload noplaybackrate" disablePictureInPicture />}
        {kind === 'voice' && <OnceVoice src={src} />}
      </div>
      <header>
        <span className="viewer-who">
          <strong dir="auto">{who}</strong>
          <small>
            <Icon name="once" size={13} /> {t.viewOnce}
          </small>
        </span>
        <button className="icon" aria-label={t.close} title={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
    </div>,
    document.body,
  )
}

// A view once voice note: one big play button, the line it moves along, and the time. It starts by itself.
function OnceVoice({ src }: { src: string }) {
  const { t } = useT()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [length, setLength] = useState(0)
  useEffect(() => {
    audio.current?.play().catch(() => {}) // (if the browser won't start it by itself, the button does)
  }, [])
  return (
    <div className="once-voice">
      <button className="round-btn" aria-label={playing ? t.pause : t.play} onClick={() => (playing ? audio.current?.pause() : audio.current?.play().catch(console.error))}>
        <Icon name={playing ? 'pause' : 'play'} size={30} />
      </button>
      <progress max={length || 1} value={at} />
      <span>{duration(playing || at ? at : length)}</span>
      <audio
        ref={audio}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => (setPlaying(false), setAt(0))}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)}
      />
    </div>
  )
}
