// Home.tsx: the main screen after login.
// It shows your chat list, or one open chat if you tapped on it.
import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { Profile } from '../App'
import type { Person } from '../chats'
import ChatList from './ChatList'
import ChatRoom from './ChatRoom'

export default function Home({ user, profile }: { user: User; profile: Profile }) {
  const me: Person = { uid: user.uid, name: profile.name }
  // The person whose chat is open. null = show the chat list.
  const [other, setOther] = useState<Person | null>(null)

  if (other) return <ChatRoom me={me} other={other} onBack={() => setOther(null)} />
  return <ChatList me={me} profile={profile} onOpen={setOther} />
}
