// ChatList.tsx: your chats, newest on top, plus a box to start a new chat.
import { useEffect, useState } from 'react'
import { signOut } from 'firebase/auth'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import type { Profile } from '../App'
import { findUserByPhone, type Chat, type Person } from '../chats'
import { toInternational } from '../phone'

type Props = { me: Person; profile: Profile; onOpen: (other: Person) => void }

export default function ChatList({ me, profile, onOpen }: Props) {
  const [chats, setChats] = useState<Chat[]>([])
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Listen LIVE to every chat I'm a member of. When anyone sends me a message,
  // that chat's lastMessage changes and this list updates by itself.
  useEffect(() => {
    const q = query(collection(db, 'chats'), where('members', 'array-contains', me.uid))
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as Chat)
      // Newest first
      list.sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0))
      setChats(list)
    })
  }, [me.uid])

  async function startChat(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const phone = toInternational(number)
    if (phone === profile.phone) {
      setError("That's your own number.")
      return
    }
    setBusy(true)
    try {
      const person = await findUserByPhone(phone)
      if (person) onOpen(person)
      else setError('Nobody on PakChat has that number yet.')
    } catch (err) {
      setError('Something went wrong. Try again.')
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <h2>
          PakChat
          <small>{profile.name}</small>
        </h2>
        <button onClick={() => signOut(auth)}>Log out</button>
      </header>

      <form className="newchat" onSubmit={startChat}>
        <input
          inputMode="tel"
          placeholder="Friend's number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <button disabled={busy || number.length < 10}>New chat</button>
      </form>
      {error && <p className="error pad">{error}</p>}

      <div className="list">
        {chats.length === 0 && <p className="muted center pad">No chats yet. Type a number above to start one.</p>}
        {chats.map((chat) => {
          const otherUid = chat.members.find((uid) => uid !== me.uid)!
          const otherName = chat.names[otherUid] ?? 'Unknown'
          const last = chat.lastMessage
          return (
            <button key={chat.id} className="row" onClick={() => onOpen({ uid: otherUid, name: otherName })}>
              <span className="row-main">
                <strong>{otherName}</strong>
                <span className="muted">
                  {last && (last.senderId === me.uid ? 'You: ' : '') + last.text}
                </span>
              </span>
              <time className="muted">{formatTime(chat.updatedAt?.toDate())}</time>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Today: "14:05". Older: "12 Oct".
function formatTime(date?: Date) {
  if (!date) return ''
  const today = new Date().toDateString() === date.toDateString()
  return today
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
