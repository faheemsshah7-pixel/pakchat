// StarredList.tsx: "Starred messages": the messages you starred, newest first.
// From the chat list's menu it shows the stars from every chat; from a chat's info, just that chat's.
// Your stars are saved in your private prefs (prefs.ts) as message ids, so the messages
// themselves are fetched here, once each. Tap one to go to it in its chat.
import { useEffect, useRef, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { isGroup, otherPerson, shortText, type Chat, type Message, type Person } from '../chats'
import { isExpired } from '../disappearing'
import { useT } from '../lang'
import { starMessage } from '../prefs'
import { clock, shortDate } from '../time'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'

export type Starred = { chatId: string; id: string }

type Props = {
  me: Person
  items: Starred[]
  chats: Chat[]
  onBack: () => void
  onOpen: (chatId: string, messageId: string) => void
}

const keyOf = (item: Starred) => item.chatId + '/' + item.id

export default function StarredList({ me, items, chats, onBack, onOpen }: Props) {
  const { t } = useT()
  // key -> the message, or null if it's gone (deleted, or a chat you left)
  const [found, setFound] = useState<Map<string, Message | null>>(new Map())
  const asked = useRef(new Set<string>())

  useEffect(() => {
    for (const item of items) {
      const key = keyOf(item)
      if (asked.current.has(key)) continue
      asked.current.add(key)
      getDoc(doc(db, 'chats', item.chatId, 'messages', item.id)).then(
        (snap) => setFound((old) => new Map(old).set(key, snap.exists() ? ({ id: snap.id, ...snap.data(), pending: false } as Message) : null)),
        () => setFound((old) => new Map(old).set(key, null)),
      )
    }
  }, [items])

  const shown = items
    .map((item) => ({ item, m: found.get(keyOf(item)) }))
    .filter((x): x is { item: Starred; m: Message } => !!x.m && !x.m.deleted && !isExpired(x.m))
    .sort((a, b) => (b.m.sentAt?.toMillis() ?? 0) - (a.m.sentAt?.toMillis() ?? 0))
  const loading = items.some((item) => !found.has(keyOf(item)))

  // "Ali ▸ You", "You ▸ Sara" or "Ali ▸ Cricket team", like WhatsApp.
  function where(chatId: string, m: Message) {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return ''
    if (isGroup(chat)) return chat.title ?? ''
    return m.senderId === me.uid ? otherPerson(chat, me.uid).name : t.you
  }

  return (
    <div className="pane info-pane">
      <header className="bar">
        <button className="icon back-always" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{t.starredMessages}</h2>
      </header>
      <div className="list">
        {shown.length === 0 && <p className="empty">{loading ? t.loading : t.noStarred}</p>}
        {shown.map(({ item, m }) => {
          const mine = m.senderId === me.uid
          const date = m.sentAt?.toDate()
          return (
            <div key={keyOf(item)} className="starred">
              <button className="starred-open" onClick={() => onOpen(item.chatId, m.id)}>
                <span className="starred-top">
                  <PersonAvatar uid={m.senderId} name={m.senderName ?? '?'} size={26} />
                  <strong dir="auto">{mine ? t.you : m.senderName}</strong>
                  <span className="starred-where" dir="auto">
                    ▸ {where(item.chatId, m)}
                  </span>
                  {date && <time>{shortDate(date, t.locale)}</time>}
                </span>
                <span className={mine ? 'starred-bubble mine' : 'starred-bubble'}>
                  <span dir="auto">{shortText(m, me.uid, t)}</span>
                  <small>
                    <Icon name="starFilled" size={11} />
                    {date && clock(date, t.locale)}
                  </small>
                </span>
              </button>
              <button
                className="icon small"
                aria-label={t.unstar}
                title={t.unstar}
                onClick={() => starMessage(me.uid, item.chatId, item.id, false).catch(console.error)}
              >
                <Icon name="starOff" size={18} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
