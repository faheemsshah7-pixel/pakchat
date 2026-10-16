// MessageBubble.tsx: one message in a chat: who sent it (in groups), what it answers,
// the words / photo / video / voice note / document / location / contact / poll / sticker / call / scheduled call,
// the time and ticks, and any emoji reactions under it.
// Right-click it (or hold your finger on it on a phone, or use the little arrow) for its menu.
// memo (at the bottom): a bubble is only drawn again when ITS message changed. A chat shows
// 50 messages, and drawing all of them for every new one made sending feel slow on phones.
import { memo, useRef } from 'react'
import { callTitle, shortText, type Message, type SharedContact, type Tick } from '../chats'
import { nameColour } from '../colours'
import { isJumboEmoji } from '../emoji'
import { useT } from '../lang'
import { clock, duration } from '../time'
import Icon from './Icon'
import { ContactBubble, LocationBubble, ScheduledCallBubble } from './CardBubbles'
import { FileBubble, PhotoBubble, VideoBubble, VoiceBubble } from './MediaBubbles'
import { PollBubble } from './Polls'
import RichText from './RichText'
import { StickerBubble } from './Stickers'
import Ticks from './Ticks'

type Props = {
  m: Message
  tick: Tick // the clock / ✓ / ✓✓ (worked out in ChatRoom.tsx, so this bubble doesn't need the whole chat)
  chatId: string
  myUid: string
  group: boolean
  first: boolean // first of several in a row from the same person: gets the tail (and the name, in groups)
  highlight: string // words you searched for
  starred: boolean // you starred it: a small star by the time
  pinned: boolean // pinned in this chat: a small pin by the time
  onMenu: (m: Message, x: number, y: number) => void
  onReactions: (m: Message) => void
  onJump: (messageId: string) => void
  onView: (m: Message, data: string) => void // a photo or video, full screen
  onContact: (contact: SharedContact) => void // "Message" on a contact card
  onCall?: (video: boolean) => void // tapping a call in the chat calls them back
  canVote: boolean // polls: you can vote (you can send messages here)
  nameOf: (uid: string) => string // someone's name in this chat (for @mentions and poll votes)
  onVotes: (m: Message) => void // polls: "View votes"
  onMention: (uid: string) => void // tapping an @mention
}

