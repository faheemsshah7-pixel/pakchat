// Composer.tsx: the bar at the bottom of a chat.
//   smiley: emojis    paperclip: photos    microphone: voice note    paper plane: send
// Enter sends and Shift+Enter starts a new line (you can switch this in Settings).
// What you type is kept as a draft if you leave the chat before sending (drafts.ts).
// Above it, a strip shows the message you're replying to, or editing.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Content, Extras, Message } from '../chats'
import { getDraft, saveDraft } from '../drafts'
import { useT } from '../lang'
import { MAX_VOICE_SECONDS, startRecording, type Recording } from '../media'
import { replySnapshot } from '../messages'
import { useSettings } from '../settings'
import { duration, useNow } from '../time'
import EmojiPicker from './EmojiPicker'
import Icon from './Icon'

type Props = {
  chatId: string
  myUid: string
  onSend: (content: Content, extras?: Extras) => Promise<void>
  onTyping: () => void
  onPhotos: (files: File[]) => void // photos picked or pasted: ChatRoom shows them before sending
  replyTo: Message | null
  onCancelReply: () => void
  editing: Message | null
  onCancelEdit: () => void
  onSaveEdit: (text: string) => Promise<void>
}

// Phones and tablets have no Shift key handy, so there Enter always makes a new line.
const touchScreen = window.matchMedia('(pointer: coarse)').matches

