// Login.tsx: phone number login in two steps.
//   Step A: you type your number, Firebase sends a 6-digit code by SMS.
//   Step B: you type the code, Firebase checks it and logs you in.
import { useRef, useState } from 'react'
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth'
import { auth } from '../firebase'
import { useT } from '../lang'
import { toInternational } from '../phone'

export default function Login() {
  const { t, lang, setLang } = useT()
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // reCAPTCHA is an invisible "are you a robot?" check Google requires before sending an SMS.
  const recaptcha = useRef<RecaptchaVerifier | null>(null)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      recaptcha.current ??= new RecaptchaVerifier(auth, 'recaptcha', { size: 'invisible' })
      const result = await signInWithPhoneNumber(auth, toInternational(number), recaptcha.current)
      setConfirmation(result)
    } catch (err) {
      setError(t.sendCodeError)
      console.error(err)
      // Throw away the used robot check, so the next try gets a fresh one.
      recaptcha.current?.clear()
      recaptcha.current = null
    } finally {
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
    <div className="card">
      <button className="link lang-switch" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>
        {t.switchLanguage}
      </button>
      <h1>PakChat</h1>
      {!confirmation ? (
        <form onSubmit={sendCode}>
          <label>{t.phoneLabel}</label>
          <div className="phone">
            <span>+92</span>
            <input
              inputMode="tel"
              placeholder="300 1234567"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              autoFocus
            />
          </div>
          <button disabled={busy || number.length < 10}>{busy ? t.sending : t.sendCode}</button>
        </form>
      ) : (
        <form onSubmit={checkCode}>
          <label>{t.codeLabel}</label>
          <input
            inputMode="numeric"
            dir="ltr"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button disabled={busy || code.length !== 6}>{busy ? t.checking : t.logIn}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <div id="recaptcha" />
    </div>
  )
}
