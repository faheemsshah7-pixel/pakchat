// VideoViewer.tsx: a video on the whole screen, playing, with the browser's own controls
// (play, pause, the time bar, sound, full screen). Like the photo viewer: who sent it and when
// at the top, Download, and ✕ (or Esc) to close.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import Icon from './Icon'

type Props = { src: string; who: string; when: string; caption?: string; fileName: string; onClose: () => void }

export default function VideoViewer({ src, who, when, caption, fileName, onClose }: Props) {
  const { t } = useT()
  useBack(true, LEVEL.cover, onClose)
  const viewer = useRef<HTMLDivElement>(null)
  useEffect(() => viewer.current?.focus(), [])

  return createPortal(
    <div className={caption ? 'viewer is-video has-caption' : 'viewer is-video'} ref={viewer} tabIndex={-1} role="dialog" aria-label={who}>
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <video src={src} controls autoPlay playsInline />
      </div>
      <header>
        <span className="viewer-who">
          <strong dir="auto">{who}</strong>
          <small>{when}</small>
        </span>
        <a className="icon" href={src} download={fileName} aria-label={t.download} title={t.download}>
          <Icon name="download" />
        </a>
        <button className="icon" aria-label={t.close} title={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {caption && (
        <p className="viewer-caption" dir="auto">
          {caption}
        </p>
      )}
    </div>,
    document.body,
  )
}
