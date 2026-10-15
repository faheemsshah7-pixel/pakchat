// Home.tsx: for now just says hello. Chats arrive in step 2.
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import type { Profile } from '../App'

export default function Home({ profile }: { profile: Profile }) {
  return (
    <div className="card">
      <h1>Salam, {profile.name}!</h1>
      <p className="muted">Logged in as {profile.phone}</p>
      <p>Your chats will appear here in step 2.</p>
      <button className="secondary" onClick={() => signOut(auth)}>
        Log out
      </button>
    </div>
  )
}
