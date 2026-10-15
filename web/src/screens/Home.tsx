// Home.tsx: the main screen after login.
// On a computer it's two panels side by side, like WhatsApp Web:
//   left:  your chats (or New chat, New group, Archived, Settings)
//   right: the open chat (or a welcome message when none is open)
// On a phone there's only room for one, so index.css hides the other.
// It also does some jobs in the background while you're logged in:
//   1. listens to all your chats, and your private settings for each one (prefs.ts)
//   2. pops up an alert and plays a sound when a message arrives and you're not looking
//   3. marks new messages as "delivered" (✓✓) as soon as they arrive
//   4. counts unread messages, and shows the number of unread chats in the tab: "(2) PakChat"
//   5. keeps your "online" heartbeat going (unless you hid your last seen)
//   6. opens a group invite link, if the page was opened with one
//   7. listens for calls to you, and shows the call screen (calls.ts, CallScreen.tsx)
//   8. listens for "typing…" in all your chats (typing.ts)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { collection, getCountFromServer, onSnapshot, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { showAlert } from '../alerts'
import { listenForCalls, useCall } from '../calls'
import {
  chatIdFor,
  chatTitle,
  isGroup,
  isUnread,
  lastRead,
  markDelivered,
  otherPerson,
  previewText,
  type Chat,
  type Person,
} from '../chats'
import { codeFromAddress } from '../invites'
import { useT } from '../lang'
import { isHidden, isMuted, usePrefs, type ChatPrefs } from '../prefs'
import { startHeartbeat } from '../presence'
import type { Profile } from '../profiles'
import { useBlocked } from '../safety'
import { playPing } from '../sound'
import { listenForTyping } from '../typing'
import CallScreen from './CallScreen'
import CallsList from './CallsList'
import ChatList from './ChatList'
import ChatRoom from './ChatRoom'
import JoinGroup from './JoinGroup'
import NewChat from './NewChat'
import NewGroup from './NewGroup'
import Settings from './Settings'
import Welcome from './Welcome'

// Which chat is open. `other` is set for direct chats (the chat may not exist yet).
export type Open = { chatId: string; other?: Person }
type View = 'chats' | 'archived' | 'newChat' | 'newGroup' | 'settings' | 'calls'

export default function Home({ user, profile }: { user: User; profile: Profile }) {
  const { t } = useT()
  // (useMemo: the same object until your name changes, so screens can tell nothing changed.)
  const me: Person = useMemo(() => ({ uid: user.uid, name: profile.name }), [user.uid, profile.name])
  const [open, setOpen] = useState<Open | null>(null)
  const [view, setView] = useState<View>('chats')
  const [chats, setChats] = useState<Chat[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [joinCode, setJoinCode] = useState(codeFromAddress)
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
        if (looking || isMuted(prefsRef.current.get(chat.id))) continue // muted chats stay quiet
        playPing()
        showAlert(chatTitle(chat, user.uid), previewText(chat, user.uid, tRef.current), chat.id, () =>
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

  // "(2) PakChat" in the tab title. Muted and archived chats don't count.
  useEffect(() => {
    const loud = (c: Chat, p?: ChatPrefs) => isUnread(c, user.uid, p) && !isMuted(p) && !p?.archived && !isHidden(c, p)
    const unread = chats.filter((c) => loud(c, prefs.get(c.id))).length
    document.title = unread ? `(${unread}) PakChat` : 'PakChat'
    return () => {
      document.title = 'PakChat'
    }
  }, [chats, prefs, user.uid])

  // 5. Heartbeat for "online" / "last seen". Off if you hid your last seen.
  const hideLastSeen = !!profile.hideLastSeen
  useEffect(() => (hideLastSeen ? undefined : startHeartbeat(user.uid)), [user.uid, hideLastSeen])

  // 6. Done with the invite link: take it out of the address bar.
  const closeJoin = useCallback(() => {
    setJoinCode(null)
    history.replaceState(null, '', '/')
  }, [])
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

  // 8. "typing…" in all your chats
  useEffect(() => listenForTyping(user.uid), [user.uid])

  function openChat(next: Open) {
    setOpen(next)
    if (view !== 'archived') setView('chats')
  }

  const openChatDoc = open ? chats.find((c) => c.id === open.chatId) : undefined
  // (If you just left a group, it's gone from your chats, so nothing is open any more.)
  const showing = open && (open.other || openChatDoc) ? open : null

  return (
    <div className={showing ? 'app has-chat' : 'app'}>
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
        ) : view === 'settings' ? (
          <Settings me={me} profile={profile} blocked={blocked} onBack={() => setView('chats')} />
        ) : view === 'calls' ? (
          <CallsList me={me} onBack={() => setView('chats')} />
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
            onSettings={() => setView('settings')}
            onCalls={() => setView('calls')}
          />
        )}
      </aside>
      <main className="main">
        {showing ? (
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
          />
        ) : (
          <Welcome />
        )}
      </main>
      {joinCode && <JoinGroup me={me} code={joinCode} onClose={closeJoin} onJoined={joined} />}
      {call && <CallScreen key={call.id} call={call} />}
    </div>
  )
}
