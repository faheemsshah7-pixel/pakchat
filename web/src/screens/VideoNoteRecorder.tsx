// VideoNoteRecorder.tsx: recording a round video message (videoNotes.ts), from the round
// camera button in the chat's bottom bar. Your front camera shows in a circle, and a ring
// fills up as the minute goes by.
//   ✕ throws it away    ■ stops, so you can watch it before sending    ➤ sends it
// At one minute it stops by itself, and waits for you to send it or throw it away.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { useStable } from '../stable'
import { duration, useNow } from '../time'
import { closeCamera, grabPoster, MAX_NOTE_SECONDS, noteContent, openCamera, recordNote, type NoteRecording } from '../videoNotes'
import Icon from './Icon'

type Content = Awaited<ReturnType<typeof noteContent>>
type Props = { onSend: (content: Content) => void; onClose: () => void }
type Taken = { blob: Blob; seconds: number; url: string }

const RING = 2 * Math.PI * 48 // the ring's length (its radius is 48 in a 100 × 100 box)

export default function VideoNoteRecorder({ onSend, onClose }: Props) {
  const { t } = useT()
  const [phase, setPhase] = useState<'starting' | 'recording' | 'review' | 'sending'>('starting')
  const [problem, setProblem] = useState('')
  const [taken, setTaken] = useState<Taken | null>(null)
  const [sound, setSound] = useState(false) // watching it back: with sound?
  const [started, setStarted] = useState(0) // when recording started
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recording = useRef<NoteRecording | null>(null)
  const shape = useRef({ poster: '', width: 480, height: 480 })
  const now = useNow(200)

  // Turn the camera on and start recording as soon as it shows a picture.
  useEffect(() => {
    let stillHere = true
    openCamera()
      .then(async (camera) => {
        if (!stillHere) return closeCamera(camera)
        stream.current = camera
        const video = preview.current!
        video.srcObject = camera
        await video.play().catch(() => {})
        if (!stillHere) return
        recording.current = recordNote(camera)
        setStarted(recording.current.started)
        setPhase('recording')
        // The picture shown before it plays: from just after the start (the camera needs a moment).
        setTimeout(() => {
          if (!stillHere || !video.videoWidth) return
          shape.current = { poster: grabPoster(video), width: video.videoWidth, height: video.videoHeight }
        }, 400)
      })
      .catch((err) => {
        console.error(err)
        if (stillHere) setProblem(t.cameraBlocked)
      })
    return () => {
      stillHere = false
      closeCamera(stream.current)
    }
  }, [t.cameraBlocked])

  // Let go of the recording's blob URL when it's no longer shown.
  useEffect(() => {
    if (!taken) return
    return () => URL.revokeObjectURL(taken.url)
  }, [taken])

  async function stop() {
    const rec = recording.current
    if (!rec) return null
    recording.current = null
    const video = preview.current
    if (!shape.current.poster && video?.videoWidth) shape.current = { poster: grabPoster(video), width: video.videoWidth, height: video.videoHeight }
    const { blob, seconds } = await rec.stop()
    closeCamera(stream.current)
    stream.current = null
    const result = { blob, seconds, url: URL.createObjectURL(blob) }
    setTaken(result)
    setPhase('review')
    return result
  }

  async function send() {
    if (phase === 'sending') return
    const done = taken ?? (await stop())
    if (!done) return
    setPhase('sending')
    try {
      onSend(await noteContent(done.blob, done.seconds, shape.current.poster, shape.current.width, shape.current.height))
    } catch (err) {
      console.error(err)
      setProblem(t.videoTooBig)
      setPhase('review')
    }
  }

  // One minute: stop by itself.
  const seconds = phase === 'recording' ? Math.max(0, Math.min(MAX_NOTE_SECONDS, (now - started) / 1000)) : (taken?.seconds ?? 0)
  const full = phase === 'recording' && seconds >= MAX_NOTE_SECONDS
  const stopNow = useStable(stop)
  useEffect(() => {
    if (full) void stopNow()
  }, [full, stopNow])

  useBack(true, LEVEL.cover, onClose)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  return createPortal(
    <div className="note-recorder" role="dialog" aria-label={t.videoNote}>
      <div className="note-circle">
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle className="note-ring-back" cx="50" cy="50" r="48" />
          <circle className="note-ring" cx="50" cy="50" r="48" strokeDasharray={RING} strokeDashoffset={RING * (1 - seconds / MAX_NOTE_SECONDS)} />
        </svg>
        {taken ? (
          <video key="back" src={taken.url} autoPlay loop playsInline muted={!sound} onClick={() => setSound(!sound)} aria-label={t.playVideo} />
        ) : (
          <video key="live" ref={preview} className="mirror" muted playsInline />
        )}
        {phase === 'starting' && !problem && <span className="spinner" />}
      </div>
      {problem ? (
        <p className="note-problem">{problem}</p>
      ) : (
        <p className="note-time">
          {phase === 'recording' && <span className="rec-dot" />}
          {duration(seconds)} <small>/ {duration(MAX_NOTE_SECONDS)}</small>
        </p>
      )}
      <div className="note-buttons">
        <button className="icon" aria-label={t.cancel} title={t.cancel} onClick={onClose}>
          <Icon name={phase === 'starting' || problem === t.cameraBlocked ? 'close' : 'trash'} />
        </button>
        {phase === 'recording' && (
          <button className="icon" aria-label={t.stopRecording} title={t.stopRecording} onClick={() => void stop()}>
            <Icon name="stop" />
          </button>
        )}
        <button className="round-btn" aria-label={t.send} title={t.send} disabled={phase === 'starting' || phase === 'sending' || problem === t.cameraBlocked} onClick={send}>
          {phase === 'sending' ? <span className="spinner" /> : <Icon name="send" />}
        </button>
      </div>
    </div>,
    document.body,
  )
}