export default function Composer(props: Props) {
  const { chatId, myUid, onSend, onTyping, onPhotos, replyTo, onCancelReply, editing, onCancelEdit, onSaveEdit } = props
  const { t } = useT()
  const { enterSends } = useSettings()
  const [text, setText] = useState(() => getDraft(chatId))
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<Recording | null>(null)
  const [emojis, setEmojis] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Start editing: put the message's words in the box. Stop: bring the draft back.
  // (React's way to change state when a prop changes: compare with the last one, during drawing.)
  const [lastEditing, setLastEditing] = useState(editing)
  if (editing !== lastEditing) {
    setLastEditing(editing)
    setText(editing ? ((editing.kind === 'photo' ? editing.caption : editing.text) ?? '') : getDraft(chatId))
  }
  useEffect(() => {
    box.current?.focus()
  }, [editing])

  // Replying: put the cursor in the box.
  useEffect(() => {
    if (replyTo) box.current?.focus()
  }, [replyTo])

  // The box grows with what you type, up to about 6 lines.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }, [text])

  function change(value: string) {
    setText(value)
    if (!editing) saveDraft(chatId, value)
    if (value) onTyping()
  }

  async function send(content: Content, restore = '') {
    setError('')
    const extras = replyTo ? { replyTo: replySnapshot(replyTo) } : {}
    onCancelReply()
    try {
      await onSend(content, extras)
    } catch (err) {
      setError(t.notSent)
      if (restore) change(restore)
      console.error(err)
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const clean = text.trim()
    if (editing) {
      if (!clean && editing.kind !== 'photo') return
      try {
        await onSaveEdit(clean)
      } catch (err) {
        setError(t.notEdited)
        console.error(err)
      }
      return
    }
    if (!clean) return
    change('') // clear the box straight away, like WhatsApp
    send({ kind: 'text', text: clean }, clean)
  }

  function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: typing in a language that builds letters in steps (Enter picks the letter).
    if (e.key === 'Enter' && !e.shiftKey && enterSends && !touchScreen && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape' && (editing || replyTo)) {
      e.stopPropagation()
      if (editing) onCancelEdit()
      else onCancelReply()
    }
  }

  // Pasting a photo (Ctrl+V) sends it like picking one.
  function paste(e: React.ClipboardEvent) {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (images.length && !editing) {
      e.preventDefault()
      onPhotos(images)
    }
  }

  function pickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // so picking the same photo again still works
    if (files.length) onPhotos(files)
  }

  // Put an emoji where the cursor is.
  function addEmoji(emoji: string) {
    const el = box.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    change(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
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

  const strip = editing ?? replyTo
  return (
    <div className="composer-area">
      {error && <p className="error toast">{error}</p>}
      {strip && (
        <div className={editing ? 'reply-bar editing' : 'reply-bar'}>
          <Icon name={editing ? 'edit' : 'reply'} size={18} />
          <div className="quote">
            <strong>{editing ? t.editMessage : strip.senderId === myUid ? t.you : strip.senderName}</strong>
            <span dir="auto">{(strip.kind === 'photo' ? strip.caption || t.photo : strip.kind === 'voice' ? t.voice : strip.text) ?? ''}</span>
          </div>
          <button className="icon" aria-label={t.cancel} onClick={editing ? onCancelEdit : onCancelReply}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {recording ? (
        <RecordingBar recording={recording} onDone={finishVoice} />
      ) : (
        <form className="composer" onSubmit={submit}>
          <div className="field">
            <button type="button" className="icon" aria-label={t.emoji} title={t.emoji} onClick={() => setEmojis(!emojis)}>
              <Icon name="smile" />
            </button>
            {!editing && (
              <button type="button" className="icon" aria-label={t.sendPhoto} title={t.sendPhoto} onClick={() => photoInput.current?.click()}>
                <Icon name="paperclip" />
              </button>
            )}
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={pickPhotos} />
            <textarea
              ref={box}
              rows={1}
              dir="auto"
              placeholder={t.message}
              aria-label={t.message}
              value={text}
              maxLength={4000}
              onChange={(e) => change(e.target.value)}
              onKeyDown={keyDown}
              onPaste={paste}
              autoFocus
            />
          </div>
          {/* One round button: Send (or Save) when there's text, the microphone when there isn't. */}
          {text.trim() || editing ? (
            <button className="round-btn" aria-label={editing ? t.save : t.send} title={editing ? t.save : t.send}>
              <Icon name={editing ? 'check' : 'send'} />
            </button>
          ) : (
            <button type="button" className="round-btn" aria-label={t.recordVoice} title={t.recordVoice} onClick={startVoice}>
              <Icon name="mic" />
            </button>
          )}
          {emojis && <EmojiPicker className="above-composer" onPick={addEmoji} onClose={() => setEmojis(false)} />}
        </form>
      )}
    </div>
  )
}

// While recording: a bin to cancel, a red dot, the time so far, a moving sound wave, and Send.
function RecordingBar({ recording, onDone }: { recording: Recording; onDone: (keep: boolean) => void }) {
  const { t } = useT()
  const now = useNow(250)
  const seconds = (now - recording.started) / 1000

  // Stop by itself at the time limit, so the file never gets too big.
  useEffect(() => {
    const timer = setTimeout(() => onDone(true), MAX_VOICE_SECONDS * 1000 - (Date.now() - recording.started))
    return () => clearTimeout(timer)
  }, [recording, onDone])

  // Enter sends it, like pressing Send. (Not while a window like the photo viewer is on top.)
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat || document.querySelector('.modal, .viewer, .photo-sender')) return
      e.preventDefault() // so Enter doesn't also press the bin button, if it's selected
      onDone(true)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onDone])

  return (
    <div className="composer recording">
      <div className="field">
        <button type="button" className="icon danger" aria-label={t.cancel} title={t.cancel} onClick={() => onDone(false)}>
          <Icon name="trash" />
        </button>
        <span className="rec-dot" />
        <span className="rec-time">
          {duration(seconds)} <small>/ {duration(MAX_VOICE_SECONDS)}</small>
        </span>
        <span className="wave" aria-label={t.recording}>
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
          ))}
        </span>
      </div>
      <button type="button" className="round-btn" aria-label={t.send} title={t.send} onClick={() => onDone(true)}>
        <Icon name="send" />
      </button>
    </div>
  )
}
