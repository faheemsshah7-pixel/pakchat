// Login.tsx: two ways to log in.
//   1. Phone number, in two steps:
//      Step A: you type your number, Firebase sends a 6-digit code by SMS.
//      Step B: you type the code, Firebase checks it and logs you in.
//   2. "Sign in with Google": a Google window opens, you pick your account, done.
// Either way, App.tsx notices you're logged in and moves on by itself.
import { useRef, useState } from 'react'
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from 'firebase/auth'
import { auth } from '../firebase'
import { LEVEL, useBack } from '../back'
import { useT } from '../lang'
import { toInternational } from '../phone'
import { useFixedTheme } from '../theme'
import Icon from './Icon'
import Logo from './Logo'

export default function Login() {
  const { t, lang, setLang } = useT()
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // reCAPTCHA is an invisible "are you a robot?" check Google requires before sending an SMS.
  const recaptcha = useRef<RecaptchaVerifier | null>(null)
  // Back, on the "enter the code" step: back to the phone number (with a fresh robot check).
  useBack(!!confirmation, LEVEL.page, () => {
    setConfirmation(null)
    setCode('')
    recaptcha.current?.clear()
    recaptcha.current = null
  })
  useFixedTheme('aurora') // the login page is always Aurora

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      recaptcha.current ??= new RecaptchaVerifier(auth, 'recaptcha', { size: 'invisible' })
      const result = await signInWithPhoneNumber(auth, toInternational(number), recaptcha.current)
      setConfirmation(result)
    } catch (err) {
      // Real SMS needs Firebase's paid plan. Test numbers still work without it.
      const noBilling = (err as { code?: string }).code === 'auth/billing-not-enabled'
      setError(noBilling ? t.smsNotAvailable : t.sendCodeError)
      console.error(err)
      // Throw away the used robot check, so the next try gets a fresh one.
      recaptcha.current?.clear()
      recaptcha.current = null
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setError('')
    setBusy(true)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      // Closing the Google window isn't an error worth showing.
      if ((err as { code?: string }).code !== 'auth/popup-closed-by-user') setError(t.googleError)
      console.error(err)
      setBusy(false)
    }
  }

  async function checkCode(e: React.FormEvent) {
    e.preventDefault()
    if (!confirmation) return
    setError('')
    setBusy(true)
    try {
      // If the code is right, Firebase logs us in and App.tsx moves us on automatically.
      await confirmation.confirm(code)
    } catch (err) {
      setError(t.wrongCode)
      console.error(err)
      setBusy(false)
    }
  }

  return (
    <div className="login">
      {/* Left side (on big screens): what PakChat is. */}
      <section className="hero">
        <Logo size={72} />
        <h1>PakChat</h1>
        <p>{t.tagline}</p>
        <ul className="features">
          <li>
            <Icon name="bolt" /> {t.feature1}
          </li>
          <li>
            <Icon name="image" /> {t.feature2}
          </li>
          <li>
            <Icon name="users" /> {t.feature3}
          </li>
          <li>
            <Icon name="language" /> {t.feature4}
          </li>
        </ul>
      </section>

      {/* Right side: the login box. */}
      <div className="card">
        <div className="card-tools">
          <button className="link" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>
            {t.switchLanguage}
          </button>
        </div>
        <h2>{t.loginHeading}</h2>
        {!confirmation ? (
          <form onSubmit={sendCode}>
            <label htmlFor="phone">{t.phoneLabel}</label>
            <div className="phone">
              <span>+92</span>
              <input
                id="phone"
                inputMode="tel"
                placeholder="300 1234567"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                autoFocus
              />
            </div>
            <button className="btn" disabled={busy || number.length < 10}>
              {busy ? t.sending : t.sendCode}
            </button>
            <p className="or">
              <span>{t.or}</span>
            </p>
            <button type="button" className="btn google" disabled={busy} onClick={google}>
              <GoogleG /> {t.googleSignIn}
            </button>
          </form>
        ) : (
          <form onSubmit={checkCode}>
            <label htmlFor="code">{t.codeLabel}</label>
            <input
              id="code"
              className="code"
              inputMode="numeric"
              dir="ltr"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <button className="btn" disabled={busy || code.length !== 6}>
              {busy ? t.checking : t.logIn}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
        <div id="recaptcha" />
      </div>
    </div>
  )
}

// Google's "G", in its four colours.
function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