export default memo(function MessageBubble(props: Props) {
  const { m, tick, chatId, myUid, group, first, highlight, starred, pinned, onMenu, onReactions, onJump, onView, onContact, onCall, canVote, nameOf, onVotes, onMention } = props
  const { t } = useT()
  const mine = m.senderId === myUid
  const kind = m.kind ?? 'text'
  const text = kind === 'text' ? m.text : m.caption // (photos, videos and documents can have a caption)
  const jumbo = kind === 'text' && !m.deleted && !m.replyTo && isJumboEmoji(m.text ?? '')
  // Photos, videos and maps fill the bubble, with a thin edge.
  const big = ['photo', 'video', 'location'].includes(kind) && !m.deleted
  // A sticker has no bubble around it (like a big emoji).
  const sticker = kind === 'sticker' && !m.deleted
  const classes = ['bubble', mine && 'mine', first && 'first', big && 'has-photo', (jumbo || sticker) && 'jumbo', sticker && 'is-sticker', kind === 'poll' && 'is-poll', kind === 'call' && 'is-call', m.fresh && 'fresh']
  const tagged = m.mentions?.map((uid) => ({ uid, name: nameOf(uid) }))

  // Holding a finger on the message opens its menu (phones don't have right-click).
  const press = useRef<{ timer: number; opened: number }>({ timer: 0, opened: 0 })
  function touchStart(e: React.TouchEvent) {
    const { clientX, clientY } = e.touches[0]
    press.current.timer = window.setTimeout(() => {
      press.current.opened = Date.now()
      onMenu(m, clientX, clientY)
    }, 500)
  }
  const touchEnd = () => clearTimeout(press.current.timer)

  const time = (
    <time>
      {pinned && !m.deleted && <Icon name="pin" size={12} />}
      {starred && !m.deleted && <Icon name="starFilled" size={12} />}
      {m.editedAt && !m.deleted && <span className="edited">{t.edited}</span>}
      {m.sentAt && clock(m.sentAt.toDate(), t.locale)}
      {mine && !m.deleted && <Ticks tick={tick} />}
    </time>
  )

  return (
    <div
      id={'m-' + m.id}
      className={classes.filter(Boolean).join(' ')}
      onContextMenu={(e) => {
        e.preventDefault()
        if (Date.now() - press.current.opened > 800) onMenu(m, e.clientX, e.clientY)
      }}
      onTouchStart={touchStart}
      onTouchEnd={touchEnd}
      onTouchMove={touchEnd}
    >
      {group && !mine && first && (
        <span className="sender" style={{ color: nameColour(m.senderName ?? '') }}>
          {m.senderName}
        </span>
      )}

      {m.deleted ? (
        <span className="deleted-text">
          <Icon name="block" size={15} />
          {mine ? t.youDeleted : t.wasDeleted}
        </span>
      ) : (
        <>
          {m.forwarded && (
            <span className="forwarded">
              <Icon name="sendFwd" size={14} /> {t.forwarded}
            </span>
          )}
          {m.replyTo && (
            // (A reply to a status can't jump anywhere: the status isn't in the chat.
            // Nor can "Reply privately": the message it answers is in the group.)
            <button type="button" className="quote" onClick={() => m.replyTo!.kind !== 'status' && !m.replyTo!.from && onJump(m.replyTo!.id)}>
              <strong style={{ color: nameColour(m.replyTo.senderName) }}>
                {m.replyTo.senderId === myUid ? t.you : m.replyTo.senderName}
                {m.replyTo.from && <span className="quote-from"> · {m.replyTo.from}</span>}
              </strong>
              <span dir="auto">{shortText(m.replyTo, myUid, t)}</span>
            </button>
          )}
          {kind === 'photo' && (
            <PhotoBubble chatId={chatId} mediaId={m.mediaId} width={m.width} height={m.height} onView={(data) => onView(m, data)} />
          )}
          {kind === 'video' && <VideoBubble chatId={chatId} m={m} onView={(url) => onView(m, url)} />}
          {kind === 'voice' && <VoiceBubble chatId={chatId} mediaId={m.mediaId} seconds={m.seconds} />}
          {kind === 'file' && <FileBubble chatId={chatId} m={m} />}
          {kind === 'location' && <LocationBubble chatId={chatId} m={m} mine={mine} />}
          {kind === 'contact' && m.contact && <ContactBubble contact={m.contact} onMessage={onContact} />}
          {kind === 'scheduledCall' && <ScheduledCallBubble m={m} onCall={onCall} />}
          {kind === 'poll' && <PollBubble chatId={chatId} m={m} myUid={myUid} canVote={canVote} nameOf={nameOf} onVotes={onVotes} />}
          {kind === 'sticker' && <StickerBubble chatId={chatId} m={m} />}
          {kind === 'call' && (
            // "Voice call 2:13" / "Missed video call". Tap it to call back.
            <button type="button" className={m.missed && !mine ? 'call-bubble missed' : 'call-bubble'} disabled={!onCall} onClick={() => onCall?.(!!m.video)}>
              <span className="call-icon">
                <Icon name={m.video ? 'video' : 'phone'} size={20} />
              </span>
              <span className="call-words">
                <strong>{callTitle(m, myUid, t)}</strong>
                <small>{m.missed ? (mine ? t.callNoAnswer : t.callBack) : m.seconds ? duration(m.seconds) : ''}</small>
              </span>
            </button>
          )}
          {text && (
            <span className="text" dir="auto">
              <RichText text={text} highlight={highlight} mentions={tagged} onMention={onMention} />
            </span>
          )}
        </>
      )}
      {time}

      {!m.pending && (
        <button
          type="button"
          className="bubble-menu"
          aria-label={t.messageMenu}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(m, r.left, r.bottom + 4)
          }}
        >
          <Icon name="chevronDown" size={18} />
        </button>
      )}

      {m.reactions && Object.keys(m.reactions).length > 0 && !m.deleted && (
        <Reactions reactions={m.reactions} myUid={myUid} onClick={() => onReactions(m)} />
      )}
    </div>
  )
})

// The little pill under a message: the emojis people reacted with, and how many.
function Reactions({ reactions, myUid, onClick }: { reactions: Record<string, string>; myUid: string; onClick: () => void }) {
  const { t } = useT()
  const counts = new Map<string, number>()
  Object.values(reactions).forEach((emoji) => counts.set(emoji, (counts.get(emoji) ?? 0) + 1))
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const total = Object.keys(reactions).length
  return (
    <button type="button" className={myUid in reactions ? 'reactions mine' : 'reactions'} onClick={onClick} aria-label={t.reactions}>
      {top.map(([emoji]) => (
        <span key={emoji}>{emoji}</span>
      ))}
      {total > 1 && <small>{total}</small>}
    </button>
  )
}
