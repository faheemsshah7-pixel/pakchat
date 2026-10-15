// ChatList.tsx: your chats, newest on top, plus boxes to start a chat or a group.
// The chats themselves come from Home.tsx, which listens to the database.
import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import type { Profile } from '../App'
import { alertsState, turnOnAlerts } from '../alerts'
import {
  chatIdFor,
  chatTitle,
  findUserByPhone,
  isGroup,
  isUnread,
  otherPerson,
  previewText,
  tickFor,
  typingText,
  type Chat,
  type Person,
} from '../chats'
import { useT } from '../lang'
import { toInternational } from '../phone'
import { formatTime, useNow } from '../time'
import Avatar from './Avatar'
import type { Open } from './Home'
import Menu, { type MenuItem } from './Menu'
import Ticks from './Ticks'

type Props = {
  me: Person
  profile: Profile
  chats: Chat[]
  onOpen: (open: Open) => void
  onNewGroup: () => void
}

export default function ChatList({ me, profile, chats, onOpen, onNewGroup }: Props) {
  const { t, lang, setLang } = useT()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState(alertsState)
  const now = useNow(2000) // re-check "typing…" every 2 seconds

  async function startChat(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const phone = toInternational(number)
    if (phone === profile.phone) {
      setError(t.ownNumber)
      return
    }
    setBusy(true)
    try {
      const person = await findUserByPhone(phone)
      if (person) onOpen({ chatId: chatIdFor(me.uid, person.uid), other: person })
      else setError(t.notOnPakChat)
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const menu: MenuItem[] = [
    { label: t.switchLanguage, onClick: () => setLang(lang === 'en' ? 'ur' : 'en') },
    { label: t.logOut, onClick: () => signOut(auth), danger: true },
  ]
  if (alerts === 'off') {
    menu.unshift({ label: '🔔 ' + t.alertsOn, onClick: () => turnOnAlerts().then(() => setAlerts(alertsState())) })
  }

  return (
    <div className="app">
      <header className="bar">
        <h2>
          PakChat
          <small>{profile.name}</small>
        </h2>
        <Menu label={t.menu} items={menu} />
      </header>

      <form className="newchat" onSubmit={startChat}>
        <input
          inputMode="tel"
          dir="ltr"
          placeholder={t.friendsNumber}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <button disabled={busy || number.length < 10}>{t.newChat}</button>
      </form>
      {error && <p className="error pad">{error}</p>}

      <div className="list">
        <button className="row" onClick={onNewGroup}>
          <Avatar name="" group />
          <strong className="row-main">{t.newGroup}</strong>
        </button>
        {chats.length === 0 && <p className="muted center pad">{t.noChats}</p>}
        {chats.map((chat) => {
          const title = chatTitle(chat, me.uid)
          const last = chat.lastMessage
          const mine = last?.senderId === me.uid && last.kind !== 'system'
          const typing = typingText(chat, me.uid, now, t)
          const unread = isUnread(chat, me.uid)
          const open = isGroup(chat) ? { chatId: chat.id } : { chatId: chat.id, other: otherPerson(chat, me.uid) }
          return (
            <button key={chat.id} className={unread ? 'row unread' : 'row'} onClick={() => onOpen(open)}>
              <Avatar name={title} group={isGroup(chat)} />
              <span className="row-main">
                <strong dir="auto">{title}</strong>
                {typing ? (
                  <span className="typing">{typing}</span>
                ) : (
                  <span className="muted" dir="auto">
                    {mine && <Ticks tick={tickFor(chat, me.uid, chat.updatedAt)} />}
                    {previewText(chat, me.uid, t)}
                  </span>
                )}
              </span>
              <span className="row-side">
                <time className="muted">{formatTime(chat.updatedAt?.toDate(), t.locale)}</time>
                {unread && <span className="dot" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
