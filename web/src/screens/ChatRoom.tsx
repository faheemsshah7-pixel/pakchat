// ChatRoom.tsx: one conversation (with one person, or a group).
// Messages appear live, for everyone in it. Older messages load as you scroll up.
// Each message has a menu (MessageBubble.tsx): react, reply, copy, forward, pin, star, edit, info, delete.
// Pinned messages show in a bar under the top (pins.ts). Disappearing messages vanish on time (disappearing.ts).
// In a chat with one person, the phone and camera at the top start a call (calls.ts).
// The paperclip sends photos, videos, documents, your location (location.ts) or a contact card.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { collection, doc, limitToLast, onSnapshot, orderBy, query, where, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { LEVEL, useBack } from '../back'
import { startCall } from '../calls'
import {
  findUser,
  isAdmin,
  isGroup,
  lastRead,
  markRead,
  otherPerson,
  searchText,
  sendMessage,
  shortText,
  systemText,
  tickFor,
  type Chat,
  type Content,
  type Extras,
  type Message,
  type Person,
  type SharedContact,
} from '../chats'
import { deleteExpired, isExpired, setTimer, useClockAt } from '../disappearing'
import { useT } from '../lang'
import { startSharing, type Spot } from '../location'
import { blobToDataUrl, isPhotoOrVideo, prepareVideo, shrinkPhoto, videoExtension, warmUpSound } from '../media'
import { canEdit, captionKind, editMessage, QUICK_REACTIONS, react, replySnapshot, unsendMessage } from '../messages'
import { activePins, pinMessage, unpinMessage } from '../pins'
import { clearChat, deleteChat, hideMessage, isMuted, setPrefs, starMessage, type ChatPrefs } from '../prefs'
import { presenceText } from '../presence'
import { rememberProfile, useProfile, type Profile } from '../profiles'
import { block, report, unblock } from '../safety'
import { leaveGroup } from '../groups'
import { useStable } from '../stable'
import { fill, type Strings } from '../strings'
import { clock, dayNumber, isToday, isYesterday, useNow } from '../time'
import { markTyping, typingText, useTypingVersion } from '../typing'
import Avatar, { GroupAvatar, PersonAvatar, TimerBadge } from './Avatar'
import Composer from './Composer'
import ContactInfo from './ContactInfo'
import {
  ContactDialog,
  DeleteDialog,
  DocumentSender,
  ForwardDialog,
  InfoDialog,
  LocationDialog,
  MuteDialog,
  PinDialog,
  ReactionsDialog,
  TimerDialog,
} from './Dialogs'
import EmojiPicker from './EmojiPicker'
import GroupInfo from './GroupInfo'
import Icon from './Icon'
import Menu, { type MenuItem } from './Menu'
import MessageBubble from './MessageBubble'
import PhotoSender, { type PickedPhoto } from './PhotoSender'
import PhotoViewer from './PhotoViewer'
import Popover, { type PopoverItem } from './Popover'
import StarredList from './StarredList'
import VideoViewer from './VideoViewer'

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
  focus?: { id: string } // go to this message (from "Starred messages")
}

type Dialog = { kind: 'forward' | 'info' | 'reactions' | 'delete' | 'pin'; m: Message } | { kind: 'mute' | 'timer' | 'location' | 'contact' }
const PAGE = 50 // messages loaded at a time (a few screens' worth; fewer = faster)
const LOOK_BACK = 1000 // going to an old message loads at most this many

