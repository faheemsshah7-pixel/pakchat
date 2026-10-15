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

export default function Login() {
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // reCAPTCHA is an invisible "are you a robot?" check Google requires before sending an SMS.
  const recaptcha = useRef<RecaptchaVerifier | null>(null)

  // "0300 1234567" or "3001234567" -> "+923001234567"
  function toInternational(input: string) {
    const digits = input.replace(/\D/g, '').replace(/^92/, '').replace(/^0/, '')
    return '+92' + digits
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      recaptcha.current ??= new RecaptchaVerifier(auth, 'recaptcha', { size: 'invisible' })
      const result = await signInWithPhoneNumber(auth, toInternational(number), recaptcha.current)
      setConfirmation(result)
    } catch (err) {
      setError('Could not send the code. Check the number and try again.')
      console.error(err)
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
      setError('That code is not right. Try again.')
      console.error(err)
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h1>PakChat</h1>
      {!confirmation ? (
        <form onSubmit={sendCode}>
          <label>Your phone number</label>
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
          <button disabled={busy || number.length < 10}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form onSubmit={checkCode}>
          <label>Enter the 6-digit code we sent you</label>
          <input
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Log in'}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <div id="recaptcha" />
    </div>
  )
}
