// ChatRoom.tsx: one conversation (with one person, or a group).
// Messages appear live, for everyone in it.
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { collection, doc, limitToLast, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import {
  isGroup,
  markRead,
  markTyping,
  otherPerson,
  sendMessage,
  systemText,
  tickFor,
  typingText,
  type Chat,
  type Content,
  type Message,
  type Person,
} from '../chats'
import { useT } from '../lang'
import { presenceText } from '../presence'
import { block, report, unblock } from '../safety'
import { nameColour } from '../colours'
import { fill, type Strings } from '../strings'
import { clock, isToday, isYesterday, useNow } from '../time'
import Avatar from './Avatar'
import Composer from './Composer'
import GroupInfo from './GroupInfo'
import Icon from './Icon'
import { PhotoBubble, VoiceBubble } from './MediaBubbles'
import Menu, { type MenuItem } from './Menu'
import Ticks from './Ticks'

type Props = {
  me: Person
  chatId: string
  chat: Chat | undefined // undefined = a new direct chat, before the first message
  other?: Person // set for direct chats
  blocked: Set<string> // people I blocked
  onBack: () => void
}

export default function ChatRoom({ me, chatId, chat, other: otherProp, blocked, onBack }: Props) {
  const { t } = useT()
  const [messages, setMessages] = useState<Message[]>([])
  const [showInfo, setShowInfo] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null) // a photo shown full size
  const bottom = useRef<HTMLDivElement>(null)
  const lastTypingSent = useRef(0)
  const lastMarkedRead = useRef('')
  const group = isGroup(chat)
  const other = group ? undefined : (otherProp ?? (chat && otherPerson(chat, me.uid)))
  const title = group ? (chat?.title ?? '') : (other?.name ?? '')
  const iBlockedThem = !!other && blocked.has(other.uid)

  // Listen LIVE to the last 100 messages, oldest at the top.
  useEffect(() => {
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('sentAt'), limitToLast(100))
    // includeMetadataChanges: also tell us when a message we sent reaches the server (🕓 -> ✓).
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      setMessages(
        snap.docs.map((d) => ({
          id: d.id,
          // 'estimate': a message you JUST sent has no server time yet, so use your clock for now.
          ...d.data({ serverTimestamps: 'estimate' }),
          pending: d.metadata.hasPendingWrites,
        }) as Message),
      )
    })
  }, [chatId])

  // Whenever messages change, scroll to the newest one.
  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [messages])

  // Esc closes the photo you're looking at, or else the chat (like WhatsApp Web).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return // a window on top handles its own Esc
      if (viewing) setViewing(null)
      else if (!showInfo) onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewing, showInfo, onBack])

  // New message from someone else while this chat is on screen? Mark it read (blue ✓✓).
  useEffect(() => {
    const newest = messages.findLast((m) => m.senderId !== me.uid)
    if (!newest || newest.pending) return
    const markIfVisible = () => {
      if (document.visibilityState !== 'visible' || lastMarkedRead.current === newest.id) return
      lastMarkedRead.current = newest.id
      markRead(chatId, me.uid).catch(console.error)
    }
    markIfVisible()
    // If the tab is hidden, wait until you come back to it.
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [messages, chatId, me.uid])

  function onTyping() {
    // Tell the others we're typing, at most once every 3 seconds.
    if (chat && Date.now() - lastTypingSent.current > 3000) {
      lastTypingSent.current = Date.now()
      markTyping(chatId, me.uid).catch(console.error)
    }
  }

  function send(content: Content) {
    lastTypingSent.current = 0
    return sendMessage(me, { chatId, other, isNew: !chat }, content)
  }

  async function reportChat() {
    if (!confirm(t.confirmReport)) return
    await report(me.uid, chatId, other?.uid ?? null)
    alert(t.reported)
  }

  const menu: MenuItem[] = []
  if (group) {
    menu.push({ label: t.groupInfo, icon: 'info', onClick: () => setShowInfo(true) })
  } else if (other) {
    menu.push(
      iBlockedThem
        ? { label: t.unblock, icon: 'block', onClick: () => unblock(me.uid, other.uid) }
        : {
            label: t.block,
            icon: 'block',
            danger: true,
            onClick: () => confirm(fill(t.confirmBlock, { name: other.name })) && block(me.uid, other.uid),
          },
    )
  }
  if (messages.length > 0) menu.push({ label: t.report, icon: 'flag', onClick: reportChat, danger: true })

  if (showInfo && chat) return <GroupInfo me={me} chat={chat} onBack={() => setShowInfo(false)} />

  return (
    <div className="pane">
      <header className="bar">
        <button className="icon back" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <Avatar name={title} group={group} size={42} />
        <h2 dir="auto" className={group ? 'clickable' : ''} onClick={() => group && setShowInfo(true)}>
          {title}
          <small>
            <ChatStatus me={me} chat={chat} other={other} />
          </small>
        </h2>
        {menu.length > 0 && <Menu label={t.menu} items={menu} />}
      </header>

      {/* The wall is the patterned background. The messages scroll on top of it. */}
      <div className="wall">
        <div className="messages">
          {messages.length === 0 && <p className="say-hi">{t.sayHi}</p>}
          {messages.map((m, i) => {
            const before = messages[i - 1]
            const day = dayLabel(m.sentAt?.toDate(), t)
            const newDay = day !== dayLabel(before?.sentAt?.toDate(), t)
            const dayDivider = newDay && day && (
              <div className="day">
                <span>{day}</span>
              </div>
            )
            if (m.kind === 'system') {
              return (
                <Fragment key={m.id}>
                  {dayDivider}
                  <p className="system">{systemText(m, me.uid, t)}</p>
                </Fragment>
              )
            }
            const mine = m.senderId === me.uid
            // "first" = the first of several messages in a row from the same person. It gets the little tail.
            const first = newDay || !before || before.kind === 'system' || before.senderId !== m.senderId
            return (
              <Fragment key={m.id}>
                {dayDivider}
                <div className={['bubble', mine && 'mine', first && 'first', m.kind === 'photo' && 'has-photo'].filter(Boolean).join(' ')}>
                  {group && !mine && first && (
                    <span className="sender" style={{ color: nameColour(m.senderName ?? '') }}>
                      {m.senderName}
                    </span>
                  )}
                  {m.kind === 'photo' && (
                    <PhotoBubble chatId={chatId} mediaId={m.mediaId} width={m.width} height={m.height} onView={setViewing} />
                  )}
                  {m.kind === 'voice' && <VoiceBubble chatId={chatId} mediaId={m.mediaId} seconds={m.seconds} />}
                  {(m.kind ?? 'text') === 'text' && <span dir="auto">{m.text}</span>}
                  <time>
                    {m.sentAt && clock(m.sentAt.toDate(), t.locale)}
                    {mine && <Ticks tick={tickFor(chat, me.uid, m.sentAt, m.pending)} />}
                  </time>
                </div>
              </Fragment>
            )
          })}
          <div ref={bottom} />
        </div>
      </div>

      {iBlockedThem && other ? (
        <div className="blocked-bar">
          <span>{fill(t.youBlocked, { name: other.name })}</span>
          <button className="btn small secondary" onClick={() => unblock(me.uid, other.uid)}>
            {t.unblock}
          </button>
        </div>
      ) : (
        <Composer onSend={send} onTyping={onTyping} />
      )}

      {viewing &&
        createPortal(
          <div className="viewer" onClick={() => setViewing(null)}>
            <img src={viewing} alt="" />
          </div>,
          document.body,
        )}
    </div>
  )
}

