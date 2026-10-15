// ChatRoom.tsx: one conversation (with one person, or a group).
// Messages appear live, for everyone in it. Older messages load as you scroll up.
// Each message has a menu (MessageBubble.tsx): react, reply, copy, forward, edit, info, delete.
// In a chat with one person, the phone and camera at the top start a call (calls.ts).
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { collection, doc, limitToLast, onSnapshot, orderBy, query, where, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { startCall } from '../calls'
import {
  isAdmin,
  isGroup,
  lastRead,
  markRead,
  markTyping,
  otherPerson,
  sendMessage,
  systemText,
  typingText,
  type Chat,
  type Content,
  type Extras,
  type Message,
  type Person,
} from '../chats'
import { useT } from '../lang'
import { shrinkPhoto } from '../media'
import { canEdit, editMessage, QUICK_REACTIONS, react, replySnapshot, unsendMessage } from '../messages'
import { clearChat, deleteChat, hideMessage, isMuted, setPrefs, type ChatPrefs } from '../prefs'
import { presenceText } from '../presence'
import { rememberProfile, useProfile, type Profile } from '../profiles'
import { block, report, unblock } from '../safety'
import { leaveGroup } from '../groups'
import { fill, type Strings } from '../strings'
import { clock, isToday, isYesterday, useNow } from '../time'
import Avatar, { GroupAvatar, PersonAvatar } from './Avatar'
import Composer from './Composer'
import ContactInfo from './ContactInfo'
import { DeleteDialog, ForwardDialog, InfoDialog, MuteDialog, ReactionsDialog } from './Dialogs'
import EmojiPicker from './EmojiPicker'
import GroupInfo from './GroupInfo'
import Icon from './Icon'
import Menu, { type MenuItem } from './Menu'
import MessageBubble from './MessageBubble'
import PhotoSender, { type PickedPhoto } from './PhotoSender'
import Popover, { type PopoverItem } from './Popover'

type Props = {
  me: Person
  myProfile: Profile
  chatId: string
  chat: Chat | undefined // undefined = a new direct chat, before the first message
  other?: Person // set for direct chats
  prefs: ChatPrefs | undefined // your settings for this chat (prefs.ts)
  chats: Chat[] // all your chats (to forward messages to)
  blocked: Set<string> // people I blocked
  onBack: () => void
  onOpenPerson: (person: Person) => void // "Message" someone from the group's member list
}

type Dialog = { kind: 'forward' | 'info' | 'reactions' | 'delete'; m: Message } | { kind: 'mute' }
const PAGE = 100 // messages loaded at a time

export default function ChatRoom(props: Props) {
  const { me, myProfile, chatId, chat, other: otherProp, prefs, chats, blocked, onBack, onOpenPerson } = props
  const { t } = useT()
  const [limit, setLimit] = useState(PAGE)
  const [raw, setRaw] = useState<Message[]>([]) // what the database sent
  const [hasMore, setHasMore] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [viewing, setViewing] = useState<{ m: Message; data: string } | null>(null) // a photo shown full size
  const [menu, setMenu] = useState<{ m: Message; x: number; y: number } | null>(null)
  const [reactingTo, setReactingTo] = useState<Message | null>(null) // the full emoji picker, for a reaction
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [photos, setPhotos] = useState<File[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState('')
  const [match, setMatch] = useState(0) // which search result is showing (counted from the newest)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(0) // messages that arrived while you were scrolled up
  const [toast, setToast] = useState('')
  // The "3 unread messages" line, worked out once when the chat opens.
  const [openedAt] = useState(() => (chat ? lastRead(chat, me.uid, prefs) : 0))
  const [divider, setDivider] = useState<{ id: string; count: number } | null>(null)

  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const restoreFrom = useRef<number | null>(null) // keeps your place when older messages load
  const loadedOnce = useRef(false)
  const dividerDone = useRef(false) // the unread line is worked out once
  const newest = useRef('')
  const lastTypingSent = useRef(0)
  const lastMarkedRead = useRef('')

  const group = isGroup(chat)
  const other = group ? undefined : (otherProp ?? (chat && otherPerson(chat, me.uid)))
  const title = group ? (chat?.title ?? '') : (other?.name ?? '')
  const iBlockedThem = !!other && blocked.has(other.uid)
  const canTalk = !group || !chat?.onlyAdmins || isAdmin(chat, me.uid)
  // Calls are for chats with one person (not groups), and not with someone you blocked.
  const call = other && !iBlockedThem ? (video: boolean) => startCall(me, other, video) : undefined
  const clearedAt = prefs?.clearedAt?.toMillis() ?? 0
  const hidden = prefs?.hidden
  const messages = hidden?.length ? raw.filter((m) => !hidden.includes(m.id)) : raw

  // Listen LIVE to the last 100 messages (more as you scroll up), oldest at the top.
  // After "Clear chat", only messages sent after that.
  useEffect(() => {
    const after = clearedAt ? [where('sentAt', '>', new Date(clearedAt))] : []
    const q = query(collection(db, 'chats', chatId, 'messages'), ...after, orderBy('sentAt'), limitToLast(limit))
    // includeMetadataChanges: also tell us when a message we sent reaches the server (🕓 -> ✓).
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const list = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            // 'estimate': a message you JUST sent has no server time yet, so use your clock for now.
            ...d.data({ serverTimestamps: 'estimate' }),
            pending: d.metadata.hasPendingWrites,
          }) as Message,
      )
      setRaw(list)
      setHasMore(snap.size >= limit)
      // The first time only (with fresh news from the server): where do the unread messages start?
      if (!dividerDone.current && !snap.metadata.fromCache) {
        dividerDone.current = true
        const unread = list.filter((m) => m.senderId !== me.uid && (m.sentAt?.toMillis() ?? 0) > openedAt)
        setDivider(unread.length ? { id: unread[0].id, count: unread.length } : null)
      }
    }, (err) => {
      // You were just removed from this group: you can't read it any more, and it closes by itself.
      console.warn('Stopped listening to this chat:', err.code)
    })
  }, [chatId, limit, clearedAt, me.uid, openedAt])

  // After the messages change: keep your place, or follow new messages down.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || messages.length === 0) return
    const last = messages[messages.length - 1]
    if (restoreFrom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current // older messages arrived above: stay put
      restoreFrom.current = null
    } else if (!loadedOnce.current) {
      // Just opened: go to the first unread message, or else the bottom.
      const line = document.getElementById('unread-line')
      if (line) line.scrollIntoView({ block: 'start' })
      else el.scrollTop = el.scrollHeight
    } else if (last.id !== newest.current) {
      // A new message arrived. Follow it if you're at the bottom (or you sent it); otherwise count it.
      if (nearBottom.current || last.senderId === me.uid) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      else setNewBelow((n) => n + 1)
    }
    loadedOnce.current = true
    newest.current = last.id
  }, [messages, me.uid])

  function onScroll() {
    const el = scroller.current!
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom.current !== atBottom) setAtBottom(nearBottom.current)
    if (nearBottom.current && newBelow) setNewBelow(0)
    // Near the top, and there are older messages: load 100 more.
    if (el.scrollTop < 80 && hasMore && restoreFrom.current === null) {
      restoreFrom.current = el.scrollHeight - el.scrollTop
      setLimit((n) => n + PAGE)
    }
  }

  function toBottom() {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
    setNewBelow(0)
  }

  // Scroll to a message and make it glow for a moment (a reply's quote, or a search result).
  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById('m-' + id)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth // (restarts the glow if it's already glowing)
    el.classList.add('flash')
  }, [])

  // Esc closes the photo you're looking at, the search, or else the chat (like WhatsApp Web).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || document.querySelector('.modal, .popover, .emoji-picker, .photo-sender')) return
      if (viewing) setViewing(null)
      else if (searching) setSearching(false)
      else if (!showInfo && !replyTo && !editing) onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewing, searching, showInfo, replyTo, editing, onBack])

  // New message from someone else while this chat is on screen? Mark it read (blue ✓✓).
  useEffect(() => {
    const newestFromOthers = messages.findLast((m) => m.senderId !== me.uid)
    const markedUnread = !!prefs?.unread
    if ((!newestFromOthers || newestFromOthers.pending) && !markedUnread) return
    const markIfVisible = () => {
      const id = newestFromOthers?.id ?? ''
      if (document.visibilityState !== 'visible' || (lastMarkedRead.current === id && !markedUnread)) return
      lastMarkedRead.current = id
      if (chat) markRead(chatId, me.uid, markedUnread).catch(console.error)
    }
    markIfVisible()
    // If the tab is hidden, wait until you come back to it.
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [messages, chatId, me.uid, prefs?.unread, chat])

  // Toasts ("Copied") disappear by themselves.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])

  function onTyping() {
    // Tell the others we're typing, at most once every 3 seconds.
    if (chat && Date.now() - lastTypingSent.current > 3000) {
      lastTypingSent.current = Date.now()
      markTyping(chatId, me.uid).catch(console.error)
    }
  }

  function send(content: Content, extras?: Extras) {
    lastTypingSent.current = 0
    nearBottom.current = true
    return sendMessage(me, { chatId, other, isNew: !chat }, content, extras)
  }

  // Photos picked, pasted or dropped: shrink and send them one by one.
  async function sendPhotos(picked: PickedPhoto[]) {
    setPhotos(null)
    const extras = replyTo ? { replyTo: replySnapshot(replyTo) } : {}
    setReplyTo(null)
    for (const [i, { file, caption }] of picked.entries()) {
      try {
        const photo = await shrinkPhoto(file)
        await send({ kind: 'photo', ...photo, ...(caption ? { caption } : {}) }, i === 0 ? extras : {})
      } catch (err) {
        console.error(err)
        setToast(t.photoNotSent)
      }
    }
  }

  async function saveEdit(text: string) {
    if (!editing) return
    const isLast = messages[messages.length - 1]?.id === editing.id
    await editMessage(chatId, me, editing, text, isLast)
    setEditing(null)
  }

  async function reportChat() {
    if (!confirm(t.confirmReport)) return
    await report(me.uid, chatId, other?.uid ?? null)
    alert(t.reported)
  }

  // ----- Things you can do to the whole chat (header menu, and the info panels) -----
  const muted = isMuted(prefs)
  const actions = {
    mute: () => (muted ? setPrefs(me.uid, chatId, { mutedUntil: null }) : setDialog({ kind: 'mute' })),
    clear: () => confirm(t.confirmClear) && clearChat(me.uid, chatId).catch(console.error),
    remove: () => {
      if (!confirm(t.confirmDeleteChat)) return
      deleteChat(me.uid, chatId).catch(console.error)
      onBack()
    },
    block: () => {
      if (!other) return
      if (iBlockedThem) unblock(me.uid, other.uid)
      else if (confirm(fill(t.confirmBlock, { name: other.name }))) block(me.uid, other.uid)
    },
    report: reportChat,
    leave: () => chat && confirm(t.confirmLeave) && leaveGroup(me, chat).catch(console.error),
  }

  const menuItems: MenuItem[] = [
    { label: group ? t.groupInfo : t.contactInfo, icon: 'info', onClick: () => setShowInfo(true) },
    { label: t.searchMessages, icon: 'search', onClick: () => setSearching(true) },
    { label: muted ? t.unmute : t.mute, icon: muted ? 'bell' : 'bellOff', onClick: actions.mute },
  ]
  if (messages.length > 0) menuItems.push({ label: t.clearChat, icon: 'eraser', onClick: actions.clear })
  if (other) menuItems.push({ label: iBlockedThem ? t.unblock : t.block, icon: 'block', onClick: actions.block, danger: !iBlockedThem })
  if (messages.length > 0) menuItems.push({ label: t.report, icon: 'flag', onClick: reportChat, danger: true })
  if (group) menuItems.push({ label: t.leaveGroup, icon: 'logout', onClick: actions.leave, danger: true })
  else if (chat) menuItems.push({ label: t.deleteChat, icon: 'trash', onClick: actions.remove, danger: true })

  // ----- The menu on one message -----
  function messageMenu(m: Message): PopoverItem[] {
    const items: PopoverItem[] = []
    const text = (m.kind === 'photo' ? m.caption : m.text) ?? ''
    if (m.deleted || m.kind === 'call') return [{ label: t.delete, icon: 'trash', danger: true, onClick: () => setDialog({ kind: 'delete', m }) }]
    if (canTalk && !iBlockedThem) items.push({ label: t.reply, icon: 'reply', onClick: () => (setEditing(null), setReplyTo(m)) })
    if (text) {
      items.push({
        label: t.copy,
        icon: 'copy',
        onClick: () => navigator.clipboard.writeText(text).then(() => setToast(t.copied), console.error),
      })
    }
    items.push({ label: t.forward, icon: 'forward', onClick: () => setDialog({ kind: 'forward', m }) })
    if (canEdit(m, me.uid)) items.push({ label: t.edit, icon: 'edit', onClick: () => (setReplyTo(null), setEditing(m)) })
    if (m.senderId === me.uid && chat) items.push({ label: t.info, icon: 'info', onClick: () => setDialog({ kind: 'info', m }) })
    items.push({ label: t.delete, icon: 'trash', danger: true, onClick: () => setDialog({ kind: 'delete', m }) })
    return items
  }

  function toggleReaction(m: Message, emoji: string) {
    const mine = m.reactions?.[me.uid]
    react(chatId, m.id, me.uid, mine === emoji ? null : emoji).catch((err) => {
      console.error(err)
      setToast(t.somethingWrong)
    })
  }

  // ----- Search: find words in the loaded messages -----
  const q = searching ? search.trim().toLowerCase() : ''
  const matches = q
    ? messages.filter((m) => !m.deleted && ((m.kind === 'photo' ? m.caption : m.text) ?? '').toLowerCase().includes(q))
    : []
  const matchIndex = Math.min(match, matches.length - 1)
  const foundId = matches[matches.length - 1 - matchIndex]?.id
  useEffect(() => {
    if (foundId) jumpTo(foundId)
  }, [foundId, jumpTo])

  if (showInfo && chat && group) {
    return <GroupInfo me={me} chat={chat} messages={messages} prefs={prefs} actions={actions} onBack={() => setShowInfo(false)} onOpenPerson={onOpenPerson} onView={(m, data) => setViewing({ m, data })} />
  }
  if (showInfo && other) {
    return (
      <ContactInfo
        me={me}
        chatId={chatId}
        person={other}
        messages={messages}
        muted={muted}
        blocked={iBlockedThem}
        actions={actions}
        onCall={call}
        onBack={() => setShowInfo(false)}
        onView={(m, data) => setViewing({ m, data })}
      />
    )
  }

  return (
    <div
      className="pane"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files') || !canTalk || iBlockedThem) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        if (images.length) setPhotos(images)
      }}
    >
      <header className="bar">
        <button className="icon back" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <button className="bar-who" onClick={() => setShowInfo(true)} disabled={!chat && !other}>
          {group && chat ? <GroupAvatar chat={chat} size={42} /> : other ? <PersonAvatar uid={other.uid} name={other.name} size={42} /> : <Avatar name={title} size={42} />}
          <h2 dir="auto">
            {title}
            <small>
              <ChatStatus me={me} myProfile={myProfile} chat={chat} other={other} />
            </small>
          </h2>
        </button>
        {muted && (
          <span className="bar-muted" title={t.muted}>
            <Icon name="bellOff" size={18} />
          </span>
        )}
        {call && (
          <>
            <button className="icon" aria-label={t.videoCall} title={t.videoCall} onClick={() => call(true)}>
              <Icon name="video" />
            </button>
            <button className="icon" aria-label={t.voiceCall} title={t.voiceCall} onClick={() => call(false)}>
              <Icon name="phone" />
            </button>
          </>
        )}
        <button className="icon hide-narrow" aria-label={t.searchMessages} title={t.searchMessages} onClick={() => setSearching(!searching)}>
          <Icon name="search" />
        </button>
        <Menu label={t.menu} items={menuItems} />
      </header>

      {searching && (
        <div className="search-bar">
          <div className="field">
            <Icon name="search" size={18} />
            <input
              placeholder={t.searchMessages}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setMatch(0)
              }}
              onKeyDown={(e) => e.key === 'Enter' && setMatch((n) => (n + 1) % Math.max(1, matches.length))}
              autoFocus
            />
            {q && <span className="search-count">{matches.length ? `${matchIndex + 1} / ${matches.length}` : '0'}</span>}
          </div>
          <button className="icon" aria-label={t.older} disabled={matchIndex >= matches.length - 1} onClick={() => setMatch(matchIndex + 1)}>
            <Icon name="chevronUp" />
          </button>
          <button className="icon" aria-label={t.newer} disabled={matchIndex <= 0} onClick={() => setMatch(matchIndex - 1)}>
            <Icon name="chevronDown" />
          </button>
          <button className="icon" aria-label={t.close} onClick={() => setSearching(false)}>
            <Icon name="close" />
          </button>
        </div>
      )}

      {/* The wall is the patterned background. The messages scroll on top of it. */}
      <div className="wall">
        <div className="messages" ref={scroller} onScroll={onScroll}>
          {hasMore && <p className="loading-older">{t.loadingOlder}</p>}
          {messages.length === 0 && <p className="say-hi">{t.sayHi}</p>}
          {messages.map((m, i) => {
            const before = messages[i - 1]
            const day = dayLabel(m.sentAt?.toDate(), t)
            const newDay = day !== dayLabel(before?.sentAt?.toDate(), t)
            return (
              <Fragment key={m.id}>
                {newDay && day && (
                  <div className="day">
                    <span>{day}</span>
                  </div>
                )}
                {divider?.id === m.id && (
                  <div className="unread-line" id="unread-line">
                    <span>{fill(divider.count === 1 ? t.oneUnread : t.manyUnread, { n: divider.count })}</span>
                  </div>
                )}
                {m.kind === 'system' ? (
                  <p className="system" id={'m-' + m.id}>
                    {systemText(m, me.uid, t)}
                  </p>
                ) : (
                  <MessageBubble
                    m={m}
                    chat={chat}
                    chatId={chatId}
                    myUid={me.uid}
                    group={group}
                    // "first" = the first of several messages in a row from the same person. It gets the little tail.
                    first={newDay || !before || before.kind === 'system' || before.senderId !== m.senderId || divider?.id === m.id}
                    highlight={q}
                    onMenu={(m, x, y) => setMenu({ m, x, y })}
                    onReactions={(m) => setDialog({ kind: 'reactions', m })}
                    onJump={jumpTo}
                    onView={(m, data) => setViewing({ m, data })}
                    onCall={call}
                  />
                )}
              </Fragment>
            )
          })}
        </div>
        {!atBottom && (
          <button className="jump-down" aria-label={t.newest} onClick={toBottom}>
            <Icon name="chevronDown" />
            {newBelow > 0 && <span className="badge">{newBelow}</span>}
          </button>
        )}
        {toast && <p className="toast">{toast}</p>}
        {dragging && (
          <div className="drop-here">
            <Icon name="image" size={40} />
            {t.dropPhotos}
          </div>
        )}
      </div>

      {iBlockedThem && other ? (
        <div className="blocked-bar">
          <span>{fill(t.youBlocked, { name: other.name })}</span>
          <button className="btn small secondary" onClick={() => unblock(me.uid, other.uid)}>
            {t.unblock}
          </button>
        </div>
      ) : !canTalk ? (
        <div className="blocked-bar center">
          <Icon name="lock" size={16} /> {t.onlyAdminsCanSend}
        </div>
      ) : (
        <Composer
          chatId={chatId}
          myUid={me.uid}
          onSend={send}
          onTyping={onTyping}
          onPhotos={setPhotos}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSaveEdit={saveEdit}
        />
      )}

      {menu && (
        <Popover
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={messageMenu(menu.m)}
          top={
            !menu.m.deleted && (
              <div className="quick-reactions">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    className={menu.m.reactions?.[me.uid] === emoji ? 'on' : ''}
                    aria-label={emoji}
                    onClick={() => {
                      setMenu(null)
                      toggleReaction(menu.m, emoji)
                    }}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  className="more"
                  aria-label={t.moreReactions}
                  onClick={() => {
                    setReactingTo(menu.m)
                    setMenu(null)
                  }}
                >
                  <Icon name="plus" size={18} />
                </button>
              </div>
            )
          }
        />
      )}
      {reactingTo &&
        createPortal(
          <EmojiPicker
            className="floating"
            onClose={() => setReactingTo(null)}
            onPick={(emoji) => {
              toggleReaction(reactingTo, emoji)
              setReactingTo(null)
            }}
          />,
          document.body,
        )}

      {dialog?.kind === 'forward' && (
        <ForwardDialog
          me={me}
          chats={chats}
          fromChatId={chatId}
          m={dialog.m}
          onClose={() => setDialog(null)}
          onSent={(n) => {
            setDialog(null)
            setToast(fill(n === 1 ? t.forwardedOne : t.forwardedMany, { n }))
          }}
        />
      )}
      {dialog?.kind === 'info' && chat && <InfoDialog chat={chat} m={dialog.m} me={me} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'reactions' && (
        <ReactionsDialog chat={chat} chatId={chatId} m={dialog.m} myUid={me.uid} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          m={dialog.m}
          myUid={me.uid}
          onClose={() => setDialog(null)}
          onForMe={() => {
            hideMessage(me.uid, chatId, dialog.m.id).catch(console.error)
            setDialog(null)
          }}
          onForEveryone={() => {
            const isLast = messages[messages.length - 1]?.id === dialog.m.id
            unsendMessage(chatId, me, dialog.m, isLast).catch((err) => {
              console.error(err)
              setToast(t.somethingWrong)
            })
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'mute' && (
        <MuteDialog onClose={() => setDialog(null)} onMute={(until) => setPrefs(me.uid, chatId, { mutedUntil: until }).catch(console.error)} />
      )}

      {photos && <PhotoSender files={photos} onClose={() => setPhotos(null)} onSend={sendPhotos} />}

      {viewing &&
        createPortal(
          <div className="viewer" onClick={() => setViewing(null)}>
            <header onClick={(e) => e.stopPropagation()}>
              <span className="viewer-who">
                <strong>{viewing.m.senderId === me.uid ? t.you : viewing.m.senderName}</strong>
                <small>{viewing.m.sentAt && `${dayLabel(viewing.m.sentAt.toDate(), t)}, ${clock(viewing.m.sentAt.toDate(), t.locale)}`}</small>
              </span>
              <a className="icon" href={viewing.data} download={`PakChat photo ${viewing.m.id}.jpg`} aria-label={t.download} title={t.download}>
                <Icon name="download" />
              </a>
              <button className="icon" aria-label={t.close} onClick={() => setViewing(null)}>
                <Icon name="close" />
              </button>
            </header>
            <img src={viewing.data} alt="" onClick={(e) => e.stopPropagation()} />
            {viewing.m.caption && (
              <p className="viewer-caption" dir="auto">
                {viewing.m.caption}
              </p>
            )}
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
function ChatStatus({ me, myProfile, chat, other }: { me: Person; myProfile: Profile; chat: Chat | undefined; other?: Person }) {
  const { t } = useT()
  const now = useNow(1000)
  const [lastSeen, setLastSeen] = useState<Timestamp | null>(null)
  const otherUid = other?.uid
  const theirs = useProfile(otherUid)

  // Direct chats: listen LIVE to the other person's profile, for "online" / "last seen".
  useEffect(() => {
    if (!otherUid) return
    return onSnapshot(doc(db, 'users', otherUid), (snap) => {
      if (!snap.exists()) return
      setLastSeen(snap.get('lastSeen') ?? null)
      rememberProfile(otherUid, snap.data() as Profile) // share their new photo/about with the rest of the app
    })
  }, [otherUid])

  const typing = typingText(chat, me.uid, now, t)
  if (typing) return <span className="typing">{typing}</span>
  if (other) {
    // Hidden if they hid theirs, or you hid yours (like WhatsApp: you can't see what you don't share).
    if (myProfile.hideLastSeen || theirs?.hideLastSeen) return <>{t.tapForInfo}</>
    return <>{presenceText(lastSeen, now, t) || t.tapForInfo}</>
  }
  // Groups: "Ali, Sara, You"
  return <>{chat?.members.map((uid) => (uid === me.uid ? t.you : chat.names[uid])).join(', ')}</>
}
