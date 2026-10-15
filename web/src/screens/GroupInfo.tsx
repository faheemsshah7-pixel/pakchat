// GroupInfo.tsx: who's in the group. The admin can add people; anyone can leave.
import { useState } from 'react'
import { findUser, type Chat, type Person } from '../chats'
import { addMember, leaveGroup } from '../groups'
import { useT } from '../lang'
import { fill } from '../strings'
import Avatar from './Avatar'
import Icon from './Icon'

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
      const person = await findUser(number)
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
    <div className="pane">
      <header className="bar">
        <button className="icon back" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{t.groupInfo}</h2>
      </header>

      <div className="list">
        <div className="info-hero">
          <Avatar name={chat.title ?? ''} group size={96} />
          <h3 dir="auto">{chat.title}</h3>
          <p>{fill(t.members, { n: chat.members.length })}</p>
        </div>

        {iAmAdmin && (
          <form className="newchat" onSubmit={add}>
            <div className="field">
              <Icon name="userPlus" size={20} />
              <input dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <button className="btn small" disabled={busy || number.trim().length < 5}>
              {t.addMember}
            </button>
          </form>
        )}
        {error && <p className="error pad">{error}</p>}

        {chat.members.map((uid) => {
          const name = uid === me.uid ? t.you : (chat.names[uid] ?? '?')
          return (
            <div key={uid} className="row">
              <Avatar name={chat.names[uid] ?? '?'} size={44} />
              <strong className="row-main" dir="auto">
                {name}
              </strong>
              {uid === chat.admin && <span className="tag">{t.admin}</span>}
            </div>
          )
        })}

        <div className="bottom">
          <button className="btn secondary danger" onClick={leave}>
            <Icon name="logout" size={18} /> {t.leaveGroup}
          </button>
        </div>
      </div>
    </div>
  )
}
