// Composer.tsx: the bar at the bottom of a chat.
//   smiley: emojis and stickers    paperclip: photos & videos, camera, document, location, contact, poll
//   microphone: voice note    paper plane: send
// In a group, typing @ shows the people in it: pick one to mention them (mentions.ts).
// Enter sends and Shift+Enter starts a new line (you can switch this in Settings).
// What you type is kept as a draft if you leave the chat before sending (drafts.ts).
// Above it, a strip shows the message you're replying to, or editing.
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { shortText, type Content, type Extras, type Message, type Person, type ReplyTo } from '../chats'
import { getDraft, saveDraft } from '../drafts'
import { useT } from '../lang'
import { isPhotoOrVideo, MAX_VOICE_SECONDS, startRecording, type Recording } from '../media'
import { findMentions, mentionQuery } from '../mentions'
import { useSettings } from '../settings'
import { duration, useNow } from '../time'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'
import { EmojiPicker } from './lazy' // (the emoji and sticker panel loads the first time you open it)
import Popover, { type PopoverItem } from './Popover'

type Props = {
  chatId: string
  myUid: string
  onSend: (content: Content, extras?: Extras) => Promise<unknown>
  onTyping: () => void
  onPhotos: (files: File[]) => void // photos or videos picked or pasted: ChatRoom shows them before sending
  onDocuments: (files: File[]) => void // documents picked or pasted
  onLocation: () => void // "Location" in the paperclip menu
  onContact: () => void // "Contact" in the paperclip menu
  onPoll: () => void // "Poll" in the paperclip menu
  people?: Person[] // a group's other members, to @mention (missing in chats with one person)
  replyTo: ReplyTo | null
  onCancelReply: () => void
  editing: Message | null
  onCancelEdit: () => void
  onSaveEdit: (text: string) => Promise<void>
}

// A few people at a time in the @ list.
const MAX_SHOWN = 8

// Phones and tablets have no Shift key handy, so there Enter always makes a new line.
const touchScreen = window.matchMedia('(pointer: coarse)').matches

