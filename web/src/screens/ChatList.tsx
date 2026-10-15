// ChatList.tsx: your chats, newest on top, plus a box to start a chat, a "New group" button,
// and All / Unread / Groups buttons to filter the list.
// The chats themselves come from Home.tsx, which listens to the database.
import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import type { Profile } from '../App'
import { alertsState, turnOnAlerts } from '../alerts'
import {
  chatIdFor,
  chatTitle,
  findUser,
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
import { contactKey } from '../phone'
import { formatTime, useNow } from '../time'
import Avatar from './Avatar'
import type { Open } from './Home'
import Icon from './Icon'
import Logo from './Logo'
import Menu, { type MenuItem } from './Menu'
import ThemePicker from './ThemePicker'
import Ticks from './Ticks'

type Filter = 'all' | 'unread' | 'groups'

type Props = {
  me: Person
  profile: Profile
  chats: Chat[]
  activeId?: string // the chat open on the right (on a computer)
  onOpen: (open: Open) => void
  onNewGroup: () => void
}

export default function ChatList({ me, profile, chats, activeId, onOpen, onNewGroup }: Props) {
  const { t, lang, setLang } = useT()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState(alertsState)
  const [filter, setFilter] = useState<Filter>('all')
  const [picking, setPicking] = useState(false) // the "Choose a look" window
  const now = useNow(2000) // re-check "typing…" every 2 seconds

  async function startChat(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const { field, value } = contactKey(number)
    if (profile[field] === value) {
      setError(t.ownNumber)
      return
    }
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

  const menu: MenuItem[] = [
    { label: t.theme, icon: 'palette', onClick: () => setPicking(true) },
    { label: t.switchLanguage, icon: 'language', onClick: () => setLang(lang === 'en' ? 'ur' : 'en') },
    { label: t.logOut, icon: 'logout', onClick: () => signOut(auth), danger: true },
  ]
  if (alerts === 'off') {
    menu.unshift({ label: t.alertsOn, icon: 'bell', onClick: () => turnOnAlerts().then(() => setAlerts(alertsState())) })
  }

  const shown = chats.filter((chat) =>
    filter === 'unread' ? isUnread(chat, me.uid) : filter === 'groups' ? isGroup(chat) : true,
  )
  const filters: [Filter, string][] = [
    ['all', t.filterAll],
    ['unread', t.filterUnread],
    ['groups', t.filterGroups],
  ]

  return (
    <div className="pane">
      <header className="bar">
        <span className="brand">
          <Logo size={34} />
        </span>
        <h2>
          PakChat
          <small>
            {profile.name} · <span dir="ltr">{profile.phone ?? profile.email}</span>
          </small>
        </h2>
        <button className="icon" aria-label={t.theme} title={t.theme} onClick={() => setPicking(true)}>
          <Icon name="palette" />
        </button>
        <Menu label={t.menu} items={menu} />
      </header>

      <form className="newchat" onSubmit={startChat}>
        <div className="field">
          <Icon name="chatPlus" size={20} />
          <input dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <button className="btn small" disabled={busy || number.trim().length < 5}>
          {t.newChat}
        </button>
      </form>
      {error && <p className="error pad">{error}</p>}

      <div className="chips" role="tablist">
        {filters.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'chip on' : 'chip'} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="list">
        {filter === 'all' && (
          <button className="row new-group" onClick={onNewGroup}>
            <span className="avatar accent">
              <Icon name="userPlus" />
            </span>
            <strong className="row-main">{t.newGroup}</strong>
          </button>
        )}
        {chats.length === 0 && <p className="empty">{t.noChats}</p>}
        {chats.length > 0 && shown.length === 0 && <p className="empty">{t.nothingHere}</p>}
        {shown.map((chat) => {
          const title = chatTitle(chat, me.uid)
          const last = chat.lastMessage
          const mine = last?.senderId === me.uid && last.kind !== 'system'
          const typing = typingText(chat, me.uid, now, t)
          const unread = isUnread(chat, me.uid)
          const open = isGroup(chat) ? { chatId: chat.id } : { chatId: chat.id, other: otherPerson(chat, me.uid) }
          const classes = ['row', unread && 'unread', chat.id === activeId && 'active'].filter(Boolean).join(' ')
          return (
            <button key={chat.id} className={classes} onClick={() => onOpen(open)}>
              <Avatar name={title} group={isGroup(chat)} />
              <span className="row-main">
                <span className="row-top">
                  <strong dir="auto">{title}</strong>
                  <time>{formatTime(chat.updatedAt?.toDate(), t.locale)}</time>
                </span>
                <span className="row-bottom">
                  {typing ? (
                    <span className="typing">{typing}</span>
                  ) : (
                    <span className="preview-text" dir="auto">
                      {mine && <Ticks tick={tickFor(chat, me.uid, chat.updatedAt)} />}
                      {previewText(chat, me.uid, t)}
                    </span>
                  )}
                  {unread && <span className="dot" />}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {picking && <ThemePicker onClose={() => setPicking(false)} />}
    </div>
  )
}
