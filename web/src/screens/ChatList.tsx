// ChatList.tsx: your chats, pinned ones on top, then newest first.
// The search box finds a chat by name or message, or starts a new chat with a number or Gmail.
// All / Unread / Groups filter the list. Archived chats wait in their own list.
// Right-click a chat (or use its little arrow) to pin, mute, archive, mark unread or delete it.
// The chats themselves come from Home.tsx, which listens to the database.
// Each row is drawn again only when something in it changed (memo, at the bottom).
import { memo, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { alertsState, turnOnAlerts } from '../alerts'
import {
  chatIdFor,
  chatTitle,
  findUser,
  isGroup,
  isUnread,
  markRead,
  otherPerson,
  previewText,
  tickFor,
  type Chat,
  type Person,
} from '../chats'
import { getDraft, useDraftsVersion } from '../drafts'
import { leaveGroup } from '../groups'
import { useT } from '../lang'
import { contactKey } from '../phone'
import { deleteChat, isHidden, isMuted, MAX_PINNED, setPrefs, type ChatPrefs } from '../prefs'
import type { Profile } from '../profiles'
import { install, useCanInstall } from '../pwa'
import { useStable } from '../stable'
import { formatTime, useNow } from '../time'
import { typingText, useTypingVersion } from '../typing'
import { ChatAvatar } from './Avatar'
import { MuteDialog } from './Dialogs'
import type { Open } from './Home'
import Icon from './Icon'
import Logo from './Logo'
import Menu, { type MenuItem } from './Menu'
import Popover, { type PopoverItem } from './Popover'
import ThemePicker from './ThemePicker'
import Ticks from './Ticks'

type Filter = 'all' | 'unread' | 'groups'

type Props = {
  me: Person
  profile: Profile
  chats: Chat[]
  prefs: Map<string, ChatPrefs>
  counts: Map<string, number> // how many unread messages in each chat
  activeId?: string // the chat open on the right (on a computer)
  archived: boolean // showing the "Archived" list
  onArchived: (show: boolean) => void
  onOpen: (open: Open) => void
  onNewChat: () => void
  onNewGroup: () => void
  onSettings: () => void
  onCalls: () => void
}

export default function ChatList(props: Props) {
  const { me, profile, chats, prefs, counts, activeId, archived, onArchived, onOpen, onNewChat, onNewGroup, onSettings, onCalls } = props
  const { t, lang, setLang } = useT()
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState(alertsState)
  const [filter, setFilter] = useState<Filter>('all')
  const [picking, setPicking] = useState(false) // the "Choose a look" window
  const [rowMenu, setRowMenu] = useState<{ chat: Chat; x: number; y: number } | null>(null)
  const [muting, setMuting] = useState<string | null>(null) // chat id for the "Mute" window
  const canInstall = useCanInstall()
  useDraftsVersion() // re-draw when a draft appears or goes
  useTypingVersion() // re-draw when someone starts typing
  const now = useNow(2000) // re-check "typing…" every 2 seconds

  const q = search.trim().toLowerCase()
  // Does the search look like a phone number or a Gmail? Then offer to start a chat with it.
  const looksLikeContact = q.includes('@') ? q.includes('.') : q.replace(/\D/g, '').length >= 10

  async function startChat(e?: React.FormEvent) {
    e?.preventDefault()
    if (!looksLikeContact) return
    setError('')
    const { field, value } = contactKey(search)
    if (profile[field] === value) return setError(t.ownNumber)
    setBusy(true)
    try {
      const person = await findUser(search)
      if (person) {
        onOpen({ chatId: chatIdFor(me.uid, person.uid), other: person })
        setSearch('')
      } else setError(t.notOnPakChat)
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const menu: MenuItem[] = [
    { label: t.newGroup, icon: 'users', onClick: onNewGroup },
    { label: t.calls, icon: 'phone', onClick: onCalls },
    { label: t.settings, icon: 'settings', onClick: onSettings },
    { label: t.theme, icon: 'palette', onClick: () => setPicking(true) },
    { label: t.switchLanguage, icon: 'language', onClick: () => setLang(lang === 'en' ? 'ur' : 'en') },
  ]
  if (alerts === 'off') {
    menu.push({ label: t.alertsOn, icon: 'bell', onClick: () => turnOnAlerts().then(() => setAlerts(alertsState())) })
  }
  if (canInstall) menu.push({ label: t.installApp, icon: 'install', onClick: install })
  menu.push({ label: t.logOut, icon: 'logout', onClick: () => signOut(auth), danger: true })

  // The chats for this list, pinned first, then newest first.
  const inList = chats.filter((c) => !isHidden(c, prefs.get(c.id)) && !!prefs.get(c.id)?.archived === archived)
  const pinnedAt = (c: Chat) => (archived ? 0 : (prefs.get(c.id)?.pinnedAt ?? 0))
  inList.sort((a, b) => pinnedAt(b) - pinnedAt(a) || (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0))
  const shown = inList.filter((chat) => {
    if (filter === 'unread' && !isUnread(chat, me.uid, prefs.get(chat.id))) return false
    if (filter === 'groups' && !isGroup(chat)) return false
    if (!q) return true
    return chatTitle(chat, me.uid).toLowerCase().includes(q) || previewText(chat, me.uid, t).toLowerCase().includes(q)
  })
  const archivedChats = chats.filter((c) => prefs.get(c.id)?.archived && !isHidden(c, prefs.get(c.id)))
  const archivedUnread = archivedChats.filter((c) => isUnread(c, me.uid, prefs.get(c.id))).length
  const pinnedCount = chats.filter((c) => prefs.get(c.id)?.pinnedAt).length

  const filters: [Filter, string][] = [
    ['all', t.filterAll],
    ['unread', t.filterUnread],
    ['groups', t.filterGroups],
  ]

  // The same two functions for every row, every time (see stable.ts), so memo() works.
  const openRow = useStable((chat: Chat) => onOpen(isGroup(chat) ? { chatId: chat.id } : { chatId: chat.id, other: otherPerson(chat, me.uid) }))
  const rowMenuAt = useStable((chat: Chat, x: number, y: number) => setRowMenu({ chat, x, y }))

  // The menu on one chat.
  function rowItems(chat: Chat): PopoverItem[] {
    const p = prefs.get(chat.id)
    const unread = isUnread(chat, me.uid, p)
    const items: PopoverItem[] = [
      p?.archived
        ? { label: t.unarchive, icon: 'archive', onClick: () => setPrefs(me.uid, chat.id, { archived: false }) }
        : { label: t.archive, icon: 'archive', onClick: () => setPrefs(me.uid, chat.id, { archived: true, pinnedAt: null }) },
      isMuted(p)
        ? { label: t.unmute, icon: 'bell', onClick: () => setPrefs(me.uid, chat.id, { mutedUntil: null }) }
        : { label: t.mute, icon: 'bellOff', onClick: () => setMuting(chat.id) },
    ]
    if (!p?.archived) {
      if (p?.pinnedAt) items.push({ label: t.unpin, icon: 'pin', onClick: () => setPrefs(me.uid, chat.id, { pinnedAt: null }) })
      else {
        items.push({
          label: t.pin,
          icon: 'pin',
          onClick: () => (pinnedCount >= MAX_PINNED ? alert(t.pinLimit) : setPrefs(me.uid, chat.id, { pinnedAt: Date.now() })),
        })
      }
    }
    items.push(
      unread
        ? { label: t.markRead, icon: 'checks', onClick: () => markRead(chat.id, me.uid, true) }
        : { label: t.markUnread, icon: 'chatPlus', onClick: () => setPrefs(me.uid, chat.id, { unread: true }) },
    )
    if (isGroup(chat)) {
      items.push({ label: t.leaveGroup, icon: 'logout', danger: true, onClick: () => confirm(t.confirmLeave) && leaveGroup(me, chat) })
    } else {
      items.push({ label: t.deleteChat, icon: 'trash', danger: true, onClick: () => confirm(t.confirmDeleteChat) && deleteChat(me.uid, chat.id) })
    }
    return items
  }

  return (
    <div className="pane">
      {archived ? (
        <header className="bar">
          <button className="icon back-always" onClick={() => onArchived(false)} aria-label={t.back}>
            <Icon name="back" />
          </button>
          <h2>{t.archived}</h2>
        </header>
      ) : (
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
          <button className="icon" aria-label={t.newChat} title={t.newChat} onClick={onNewChat}>
            <Icon name="chatPlus" />
          </button>
          <button className="icon" aria-label={t.calls} title={t.calls} onClick={onCalls}>
            <Icon name="phone" />
          </button>
          <Menu label={t.menu} items={menu} />
        </header>
      )}

      {!archived && (
        <>
          <form className="newchat" onSubmit={startChat}>
            <div className="field">
              <Icon name="search" size={20} />
              <input placeholder={t.searchOrStart} aria-label={t.searchOrStart} value={search} onChange={(e) => (setSearch(e.target.value), setError(''))} />
              {search && (
                <button type="button" className="icon small" aria-label={t.close} onClick={() => setSearch('')}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          </form>
          {error && <p className="error pad">{error}</p>}

          <div className="chips" role="tablist">
            {filters.map(([key, label]) => (
              <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'chip on' : 'chip'} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="list">
        {looksLikeContact && !archived && (
          <button className="row new-group" onClick={() => startChat()} disabled={busy}>
            <span className="avatar accent">
              <Icon name="chatPlus" />
            </span>
            <span className="row-main">
              <strong>{t.startChatWith}</strong>
              <small className="muted" dir="ltr">
                {search.trim()}
              </small>
            </span>
          </button>
        )}
        {!archived && !q && filter === 'all' && archivedChats.length > 0 && (
          <button className="row archived-row" onClick={() => onArchived(true)}>
            <span className="row-icon">
              <Icon name="archive" />
            </span>
            <strong className="row-main">{t.archived}</strong>
            {archivedUnread > 0 && <span className="badge">{archivedUnread}</span>}
          </button>
        )}
        {chats.length === 0 && <p className="empty">{t.noChats}</p>}
        {chats.length > 0 && shown.length === 0 && !looksLikeContact && <p className="empty">{archived ? t.noArchived : t.nothingHere}</p>}
        {shown.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            me={me}
            prefs={prefs.get(chat.id)}
            count={counts.get(chat.id) ?? 0}
            active={chat.id === activeId}
            typing={typingText(chat, me.uid, now, t)}
            draft={chat.id === activeId ? '' : getDraft(chat.id)} // (no "Draft:" for the chat you're typing in)
            muted={isMuted(prefs.get(chat.id), now)}
            onOpen={openRow}
            onMenu={rowMenuAt}
          />
        ))}
        {archived && <p className="hint center">{t.archivedHint}</p>}
      </div>

      {picking && <ThemePicker onClose={() => setPicking(false)} />}
      {rowMenu && <Popover x={rowMenu.x} y={rowMenu.y} onClose={() => setRowMenu(null)} items={rowItems(rowMenu.chat)} />}
      {muting && <MuteDialog onClose={() => setMuting(null)} onMute={(until) => setPrefs(me.uid, muting, { mutedUntil: until })} />}
    </div>
  )
}

type RowProps = {
  chat: Chat
  me: Person
  prefs: ChatPrefs | undefined
  count: number
  active: boolean
  typing: string // "typing…", or ''
  draft: string
  muted: boolean
  onOpen: (chat: Chat) => void
  onMenu: (chat: Chat, x: number, y: number) => void
}

// memo: only drawn again when one of its props changed (a new message in THIS chat, say).
const ChatRow = memo(function ChatRow({ chat, me, prefs, count, active, typing, draft, muted, onOpen, onMenu }: RowProps) {
  const { t } = useT()
  const title = chatTitle(chat, me.uid)
  const last = chat.lastMessage
  const mine = last?.senderId === me.uid && last.kind !== 'system' && !last.deleted
  const unread = isUnread(chat, me.uid, prefs)
  const classes = ['row', 'chat-row', unread && 'unread', active && 'active', muted && 'muted'].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(chat)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(chat))}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(chat, e.clientX, e.clientY)
      }}
    >
      <ChatAvatar chat={chat} myUid={me.uid} />
      <span className="row-main">
        <span className="row-top">
          <strong dir="auto">{title}</strong>
          <time>{formatTime(chat.updatedAt?.toDate(), t.locale)}</time>
        </span>
        <span className="row-bottom">
          {typing ? (
            <span className="typing">{typing}</span>
          ) : draft ? (
            <span className="preview-text" dir="auto">
              <span className="draft">{t.draft}</span> {draft}
            </span>
          ) : (
            <span className="preview-text" dir="auto">
              {mine && <Ticks tick={tickFor(chat, me.uid, chat.updatedAt)} />}
              {previewText(chat, me.uid, t)}
            </span>
          )}
          {muted && <Icon name="bellOff" size={16} />}
          {prefs?.pinnedAt && !prefs.archived && <Icon name="pin" size={16} />}
          {unread && (count > 0 && !prefs?.unread ? <span className="badge">{count > 99 ? '99+' : count}</span> : <span className="dot" />)}
          <button
            className="row-menu"
            aria-label={t.chatMenu}
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              onMenu(chat, r.left, r.bottom + 4)
            }}
          >
            <Icon name="chevronDown" size={18} />
          </button>
        </span>
      </span>
    </div>
  )
})