export default function Composer(props: Props) {
  const { chatId, myUid, onSend, onTyping, onPhotos, onDocuments, onLocation, onContact, onPoll, people, replyTo, onCancelReply, editing, onCancelEdit, onSaveEdit } = props
  const { t } = useT()
  const { enterSends } = useSettings()
  const [text, setText] = useState(() => getDraft(chatId))
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<Recording | null>(null)
  const [emojis, setEmojis] = useState(false)
  const [attach, setAttach] = useState<{ x: number; y: number } | null>(null) // the paperclip menu
  const [caret, setCaret] = useState(0) // where the cursor is (for @mentions)
  const [tagIndex, setTagIndex] = useState(0) // which person in the @ list is picked
  const [tagClosed, setTagClosed] = useState(-1) // Esc closed the @ list that starts here
  const photoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const moveCaret = useRef<number | null>(null) // put the cursor here once the new words are in the box

  // Start editing: put the message's words in the box. Stop: bring the draft back.
  // (React's way to change state when a prop changes: compare with the last one, during drawing.)
  const [lastEditing, setLastEditing] = useState(editing)
  if (editing !== lastEditing) {
    setLastEditing(editing)
    setText(editing ? (((editing.kind ?? 'text') === 'text' ? editing.text : editing.caption) ?? '') : getDraft(chatId))
  }
  useEffect(() => {
    box.current?.focus()
  }, [editing])

  // Replying: put the cursor in the box.
  useEffect(() => {
    if (replyTo) box.current?.focus()
  }, [replyTo])

  // The box grows with what you type, up to about 6 lines.
  // (And after picking someone to @mention, the cursor goes after their name, before you type on.)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
    if (moveCaret.current !== null) {
      el.focus()
      el.setSelectionRange(moveCaret.current, moveCaret.current)
      moveCaret.current = null
    }
  }, [text])

  function change(value: string, cursor = value.length) {
    setText(value)
    setCaret(cursor)
    setTagIndex(0)
    if (!editing) saveDraft(chatId, value)
    if (value) onTyping()
  }

  // ----- @mentions: the list of people while you type "@al…" -----
  const tag = people?.length ? mentionQuery(text, caret) : null
  const tagShown =
    tag && tag.start !== tagClosed
      ? people!.filter((p) => p.name.toLowerCase().includes(tag.query.toLowerCase())).slice(0, MAX_SHOWN)
      : []
  const tagPicked = Math.min(tagIndex, tagShown.length - 1)
  // Put "@Name " in place of "@al", and the cursor after it.
  function pickMention(person: Person) {
    if (!tag) return
    const before = text.slice(0, tag.start) + '@' + person.name + ' '
    moveCaret.current = before.length
    change(before + text.slice(caret), before.length)
  }

  async function send(content: Content, restore = '', mentions: string[] = []) {
    setError('')
    const extras: Extras = replyTo ? { replyTo } : {}
    if (mentions.length) extras.mentions = mentions
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
      if (!clean && (editing.kind ?? 'text') === 'text') return // (a caption can be emptied)
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
    send({ kind: 'text', text: clean }, clean, people ? findMentions(clean, people) : [])
  }

  function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // The @ list is open: arrows move, Enter or Tab picks, Esc closes it.
    if (tagShown.length > 0 && tag && !e.nativeEvent.isComposing) {
      const keys: Record<string, () => void> = {
        ArrowDown: () => setTagIndex((tagPicked + 1) % tagShown.length),
        ArrowUp: () => setTagIndex((tagPicked - 1 + tagShown.length) % tagShown.length),
        Enter: () => pickMention(tagShown[tagPicked]),
        Tab: () => pickMention(tagShown[tagPicked]),
        Escape: () => setTagClosed(tag.start),
      }
      const action = keys[e.key]
      if (action && !(e.key === 'Enter' && e.shiftKey)) {
        e.preventDefault()
        e.stopPropagation()
        return action()
      }
    }
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

  // Pasting a photo, video or file (Ctrl+V) sends it like picking one.
  function paste(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.files]
    if (!files.length || editing) return
    e.preventDefault()
    const media = files.filter(isPhotoOrVideo)
    if (media.length) onPhotos(media)
    const docs = files.filter((f) => !isPhotoOrVideo(f))
    if (docs.length) onDocuments(docs)
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>, then: (files: File[]) => void) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // so picking the same file again still works
    if (files.length) then(files)
  }

  // The paperclip menu, like WhatsApp's. (Camera only on phones: computers open a file list instead.)
  const attachItems: PopoverItem[] = [
    { label: t.photosVideos, icon: 'image', onClick: () => photoInput.current?.click() },
    ...(touchScreen ? [{ label: t.camera, icon: 'camera' as const, onClick: () => cameraInput.current?.click() }] : []),
    { label: t.document, icon: 'file', onClick: () => docInput.current?.click() },
    { label: t.location, icon: 'mapPin', onClick: onLocation },
    { label: t.contact, icon: 'contact', onClick: onContact },
    { label: t.poll, icon: 'poll', onClick: onPoll },
  ]

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
      {tagShown.length > 0 && (
        <div className="mention-list" role="listbox" aria-label={t.mentionSomeone}>
          {tagShown.map((p, i) => (
            <button
              key={p.uid}
              type="button"
              role="option"
              aria-selected={i === tagPicked}
              className={i === tagPicked ? 'row on' : 'row'}
              onMouseDown={(e) => e.preventDefault()} // (keeps the cursor in the box)
              onClick={() => pickMention(p)}
            >
              <PersonAvatar uid={p.uid} name={p.name} size={32} />
              <strong className="row-main" dir="auto">
                {p.name}
              </strong>
            </button>
          ))}
        </div>
      )}
      {strip && (
        <div className={editing ? 'reply-bar editing' : 'reply-bar'}>
          <Icon name={editing ? 'edit' : 'reply'} size={18} />
          <div className="quote">
            <strong>
              {editing ? t.editMessage : strip.senderId === myUid ? t.you : strip.senderName}
              {!editing && replyTo?.from && <span className="quote-from"> · {replyTo.from}</span>}
            </strong>
            <span dir="auto">{shortText(strip, myUid, t)}</span>
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
              <button
                type="button"
                className="icon"
                aria-label={t.attach}
                title={t.attach}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setAttach({ x: r.left, y: r.top - 8 })
                }}
              >
                <Icon name="paperclip" />
              </button>
            )}
            <input ref={photoInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick(e, onPhotos)} />
            <input ref={cameraInput} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => pick(e, onPhotos)} />
            <input ref={docInput} type="file" multiple hidden onChange={(e) => pick(e, onDocuments)} />
            <textarea
              ref={box}
              rows={1}
              dir="auto"
              placeholder={t.message}
              aria-label={t.message}
              value={text}
              maxLength={4000}
              onChange={(e) => change(e.target.value, e.target.selectionStart)}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
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
          {emojis && (
            <Suspense fallback={null}>
              <EmojiPicker
                className="above-composer"
                onPick={addEmoji}
                onClose={() => setEmojis(false)}
                onSticker={
                  editing
                    ? undefined
                    : (picked) => {
                        setEmojis(false)
                        send({ kind: 'sticker', ...picked })
                      }
                }
              />
            </Suspense>
          )}
        </form>
      )}
      {attach && <Popover x={attach.x} y={attach.y} items={attachItems} onClose={() => setAttach(null)} />}
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
