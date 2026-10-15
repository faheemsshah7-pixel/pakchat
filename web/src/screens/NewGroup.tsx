// NewGroup.tsx: pick a name and some people, then create the group.
// People you already chat with are listed. You can also add someone by number.
import { useState } from 'react'
import { findUserByPhone, isGroup, otherPerson, type Chat, type Person } from '../chats'
import { createGroup } from '../groups'
import { useT } from '../lang'
import { toInternational } from '../phone'
import Avatar from './Avatar'

type Props = { me: Person; chats: Chat[]; onCancel: () => void; onCreated: (chatId: string) => void }

export default function NewGroup({ me, chats, onCancel, onCreated }: Props) {
  const { t } = useT()
  const [title, setTitle] = useState('')
  // Everyone from your one-to-one chats, plus anyone you add by number.
  const [people, setPeople] = useState<Person[]>(() =>
    chats.filter((c) => !isGroup(c)).map((c) => otherPerson(c, me.uid)),
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
  }

  async function addByNumber(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const person = await findUserByPhone(toInternational(number))
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
    setBusy(true)
    setError('')
    try {
      const chatId = await createGroup(
        me,
        title.trim(),
        people.filter((p) => picked.has(p.uid)),
      )
      onCreated(chatId)
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <button className="back" onClick={onCancel} aria-label={t.back}>
          ←
        </button>
        <h2>{t.newGroup}</h2>
      </header>

      <div className="pad stack">
        <input dir="auto" placeholder={t.groupName} value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <label>{t.addPeople}</label>
      </div>
      <form className="newchat" onSubmit={addByNumber}>
        <input inputMode="tel" dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
        <button disabled={number.length < 10}>{t.add}</button>
      </form>

      <div className="list">
        {people.map((p) => (
          <label key={p.uid} className="row pick">
            <input type="checkbox" checked={picked.has(p.uid)} onChange={() => toggle(p.uid)} />
            <Avatar name={p.name} />
            <strong className="row-main" dir="auto">{p.name}</strong>
          </label>
        ))}
      </div>

      {error && <p className="error pad">{error}</p>}
      <div className="pad bottom">
        <button disabled={busy || !title.trim()} onClick={create}>
          {t.createGroup}
        </button>
      </div>
    </div>
  )
}
