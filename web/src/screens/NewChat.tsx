// NewChat.tsx: start a chat. Type a friend's number or Gmail, or pick someone you already
// know (from your chats and groups). "New group" and "Message yourself" are here too.
import { useState } from 'react'
import { chatIdFor, findUser, isGroup, type Chat, type Person } from '../chats'
import { useT } from '../lang'
import { contactKey } from '../phone'
import type { Profile } from '../profiles'
import { fill } from '../strings'
import { PersonAvatar } from './Avatar'
import type { Open } from './Home'
import Icon from './Icon'

type Props = { me: Person; profile: Profile; chats: Chat[]; onBack: () => void; onOpen: (open: Open) => void; onNewGroup: () => void }

export default function NewChat({ me, profile, chats, onBack, onOpen, onNewGroup }: Props) {
  const { t } = useT()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Everyone you know: the people in your chats and groups, A to Z.
  const people = new Map<string, string>()
  for (const chat of chats) {
    for (const uid of chat.members) if (uid !== me.uid && !people.has(uid)) people.set(uid, chat.names[uid] ?? '?')
  }
  const known = [...people.entries()].map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name))
  const q = number.trim().toLowerCase()
  const shown = q ? known.filter((p) => p.name.toLowerCase().includes(q)) : known
  const direct = new Set(chats.filter((c) => !isGroup(c)).flatMap((c) => c.members))
  // "Message yourself": notes, links and photos you want to keep (a chat with you twice: uid_uid).
  const self = { chatId: chatIdFor(me.uid, me.uid), other: me }

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const { field, value } = contactKey(number)
    if (profile[field] === value) return onOpen(self) // your own number: your chat with yourself
    setBusy(true)
    try {
      const person = await findUser(number)
      if (person) onOpen({ chatId: chatIdFor(me.uid, person.uid), other: person })
      else setError(t.notOnPakChat)
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pane">
      <header className="bar">
        <button className="icon back-always" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{t.newChat}</h2>
      </header>

      <form className="newchat" onSubmit={start}>
        <div className="field">
          <Icon name="chatPlus" size={20} />
          <input dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
        </div>
        <button className="btn small" disabled={busy || number.trim().length < 5}>
          {t.start}
        </button>
      </form>
      {error && <p className="error pad">{error}</p>}

      <div className="list">
        <button className="row new-group" onClick={onNewGroup}>
          <span className="avatar accent">
            <Icon name="users" />
          </span>
          <strong className="row-main">{t.newGroup}</strong>
        </button>
        <button className="row" onClick={() => onOpen(self)}>
          <PersonAvatar uid={me.uid} name={me.name} size={44} />
          <span className="row-main">
            <strong dir="auto">{fill(t.youName, { name: me.name })}</strong>
            <small className="muted">{t.messageYourself}</small>
          </span>
        </button>
        {shown.length > 0 && <p className="section-title">{t.peopleYouKnow}</p>}
        {shown.map((p) => (
          <button key={p.uid} className="row" onClick={() => onOpen({ chatId: chatIdFor(me.uid, p.uid), other: p })}>
            <PersonAvatar uid={p.uid} name={p.name} size={44} />
            <span className="row-main">
              <strong dir="auto">{p.name}</strong>
              {!direct.has(p.uid) && <small className="muted">{t.fromAGroup}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