export default function ChatRoom(props: Props) {
  const { me, myProfile, chatId, chat, other: otherProp, prefs, chats, blocked, onBack, onOpenPerson, focus: focusProp } = props
  const { t } = useT()
  const [limit, setLimit] = useState(PAGE)
  const [raw, setRaw] = useState<Message[]>([]) // what the database sent
  const [hasMore, setHasMore] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showStarred, setShowStarred] = useState(false)
  const [viewing, setViewing] = useState<{ m: Message; data: string } | null>(null) // a photo or video, full screen
  const [menu, setMenu] = useState<{ m: Message; x: number; y: number } | null>(null)
  const [reactingTo, setReactingTo] = useState<Message | null>(null) // the full emoji picker, for a reaction
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [photos, setPhotos] = useState<File[] | null>(null) // photos and videos picked, to add captions to
  const [documents, setDocuments] = useState<File[] | null>(null) // documents picked
  const [working, setWorking] = useState('') // "Preparing video… 40%" (stays until it's done)
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
  const [focus, setFocus] = useState<string | null>(focusProp?.id ?? null) // a message to go to
  const [focusFrom, setFocusFrom] = useState(focusProp)
  const [pinIndex, setPinIndex] = useState(0) // which pin the pin bar shows
  // Asked to go to a different message while this chat is open (from "Starred messages").
  if (focusProp !== focusFrom) {
    setFocusFrom(focusProp)
    if (focusProp) setFocus(focusProp.id)
  }

  // The phone's Back button closes these first (back.ts), then the chat itself (Home.tsx).
  useBack(showInfo, LEVEL.panel, () => setShowInfo(false))
  useBack(showStarred, LEVEL.panel, () => setShowStarred(false))
  useBack(searching, LEVEL.panel, () => setSearching(false))

  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const restoreFrom = useRef<number | null>(null) // keeps your place when older messages load
  const loadedOnce = useRef(false)
  const known = useRef(new Map<string, Message>()) // the messages we have, by id
  const dividerDone = useRef(false) // the unread line is worked out once
  const newest = useRef('')
  const lastTypingSent = useRef(0)
  const lastMarkedRead = useRef('')
  const loadedLimit = useRef(0) // the limit of the messages we have now (more may be on the way)

  const group = isGroup(chat)
  const other = group ? undefined : (otherProp ?? (chat && otherPerson(chat, me.uid)))
  const title = group ? (chat?.title ?? '') : (other?.name ?? '')
  const iBlockedThem = !!other && blocked.has(other.uid)
  const canTalk = !group || !chat?.onlyAdmins || isAdmin(chat, me.uid)
  // Calls are for chats with one person (not groups), and not with someone you blocked.
  const call = other && !iBlockedThem ? (video: boolean) => startCall(me, other, video) : undefined
  const clearedAt = prefs?.clearedAt?.toMillis() ?? 0
  const hidden = prefs?.hidden
  // Disappearing messages and pins run out at set times. `now` moves on right when one does.
  const endTimes = raw.flatMap((m) => (m.expireAt ? [m.expireAt.toMillis()] : []))
  Object.values(chat?.pins ?? {}).forEach((pin) => endTimes.push(pin.until))
  const now = useClockAt(endTimes)
  // What's shown: not the ones you deleted for yourself, and not the ones whose time is up.
  const messages = useMemo(() => raw.filter((m) => !hidden?.includes(m.id) && !isExpired(m, now)), [raw, hidden, now])
  const starredIds = useMemo(() => new Set(prefs?.starred ?? []), [prefs?.starred])
  // Pinned messages, newest first. (Not ones deleted for everyone.)
  const pins = activePins(chat, now).filter((pin) => !messages.find((m) => m.id === pin.id)?.deleted)
  const pinnedIds = new Set(pins.map((pin) => pin.id))

  // Listen LIVE to the last 50 messages (more as you scroll up), oldest at the top.
  // After "Clear chat", only messages sent after that.
  useEffect(() => {
    const after = clearedAt ? [where('sentAt', '>', new Date(clearedAt))] : []
    const q = query(collection(db, 'chats', chatId, 'messages'), ...after, orderBy('sentAt'), limitToLast(limit))
    // includeMetadataChanges: also tell us when a message we sent reaches the server (🕓 -> ✓).
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const changed = new Set(snap.docChanges({ includeMetadataChanges: true }).map((c) => c.doc.id))
      // New messages slide in, except the ones there when you opened the chat, and older ones loading above.
      const arriving = loadedOnce.current && restoreFrom.current === null
      const list = snap.docs.map((d) => {
        const old = known.current.get(d.id)
        // A message that didn't change keeps the very same object, so its bubble isn't drawn again.
        if (old && !changed.has(d.id)) return old
        return {
          id: d.id,
          // 'estimate': a message you JUST sent has no server time yet, so use your clock for now.
          ...d.data({ serverTimestamps: 'estimate' }),
          pending: d.metadata.hasPendingWrites,
          fresh: old ? old.fresh : arriving,
        } as Message
      })
      known.current = new Map(list.map((m) => [m.id, m]))
      loadedLimit.current = limit
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
      // (Straight away, not a smooth glide: a glide made new messages feel late.)
      if (nearBottom.current || last.senderId === me.uid) el.scrollTop = el.scrollHeight
      else setNewBelow((n) => n + 1)
    }
    loadedOnce.current = true
    newest.current = last.id
  }, [messages, me.uid])

  // When the messages get less room (the phone's keyboard opens, or a reply bar appears),
  // stay at the bottom if you were there, so the newest messages don't hide behind it.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const watch = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [showInfo])

  // Disappearing messages: the first person to open the chat after a message's time is up deletes it for good.
  const expiredCount = raw.length - raw.filter((m) => !isExpired(m, now)).length
  const usesTimer = !!chat?.timer || raw.some((m) => m.expireAt)
  const chatExists = !!chat
  useEffect(() => {
    if (usesTimer && chatExists) deleteExpired(chatId).catch(console.warn)
  }, [chatId, usesTimer, chatExists, expiredCount])

  function onScroll() {
    const el = scroller.current!
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom.current !== atBottom) setAtBottom(nearBottom.current)
    if (nearBottom.current && newBelow) setNewBelow(0)
    // Near the top, and there are older messages: load 50 more.
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

  // Going to a message (a starred or pinned one) that may be too old to be loaded yet:
  // load older messages until it's there, then scroll to it.
  // (It has to wait for the messages to arrive and be drawn, so it's an effect. The lint rule
  // below warns about changing state in an effect; here that's what we want.)
  useEffect(() => {
    if (!focus || !loadedOnce.current || loadedLimit.current !== limit) return // (still loading)
    if (messages.some((m) => m.id === focus)) {
      nearBottom.current = false // (so nothing pulls the chat back down to the bottom)
      jumpTo(focus)
      // oxlint-disable-next-line react/set-state-in-effect
      setFocus(null)
    } else if (hasMore && limit < LOOK_BACK) {
      const el = scroller.current
      if (el) restoreFrom.current = el.scrollHeight - el.scrollTop
      setLimit((n) => n + PAGE * 4)
    } else {
      setFocus(null)
      setToast(t.notFound)
    }
  }, [focus, messages, hasMore, limit, jumpTo, t])

  // Esc closes the photo you're looking at, the search, or else the chat (like WhatsApp Web).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || document.querySelector('.modal, .popover, .emoji-picker, .photo-sender, .settings-window, .call-screen')) return
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
      markTyping(chat, me.uid).catch(console.error)
    }
  }

  function send(content: Content, extras?: Extras) {
    lastTypingSent.current = 0
    nearBottom.current = true
    return sendMessage(me, { chatId, other, isNew: !chat, timer: chat?.timer }, content, extras)
  }

  function goTo(messageId: string) {
    setShowStarred(false)
    setShowInfo(false)
    setFocus(messageId)
  }

  // Shows "Something went wrong" if a change didn't save.
  function oops(err: unknown) {
    console.error(err)
    setToast(t.somethingWrong)
  }

  // The message you're replying to (if any), for the next thing you send. The reply bar closes.
  function takeReply(): Extras {
    const extras = replyTo ? { replyTo: replySnapshot(replyTo) } : {}
    setReplyTo(null)
    return extras
  }

  // Photos and videos picked, pasted or dropped: shrink and send them one by one.
  // (Only the first one is the reply, like WhatsApp.)
  async function sendPhotos(picked: PickedPhoto[]) {
    setPhotos(null)
    if (picked.some(({ file }) => file.type.startsWith('video/'))) warmUpSound() // (sound needs a tap, and this is right after one)
    const extras = takeReply()
    for (const [i, { file, caption }] of picked.entries()) {
      const words = caption ? { caption } : {}
      const isVideo = file.type.startsWith('video/')
      try {
        if (isVideo) {
          let ready = false
          setWorking(t.preparingVideo)
          const video = await prepareVideo(file, (done) => !ready && setWorking(`${t.preparingVideo} ${Math.round(done * 100)}%`))
          ready = true
          setWorking('')
          await send({ kind: 'video', ...video, ...words }, i === 0 ? extras : {})
        } else {
          const photo = await shrinkPhoto(file)
          await send({ kind: 'photo', ...photo, ...words }, i === 0 ? extras : {})
        }
      } catch (err) {
        console.warn('Not sent:', err)
        setWorking('')
        const why = err instanceof Error ? err.message : ''
        if (!isVideo) setToast(t.photoNotSent)
        else setToast(why === 'too-long' ? t.videoTooLong : why === 'too-big' ? t.videoTooBig : t.videoNotSent)
      }
    }
  }

  // Documents: sent as they are (any kind of file, up to about 5 MB).
  async function sendDocuments(files: File[], caption: string) {
    const extras = takeReply()
    for (const [i, file] of files.entries()) {
      try {
        const content: Content = {
          kind: 'file',
          data: await blobToDataUrl(file),
          fileName: file.name.slice(-255) || 'file',
          fileSize: file.size,
          mime: (file.type || 'application/octet-stream').slice(0, 255),
          ...(caption ? { caption } : {}),
        }
        await send(content, i === 0 ? extras : {})
      } catch (err) {
        console.error(err)
        setToast(t.fileNotSent)
      }
    }
  }

  // Your location. A live one keeps moving as you do, until its time is up (location.ts).
  async function shareLocation(spot: Spot, liveMinutes?: number) {
    try {
      const id = await send({ kind: 'location', ...spot, ...(liveMinutes ? { liveMinutes } : {}) }, takeReply())
      if (liveMinutes) startSharing({ uid: me.uid, chatId, messageId: id, until: Date.now() + liveMinutes * 60_000 })
    } catch (err) {
      oops(err)
    }
  }

  // Contact cards, one message each.
  async function shareContacts(contacts: SharedContact[]) {
    const extras = takeReply()
    for (const [i, contact] of contacts.entries()) await send({ kind: 'contact', contact }, i === 0 ? extras : {}).catch(oops)
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
    starred: () => setShowStarred(true),
    timer: () => setDialog({ kind: 'timer' }),
  }

  const menuItems: MenuItem[] = [
    { label: group ? t.groupInfo : t.contactInfo, icon: 'info', onClick: () => setShowInfo(true) },
    { label: t.searchMessages, icon: 'search', onClick: () => setSearching(true) },
    { label: muted ? t.unmute : t.mute, icon: muted ? 'bell' : 'bellOff', onClick: actions.mute },
  ]
  if (chat) menuItems.push({ label: t.disappearing, icon: 'timer', onClick: actions.timer })
  if (starredIds.size > 0) menuItems.push({ label: t.starredMessages, icon: 'star', onClick: actions.starred })
  if (messages.length > 0) menuItems.push({ label: t.clearChat, icon: 'eraser', onClick: actions.clear })
  if (other) menuItems.push({ label: iBlockedThem ? t.unblock : t.block, icon: 'block', onClick: actions.block, danger: !iBlockedThem })
  if (messages.length > 0) menuItems.push({ label: t.report, icon: 'flag', onClick: reportChat, danger: true })
  if (group) menuItems.push({ label: t.leaveGroup, icon: 'logout', onClick: actions.leave, danger: true })
  else if (chat) menuItems.push({ label: t.deleteChat, icon: 'trash', onClick: actions.remove, danger: true })

  // ----- The menu on one message -----
  function messageMenu(m: Message): PopoverItem[] {
    const items: PopoverItem[] = []
    const text = (captionKind(m) ? m.caption : m.text) ?? ''
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
    // Pin for everyone (if you can send messages here), and star just for you.
    if (chat && canTalk && !iBlockedThem) {
      items.push(
        pinnedIds.has(m.id)
          ? { label: t.unpinMsg, icon: 'pinOff', onClick: () => unpinMessage(chatId, m.id).catch(oops) }
          : { label: t.pinMsg, icon: 'pin', onClick: () => setDialog({ kind: 'pin', m }) },
      )
    }
    const starred = starredIds.has(m.id)
    items.push({ label: starred ? t.unstar : t.star, icon: starred ? 'starOff' : 'star', onClick: () => starMessage(me.uid, chatId, m.id, !starred).catch(oops) })
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

  // The same functions for every bubble, every time (see stable.ts), so memo() in MessageBubble works.
  const openMenu = useStable((m: Message, x: number, y: number) => setMenu({ m, x, y }))
  const showReactions = useStable((m: Message) => setDialog({ kind: 'reactions', m }))
  const viewPhoto = useStable((m: Message, data: string) => setViewing({ m, data }))
  // "Message" on a contact card: open a chat with them, if they're on PakChat.
  const openContact = useStable(async (contact: SharedContact) => {
    const number = contact.phone ?? contact.email
    const person = contact.uid ? { uid: contact.uid, name: contact.name } : number ? await findUser(number).catch(() => null) : null
    if (!person) setToast(t.notOnPakChat)
    else if (person.uid !== me.uid) onOpenPerson(person)
  })
  const callBack = useStable((video: boolean) => call?.(video))

  // ----- Search: find words in the loaded messages -----
  const q = searching ? search.trim().toLowerCase() : ''
  const matches = q
    ? messages.filter((m) => !m.deleted && searchText(m).toLowerCase().includes(q))
    : []
  const matchIndex = Math.min(match, matches.length - 1)
  const foundId = matches[matches.length - 1 - matchIndex]?.id
  useEffect(() => {
    if (foundId) jumpTo(foundId)
  }, [foundId, jumpTo])

  // A photo or video opened full screen (from the chat, or from the media in the contact or group info).
  const seen = viewing && {
    src: viewing.data,
    who: viewing.m.senderId === me.uid ? t.you : (viewing.m.senderName ?? ''),
    when: viewing.m.sentAt ? `${dayLabel(viewing.m.sentAt.toDate(), t)}, ${clock(viewing.m.sentAt.toDate(), t.locale)}` : '',
    caption: viewing.m.caption,
    onClose: () => setViewing(null),
  }
  const viewer =
    seen &&
    (viewing.m.kind === 'video' ? (
      <VideoViewer {...seen} fileName={`PakChat video ${viewing.m.id}.${videoExtension(seen.src)}`} />
    ) : (
      <PhotoViewer {...seen} fileName={`PakChat photo ${viewing.m.id}.jpg`} />
    ))

  // Windows about the whole chat. They can open from the chat's menu or its info panel.
  const chatDialogs = (
    <>
      {dialog?.kind === 'mute' && (
        <MuteDialog onClose={() => setDialog(null)} onMute={(until) => setPrefs(me.uid, chatId, { mutedUntil: until }).catch(console.error)} />
      )}
      {dialog?.kind === 'timer' && chat && (
        <TimerDialog
          current={chat.timer ?? 0}
          canChange={!group || isAdmin(chat, me.uid)}
          onClose={() => setDialog(null)}
          onSave={(seconds) => setTimer(me, chat, seconds).catch(oops)}
        />
      )}
    </>
  )
  const infoDialogs = (
    <>
      {chatDialogs}
      {toast && <p className="toast">{toast}</p>}
    </>
  )

  if (showStarred) {
    return (
      <StarredList
        me={me}
        items={[...starredIds].map((id) => ({ chatId, id }))}
        chats={chats}
        onBack={() => setShowStarred(false)}
        onOpen={(_, id) => goTo(id)}
      />
    )
  }
  if (showInfo && chat && group) {
    return (
      <>
        <GroupInfo
          me={me}
          chat={chat}
          messages={messages}
          prefs={prefs}
          starred={starredIds.size}
          actions={actions}
          onBack={() => setShowInfo(false)}
          onOpenPerson={onOpenPerson}
          onView={(m, data) => setViewing({ m, data })}
        />
        {infoDialogs}
        {viewer}
      </>
    )
  }
  if (showInfo && other) {
    return (
      <>
        <ContactInfo
          me={me}
          chatId={chatId}
          person={other}
          messages={messages}
          muted={muted}
          blocked={iBlockedThem}
          starred={starredIds.size}
          timer={chat ? (chat.timer ?? 0) : undefined}
          actions={actions}
          onCall={call}
          onBack={() => setShowInfo(false)}
          onView={(m, data) => setViewing({ m, data })}
        />
        {infoDialogs}
        {viewer}
      </>
    )
  }

  const pin = pins.length ? pins[pinIndex % pins.length] : undefined
  const pinLive = pin && messages.find((m) => m.id === pin.id) // (its words may have been edited since)

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
        const files = [...e.dataTransfer.files]
        const media = files.filter(isPhotoOrVideo) // photos and videos get a preview, other files are documents
        if (media.length) setPhotos(media)
        else if (files.length) setDocuments(files)
      }}
    >
      <header className="bar">
        <button className="icon back" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <button className="bar-who" onClick={() => setShowInfo(true)} disabled={!chat && !other}>
          <TimerBadge on={!!chat?.timer}>
            {group && chat ? <GroupAvatar chat={chat} size={42} /> : other ? <PersonAvatar uid={other.uid} name={other.name} size={42} /> : <Avatar name={title} size={42} />}
          </TimerBadge>
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

      {/* Pinned messages: tap to go to it. With more than one, each tap goes to the next. */}
      {pin && (
        <div className="pin-bar">
          <button
            className="pin-show"
            aria-label={t.pinnedMessage}
            onClick={() => {
              goTo(pin.id)
              setPinIndex((i) => (i + 1) % pins.length)
            }}
          >
            {pins.length > 1 && (
              <span className="pin-steps" aria-hidden>
                {pins.map((p) => (
                  <span key={p.id} className={p.id === pin.id ? 'on' : ''} />
                ))}
              </span>
            )}
            <Icon name="pin" size={18} />
            <span className="pin-text" dir="auto">
              {group && <strong>{pin.senderId === me.uid ? t.you : pin.senderName}: </strong>}
              {shortText(pinLive ?? pin, me.uid, t)}
            </span>
          </button>
          {canTalk && !iBlockedThem && (
            <button className="icon" aria-label={t.unpinMsg} title={t.unpinMsg} onClick={() => unpinMessage(chatId, pin.id).catch(oops)}>
              <Icon name="pinOff" size={18} />
            </button>
          )}
        </div>
      )}

      {/* The wall is the patterned background. The messages scroll on top of it. */}
      <div className="wall">
        <div className="messages" ref={scroller} onScroll={onScroll}>
          {hasMore && <p className="loading-older">{t.loadingOlder}</p>}
          {messages.length === 0 && <p className="say-hi">{t.sayHi}</p>}
          {messages.map((m, i) => {
            const before = messages[i - 1]
            const day = dayNumber(m.sentAt)
            const newDay = day !== dayNumber(before?.sentAt)
            return (
              <Fragment key={m.id}>
                {newDay && m.sentAt && (
                  <div className="day">
                    <span>{dayLabel(m.sentAt.toDate(), t)}</span>
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
                    tick={m.senderId === me.uid ? tickFor(chat, me.uid, m.sentAt, m.pending) : 'sent'}
                    chatId={chatId}
                    myUid={me.uid}
                    group={group}
                    // "first" = the first of several messages in a row from the same person. It gets the little tail.
                    first={newDay || !before || before.kind === 'system' || before.senderId !== m.senderId || divider?.id === m.id}
                    highlight={q}
                    starred={starredIds.has(m.id)}
                    pinned={pinnedIds.has(m.id)}
                    onMenu={openMenu}
                    onReactions={showReactions}
                    onJump={jumpTo}
                    onView={viewPhoto}
                    onContact={openContact}
                    onCall={call ? callBack : undefined}
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
        {(working || toast) && <p className="toast">{working || toast}</p>}
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
          onDocuments={setDocuments}
          onLocation={() => setDialog({ kind: 'location' })}
          onContact={() => setDialog({ kind: 'contact' })}
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
            unsendMessage(chatId, me, dialog.m, isLast, !!chat?.pins?.[dialog.m.id]).catch(oops)
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'pin' && chat && (
        <PinDialog
          onClose={() => setDialog(null)}
          onPin={(lasts) => {
            setPinIndex(0) // show the new pin
            pinMessage(me, chat, dialog.m, lasts).catch(oops)
          }}
        />
      )}
      {dialog?.kind === 'location' && <LocationDialog onClose={() => setDialog(null)} onSend={shareLocation} />}
      {dialog?.kind === 'contact' && <ContactDialog me={me} chats={chats} onClose={() => setDialog(null)} onSend={shareContacts} />}
      {chatDialogs}

      {photos && <PhotoSender files={photos} onClose={() => setPhotos(null)} onSend={sendPhotos} />}
      {documents && <DocumentSender files={documents} onClose={() => setDocuments(null)} onSend={sendDocuments} />}

      {viewer}
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
  useTypingVersion() // re-draw as soon as someone starts typing
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
  // Everyone else first, then "You" at the end, like WhatsApp.
  const others = chat?.members.filter((uid) => uid !== me.uid).map((uid) => chat.names[uid]) ?? []
  return <>{[...others, t.you].join(', ')}</>
}
