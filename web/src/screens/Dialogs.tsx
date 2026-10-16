// Dialogs.tsx: small windows: forward a message to other chats, message info (who read it),
// who reacted, delete a message, mute a chat, pin a message, and disappearing messages.
import { useState } from 'react'
import {
  chatTitle,
  isGroup,
  myPrivacy,
  otherPerson,
  shortText,
  type Chat,
  type Message,
  type Person,
  type Target,
} from '../chats'
import { timerLabel, TIMER_CHOICES } from '../disappearing'
import { useT } from '../lang'
import { canUnsend, forwardMessage, react } from '../messages'
import { PIN_CHOICES } from '../pins'
import { HOUR, MUTE_ALWAYS } from '../prefs'
import { fill } from '../strings'
import { ChatAvatar, PersonAvatar } from './Avatar'
import Icon from './Icon'
import Modal from './Modal'
import Ticks from './Ticks'

const MAX_FORWARD = 5

// Pick up to 5 chats to send a copy of the message to.
export function ForwardDialog(props: { me: Person; chats: Chat[]; fromChatId: string; m: Message; onClose: () => void; onSent: (n: number) => void }) {
  const { me, chats, fromChatId, m, onClose, onSent } = props
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shown = chats.filter((c) => chatTitle(c, me.uid).toLowerCase().includes(search.trim().toLowerCase()))

  function toggle(id: string) {
    if (picked.includes(id)) setPicked(picked.filter((p) => p !== id))
    else if (picked.length < MAX_FORWARD) setPicked([...picked, id])
  }

  async function send() {
    setBusy(true)
    setError('')
    const targets: Target[] = picked.map((id) => {
      const chat = chats.find((c) => c.id === id)!
      // (timer: if that chat has disappearing messages on, the copy disappears too)
      return isGroup(chat) ? { chatId: id, timer: chat.timer } : { chatId: id, other: otherPerson(chat, me.uid), timer: chat.timer }
    })
    try {
      const failed = await forwardMessage(me, fromChatId, m, targets)
      if (failed.length) setError(t.someNotSent)
      else onSent(targets.length)
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
    }
    setBusy(false)
  }

  return (
    <Modal title={t.forwardTo} onClose={onClose} className="narrow">
      <div className="field">
        <Icon name="search" size={18} />
        <input placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      <div className="pick-list">
        {shown.map((c) => (
          <label key={c.id} className="row pick">
            <ChatAvatar chat={c} myUid={me.uid} size={42} />
            <strong className="row-main" dir="auto">
              {chatTitle(c, me.uid)}
            </strong>
            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
          </label>
        ))}
        {shown.length === 0 && <p className="empty">{t.nothingHere}</p>}
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy || picked.length === 0} onClick={send}>
        <Icon name="send" size={18} /> {busy ? t.sending : t.send}
        {picked.length > 0 && <span className="count">{picked.length}</span>}
      </button>
    </Modal>
  )
}

// Who has received and read one of your messages.
export function InfoDialog({ chat, m, me, onClose }: { chat: Chat; m: Message; me: Person; onClose: () => void }) {
  const { t } = useT()
  const sent = m.sentAt?.toMillis() ?? Infinity
  const others = chat.members.filter((uid) => uid !== me.uid)
  const canSeeRead = myPrivacy.readReceipts || isGroup(chat)
  const reached = (times: Chat['readAt'], uid: string) => (times?.[uid]?.toMillis() ?? 0) >= sent
  const read = canSeeRead ? others.filter((uid) => reached(chat.readAt, uid)) : []
  const delivered = others.filter((uid) => !read.includes(uid) && (reached(chat.deliveredAt, uid) || reached(chat.readAt, uid)))
  const waiting = others.filter((uid) => !read.includes(uid) && !delivered.includes(uid))

  const list = (title: string, uids: string[], tick: 'read' | 'delivered' | 'sent') =>
    uids.length > 0 && (
      <>
        <p className="section-title">
          <Ticks tick={tick} /> {title}
        </p>
        {uids.map((uid) => (
          <div key={uid} className="row">
            <PersonAvatar uid={uid} name={chat.names[uid] ?? '?'} size={40} />
            <strong className="row-main" dir="auto">
              {chat.names[uid] ?? '?'}
            </strong>
          </div>
        ))}
      </>
    )

  return (
    <Modal title={t.messageInfo} onClose={onClose} className="narrow">
      <p className="info-quote" dir="auto">
        {shortText(m, me.uid, t)}
      </p>
      {list(t.readBy, read, 'read')}
      {list(t.deliveredTo, delivered, 'delivered')}
      {list(t.notDeliveredYet, waiting, 'sent')}
      {!canSeeRead && <p className="hint">{t.receiptsOffHint}</p>}
    </Modal>
  )
}

