// Dialogs.tsx: small windows: forward a message to other chats, message info (who read it),
// who reacted, delete a message, mute a chat, pin a message, disappearing messages,
// send documents, share your location, share a contact, and pick a notification sound.
import { useEffect, useState } from 'react'
import {
  chatTitle,
  findUser,
  isBroadcast,
  isDirect,
  isGroup,
  myPrivacy,
  otherPerson,
  shortText,
  type Chat,
  type Message,
  type Person,
  type SharedContact,
  type Target,
} from '../chats'
import { timerLabel, TIMER_CHOICES } from '../disappearing'
import { useT } from '../lang'
import { findMe, LIVE_CHOICES, type Spot } from '../location'
import { MAX_FILE_BYTES, sizeText } from '../media'
import { canUnsend, forwardMessage, react } from '../messages'
import { PIN_CHOICES } from '../pins'
import { HOUR, MUTE_ALWAYS } from '../prefs'
import { getProfile } from '../profiles'
import { getSetting } from '../settings'
import { previewTone, TONES, type Tone } from '../sound'
import { fill } from '../strings'
import { ChatAvatar, PersonAvatar } from './Avatar'
import { MapPreview } from './CardBubbles'
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
  // (Not to broadcast lists: forward to the people themselves.)
  const shown = chats.filter((c) => !isBroadcast(c) && chatTitle(c, me.uid, t).toLowerCase().includes(search.trim().toLowerCase()))

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
      return isDirect(chat) ? { chatId: id, other: otherPerson(chat, me.uid), timer: chat.timer } : { chatId: id, timer: chat.timer }
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
              {chatTitle(c, me.uid, t)}
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

// Documents picked to send: their names and sizes, an optional caption (for one), then Send.
// Files over 5 MB can't be sent on the free plan, so they're shown in red and left out.
type DocsProps = { files: File[]; onSend: (files: File[], caption: string) => void; onClose: () => void }
export function DocumentSender({ files, onSend, onClose }: DocsProps) {
  const { t } = useT()
  const [caption, setCaption] = useState('')
  const ok = files.filter((file) => file.size <= MAX_FILE_BYTES)
  return (
    <Modal title={t.sendDocuments} onClose={onClose} className="narrow">
      <div className="doc-list">
        {files.map((file, i) => (
          <div key={i} className={file.size <= MAX_FILE_BYTES ? 'row doc-row' : 'row doc-row too-big'}>
            <Icon name="file" />
            <span className="row-main">
              <strong dir="auto">{file.name}</strong>
              <small>{file.size <= MAX_FILE_BYTES ? sizeText(file.size) : fill(t.fileTooBig, { size: sizeText(file.size) })}</small>
            </span>
          </div>
        ))}
      </div>
      {ok.length === 1 && (
        <div className="field">
          <input dir="auto" placeholder={t.addCaption} value={caption} maxLength={1024} onChange={(e) => setCaption(e.target.value)} autoFocus />
        </div>
      )}
      <button
        className="btn"
        disabled={ok.length === 0}
        onClick={() => {
          onSend(ok, caption.trim())
          onClose()
        }}
      >
        <Icon name="send" size={18} /> {t.send}
        {ok.length > 1 && <span className="count">{ok.length}</span>}
      </button>
    </Modal>
  )
}

