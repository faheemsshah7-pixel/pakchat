// Home.tsx: the main screen after login.
// On a computer it's two panels side by side, like WhatsApp Web:
//   left:  your chats (or the "new group" screen)
//   right: the open chat (or a welcome message when none is open)
// On a phone there's only room for one, so index.css hides the other.
// It also does some jobs in the background while you're logged in:
//   1. listens to all your chats
//   2. pops up an alert when a message arrives and you're not looking
//   3. marks new messages as "delivered" (✓✓) as soon as they arrive
//   4. shows the number of unread chats in the tab title: "(2) PakChat"
//   5. keeps your "online" heartbeat going
import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Profile } from '../App'
import { showAlert } from '../alerts'
import { chatTitle, isGroup, isUnread, markDelivered, otherPerson, previewText, type Chat, type Person } from '../chats'
import { useT } from '../lang'
import { startHeartbeat } from '../presence'
import { useBlocked } from '../safety'
import ChatList from './ChatList'
import ChatRoom from './ChatRoom'
import NewGroup from './NewGroup'
import Welcome from './Welcome'

// Which chat is open. `other` is set for direct chats (the chat may not exist yet).
export type Open = { chatId: string; other?: Person }

export default function Home({ user, profile }: { user: User; profile: Profile }) {
  const { t } = useT()
  const me: Person = { uid: user.uid, name: profile.name }
  const [open, setOpen] = useState<Open | null>(null)
  const [newGroup, setNewGroup] = useState(false)
  const [chats, setChats] = useState<Chat[]>([])
  const blocked = useBlocked(user.uid)
  const delivered = useRef(new Map<string, number>()) // chats we already marked delivered
  const alerted = useRef(new Map<string, number>()) // chats we already popped an alert for
  // The snapshot listener below is created once, so it reads these through refs.
  const openRef = useRef<string | null>(null)
  const tRef = useRef(t)
  useEffect(() => {
    openRef.current = open?.chatId ?? null
    tRef.current = t
  })

  // 1 + 2. Listen LIVE to every chat I'm a member of, and alert on new messages.
  useEffect(() => {
    let first = true
    const q = query(collection(db, 'chats'), where('members', 'array-contains', user.uid))
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as Chat)
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
        if (!looking) {
          showAlert(chatTitle(chat, user.uid), previewText(chat, user.uid, tRef.current), chat.id, () =>
            setOpen(isGroup(chat) ? { chatId: chat.id } : { chatId: chat.id, other: otherPerson(chat, user.uid) }),
          )
        }
      }
      first = false
    })
  }, [user.uid])

  // 3. A new message from someone else arrived? Tell them it's delivered.
  useEffect(() => {
    for (const chat of chats) {
      const last = chat.lastMessage
      const at = chat.updatedAt?.toMillis()
      if (!last || last.senderId === user.uid || !at) continue
      const alreadyDelivered = (chat.deliveredAt?.[user.uid]?.toMillis() ?? 0) >= at
      if (alreadyDelivered || delivered.current.get(chat.id) === at) continue
      delivered.current.set(chat.id, at)
      markDelivered(chat.id, user.uid).catch(console.error)
    }
  }, [chats, user.uid])

  // 4. "(2) PakChat" in the tab title.
  useEffect(() => {
    const unread = chats.filter((c) => isUnread(c, user.uid)).length
    document.title = unread ? `(${unread}) PakChat` : 'PakChat'
    return () => {
      document.title = 'PakChat'
    }
  }, [chats, user.uid])

  // 5. Heartbeat for "online" / "last seen".
  useEffect(() => startHeartbeat(user.uid), [user.uid])

  const openChat = open ? chats.find((c) => c.id === open.chatId) : undefined
  // (If you just left a group, it's gone from your chats, so nothing is open any more.)
  const showing = open && (open.other || openChat) ? open : null

  return (
    <div className={showing ? 'app has-chat' : 'app'}>
      <aside className="side">
        {newGroup ? (
          <NewGroup
            me={me}
            chats={chats}
            onCancel={() => setNewGroup(false)}
            onCreated={(chatId) => {
              setNewGroup(false)
              setOpen({ chatId })
            }}
          />
        ) : (
          <ChatList
            me={me}
            profile={profile}
            chats={chats}
            activeId={showing?.chatId}
            onOpen={setOpen}
            onNewGroup={() => setNewGroup(true)}
          />
        )}
      </aside>
      <main className="main">
        {showing ? (
          // key: a different chat gets a fresh ChatRoom, so nothing carries over from the last one.
          <ChatRoom
            key={showing.chatId}
            me={me}
            chatId={showing.chatId}
            chat={openChat}
            other={showing.other}
            blocked={blocked}
            onBack={() => setOpen(null)}
          />
        ) : (
          <Welcome />
        )}
      </main>
    </div>
  )
}
