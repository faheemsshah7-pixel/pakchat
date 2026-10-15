// Composer.tsx: the bar at the bottom of a chat.
//   📷  pick a photo       🎤  record a voice note       Send  send what you typed
import { useEffect, useRef, useState } from 'react'
import type { Content } from '../chats'
import { useT } from '../lang'
import { MAX_VOICE_SECONDS, shrinkPhoto, startRecording, type Recording } from '../media'
import { duration, useNow } from '../time'

type Props = { onSend: (content: Content) => Promise<void>; onTyping: () => void }

export default function Composer({ onSend, onTyping }: Props) {
  const { t } = useT()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<Recording | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  async function send(content: Content, restore = '') {
    setError('')
    try {
      await onSend(content)
    } catch (err) {
      setError(t.notSent)
      setText(restore)
      console.error(err)
    }
  }

  function sendText(e: React.FormEvent) {
    e.preventDefault()
    const clean = text.trim()
    if (!clean) return
    setText('') // clear the box straight away, like WhatsApp
    send({ kind: 'text', text: clean }, clean)
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same photo again still works
    if (!file) return
    setError('')
    try {
      const photo = await shrinkPhoto(file)
      await send({ kind: 'photo', ...photo })
    } catch (err) {
      setError(t.photoTooBig)
      console.error(err)
    }
  }

  async function startVoice() {
    setError('')
    try {
      setRecording(await startRecording())
    } catch (err) {
      setError(t.micBlocked) // the person said no, or there's no microphone
      console.error(err)
    }
  }

  async function finishVoice(keep: boolean) {
    if (!recording) return
    setRecording(null)
    try {
      if (!keep) return await recording.cancel()
      const voice = await recording.stop()
      await send({ kind: 'voice', ...voice })
    } catch (err) {
      setError(t.voiceTooLong)
      console.error(err)
    }
  }

  return (
    <>
      {error && <p className="error pad">{error}</p>}
      {recording ? (
        <RecordingBar recording={recording} onDone={finishVoice} />
      ) : (
        <form className="composer" onSubmit={sendText}>
          <button type="button" className="icon round" aria-label={t.sendPhoto} title={t.sendPhoto} onClick={() => photoInput.current?.click()}>
            📷
          </button>
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
          <input
            dir="auto"
            placeholder={t.message}
            value={text}
            maxLength={2000}
            onChange={(e) => {
              setText(e.target.value)
              if (e.target.value) onTyping()
            }}
            autoFocus
          />
          {text.trim() ? (
            <button>{t.send}</button>
          ) : (
            <button type="button" className="icon round" aria-label={t.recordVoice} title={t.recordVoice} onClick={startVoice}>
              🎤
            </button>
          )}
        </form>
      )}
    </>
  )
}

// While recording: a red dot, the time so far, and Cancel / Send.
function RecordingBar({ recording, onDone }: { recording: Recording; onDone: (keep: boolean) => void }) {
  const { t } = useT()
  const now = useNow(250)
  const seconds = (now - recording.started) / 1000

  // Stop by itself at the time limit, so the file never gets too big.
  useEffect(() => {
    const timer = setTimeout(() => onDone(true), MAX_VOICE_SECONDS * 1000 - (Date.now() - recording.started))
    return () => clearTimeout(timer)
  }, [recording, onDone])

  return (
    <div className="composer recording">
      <span className="rec-dot" />
      <span className="row-main">
        {t.recording} {duration(seconds)} / {duration(MAX_VOICE_SECONDS)}
      </span>
      <button type="button" className="secondary" onClick={() => onDone(false)}>
        {t.cancel}
      </button>
      <button type="button" onClick={() => onDone(true)}>
        {t.send}
      </button>
    </div>
  )
}
