// NewGroup.tsx: pick a name and some people, then create the group.
// People you already chat with are listed. You can also add someone by number.
// broadcast: make a broadcast list instead (broadcasts.ts). Its name is optional, and it needs 2 people or more.
import { useState } from 'react'
import { MAX_RECIPIENTS, createBroadcast } from '../broadcasts'
import { findUser, isDirect, otherPerson, type Chat, type Person } from '../chats'
import { createGroup } from '../groups'
import { useT } from '../lang'
import Avatar from './Avatar'
import Icon from './Icon'

type Props = { me: Person; chats: Chat[]; broadcast?: boolean; onCancel: () => void; onCreated: (chatId: string) => void }

export default function NewGroup({ me, chats, broadcast = false, onCancel, onCreated }: Props) {
  const { t } = useT()
  const [title, setTitle] = useState('')
  // Everyone from your one-to-one chats (not "Message yourself"), plus anyone you add by number.
  const [people, setPeople] = useState<Person[]>(() =>
    chats
      .filter(isDirect)
      .map((c) => otherPerson(c, me.uid))
      .filter((p) => p.uid !== me.uid),
  )
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function toggle(uid: string) {
    const next = new Set(picked)
    if (next.has(uid)) next.delete(uid)
    else next.add(uid)
    setPicked(next)
    setError('') // ("Pick at least 2 people." goes once you pick someone)
  }

  async function addByNumber(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const person = await findUser(number)
      if (!person) return setError(t.notOnPakChat)
      if (person.uid === me.uid) return setError(t.ownNumber)
      if (!people.some((p) => p.uid === person.uid)) setPeople([...people, person])
      setPicked(new Set(picked).add(person.uid))
      setNumber('')
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    }
  }

  async function create() {
    if (picked.size === 0) return setError(t.pickPeople)
    if (broadcast && picked.size < 2) return setError(t.pickTwo)
    setBusy(true)
    setError('')
    try {
      const chosen = people.filter((p) => picked.has(p.uid))
      const chatId = await (broadcast ? createBroadcast(me, title.trim(), chosen.slice(0, MAX_RECIPIENTS)) : createGroup(me, title.trim(), chosen))
      onCreated(chatId)
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
      setBusy(false)
    }
  }

  return (
    <div className="pane">
      <header className="bar">
        <button className="icon back" onClick={onCancel} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{broadcast ? t.newBroadcast : t.newGroup}</h2>
      </header>

      <div className="group-name">
        <Avatar name={title || '?'} group={!broadcast} list={broadcast} size={56} />
        <input dir="auto" placeholder={broadcast ? t.listName : t.groupName} value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      {broadcast && <p className="hint pad">{t.listHint}</p>}

      <p className="section-title">{t.addPeople}</p>
      <form className="newchat" onSubmit={addByNumber}>
        <div className="field">
          <Icon name="userPlus" size={20} />
          <input dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <button className="btn small" disabled={number.trim().length < 5}>
          {t.add}
        </button>
      </form>

      <div className="list">
        {people.map((p) => (
          <label key={p.uid} className="row pick">
            <Avatar name={p.name} size={44} />
            <strong className="row-main" dir="auto">
              {p.name}
            </strong>
            <input type="checkbox" checked={picked.has(p.uid)} onChange={() => toggle(p.uid)} />
          </label>
        ))}
      </div>

      {error && <p className="error pad">{error}</p>}
      <div className="bottom">
        <button className="btn" disabled={busy || (!broadcast && !title.trim())} onClick={create}>
          {broadcast ? t.createList : t.createGroup}
          {picked.size > 0 && <span className="count">{picked.size}</span>}
        </button>
      </div>
    </div>
  )
}