// Share where you are: your current spot, or a live location for 15 minutes, 1 hour or 8 hours.
// canLive: live location is offered too (not in broadcast lists: one moving pin can't be in many chats).
type LocationProps = { onSend: (spot: Spot, liveMinutes?: number) => void; onClose: () => void; canLive?: boolean }
export function LocationDialog({ onSend, onClose, canLive = true }: LocationProps) {
  const { t } = useT()
  const [spot, setSpot] = useState<Spot | null>(null)
  const [error, setError] = useState('')
  const [minutes, setMinutes] = useState(LIVE_CHOICES[0])
  const labels = [t.minutes15, t.hour1, t.hours8]

  useEffect(() => {
    let stillHere = true
    findMe().then(
      (found) => stillHere && setSpot(found),
      (err: GeolocationPositionError | Error) => {
        console.warn(err)
        if (stillHere) setError('code' in err && err.code === 1 ? t.locationBlocked : t.locationFailed)
      },
    )
    return () => {
      stillHere = false
    }
  }, [t])

  function send(liveMinutes?: number) {
    if (!spot) return
    onSend(spot, liveMinutes)
    onClose()
  }

  return (
    <Modal title={t.shareLocation} onClose={onClose} className="narrow">
      <div className="location-preview">
        {spot ? <MapPreview lat={spot.lat} lng={spot.lng} width={320} height={160} /> : <p className={error ? 'error' : 'hint'}>{error || t.findingYou}</p>}
      </div>
      {spot && <p className="hint">{fill(t.accurateTo, { m: Math.round(spot.accuracy) })}</p>}
      <button className="btn" disabled={!spot} onClick={() => send()}>
        <Icon name="mapPin" size={18} /> {t.sendCurrentLocation}
      </button>
      {canLive && (
        <>
          <p className="section-title">{t.shareLive}</p>
          <div className="choices" role="radiogroup">
            {LIVE_CHOICES.map((choice, i) => (
              <label key={choice} className="choice">
                <input type="radio" name="live" checked={minutes === choice} onChange={() => setMinutes(choice)} />
                {labels[i]}
              </label>
            ))}
          </div>
          <p className="hint">{t.liveHint}</p>
          <button className="btn secondary" disabled={!spot} onClick={() => send(minutes)}>
            {t.shareLive}
          </button>
        </>
      )}
    </Modal>
  )
}

// Share a contact: someone from your chats, someone from your phone's contacts (Android only),
// or a name and number you type in.
type ContactProps = { me: Person; chats: Chat[]; onSend: (contacts: SharedContact[]) => void; onClose: () => void }
export function ContactDialog({ me, chats, onSend, onClose }: ContactProps) {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [typing, setTyping] = useState(false) // typing in a name and number
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // (Only Chrome on Android lets websites open your phone's contacts.)
  const phoneBook = !!phoneContacts()?.select

  // Everyone you chat with: the other person in each chat, and the people in your groups.
  const people = new Map<string, string>()
  for (const chat of chats) for (const uid of chat.members) if (uid !== me.uid && chat.names[uid]) people.set(uid, chat.names[uid])
  const q = search.trim().toLowerCase()
  const shown = [...people].filter(([, n]) => n.toLowerCase().includes(q)).sort((a, b) => a[1].localeCompare(b[1]))

  function toggle(uid: string) {
    if (picked.includes(uid)) setPicked(picked.filter((p) => p !== uid))
    else if (picked.length < 5) setPicked([...picked, uid])
  }

  async function send() {
    setBusy(true)
    setError('')
    try {
      const cards: SharedContact[] = []
      for (const uid of picked) {
        const profile = await getProfile(uid)
        cards.push(card({ name: people.get(uid) ?? profile?.name ?? '?', uid, phone: profile?.phone ?? undefined, email: profile?.email ?? undefined }))
      }
      if (typing && name.trim() && phone.trim()) {
        // On PakChat? Then the card can open a chat with them.
        const found = await findUser(phone.trim()).catch(() => null)
        cards.push(card({ name: name.trim(), phone: phone.trim(), uid: found?.uid }))
      }
      if (cards.length) onSend(cards)
      onClose()
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
      setBusy(false)
    }
  }

  async function fromPhone() {
    try {
      const chosen = (await phoneContacts()?.select?.(['name', 'tel'], { multiple: true })) ?? []
      const cards = chosen.filter((c) => c.tel?.[0]).map((c) => card({ name: c.name?.[0] || c.tel![0], phone: c.tel![0] }))
      if (cards.length) {
        onSend(cards)
        onClose()
      }
    } catch (err) {
      console.warn(err) // you closed the list without picking anyone
    }
  }

  const ready = picked.length > 0 || (typing && name.trim() && phone.trim().length >= 5)
  return (
    <Modal title={t.shareContact} onClose={onClose} className="narrow">
      <div className="field">
        <Icon name="search" size={18} />
        <input placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      <div className="pick-list">
        {shown.map(([uid, n]) => (
          <label key={uid} className="row pick">
            <PersonAvatar uid={uid} name={n} size={42} />
            <strong className="row-main" dir="auto">
              {n}
            </strong>
            <input type="checkbox" checked={picked.includes(uid)} onChange={() => toggle(uid)} />
          </label>
        ))}
        {shown.length === 0 && <p className="empty">{t.nothingHere}</p>}
      </div>
      {phoneBook && (
        <button className="btn secondary" onClick={fromPhone}>
          <Icon name="contact" size={18} /> {t.phoneContacts}
        </button>
      )}
      {typing ? (
        <div className="contact-form">
          <input dir="auto" placeholder={t.contactName} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={t.contactName} />
          <input dir="ltr" type="tel" placeholder={t.contactNumber} value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} aria-label={t.contactNumber} />
        </div>
      ) : (
        <button className="link" onClick={() => setTyping(true)}>
          {t.someoneElse}
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={!ready || busy} onClick={send}>
        <Icon name="send" size={18} /> {busy ? t.sending : t.send}
      </button>
    </Modal>
  )
}

// The phone's contacts, where the browser allows it ("Contact Picker", Chrome on Android).
type PhoneContact = { name?: string[]; tel?: string[] }
type ContactPicker = { select?: (fields: string[], options: object) => Promise<PhoneContact[]> }
function phoneContacts() {
  return (navigator as Navigator & { contacts?: ContactPicker }).contacts
}

// A contact card without empty parts (the database rules only allow name, phone, email and uid).
function card(c: SharedContact): SharedContact {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v)) as SharedContact
}