// "Today", "Yesterday", or a date like "12 October 2026", for the labels between days.
function dayLabel(date: Date | undefined, t: Strings) {
  if (!date) return ''
  if (isToday(date)) return t.today
  if (isYesterday(date)) return t.yesterday
  return date.toLocaleDateString(t.locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

// The small line under the name: "typing…", "online", "last seen…", or the group's members.
// It's its own component because it re-draws every second, and the messages don't need to.
function ChatStatus({ me, chat, other }: { me: Person; chat: Chat | undefined; other?: Person }) {
  const { t } = useT()
  const now = useNow(1000)
  const [lastSeen, setLastSeen] = useState<Timestamp | null>(null)
  const otherUid = other?.uid

  // Direct chats: listen LIVE to the other person's profile, for "online" / "last seen".
  useEffect(() => {
    if (!otherUid) return
    return onSnapshot(doc(db, 'users', otherUid), (snap) => setLastSeen(snap.get('lastSeen') ?? null))
  }, [otherUid])

  const typing = typingText(chat, me.uid, now, t)
  if (typing) return <span className="typing">{typing}</span>
  if (other) return <>{presenceText(lastSeen, now, t)}</>
  // Groups: "Ali, Sara, You"
  return <>{chat?.members.map((uid) => (uid === me.uid ? t.you : chat.names[uid])).join(', ')}</>
}