// Who reacted with what. Tap your own reaction to take it back.
export function ReactionsDialog({ chat, chatId, m, myUid, onClose }: { chat: Chat | undefined; chatId: string; m: Message; myUid: string; onClose: () => void }) {
  const { t } = useT()
  const entries = Object.entries(m.reactions ?? {})
  return (
    <Modal title={fill(t.reactionsCount, { n: entries.length })} onClose={onClose} className="narrow">
      {entries.map(([uid, emoji]) => {
        const name = chat?.names[uid] ?? '?'
        const mine = uid === myUid
        return (
          <button
            key={uid}
            className="row"
            disabled={!mine}
            onClick={() => {
              react(chatId, m.id, myUid, null).catch(console.error)
              onClose()
            }}
          >
            <PersonAvatar uid={uid} name={name} size={40} />
            <span className="row-main">
              <strong dir="auto">{mine ? t.you : name}</strong>
              {mine && <small className="muted">{t.tapToRemove}</small>}
            </span>
            <span className="big-emoji">{emoji}</span>
          </button>
        )
      })}
    </Modal>
  )
}

// Delete for me, or (your own recent messages) for everyone.
type DeleteProps = { m: Message; myUid: string; onClose: () => void; onForMe: () => void; onForEveryone: () => void }
export function DeleteDialog({ m, myUid, onClose, onForMe, onForEveryone }: DeleteProps) {
  const { t } = useT()
  return (
    <Modal title={t.deleteMessage} onClose={onClose} className="narrow">
      <div className="dialog-buttons">
        {canUnsend(m, myUid) && (
          <button className="btn danger-btn" onClick={onForEveryone}>
            {t.deleteForEveryone}
          </button>
        )}
        <button className="btn secondary danger" onClick={onForMe}>
          {t.deleteForMe}
        </button>
        <button className="btn secondary" onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </Modal>
  )
}

// Mute a chat: no alerts or sounds from it for 8 hours, a week, or always.
export function MuteDialog({ onMute, onClose }: { onMute: (until: number) => void; onClose: () => void }) {
  const { t } = useT()
  const [choice, setChoice] = useState(0)
  const options: [string, number][] = [
    [t.mute8Hours, 8 * HOUR],
    [t.mute1Week, 7 * 24 * HOUR],
    [t.muteAlways, MUTE_ALWAYS],
  ]
  return (
    <Modal title={t.muteTitle} onClose={onClose} className="narrow">
      <p className="hint">{t.muteHint}</p>
      <div className="choices" role="radiogroup">
        {options.map(([label], i) => (
          <label key={label} className="choice">
            <input type="radio" name="mute" checked={choice === i} onChange={() => setChoice(i)} />
            {label}
          </label>
        ))}
      </div>
      <button
        className="btn"
        onClick={() => {
          const [, length] = options[choice]
          onMute(length === MUTE_ALWAYS ? MUTE_ALWAYS : Date.now() + length)
          onClose()
        }}
      >
        <Icon name="bellOff" size={18} /> {t.mute}
      </button>
    </Modal>
  )
}

// Pin a message for everyone: for 24 hours, 7 days or 30 days.
export function PinDialog({ onPin, onClose }: { onPin: (lasts: number) => void; onClose: () => void }) {
  const { t } = useT()
  const [choice, setChoice] = useState(1) // 7 days, like WhatsApp
  const labels = [t.hours24, `7 ${t.days}`, `30 ${t.days}`]
  return (
    <Modal title={t.pinTitle} onClose={onClose} className="narrow">
      <p className="hint">{t.pinHint}</p>
      <div className="choices" role="radiogroup">
        {PIN_CHOICES.map((lasts, i) => (
          <label key={lasts} className="choice">
            <input type="radio" name="pin" checked={choice === i} onChange={() => setChoice(i)} />
            {labels[i]}
          </label>
        ))}
      </div>
      <button
        className="btn"
        onClick={() => {
          onPin(PIN_CHOICES[choice])
          onClose()
        }}
      >
        <Icon name="pin" size={18} /> {t.pinMsg}
      </button>
    </Modal>
  )
}

// Disappearing messages: off, 24 hours, 7 days or 90 days.
// In a group only admins can change it; everyone else just sees what it's set to.
type TimerProps = { current: number; canChange: boolean; onSave: (seconds: number) => void; onClose: () => void }
export function TimerDialog({ current, canChange, onSave, onClose }: TimerProps) {
  const { t } = useT()
  const [choice, setChoice] = useState(current)
  return (
    <Modal title={t.disappearing} onClose={onClose} className="narrow">
      <p className="hint">{t.timerHint}</p>
      <div className="choices" role="radiogroup">
        {TIMER_CHOICES.map((seconds) => (
          <label key={seconds} className="choice">
            <input type="radio" name="timer" checked={choice === seconds} disabled={!canChange} onChange={() => setChoice(seconds)} />
            {timerLabel(seconds, t)}
          </label>
        ))}
      </div>
      {canChange ? (
        <button
          className="btn"
          disabled={choice === current}
          onClick={() => {
            onSave(choice)
            onClose()
          }}
        >
          <Icon name="timer" size={18} /> {t.save}
        </button>
      ) : (
        <p className="hint">{t.timerAdminsOnly}</p>
      )}
    </Modal>
  )
}
