// MediaBubbles.tsx: how photos and voice notes look inside a chat bubble.
// Each one downloads its file only when it appears on screen (see media.ts).
import { useEffect, useRef, useState } from 'react'
import { loadMedia } from '../media'
import { duration } from '../time'

function useMedia(chatId: string, mediaId: string | undefined) {
  const [data, setData] = useState<string | null>(null)
  useEffect(() => {
    if (!mediaId) return
    let stillHere = true
    loadMedia(chatId, mediaId)
      .then((loaded) => stillHere && setData(loaded))
      .catch(console.error)
    return () => {
      stillHere = false
    }
  }, [chatId, mediaId])
  return data
}

type PhotoProps = { chatId: string; mediaId?: string; width?: number; height?: number; onView: (data: string) => void }

export function PhotoBubble({ chatId, mediaId, width = 4, height = 3, onView }: PhotoProps) {
  const data = useMedia(chatId, mediaId)
  // Keep the right shape while it loads, so the chat doesn't jump around.
  const style = { aspectRatio: `${width} / ${height}` }
  if (!data) return <div className="photo loading" style={style} />
  return <img className="photo" style={style} src={data} alt="" onClick={() => onView(data)} />
}

export function VoiceBubble({ chatId, mediaId, seconds = 0 }: { chatId: string; mediaId?: string; seconds?: number }) {
  const data = useMedia(chatId, mediaId)
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  function toggle() {
    if (!audio.current) return
    if (playing) audio.current.pause()
    else audio.current.play().catch(console.error)
  }

  return (
    <div className="voice">
      <button type="button" className="icon round" disabled={!data} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
      </button>
      <progress max={seconds || 1} value={position} />
      <span className="voice-time">{duration(playing ? position : seconds)}</span>
      {data && (
        <audio
          ref={audio}
          src={data}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setPosition(0)
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        />
      )}
    </div>
  )
}