// Pick people from everyone you know: one (onPick), or several with tick boxes (onDone).
// Used for "Add favourite" (Calls) and for status privacy ("My contacts except…").
type PeopleProps = {
  title: string
  hint?: string
  people: Person[]
  picked?: string[] // ticked to start with (several)
  onPick?: (person: Person) => void
  onDone?: (uids: string[]) => void
  onClose: () => void
}
export function PeopleDialog({ title, hint, people, picked: start, onPick, onDone, onClose }: PeopleProps) {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string[]>(start ?? [])
  const shown = people.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
  const toggle = (uid: string) => setPicked(picked.includes(uid) ? picked.filter((p) => p !== uid) : [...picked, uid])
  return (
    <Modal title={title} onClose={onClose} className="narrow">
      {hint && <p className="hint">{hint}</p>}
      <div className="field">
        <Icon name="search" size={18} />
        <input placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      <div className="pick-list">
        {shown.map((person) =>
          onDone ? (
            <label key={person.uid} className="row pick">
              <PersonAvatar uid={person.uid} name={person.name} size={42} />
              <strong className="row-main" dir="auto">
                {person.name}
              </strong>
              <input type="checkbox" checked={picked.includes(person.uid)} onChange={() => toggle(person.uid)} />
            </label>
          ) : (
            <button
              key={person.uid}
              className="row"
              onClick={() => {
                onPick?.(person)
                onClose()
              }}
            >
              <PersonAvatar uid={person.uid} name={person.name} size={42} />
              <strong className="row-main" dir="auto">
                {person.name}
              </strong>
            </button>
          ),
        )}
        {shown.length === 0 && <p className="empty">{people.length ? t.nothingHere : t.noPeopleYet}</p>}
      </div>
      {onDone && (
        <button
          className="btn"
          onClick={() => {
            onDone(picked)
            onClose()
          }}
        >
          <Icon name="check" size={18} /> {t.done}
          {picked.length > 0 && <span className="count">{picked.length}</span>}
        </button>
      )}
    </Modal>
  )
}

// Pick a notification sound (sound.ts). Tapping one plays it, so you can hear it first.
// usual: for one chat, the first choice is "Default", which plays the tone from Settings
// (leave it out when this IS the setting).
type ToneProps = { title: string; current: Tone | null; usual?: Tone; onSave: (tone: Tone | null) => void; onClose: () => void }
export function ToneDialog({ title, current, usual, onSave, onClose }: ToneProps) {
  const { t } = useT()
  const [choice, setChoice] = useState<Tone | null>(current)
  const choices: (Tone | null)[] = usual ? [null, ...TONES] : [...TONES]
  return (
    <Modal title={title} onClose={onClose} className="narrow">
      <p className="hint">{getSetting('sounds') ? t.toneHint : t.soundsAreOff}</p>
      <div className="choices" role="radiogroup">
        {choices.map((tone) => (
          <label key={tone ?? 'usual'} className="choice">
            <input
              type="radio"
              name="tone"
              checked={choice === tone}
              onChange={() => {
                setChoice(tone)
                previewTone(tone ?? usual ?? 'ping')
              }}
            />
            {tone ? t.toneNames[tone] : fill(t.usualTone, { name: t.toneNames[usual ?? 'ping'] })}
          </label>
        ))}
      </div>
      <button
        className="btn"
        onClick={() => {
          onSave(choice)
          onClose()
        }}
      >
        <Icon name="check" size={18} /> {t.save}
      </button>
    </Modal>
  )
}
