// Home.tsx: the main screen after login. Like WhatsApp on a computer, it has three parts:
//   the bar on the left (Rail.tsx): Chats, Calls, Status, Archived, Starred, Settings
//   a list:                  your chats       your calls              everyone's status updates
//   and what you opened:     the open chat    a call's details,       My status
//                            (or Welcome)     or the big call buttons
// Settings opens as a window in the middle (Settings.tsx).
// On a phone there's only room for one part, so index.css hides the others, and the bar
// moves to the bottom.
// It also does some jobs in the background while you're logged in:
//   1. listens to all your chats, and your private settings for each one (prefs.ts)
//   2. pops up an alert and plays a sound when a message arrives and you're not looking
//   3. marks new messages as "delivered" (✓✓) as soon as they arrive
//   4. counts unread messages, and shows the number of unread chats in the tab: "(2) PakChat"
//   5. keeps your "online" heartbeat going (unless you hid your last seen)
//   6. opens a group invite link, if the page was opened with one
//   7. listens for calls to you, and shows the call screen (calls.ts, CallScreen.tsx)
//   8. listens for "typing…" in all your chats (typing.ts)
//   9. carries on sharing a live location after a reload (location.ts)
//  10. counts the calls you missed since you last opened Calls (callExtras.ts)
//  11. listens for your scheduled calls, and reminds you when one starts
//  12. listens for status updates: other people's, and your own (status.ts)
// Settings, Status, the call screen and the call windows load when first needed (lazy.ts).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { collection, getCountFromServer, onSnapshot, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { showAlert } from '../alerts'
import { LEVEL, useBack } from '../back'
import { listenForCalls, useCall } from '../calls'
import {
  addFavourite,
  callCodeFromAddress,
  listenForMissed,
  listenForScheduled,
  markCallsSeen,
  scheduledWith,
  type CallGroup,
  type ScheduledCall,
} from '../callExtras'
import {
  chatIdFor,
  chatTitle,
  isGroup,
  isUnread,
  lastRead,
  markDelivered,
  otherPerson,
  peopleYouKnow,
  previewText,
  sendMessage,
  type Chat,
  type Person,
  type ReplyTo,
} from '../chats'
import { codeFromAddress } from '../invites'
import { useT } from '../lang'
import { resumeSharing } from '../location'
import { isPhotoOrVideo, prepareVideo, shrinkPhoto, warmUpSound } from '../media'
import { isHidden, isMuted, usePrefs, type ChatPrefs } from '../prefs'
import { startHeartbeat } from '../presence'
import { usePrivate } from '../private'
import type { Profile } from '../profiles'
import { useBlocked } from '../safety'
import { playPing } from '../sound'
import { useStable } from '../stable'
import {
  audienceFor,
  groupStatuses,
  listenToMine,
  listenToStatuses,
  makeThumb,
  MAX_STATUS_VIDEO,
  postStatus,
  useStatusMarks,
  type NewStatus,
  type Status,
} from '../status'
import { fill } from '../strings'
import { useNow } from '../time'
import { listenForTyping } from '../typing'
import { CallInfo, CallsHome } from './CallsMain'
import CallsList, { type CallAction } from './CallsList'
import ChatList from './ChatList'
import ChatRoom from './ChatRoom'
import { PeopleDialog } from './Dialogs'
import JoinGroup from './JoinGroup'
import { CallLinkDialog, CallReminder, CallScreen, DialDialog, JoinCallDialog, ScheduleDialog, Settings, StartCallDialog, StatusComposer, StatusViewer, warmUp } from './lazy'
import MyStatus from './MyStatus'
import NewChat from './NewChat'
import NewGroup from './NewGroup'
import PhotoSender, { type PickedPhoto } from './PhotoSender'
import Rail, { type Tab } from './Rail'
import type { Section } from './Settings'
import StarredList from './StarredList'
import StatusList, { StatusPrivacyDialog } from './StatusList'
import Welcome from './Welcome'

