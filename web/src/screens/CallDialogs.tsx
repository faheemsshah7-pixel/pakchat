// CallDialogs.tsx: the small windows behind the Calls tab's big buttons:
//   Start call       pick someone and call them
//   Call a number    a keypad, like a phone's
//   Call link        make a link that calls you, to share (callExtras.ts)
//   Join call        what you see when you open someone's call link
//   Schedule call    plan a call for later
//   Reminder         "Your call with Bushra is starting", when a scheduled call's time comes
import { useEffect, useState } from 'react'
import { startCall } from '../calls'
import {
  callLinkAddress,
  deleteCallLink,
  lookupCallLink,
  makeCallLink,
  myCallLinks,
  scheduleCall,
  scheduledWith,
  type CallLink,
  type ScheduledCall,
} from '../callExtras'
import { chatIdFor, findUser, type Chat, type Person } from '../chats'
import { useT } from '../lang'
import { contactKey } from '../phone'
import type { Profile } from '../profiles'
import { fill } from '../strings'
import { dayAndTime } from '../time'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'
import Modal from './Modal'

// ---------- Start call: everyone you know, with a phone and a camera button ----------

export function StartCallDialog({ me, people, onClose }: { me: Person; people: Person[]; onClose: () => void }) {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const shown = people.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
  function call(person: Person, video: boolean) {
    onClose()
    startCall(me, person, video)
  }
  return (
    <Modal title={t.startCall} onClose={onClose} className="narrow">
      <div className="field">
        <Icon name="search" size={18} />
        <input placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      <div className="pick-list">
        {shown.map((person) => (
          <div key={person.uid} className="row">
            <PersonAvatar uid={person.uid} name={person.name} size={42} />
            <strong className="row-main" dir="auto">
              {person.name}
            </strong>
            <button className="icon accent" aria-label={`${t.voiceCall}: ${person.name}`} title={t.voiceCall} onClick={() => call(person, false)}>
              <Icon name="phone" />
            </button>
            <button className="icon accent" aria-label={`${t.videoCall}: ${person.name}`} title={t.videoCall} onClick={() => call(person, true)}>
              <Icon name="video" />
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="empty">{people.length ? t.nothingHere : t.noPeopleYet}</p>}
      </div>
    </Modal>
  )
}

// ---------- Call a number: a keypad ----------

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['+', ''],
  ['0', ''],
  ['#', ''],
]

export function DialDialog({ me, profile, onClose }: { me: Person; profile: Profile; onClose: () => void }) {
  const { t } = useT()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function call(video: boolean) {
    setError('')
    const { field, value } = contactKey(number)
    if (profile[field] === value) return setError(t.ownNumber)
    setBusy(true)
    try {
      const person = await findUser(number)
      if (!person) return setError(t.notOnPakChat)
      onClose()
      startCall(me, person, video)
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
    } finally {
      setBusy(false)
    }
  }

  const ready = number.replace(/\D/g, '').length >= 10 || (number.includes('@') && number.includes('.'))
  return (
    <Modal title={t.callANumber} onClose={onClose} className="narrow dial">
      <div className="dial-number">
        <input
          dir="ltr"
          inputMode="tel"
          placeholder="0300 1234567"
          aria-label={t.phone}
          value={number}
          onChange={(e) => (setNumber(e.target.value), setError(''))}
          onKeyDown={(e) => e.key === 'Enter' && ready && call(false)}
          autoFocus
        />
        {number && (
          <button className="icon" aria-label={t.deleteDigit} title={t.deleteDigit} onClick={() => setNumber(number.slice(0, -1))}>
            <Icon name="backspace" />
          </button>
        )}
      </div>
      {error && <p className="error center">{error}</p>}
      <div className="keypad">
        {KEYS.map(([key, letters]) => (
          <button key={key} onClick={() => (setNumber(number + key), setError(''))}>
            {key}
            <small>{letters}</small>
          </button>
        ))}
      </div>
      <div className="dial-calls">
        <button className="round-btn" aria-label={t.voiceCall} title={t.voiceCall} disabled={!ready || busy} onClick={() => call(false)}>
          <Icon name="phone" />
        </button>
        <button className="round-btn" aria-label={t.videoCall} title={t.videoCall} disabled={!ready || busy} onClick={() => call(true)}>
          <Icon name="video" />
        </button>
      </div>
    </Modal>
  )
}

// ---------- Call link: make one, copy or share it, delete old ones ----------

export function CallLinkDialog({ me, onClose }: { me: Person; onClose: () => void }) {
  const { t } = useT()
  const [video, setVideo] = useState(false)
  const [links, setLinks] = useState<CallLink[] | null>(null)
  const [fresh, setFresh] = useState<string | null>(null) // the link you just made
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let stillHere = true
    myCallLinks(me.uid)
      .then((list) => stillHere && setLinks(list))
      .catch((err) => {
        console.error(err)
        if (stillHere) setLinks([])
      })
    return () => {
      stillHere = false
    }
  }, [me.uid])

  async function make() {
    setBusy(true)
    setError('')
    try {
      const code = await makeCallLink(me, video)
      setFresh(code)
      setLinks([{ code, owner: me, video }, ...(links ?? [])])
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
    }
    setBusy(false)
  }

  function copy(code: string) {
    navigator.clipboard
      .writeText(callLinkAddress(code))
      .then(() => setCopied(code))
      .catch(() => {})
  }

  async function remove(code: string) {
    if (!confirm(t.confirmDeleteLink)) return
    try {
      await deleteCallLink(code)
      setLinks((links ?? []).filter((link) => link.code !== code))
      if (fresh === code) setFresh(null)
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
    }
  }

  return (
    <Modal title={t.callLink} onClose={onClose} className="narrow">
      <p className="hint">{t.callLinkHint}</p>
      <div className="setting static">
        <span className="setting-text">
          <span>{t.callType}</span>
        </span>
        <span className="segmented" role="radiogroup" aria-label={t.callType}>
          <button role="radio" aria-checked={!video} className={!video ? 'on' : ''} onClick={() => setVideo(false)}>
            {t.voiceWord}
          </button>
          <button role="radio" aria-checked={video} className={video ? 'on' : ''} onClick={() => setVideo(true)}>
            {t.videoWord}
          </button>
        </span>
      </div>
      <button className="btn" disabled={busy} onClick={make}>
        <Icon name="link" size={18} /> {t.createLink}
      </button>
      {error && <p className="error">{error}</p>}
      {links && links.length > 0 && <p className="section-title">{t.yourCallLinks}</p>}
      <div className="call-links">
        {links?.map((link) => (
          <div key={link.code} className={link.code === fresh ? 'call-link fresh' : 'call-link'}>
            <span className="invite-link" dir="ltr">
              <Icon name={link.video ? 'video' : 'phone'} size={16} />
              {callLinkAddress(link.code)}
            </span>
            <span className="invite-buttons">
              <button className="btn small secondary" onClick={() => copy(link.code)}>
                <Icon name="copy" size={16} /> {copied === link.code ? t.copied : t.copyLink}
              </button>
              {'share' in navigator && (
                <button
                  className="btn small secondary"
                  onClick={() => navigator.share({ title: 'PakChat', text: t.callMeOnPakChat, url: callLinkAddress(link.code) }).catch(() => {})}
                >
                  <Icon name="sendFwd" size={16} /> {t.share}
                </button>
              )}
              <button className="btn small secondary danger" onClick={() => remove(link.code)}>
                <Icon name="trash" size={16} /> {t.delete}
              </button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ---------- Opening someone's call link ----------

export function JoinCallDialog({ me, code, onClose }: { me: Person; code: string; onClose: () => void }) {
  const { t } = useT()
  const [link, setLink] = useState<CallLink | null | undefined>(undefined) // undefined = loading
  useEffect(() => {
    let stillHere = true
    lookupCallLink(code)
      .then((found) => stillHere && setLink(found))
      .catch((err) => {
        console.error(err)
        if (stillHere) setLink(null)
      })
    return () => {
      stillHere = false
    }
  }, [code])

  return (
    <Modal title={t.callLink} onClose={onClose} className="narrow">
      {link === undefined && <p className="empty">{t.loading}</p>}
      {link === null && <p className="empty">{t.badCallLink}</p>}
      {link && (
        <div className="join-call">
          <PersonAvatar uid={link.owner.uid} name={link.owner.name} size={96} />
          <h3 dir="auto">{link.owner.name}</h3>
          <p className="muted">{link.video ? t.videoCall : t.voiceCall}</p>
          {link.owner.uid === me.uid ? (
            <p className="hint center">{t.ownCallLink}</p>
          ) : (
            <button
              className="btn"
              onClick={() => {
                onClose()
                startCall(me, link.owner, link.video)
              }}
            >
              <Icon name={link.video ? 'video' : 'phone'} size={18} /> {fill(t.callPerson, { name: link.owner.name })}
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

// ---------- Schedule call ----------

// The next half hour from now, for the time box: "2026-10-16" and "15:30".
function nextHalfHour() {
  const d = new Date(Date.now() + 30 * 60_000)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

type ScheduleProps = { me: Person; people: Person[]; chats: Chat[]; onClose: () => void; onDone: () => void }

export function ScheduleDialog({ me, people, chats, onClose, onDone }: ScheduleProps) {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [who, setWho] = useState<Person | null>(null)
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(nextHalfHour)
  const [video, setVideo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shown = people.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!who) return
    const startsAt = new Date(`${when.date}T${when.time}`)
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 5 * 60_000) return setError(t.pickLaterTime)
    setBusy(true)
    setError('')
    try {
      const chatExists = chats.some((c) => c.id === chatIdFor(me.uid, who.uid))
      await scheduleCall(me, who, title.trim() || fill(t.callWith, { name: who.name }), startsAt, video, chatExists)
      onDone()
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
      setBusy(false)
    }
  }

  return (
    <Modal title={t.scheduleCall} onClose={onClose} className="narrow">
      {!who ? (
        <>
          <p className="hint">{t.scheduleWho}</p>
          <div className="field">
            <Icon name="search" size={18} />
            <input placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="pick-list">
            {shown.map((person) => (
              <button key={person.uid} className="row" onClick={() => setWho(person)}>
                <PersonAvatar uid={person.uid} name={person.name} size={42} />
                <strong className="row-main" dir="auto">
                  {person.name}
                </strong>
              </button>
            ))}
            {shown.length === 0 && <p className="empty">{people.length ? t.nothingHere : t.noPeopleYet}</p>}
          </div>
        </>
      ) : (
        <form className="schedule-form" onSubmit={save}>
          <button type="button" className="row schedule-who" onClick={() => setWho(null)}>
            <PersonAvatar uid={who.uid} name={who.name} size={42} />
            <strong className="row-main" dir="auto">
              {who.name}
            </strong>
            <small className="link">{t.change}</small>
          </button>
          <label className="form-label">
            {t.callNameLabel}
            <input dir="auto" maxLength={100} placeholder={fill(t.callWith, { name: who.name })} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="form-row">
            <label className="form-label">
              {t.date}
              <input type="date" required value={when.date} onChange={(e) => setWhen({ ...when, date: e.target.value })} />
            </label>
            <label className="form-label">
              {t.time}
              <input type="time" required value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} />
            </label>
          </div>
          <div className="setting static">
            <span className="setting-text">
              <span>{t.callType}</span>
            </span>
            <span className="segmented" role="radiogroup" aria-label={t.callType}>
              <button type="button" role="radio" aria-checked={!video} className={!video ? 'on' : ''} onClick={() => setVideo(false)}>
                {t.voiceWord}
              </button>
              <button type="button" role="radio" aria-checked={video} className={video ? 'on' : ''} onClick={() => setVideo(true)}>
                {t.videoWord}
              </button>
            </span>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={busy}>
            <Icon name="calendar" size={18} /> {busy ? t.saving : t.schedule}
          </button>
        </form>
      )}
    </Modal>
  )
}

// ---------- The reminder when a scheduled call starts ----------

export function CallReminder({ me, plan, onClose }: { me: Person; plan: ScheduledCall; onClose: () => void }) {
  const { t } = useT()
  const peer = scheduledWith(plan, me.uid)
  return (
    <Modal title={t.scheduledCall} onClose={onClose} className="narrow">
      <div className="join-call">
        <PersonAvatar uid={peer.uid} name={peer.name} size={96} />
        <h3 dir="auto">{plan.title}</h3>
        <p className="muted" dir="auto">
          {peer.name} · {dayAndTime(plan.startsAt.toDate(), t.locale)}
        </p>
        <p className="hint center">{t.callStartingNow}</p>
        <button
          className="btn"
          onClick={() => {
            onClose()
            startCall(me, peer, plan.video)
          }}
        >
          <Icon name={plan.video ? 'video' : 'phone'} size={18} /> {fill(t.callPerson, { name: peer.name })}
        </button>
        <button className="btn secondary" onClick={onClose}>
          {t.notNow}
        </button>
      </div>
    </Modal>
  )
}
