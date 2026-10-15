// MediaBubbles.tsx: how photos and voice notes look inside a chat bubble.
// Each one downloads its file only when it appears on screen (see media.ts).
import { useRef, useState } from 'react'
import { useMedia } from '../media'
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

const SPEEDS = [1, 1.5, 2]

// The voice note playing right now, in any chat. Only one plays at a time, like WhatsApp:
// pressing play on another one pauses this one first.
let nowPlaying: HTMLAudioElement | null = null

export function VoiceBubble({ chatId, mediaId, seconds = 0 }: { chatId: string; mediaId?: string; seconds?: number }) {
  const data = useMedia(chatId, mediaId)
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [speed, setSpeed] = useState(1)

  function toggle() {
    if (!audio.current) return
    if (playing) audio.current.pause()
    else audio.current.play().catch(console.error)
  }

  // 1× -> 1.5× -> 2× -> 1×, like WhatsApp.
  function nextSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    if (audio.current) audio.current.playbackRate = next
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
