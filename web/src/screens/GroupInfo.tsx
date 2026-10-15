// GroupInfo.tsx: who's in the group. The admin can add people; anyone can leave.
import { useState } from 'react'
import { findUserByPhone, type Chat, type Person } from '../chats'
import { addMember, leaveGroup } from '../groups'
import { useT } from '../lang'
import { toInternational } from '../phone'
import { fill } from '../strings'
import Avatar from './Avatar'

export default function GroupInfo({ me, chat, onBack }: { me: Person; chat: Chat; onBack: () => void }) {
  const { t } = useT()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const iAmAdmin = chat.admin === me.uid

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const person = await findUserByPhone(toInternational(number))
      if (!person) setError(t.notOnPakChat)
      else if (chat.members.includes(person.uid)) setError(t.alreadyIn)
      else {
        await addMember(me, chat, person)
        setNumber('')
      }
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    if (!confirm(t.confirmLeave)) return
    // When this finishes, the group disappears from your chats and Home shows the list.
    await leaveGroup(me, chat).catch((err) => {
      setError(t.somethingWrong)
      console.error(err)
    })
  }

  return (
    <div className="app">
      <header className="bar">
        <button className="back" onClick={onBack} aria-label={t.back}>
          ←
        </button>
        <h2 dir="auto">
          {chat.title}
          <small>{fill(t.members, { n: chat.members.length })}</small>
        </h2>
      </header>

      {iAmAdmin && (
        <form className="newchat" onSubmit={add}>
          <input inputMode="tel" dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
          <button disabled={busy || number.length < 10}>{t.addMember}</button>
        </form>
      )}
      {error && <p className="error pad">{error}</p>}

      <div className="list">
        {chat.members.map((uid) => {
          const name = uid === me.uid ? t.you : (chat.names[uid] ?? '?')
          return (
            <div key={uid} className="row">
              <Avatar name={chat.names[uid] ?? '?'} />
              <strong className="row-main" dir="auto">{name}</strong>
              {uid === chat.admin && <span className="tag">{t.admin}</span>}
            </div>
          )
        })}
      </div>

      <div className="pad bottom">
        <button className="secondary danger" onClick={leave}>
          {t.leaveGroup}
        </button>
      </div>
    </div>
  )
}
