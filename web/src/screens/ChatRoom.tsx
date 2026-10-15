// ChatRoom.tsx: one conversation. Messages appear live, for both people.
import { useEffect, useRef, useState } from 'react'
import { collection, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { chatIdFor, sendMessage, type Message, type Person } from '../chats'

type Props = { me: Person; other: Person; onBack: () => void }

export default function ChatRoom({ me, other, onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const chatId = chatIdFor(me.uid, other.uid)

  // Listen LIVE to the last 100 messages, oldest at the top.
  useEffect(() => {
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('sentAt'), limitToLast(100))
    return onSnapshot(q, (snap) => {
      // 'estimate': a message you JUST sent has no server time yet, so use your clock for now.
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as Message))
    })
  }, [chatId])

  // Whenever messages change, scroll to the newest one.
  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const clean = text.trim()
    if (!clean) return
    setText('') // clear the box straight away, like WhatsApp
    setError('')
    try {
      await sendMessage(me, other, clean)
    } catch (err) {
      setError('Message not sent. Try again.')
      setText(clean)
      console.error(err)
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <button className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2>{other.name}</h2>
      </header>

      <div className="messages">
        {messages.length === 0 && <p className="muted center">Say salam 👋</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.senderId === me.uid ? 'bubble mine' : 'bubble'}>
            {m.text}
            <time>{m.sentAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {error && <p className="error pad">{error}</p>}
      <form className="composer" onSubmit={send}>
        <input placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <button disabled={!text.trim()}>Send</button>
      </form>
    </div>
  )
}