// Which chat is open. `other` is set for direct chats (the chat may not exist yet).
// focus: go to this message when it opens (from "Starred messages").
// reply: start answering this message (from "Reply privately" in a group).
export type Open = { chatId: string; other?: Person; focus?: { id: string }; reply?: ReplyTo }
type View = 'chats' | 'archived' | 'starred' | 'newChat' | 'newGroup' | 'calls' | 'status'
const CHAT_VIEWS: View[] = ['chats', 'archived', 'starred', 'newChat', 'newGroup'] // (the open chat shows next to these)

export default function Home({ user, profile }: { user: User; profile: Profile }) {
  const { t } = useT()
  // (useMemo: the same object until your name changes, so screens can tell nothing changed.)
  const me: Person = useMemo(() => ({ uid: user.uid, name: profile.name }), [user.uid, profile.name])
  const [open, setOpen] = useState<Open | null>(null)
  const [view, setView] = useState<View>('chats')
  const [chats, setChats] = useState<Chat[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [joinCode, setJoinCode] = useState(codeFromAddress)
  const [callCode, setCallCode] = useState(callCodeFromAddress) // opened with someone's call link
  const [settingsAt, setSettingsAt] = useState<{ start: Section | null } | null>(null) // the Settings window
  const [callGroup, setCallGroup] = useState<CallGroup | null>(null) // the call whose details are open
  const [callAction, setCallAction] = useState<CallAction | 'favourite' | null>(null) // a window from the Calls tab
  const [callsReload, setCallsReload] = useState(0)
  const [missed, setMissed] = useState(0)
  const [plans, setPlans] = useState<ScheduledCall[]>([])
  const [reminder, setReminder] = useState<ScheduledCall | null>(null)
  const [statuses, setStatuses] = useState<Status[]>([]) // other people's
  const [myStatuses, setMyStatuses] = useState<Status[]>([])
  const [viewer, setViewer] = useState<{ order: string[]; startItem?: number } | null>(null)
  const [writing, setWriting] = useState(false) // writing a words-only status
  const [statusFiles, setStatusFiles] = useState<File[] | null>(null) // photos or videos to post as status
  const [statusPrivacy, setStatusPrivacy] = useState(false)
  const [working, setWorking] = useState('') // "Posting…" (stays until it's done)
  const [notice, setNotice] = useState('') // "Status posted" (goes by itself)
  const statusInput = useRef<HTMLInputElement>(null)
  const callPrefs = usePrivate(user.uid, 'calls')
  const statusPrefs = usePrivate(user.uid, 'status')
  const marks = useStatusMarks()
  const minute = useNow(60_000)
  const prefs = usePrefs(user.uid)
  const blocked = useBlocked(user.uid)
  const call = useCall()
  const delivered = useRef(new Map<string, number>()) // chats we already marked delivered
  const alerted = useRef(new Map<string, number>()) // chats we already popped an alert for
  const counting = useRef(new Set<string>()) // unread counts we already asked for
  // The snapshot listener below is created once, so it reads these through refs.
  const openRef = useRef<string | null>(null)
  const tRef = useRef(t)
  const prefsRef = useRef(prefs)
  const nameRef = useRef(profile.name)
  useEffect(() => {
    openRef.current = open?.chatId ?? null
    tRef.current = t
    prefsRef.current = prefs
    nameRef.current = profile.name
  })

  // 1 + 2. Listen LIVE to every chat I'm a member of, and alert on new messages.
  useEffect(() => {
    let first = true
    let known = new Map<string, Chat>()
    const q = query(collection(db, 'chats'), where('members', 'array-contains', user.uid))
    return onSnapshot(q, (snap) => {
      const changed = new Set(snap.docChanges().map((c) => c.doc.id))
      // A chat that didn't change keeps the very same object, so its row isn't drawn again (ChatList.tsx).
      const list = snap.docs.map((d) => (!changed.has(d.id) && known.get(d.id)) || ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as Chat))
      known = new Map(list.map((chat) => [chat.id, chat]))
      list.sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0)) // newest first
      setChats(list)

      for (const chat of list) {
        const at = chat.updatedAt?.toMillis() ?? 0
        const fromSomeoneElse = chat.lastMessage && chat.lastMessage.senderId !== user.uid
        // On the first load, just remember where everything is. Don't alert for old messages.
        if (first || !fromSomeoneElse || at <= (alerted.current.get(chat.id) ?? 0)) {
          alerted.current.set(chat.id, Math.max(at, alerted.current.get(chat.id) ?? 0))
          continue
        }
        alerted.current.set(chat.id, at)
        const looking = document.visibilityState === 'visible' && openRef.current === chat.id
        // Muted chats stay quiet, unless someone @mentions you (like WhatsApp).
        const mentioned = !!chat.lastMessage?.mentions?.includes(user.uid)
        if (looking || (isMuted(prefsRef.current.get(chat.id)) && !mentioned)) continue
        playPing()
        showAlert(chatTitle(chat, user.uid, tRef.current), previewText(chat, user.uid, tRef.current), chat.id, () =>
          setOpen(isGroup(chat) ? { chatId: chat.id } : { chatId: chat.id, other: otherPerson(chat, user.uid) }),
        )
      }
      first = false
    })
  }, [user.uid])

  // 3. A new message from someone else arrived? Tell them it's delivered.
  //    (Not for the chat on screen: ChatRoom marks that one read, which means delivered too.
  //    One change to the chat instead of two, so the next message doesn't have to wait.)
  useEffect(() => {
    for (const chat of chats) {
      const last = chat.lastMessage
      const at = chat.updatedAt?.toMillis()
      if (!last || last.senderId === user.uid || !at) continue
      if (chat.id === openRef.current && document.visibilityState === 'visible') continue
      const alreadyDelivered = (chat.deliveredAt?.[user.uid]?.toMillis() ?? 0) >= at
      if (alreadyDelivered || delivered.current.get(chat.id) === at) continue
      delivered.current.set(chat.id, at)
      markDelivered(chat.id, user.uid).catch(console.error)
    }
  }, [chats, user.uid])

  // 4. How many unread messages in each unread chat? The server counts them for us
  //    (it costs one "read" per count, not one per message).
  useEffect(() => {
    for (const chat of chats) {
      const p = prefs.get(chat.id)
      if (!isUnread(chat, user.uid, p) || p?.unread) continue
      const since = lastRead(chat, user.uid, p)
      const key = `${chat.id}:${chat.updatedAt?.toMillis()}:${since}`
      if (counting.current.has(key)) continue
      counting.current.add(key)
      const newer = query(collection(db, 'chats', chat.id, 'messages'), where('sentAt', '>', Timestamp.fromMillis(since)))
      getCountFromServer(newer)
        .then((result) => setCounts((old) => new Map(old).set(chat.id, result.data().count)))
        .catch(console.error)
    }
  }, [chats, prefs, user.uid])

  // "(2) PakChat" in the tab title (and the number on Chats). Muted and archived chats don't count.
  const loud = (c: Chat, p?: ChatPrefs) => isUnread(c, user.uid, p) && !isMuted(p) && !p?.archived && !isHidden(c, p)
  const unread = chats.filter((c) => loud(c, prefs.get(c.id))).length
  const archivedUnread = chats.filter((c) => prefs.get(c.id)?.archived && !isHidden(c, prefs.get(c.id)) && isUnread(c, user.uid, prefs.get(c.id))).length
  useEffect(() => {
    document.title = unread ? `(${unread}) PakChat` : 'PakChat'
    return () => {
      document.title = 'PakChat'
    }
  }, [unread])

  // 5. Heartbeat for "online" / "last seen". Off if you hid your last seen.
  const hideLastSeen = !!profile.hideLastSeen
  useEffect(() => (hideLastSeen ? undefined : startHeartbeat(user.uid)), [user.uid, hideLastSeen])

  // 6. Done with the invite link: take it out of the address bar.
  const closeJoin = useCallback(() => {
    setJoinCode(null)
    history.replaceState(history.state, '', '/') // (keeps the Back button's guard, see back.ts)
  }, [])
  useBack(!!joinCode, LEVEL.page, closeJoin)
  const joined = useCallback(
    (chatId: string) => {
      closeJoin()
      setView('chats')
      setOpen({ chatId })
    },
    [closeJoin],
  )

  // 7. Calls to you. If PakChat isn't on screen, an alert pops up too (the ringing plays anyway).
  useEffect(
    () =>
      listenForCalls({ uid: user.uid, name: nameRef.current }, (ringing) => {
        if (document.visibilityState === 'visible') return
        const t = tRef.current
        showAlert(ringing.peer.name, ringing.video ? t.incomingVideoCall : t.incomingVoiceCall, 'call', () => {})
      }),
    [user.uid],
  )

  // The phone's Back button: closes the chat (or a call's details), or goes back to the chat
  // list (back.ts). On the chat list itself, Back does nothing, so PakChat stays open.
  const chatView = CHAT_VIEWS.includes(view)
  useBack(!!open && chatView, LEVEL.chat, () => setOpen(null))
  useBack(view === 'calls' && !!callGroup, LEVEL.chat, () => setCallGroup(null))
  useBack(view !== 'chats', LEVEL.page, () => setView('chats'))
  const closeCallLink = useCallback(() => {
    setCallCode(null)
    history.replaceState(history.state, '', '/')
  }, [])
  useBack(!!callCode, LEVEL.page, closeCallLink)

  // 8. "typing…" in all your chats
  useEffect(() => listenForTyping(user.uid), [user.uid])

  // Fetch the screens that load later (lazy.ts), once there's a free moment.
  useEffect(warmUp, [])

  // 9. A live location you were sharing before you reloaded PakChat: carry on (until its time is up).
  useEffect(() => resumeSharing(user.uid), [user.uid])

  // 10. Missed calls since you last opened Calls. Opening it starts the count again.
  const seenAt = callPrefs.seenAt?.toMillis()
  useEffect(() => {
    const since = Timestamp.fromMillis(seenAt ?? Date.now())
    return listenForMissed(user.uid, since, setMissed)
  }, [user.uid, seenAt])
  useEffect(() => {
    if (view === 'calls' && missed > 0) markCallsSeen(user.uid).catch(console.error)
  }, [view, missed, user.uid])
  // After a call, the Calls list loads again so it's there. (Changed while drawing, see ChatRoom.tsx.)
  const inCall = !!call
  const [wasInCall, setWasInCall] = useState(inCall)
  if (wasInCall !== inCall) {
    setWasInCall(inCall)
    if (!inCall) setCallsReload((n) => n + 1)
  }

  // 11. Scheduled calls: listen for them, and when one's time comes, remind you.
  useEffect(() => listenForScheduled(user.uid, setPlans), [user.uid])
  const reminded = useRef(new Set<string>())
  useEffect(() => {
    const timers = plans.map((plan) => {
      const wait = plan.startsAt.toMillis() - Date.now()
      if (wait < 0 || wait > 2 ** 31 - 1 || reminded.current.has(plan.id)) return 0
      return window.setTimeout(() => {
        reminded.current.add(plan.id)
        setReminder(plan)
        playPing()
        if (document.visibilityState !== 'visible') {
          const t = tRef.current
          showAlert(t.scheduledCall, `${plan.title} · ${scheduledWith(plan, user.uid).name}`, 'plan-' + plan.id, () => {})
        }
      }, wait)
    })
    return () => timers.forEach(clearTimeout)
  }, [plans, user.uid])

  // 12. Status updates: other people's (only ones you're allowed to see), and your own.
  useEffect(() => listenToStatuses(user.uid, setStatuses), [user.uid])
  useEffect(() => listenToMine(user.uid, setMyStatuses), [user.uid])
  const statusGroups = useMemo(
    () => groupStatuses(statuses.filter((s) => !blocked.has(s.owner)), marks.seen, minute),
    [statuses, blocked, marks.seen, minute],
  )
  const mineGroup = useMemo(() => groupStatuses(myStatuses, new Set(), minute)[0] ?? null, [myStatuses, minute])
  const allGroups = useMemo(() => (mineGroup ? [...statusGroups, mineGroup] : statusGroups), [statusGroups, mineGroup])
  const mutedStatus = statusPrefs.muted ?? []
  const newStatus = statusGroups.some((g) => g.unseen > 0 && !mutedStatus.includes(g.owner.uid))
  const people = useMemo(() => peopleYouKnow(chats, user.uid), [chats, user.uid])

  // A message that goes away by itself after a moment.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 2500)
    return () => clearTimeout(timer)
  }, [notice])

  // ----- Posting a status -----
  function statusWho() {
    const mode = statusPrefs.mode ?? 'contacts'
    if (mode === 'except') return `${t.myContactsExcept} ${fill(t.nExcluded, { n: statusPrefs.except?.length ?? 0 })}`
    if (mode === 'only') return `${t.onlyShareWith} ${fill(t.nIncluded, { n: statusPrefs.only?.length ?? 0 })}`
    return t.myContacts
  }
  async function post(content: NewStatus) {
    await postStatus(me, content, audienceFor(user.uid, chats, prefs, blocked, statusPrefs))
  }
  async function postWords(text: string, bg: number, font: number) {
    setWriting(false)
    setWorking(t.postingStatus)
    try {
      await post({ kind: 'text', text, bg, font })
      setNotice(t.statusPosted)
    } catch (err) {
      console.error(err)
      setNotice(t.statusNotPosted)
    }
    setWorking('')
  }
  async function postMedia(picked: PickedPhoto[]) {
    setStatusFiles(null)
    if (picked.some(({ file }) => file.type.startsWith('video/'))) warmUpSound() // (sound needs a tap, and this is right after one)
    let failed = ''
    for (const { file, caption } of picked) {
      const words = caption ? { caption } : {}
      try {
        if (file.type.startsWith('video/')) {
          let ready = false
          setWorking(t.preparingVideo)
          const video = await prepareVideo(file, (done) => !ready && setWorking(`${t.preparingVideo} ${Math.round(done * 100)}%`), MAX_STATUS_VIDEO)
          ready = true
          setWorking(t.postingStatus)
          await post({ kind: 'video', ...video, thumb: await makeThumb(video.poster), ...words })
        } else {
          setWorking(t.postingStatus)
          const photo = await shrinkPhoto(file)
          await post({ kind: 'photo', ...photo, thumb: await makeThumb(photo.data), ...words })
        }
      } catch (err) {
        console.warn('Status not posted:', err)
        const why = err instanceof Error ? err.message : ''
        failed = why === 'too-long' ? t.statusVideoTooLong : why === 'too-big' ? t.videoTooBig : t.statusNotPosted
      }
    }
    setWorking('')
    setNotice(failed || t.statusPosted)
  }

  // Replying to someone's status: a message in your chat with them, quoting the status.
  const replyToStatus = useStable(async (s: Status, text: string) => {
    const other = { uid: s.owner, name: s.ownerName }
    const chatId = chatIdFor(user.uid, s.owner)
    const chat = chats.find((c) => c.id === chatId)
    const what = s.text ?? s.caption ?? (s.kind === 'photo' ? t.photo : t.videoMessage)
    await sendMessage(
      me,
      { chatId, other, isNew: !chat, timer: chat?.timer },
      { kind: 'text', text },
      { replyTo: { id: s.id, senderId: s.owner, senderName: s.ownerName, kind: 'status', text: what.slice(0, 200) } },
    )
  })

  function openChat(next: Open) {
    setOpen(next)
    if (view !== 'archived' && view !== 'starred') setView('chats')
  }

  // The left bar (or the bottom bar on a phone).
  const tab: Tab | null = view === 'newChat' || view === 'newGroup' ? 'chats' : view
  const tabsShown = view === 'chats' || view === 'calls' || view === 'status'

  // Every starred message, from all your chats.
  const starred = useMemo(
    () => [...prefs.entries()].flatMap(([chatId, p]) => (p.starred ?? []).map((id) => ({ chatId, id }))),
    [prefs],
  )
  function openStarred(chatId: string, id: string) {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return
    openChat({ chatId, other: isGroup(chat) ? undefined : otherPerson(chat, user.uid), focus: { id } })
  }

  const openChatDoc = open ? chats.find((c) => c.id === open.chatId) : undefined
  // (If you just left a group, it's gone from your chats, so nothing is open any more.)
  const showing = open && (open.other || openChatDoc) ? open : null

  // On a phone: is the right-hand part (a chat, a call's details) the one showing?
  const mainShown = chatView ? !!showing : view === 'calls' && !!callGroup
  const classes = ['app', mainShown && 'has-chat', !tabsShown && 'no-tabs'].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <Rail
        tab={tab}
        me={me}
        profile={profile}
        unreadChats={unread}
        missedCalls={missed}
        newStatus={newStatus}
        archivedUnread={archivedUnread}
        onTab={(next) => setView(next)}
        onSettings={(section) => setSettingsAt({ start: section ?? null })}
      />
      <aside className="side">
        {view === 'newGroup' ? (
          <NewGroup
            me={me}
            chats={chats}
            onCancel={() => setView('chats')}
            onCreated={(chatId) => {
              setView('chats')
              setOpen({ chatId })
            }}
          />
        ) : view === 'newChat' ? (
          <NewChat me={me} profile={profile} chats={chats} onBack={() => setView('chats')} onOpen={openChat} onNewGroup={() => setView('newGroup')} />
        ) : view === 'calls' ? (
          <CallsList
            me={me}
            prefs={callPrefs}
            plans={plans}
            reload={callsReload}
            selected={callGroup?.key ?? null}
            onSelect={setCallGroup}
            onAction={setCallAction}
            onAddFavourite={() => setCallAction('favourite')}
          />
        ) : view === 'status' ? (
          <StatusList
            me={me}
            profile={profile}
            mine={mineGroup}
            groups={statusGroups}
            muted={mutedStatus}
            onOpen={(list, index) => setViewer({ order: list.slice(index).map((g) => g.owner.uid) })}
            onMine={() => setViewer({ order: [user.uid], startItem: 0 })}
            onCamera={() => statusInput.current?.click()}
            onWrite={() => setWriting(true)}
            onPrivacy={() => setStatusPrivacy(true)}
          />
        ) : view === 'starred' ? (
          <StarredList me={me} items={starred} chats={chats} onBack={() => setView('chats')} onOpen={openStarred} />
        ) : (
          <ChatList
            me={me}
            profile={profile}
            chats={chats}
            prefs={prefs}
            counts={counts}
            activeId={showing?.chatId}
            archived={view === 'archived'}
            onArchived={(show) => setView(show ? 'archived' : 'chats')}
            onOpen={openChat}
            onNewChat={() => setView('newChat')}
            onNewGroup={() => setView('newGroup')}
            onSettings={() => setSettingsAt({ start: null })}
            onStarred={() => setView('starred')}
          />
        )}
        {(working || notice) && <p className="toast app-toast">{working || notice}</p>}
      </aside>
      <main className="main">
        {view === 'calls' ? (
          callGroup ? (
            <CallInfo
              me={me}
              group={callGroup}
              prefs={callPrefs}
              onBack={() => setCallGroup(null)}
              onMessage={(person) => {
                setCallGroup(null)
                setView('chats')
                setOpen({ chatId: chatIdFor(user.uid, person.uid), other: person })
              }}
            />
          ) : (
            <CallsHome onAction={setCallAction} />
          )
        ) : view === 'status' ? (
          <MyStatus
            me={me}
            profile={profile}
            mine={mineGroup}
            onView={(index) => setViewer({ order: [user.uid], startItem: index })}
            onCamera={() => statusInput.current?.click()}
            onWrite={() => setWriting(true)}
          />
        ) : showing ? (
          // key: a different chat gets a fresh ChatRoom, so nothing carries over from the last one.
          <ChatRoom
            key={showing.chatId}
            me={me}
            myProfile={profile}
            chatId={showing.chatId}
            chat={openChatDoc}
            other={showing.other}
            prefs={prefs.get(showing.chatId)}
            chats={chats}
            blocked={blocked}
            onBack={() => setOpen(null)}
            onOpenPerson={(person) => openChat({ chatId: chatIdFor(user.uid, person.uid), other: person })}
            onReplyPrivately={(person, reply) => openChat({ chatId: chatIdFor(user.uid, person.uid), other: person, reply })}
            focus={showing.focus}
            reply={showing.reply}
          />
        ) : (
          <Welcome />
        )}
      </main>

      {/* Windows and full-screen things, on top of everything. (Suspense: shows nothing for the moment
          one of them is still loading, see lazy.ts.) */}
      <Suspense fallback={null}>
      {settingsAt && (
        <Settings
          me={me}
          profile={profile}
          blocked={blocked}
          statusPrefs={statusPrefs}
          people={people}
          start={settingsAt.start}
          onClose={() => setSettingsAt(null)}
          onStarred={() => {
            setSettingsAt(null)
            setView('starred')
          }}
        />
      )}
      {callAction === 'start' && <StartCallDialog me={me} people={people} onClose={() => setCallAction(null)} />}
      {callAction === 'dial' && <DialDialog me={me} profile={profile} onClose={() => setCallAction(null)} />}
      {callAction === 'link' && <CallLinkDialog me={me} onClose={() => setCallAction(null)} />}
      {callAction === 'schedule' && (
        <ScheduleDialog
          me={me}
          people={people}
          chats={chats}
          onClose={() => setCallAction(null)}
          onDone={() => {
            setCallAction(null)
            setNotice(t.callScheduled)
          }}
        />
      )}
      {callAction === 'favourite' && (
        <PeopleDialog
          title={t.addFavourite}
          people={people.filter((p) => !(callPrefs.favourites ?? []).some((f) => f.uid === p.uid))}
          onPick={(person) => addFavourite(user.uid, callPrefs, person).catch(console.error)}
          onClose={() => setCallAction(null)}
        />
      )}
      {reminder && <CallReminder me={me} plan={reminder} onClose={() => setReminder(null)} />}
      {callCode && !joinCode && <JoinCallDialog me={me} code={callCode} onClose={closeCallLink} />}

      {/* The camera button on Status: pick photos or videos, look at them (PhotoSender.tsx), then post */}
      <input
        ref={statusInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].filter(isPhotoOrVideo)
          e.target.value = ''
          if (files.length) setStatusFiles(files)
        }}
      />
      {statusFiles && <PhotoSender files={statusFiles} onClose={() => setStatusFiles(null)} onSend={postMedia} />}
      {writing && <StatusComposer privacy={statusWho()} onPost={postWords} onClose={() => setWriting(false)} />}
      {statusPrivacy && <StatusPrivacyDialog me={me} prefs={statusPrefs} people={people} onClose={() => setStatusPrivacy(false)} />}
      {viewer && (
        <StatusViewer
          me={me}
          groups={allGroups}
          order={viewer.order}
          startItem={viewer.startItem}
          muted={mutedStatus}
          onClose={() => setViewer(null)}
          onReply={replyToStatus}
        />
      )}

      {joinCode && <JoinGroup me={me} code={joinCode} onClose={closeJoin} onJoined={joined} />}
      {call && <CallScreen key={call.id} call={call} />}
      </Suspense>
    </div>
  )
}
