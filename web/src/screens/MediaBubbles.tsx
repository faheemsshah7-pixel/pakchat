// MediaBubbles.tsx: how photos, videos, voice notes and documents look inside a chat bubble.
// Photos and voice notes download when they appear on screen (see media.ts).
// A video shows its first picture; the video itself downloads when you tap it. Same for documents.
import { useRef, useState, useSyncExternalStore } from 'react'
import type { Message } from '../chats'
import { useT } from '../lang'
import { loadMediaUrl, sizeText, useMedia } from '../media'
import { duration } from '../time'
import Icon from './Icon'

type PhotoProps = { chatId: string; mediaId?: string; width?: number; height?: number; onView: (data: string) => void }

export function PhotoBubble({ chatId, mediaId, width = 4, height = 3, onView }: PhotoProps) {
  const data = useMedia(chatId, mediaId)
  // Keep the right shape while it loads, so the chat doesn't jump around.
  const style = { aspectRatio: `${width} / ${height}` }
  if (!data) return <div className="photo loading" style={style} />
  return <img className="photo" style={style} src={data} alt="" onClick={() => onView(data)} />
}

// A video: its first picture, a play button and how long it is. Tap it to load and watch it.
type VideoProps = { chatId: string; m: Message; onView: (url: string) => void }
export function VideoBubble({ chatId, m, onView }: VideoProps) {
  const { t } = useT()
  const poster = useMedia(chatId, m.posterId)
  const [state, setState] = useState<'ready' | 'loading' | 'failed'>('ready')
  async function open() {
    if (!m.mediaId || state === 'loading') return
    setState('loading')
    try {
      onView(await loadMediaUrl(chatId, m.mediaId))
      setState('ready')
    } catch (err) {
      console.error(err)
      setState('failed')
    }
  }
  const style = { aspectRatio: `${m.width ?? 16} / ${m.height ?? 9}` }
  return (
    <button type="button" className="video-thumb" onClick={open} aria-label={t.playVideo}>
      {poster ? <img className="photo" style={style} src={poster} alt="" /> : <span className="photo loading" style={style} />}
      <span className="play-big">{state === 'loading' ? <span className="spinner" /> : <Icon name={state === 'failed' ? 'download' : 'play'} size={26} />}</span>
      <span className="video-length">
        <Icon name="video" size={14} />
        {duration(m.seconds ?? 0)}
      </span>
    </button>
  )
}

// A document: an icon with its type (PDF, DOCX…), its name and size. Tap it to download it.
export function FileBubble({ chatId, m }: { chatId: string; m: Message }) {
  const { t } = useT()
  const [state, setState] = useState<'ready' | 'loading' | 'failed'>('ready')
  const name = m.fileName ?? 'file'
  const type = name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : ''
  async function save() {
    if (!m.mediaId || state === 'loading') return
    setState('loading')
    try {
      const link = document.createElement('a')
      link.href = await loadMediaUrl(chatId, m.mediaId)
      link.download = name
      link.click()
      setState('ready')
    } catch (err) {
      console.error(err)
      setState('failed')
    }
  }
  return (
    <button type="button" className="file-card" onClick={save} title={t.download}>
      <span className={'file-type ' + fileColour(type)}>{type || <Icon name="file" size={20} />}</span>
      <span className="file-words">
        <strong dir="auto">{name}</strong>
        <small>
          {state === 'failed' ? t.downloadFailed : [sizeText(m.fileSize), type].filter(Boolean).join(' · ')}
        </small>
      </span>
      <span className="file-get">{state === 'loading' ? <span className="spinner" /> : <Icon name="download" size={20} />}</span>
    </button>
  )
}

// PDFs are red, Word blue, Excel green, PowerPoint orange, like the apps' own colours.
function fileColour(type: string) {
  if (type === 'PDF') return 'red'
  if (['DOC', 'DOCX', 'TXT', 'RTF', 'ODT'].includes(type)) return 'blue'
  if (['XLS', 'XLSX', 'CSV', 'ODS'].includes(type)) return 'green'
  if (['PPT', 'PPTX', 'KEY', 'ODP'].includes(type)) return 'orange'
  return 'grey'
}

const SPEEDS = [1, 1.5, 2]

// The voice note playing right now, in any chat. Only one plays at a time, like WhatsApp:
// pressing play on another one pauses this one first.
let nowPlaying: HTMLAudioElement | null = null

// The speed is ONE setting for all voice notes, like WhatsApp: pick 1.5× on one, and the next
// one plays at 1.5× too. It's saved on this device, so it's still 1.5× tomorrow.
let speed = loadSpeed()
const speedListeners = new Set<() => void>()

function loadSpeed() {
  try {
    const saved = Number(localStorage.getItem('voiceSpeed'))
    return SPEEDS.includes(saved) ? saved : 1
  } catch {
    return 1 // private windows can block storage
  }
}

// 1× -> 1.5× -> 2× -> 1×
function nextSpeed() {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
  try {
    localStorage.setItem('voiceSpeed', String(speed))
  } catch {
    // not saved, but it still works until you close the app
  }
  if (nowPlaying) nowPlaying.playbackRate = speed // the one playing speeds up straight away
  speedListeners.forEach((listener) => listener())
}

function useSpeed() {
  return useSyncExternalStore(
    (listener) => {
      speedListeners.add(listener)
      return () => speedListeners.delete(listener)
    },
    () => speed,
  )
}

export function VoiceBubble({ chatId, mediaId, seconds = 0 }: { chatId: string; mediaId?: string; seconds?: number }) {
  const data = useMedia(chatId, mediaId)
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const speed = useSpeed()

  function toggle() {
    if (!audio.current) return
    if (playing) audio.current.pause()
    else audio.current.play().catch(console.error)
  }

  // Click on the line to jump to that part of the voice note.
  function seek(e: React.MouseEvent<HTMLProgressElement>) {
    if (!audio.current || !seconds) return
    const r = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientX - r.left) / r.width
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    audio.current.currentTime = (rtl ? 1 - fraction : fraction) * seconds
  }

  return (
    <div className="voice">
      <button type="button" className="play" disabled={!data} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <progress max={seconds || 1} value={position} onClick={seek} />
      <span className="voice-time">{duration(playing || position ? position : seconds)}</span>
      <button type="button" className="speed" onClick={nextSpeed} aria-label="Speed">
        {speed}×
      </button>
      {data && (
        <audio
          ref={audio}
          src={data}
          onPlay={(e) => {
            if (nowPlaying && nowPlaying !== e.currentTarget) nowPlaying.pause()
            nowPlaying = e.currentTarget
            e.currentTarget.playbackRate = speed
            setPlaying(true)
          }}
          onPause={(e) => {
            if (nowPlaying === e.currentTarget) nowPlaying = null
            setPlaying(false)
          }}
          onEnded={(e) => {
            if (nowPlaying === e.currentTarget) nowPlaying = null
            setPlaying(false)
            setPosition(0)
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        />
      )}
    </div>
  )
}
