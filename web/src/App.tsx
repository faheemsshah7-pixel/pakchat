// App.tsx: the "traffic controller". It decides which screen to show:
//   not logged in      -> Login
//   logged in, no name -> ProfileSetup
//   logged in + name   -> Home (your chats)
import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from './firebase'
import { useT } from './lang'
import Login from './screens/Login'
import ProfileSetup from './screens/ProfileSetup'
import Home from './screens/Home'

export type Profile = { name: string; phone: string }

export default function App() {
  const { t } = useT()
  // undefined = still checking, null = nobody logged in
  const [user, setUser] = useState<User | null | undefined>(undefined)
  // The profile we loaded, and whose it is (so we never show the last user's profile).
  const [loaded, setLoaded] = useState<{ uid: string; profile: Profile | null } | null>(null)

  // 1. Firebase tells us whenever someone logs in or out.
  useEffect(() => onAuthStateChanged(auth, setUser), [])

  // 2. Once logged in, we listen LIVE to this user's profile in the database.
  //    When ProfileSetup saves a name, this fires again and we switch to Home.
  useEffect(() => {
    if (!user) return
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setLoaded({ uid: user.uid, profile: snap.exists() ? (snap.data() as Profile) : null })
    })
  }, [user])

  // undefined = still loading this user's profile
  const profile = user && loaded?.uid === user.uid ? loaded.profile : undefined

  if (user === undefined || (user && profile === undefined)) {
    return <div className="center muted">{t.loading}</div>
  }
  if (!user) return <Login />
  if (!profile) return <ProfileSetup user={user} />
  return <Home user={user} profile={profile} />
}
