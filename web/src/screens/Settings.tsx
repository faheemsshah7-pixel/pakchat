// Settings.tsx: your profile (photo, name, about), privacy, notifications, chats and language.
// Profile and privacy are saved in the database (users/<you>), so they follow you to any device.
// Sounds, text size, the Enter key and call data are saved on this device only (settings.ts).
import { useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { alertsState, turnOnAlerts } from '../alerts'
import type { Person } from '../chats'
import { useT } from '../lang'
import { shrinkAvatar } from '../media'
import { removeMyPhoto, setAbout, setMyName, setMyPhoto, setPrivacy, useAvatar, useProfile, type Profile } from '../profiles'
import { install, isInstalled, useCanInstall } from '../pwa'
import { unblock } from '../safety'
import { setSetting, useSettings, type TextSize } from '../settings'
import Avatar, { PersonAvatar } from './Avatar'
import Icon from './Icon'
import Switch from './Switch'
import ThemePicker from './ThemePicker'

type Props = { me: Person; profile: Profile; blocked: Set<string>; onBack: () => void }

export default function Settings({ me, profile, blocked, onBack }: Props) {
  const { t, lang, setLang } = useT()
  const settings = useSettings()
  const photo = useAvatar(me.uid, profile.photo)
  const canInstall = useCanInstall()
  const [editing, setEditing] = useState<'name' | 'about' | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [showBlocked, setShowBlocked] = useState(false)
  const [alerts, setAlerts] = useState(alertsState)
  const photoInput = useRef<HTMLInputElement>(null)

  async function attempt(job: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(what: 'name' | 'about') {
    setDraft((what === 'name' ? profile.name : profile.about) ?? '')
    setEditing(what)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (editing === 'name' && text.length >= 2 && text !== profile.name) await attempt(() => setMyName(me.uid, text))
    if (editing === 'about' && text !== (profile.about ?? '')) await attempt(() => setAbout(me.uid, text))
    setEditing(null)
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await attempt(async () => setMyPhoto(me.uid, await shrinkAvatar(file)))
  }

  const sizes: [TextSize, string][] = [
    ['small', t.small],
    ['medium', t.medium],
    ['large', t.large],
  ]

  return (
    <div className="pane">
      <header className="bar">
        <button className="icon back-always" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{t.settings}</h2>
      </header>

      <div className="list settings">
        {/* ----- Profile ----- */}
        <div className="info-hero">
          <div className="hero-photo">
            <Avatar name={profile.name} size={110} photo={photo} />
            <button className="photo-edit" aria-label={t.changePhoto} title={t.changePhoto} onClick={() => photoInput.current?.click()}>
              <Icon name="camera" size={20} />
            </button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
          </div>
          {profile.photo && (
            <button className="link" disabled={busy} onClick={() => attempt(() => removeMyPhoto(me.uid))}>
              {t.removePhoto}
            </button>
          )}
        </div>
        {error && <p className="error pad">{error}</p>}

        <section className="info-section">
          <p className="section-title">{t.yourName}</p>
          {editing === 'name' ? (
            <form className="inline-edit" onSubmit={saveEdit}>
              <input dir="auto" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.yourName} />
              <button className="icon" aria-label={t.save} disabled={draft.trim().length < 2}>
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <button className="setting" onClick={() => startEdit('name')}>
              <span className="setting-text" dir="auto">
                {profile.name}
              </span>
              <Icon name="edit" size={18} />
            </button>
          )}
          <p className="section-title">{t.about}</p>
          {editing === 'about' ? (
            <form className="inline-edit" onSubmit={saveEdit}>
              <input dir="auto" value={draft} maxLength={140} placeholder={t.defaultAbout} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.about} />
              <button className="icon" aria-label={t.save}>
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <button className="setting" onClick={() => startEdit('about')}>
              <span className="setting-text" dir="auto">
                {profile.about || <span className="muted">{t.defaultAbout}</span>}
              </span>
              <Icon name="edit" size={18} />
            </button>
          )}
          <p className="section-title">{profile.phone ? t.phone : t.gmail}</p>
          <p className="setting static" dir="ltr">
            {profile.phone ?? profile.email}
          </p>
        </section>

        {/* ----- Privacy ----- */}
        <section className="info-section">
          <p className="section-title">
            <Icon name="lock" size={14} /> {t.privacy}
          </p>
          <Switch
            label={t.showLastSeen}
            hint={t.showLastSeenHint}
            on={!profile.hideLastSeen}
            disabled={busy}
            onChange={(on) => attempt(() => setPrivacy(me.uid, { hideLastSeen: !on }))}
          />
          <Switch
            label={t.readReceipts}
            hint={t.readReceiptsHint}
            on={profile.readReceipts !== false}
            disabled={busy}
            onChange={(on) => attempt(() => setPrivacy(me.uid, { readReceipts: on }))}
          />
          <button className="setting" onClick={() => setShowBlocked(!showBlocked)}>
            <span className="setting-text">
              <span>{t.blockedContacts}</span>
              <small>{blocked.size}</small>
            </span>
            <Icon name={showBlocked ? 'chevronUp' : 'chevronDown'} size={18} />
          </button>
          {showBlocked && (
            <div className="blocked-list">
              {blocked.size === 0 && <p className="hint">{t.noBlocked}</p>}
              {[...blocked].map((uid) => (
                <BlockedRow key={uid} uid={uid} onUnblock={() => unblock(me.uid, uid)} />
              ))}
            </div>
          )}
        </section>

        {/* ----- Notifications ----- */}
        <section className="info-section">
          <p className="section-title">
            <Icon name="bell" size={14} /> {t.notifications}
          </p>
          <div className="setting static">
            <span className="setting-text">
              <span>{t.desktopAlerts}</span>
              <small>{alerts === 'on' ? t.alertsAreOn : alerts === 'blocked' ? t.alertsBlocked : alerts === 'unsupported' ? t.alertsUnsupported : t.alertsAreOff}</small>
            </span>
            {alerts === 'off' && (
              <button className="btn small" onClick={() => turnOnAlerts().then(() => setAlerts(alertsState()))}>
                {t.turnOn}
              </button>
            )}
          </div>
          <Switch label={t.sounds} hint={t.soundsHint} on={settings.sounds} onChange={(on) => setSetting('sounds', on)} />
        </section>

        {/* ----- Calls ----- */}
        <section className="info-section">
          <p className="section-title">
            <Icon name="phone" size={14} /> {t.calls}
          </p>
          <Switch label={t.lowDataCalls} hint={t.lowDataCallsHint} on={settings.lowDataCalls} onChange={(on) => setSetting('lowDataCalls', on)} />
        </section>

        {/* ----- Chats ----- */}
        <section className="info-section">
          <p className="section-title">
            <Icon name="palette" size={14} /> {t.chatsSettings}
          </p>
          <button className="setting" onClick={() => setPicking(true)}>
            <span className="setting-text">
              <span>{t.theme}</span>
              <small>{t.chooseLook}</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
          <div className="setting static">
            <span className="setting-text">
              <span>{t.textSize}</span>
            </span>
            <span className="segmented" role="radiogroup" aria-label={t.textSize}>
              {sizes.map(([size, label]) => (
                <button key={size} role="radio" aria-checked={settings.textSize === size} className={settings.textSize === size ? 'on' : ''} onClick={() => setSetting('textSize', size)}>
                  {label}
                </button>
              ))}
            </span>
          </div>
          <Switch label={t.enterSends} hint={t.enterSendsHint} on={settings.enterSends} onChange={(on) => setSetting('enterSends', on)} />
          <div className="setting static">
            <span className="setting-text">
              <span>{t.language}</span>
            </span>
            <span className="segmented" role="radiogroup" aria-label={t.language}>
              <button role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
                English
              </button>
              <button role="radio" aria-checked={lang === 'ur'} className={lang === 'ur' ? 'on' : ''} onClick={() => setLang('ur')}>
                اردو
              </button>
            </span>
          </div>
        </section>

        {/* ----- The app ----- */}
        <section className="info-section">
          <p className="section-title">
            <Icon name="install" size={14} /> {t.app}
          </p>
          {canInstall ? (
            <button className="setting" onClick={install}>
              <span className="setting-text">
                <span>{t.installApp}</span>
                <small>{t.installHint}</small>
              </span>
              <Icon name="download" size={18} />
            </button>
          ) : (
            <p className="setting static">
              <span className="setting-text">
                <span>{isInstalled() ? t.installed : t.installApp}</span>
                <small>{isInstalled() ? t.installedHint : t.installManual}</small>
              </span>
            </p>
          )}
        </section>

        <div className="bottom">
          <button className="btn secondary danger" onClick={() => signOut(auth)}>
            <Icon name="logout" size={18} /> {t.logOut}
          </button>
        </div>
      </div>
      {picking && <ThemePicker onClose={() => setPicking(false)} />}
    </div>
  )
}

function BlockedRow({ uid, onUnblock }: { uid: string; onUnblock: () => void }) {
  const { t } = useT()
  const profile = useProfile(uid)
  const name = profile?.name ?? '…'
  return (
    <div className="row">
      <PersonAvatar uid={uid} name={name} size={40} />
      <strong className="row-main" dir="auto">
        {name}
      </strong>
      <button className="btn small secondary" onClick={onUnblock}>
        {t.unblock}
      </button>
    </div>
  )
}
