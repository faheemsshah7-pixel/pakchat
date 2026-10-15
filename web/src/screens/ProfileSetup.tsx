// ProfileSetup.tsx: first time you log in, we ask for your name
// and save it in the database under users/<your id>.
import { useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useT } from '../lang'
import { useFixedTheme } from '../theme'
import Logo from './Logo'

export default function ProfileSetup({ user }: { user: User }) {
  const { t } = useT()
  const [name, setName] = useState(user.displayName ?? '') // Google gives us your name
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useFixedTheme('aurora') // same look as the login page

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // One "document" per user. Its id is the user's login id (uid).
      await setDoc(doc(db, 'users', user.uid), {
        name: name.trim(),
        phone: user.phoneNumber, // from SMS login (or null)
        email: user.email, // from Google login (or null)
        createdAt: serverTimestamp(),
      })
      // No need to change screens here: App.tsx is listening and switches to Home.
    } catch (err) {
      setError(t.saveError)
      console.error(err)
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="card">
        <div className="card-logo">
          <Logo size={56} />
        </div>
        <h2>{t.welcome}</h2>
        <form onSubmit={save}>
          <label htmlFor="name">{t.nameLabel}</label>
          <input id="name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.yourName} maxLength={40} autoFocus />
          <button className="btn" disabled={busy || name.trim().length < 2}>
            {busy ? t.saving : t.continue}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
