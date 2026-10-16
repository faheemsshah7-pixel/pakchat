// Settings.tsx: a window in the middle of the screen, like WhatsApp's.
// On the left: search, your profile, and the parts of Settings. On the right: the part you picked.
//   Profile        your photo, name, about line and number
//   Privacy        last seen, read receipts, who sees your status, blocked people
//   Notifications  alerts, sounds, and which sound (for chats, and for groups)
//   Calls          using less data
//   Chats          the look, the wallpaper, conversation tones (on or off, and how loud), text size, the Enter key,
//                  photo quality (HD), voice message transcripts, language
//   App            installing PakChat
// On a phone the window fills the screen: first the list, then the part you tap (Back returns).
// Profile and privacy are saved in the database (users/<you>), so they follow you to any device.
// Sounds, text size, the Enter key, photo quality, transcripts and call data are saved on this device only (settings.ts).
// The wallpaper for all chats is saved in the database (wallpaper.ts), so it follows you too.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { alertsState, turnOnAlerts } from '../alerts'
import { LEVEL, useBack } from '../back'
import type { Person } from '../chats'
import { useT } from '../lang'
import { shrinkAvatar } from '../media'
import type { StatusPrefs } from '../private'
import { removeMyPhoto, setAbout, setMyName, setMyPhoto, setPrivacy, useAvatar, useProfile, type Profile } from '../profiles'
import { install, isInstalled, useCanInstall } from '../pwa'
import { unblock } from '../safety'
import { setSetting, useSettings, type TextSize } from '../settings'
import { playConversationTone, type Tone } from '../sound'
import { fill } from '../strings'
import { canTranscribe } from '../transcribe'
import { ALL_CHATS, setWallpaper, useWallDoc, wallLabel } from '../wallpaper'
import Avatar, { PersonAvatar } from './Avatar'
import Icon, { type IconName } from './Icon'
import { ToneDialog } from './Dialogs'
import { StatusPrivacyDialog } from './StatusList'
import Switch from './Switch'
import ThemePicker from './ThemePicker'
import WallpaperPicker from './WallpaperPicker'

export type Section = 'profile' | 'privacy' | 'notifications' | 'calls' | 'chats' | 'app'

type Props = {
  me: Person
  profile: Profile
  blocked: Set<string>
  statusPrefs: StatusPrefs
  people: Person[] // everyone you know (for status privacy)
  start: Section | null // the part to open at (null = the list, on a phone)
  onClose: () => void
  onStarred: () => void
}

// Is the screen wide enough for the list and the part side by side?
function useWide() {
  const query = '(min-width: 900px)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const onChange = () => setWide(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
  return wide
}

export default function Settings({ me, profile, blocked, statusPrefs, people, start, onClose, onStarred }: Props) {
  const { t, lang, setLang } = useT()
  const settings = useSettings()
  const wide = useWide()
  const photo = useAvatar(me.uid, profile.photo)
  const canInstall = useCanInstall()
  const [picked, setPicked] = useState<Section | null>(start)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<'name' | 'about' | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [statusPrivacy, setStatusPrivacy] = useState(false)
  const [showBlocked, setShowBlocked] = useState(false)
  const [toneFor, setToneFor] = useState<'messageTone' | 'groupTone' | null>(null) // picking a sound
  const [pickingWall, setPickingWall] = useState(false)
  const wall = useWallDoc(me.uid, ALL_CHATS) // the wallpaper for all chats (wallpaper.ts)
  const [alerts, setAlerts] = useState(alertsState)
  const photoInput = useRef<HTMLInputElement>(null)
  // On a computer one part is always showing (Profile to start with).
  const section = picked ?? (wide ? 'profile' : null)

  // Back (and Esc): on a phone, from a part back to the list; otherwise close the window.
  const back = () => (!wide && section ? setPicked(null) : onClose())
  useBack(true, LEVEL.window, back)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !picking && !statusPrivacy && !toneFor && !pickingWall && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, picking, statusPrivacy, toneFor, pickingWall])

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
  const statusMode = statusPrefs.mode ?? 'contacts'
  const statusWho =
    statusMode === 'except'
      ? `${t.myContactsExcept} ${fill(t.nExcluded, { n: statusPrefs.except?.length ?? 0 })}`
      : statusMode === 'only'
        ? `${t.onlyShareWith} ${fill(t.nIncluded, { n: statusPrefs.only?.length ?? 0 })}`
        : t.myContacts

  // The parts, with words to find them by (the search box looks at these too).
  const parts: [Section, IconName, string, string[]][] = [
    ['privacy', 'lock', t.privacy, [t.showLastSeen, t.readReceipts, t.blockedContacts, t.statusPrivacy, t.linkPreviews]],
    ['notifications', 'bell', t.notifications, [t.desktopAlerts, t.sounds, t.messageTone, t.groupTone]],
    ['calls', 'phone', t.calls, [t.lowDataCalls]],
    ['chats', 'palette', t.chatsSettings, [t.theme, t.wallpaper, t.conversationTones, t.textSize, t.enterSends, t.language, t.photoQuality, t.transcripts]],
    ['app', 'install', t.app, [t.installApp]],
  ]
  const q = search.trim().toLowerCase()
  const found = (words: string[]) => !q || words.some((word) => word.toLowerCase().includes(q))
  const titles: Record<Section, string> = { profile: t.profile, privacy: t.privacy, notifications: t.notifications, calls: t.calls, chats: t.chatsSettings, app: t.app }

  const pages: Record<Section, ReactNode> = {
    profile: (
      <>
        <div className="info-hero">
          <div className="hero-photo">
            <Avatar name={profile.name} size={130} photo={photo} />
            <button className="photo-edit" aria-label={t.changePhoto} title={t.changePhoto} onClick={() => photoInput.current?.click()}>
              <Icon name="camera" size={20} />
            </button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
          </div>
          <button className="link" onClick={() => photoInput.current?.click()}>
            {t.editPhoto}
          </button>
          {profile.photo && (
            <button className="link danger" disabled={busy} onClick={() => attempt(() => removeMyPhoto(me.uid))}>
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
      </>
    ),
    privacy: (
      <section className="info-section">
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
        <Switch label={t.linkPreviews} hint={t.linkPreviewsHint} on={settings.linkPreviews} onChange={(on) => setSetting('linkPreviews', on)} />
        <button className="setting" onClick={() => setStatusPrivacy(true)}>
          <span className="setting-text">
            <span>{t.status}</span>
            <small>{statusWho}</small>
          </span>
          <Icon name="chevronRight" size={18} />
        </button>
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
        {error && <p className="error pad">{error}</p>}
      </section>
    ),
    notifications: (
      <section className="info-section">
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
        {/* Which sound plays. (A chat can have its own: its info, "Notification tone".) */}
        {(['messageTone', 'groupTone'] as const).map((key) => (
          <button key={key} className="setting" onClick={() => setToneFor(key)}>
            <span className="setting-text">
              <span>{key === 'messageTone' ? t.messageTone : t.groupTone}</span>
              <small>{t.toneNames[settings[key]]}</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        ))}
      </section>
    ),
    calls: (
      <section className="info-section">
        <Switch label={t.lowDataCalls} hint={t.lowDataCallsHint} on={settings.lowDataCalls} onChange={(on) => setSetting('lowDataCalls', on)} />
      </section>
    ),
    chats: (
      <section className="info-section">
        <button className="setting" onClick={() => setPicking(true)}>
          <span className="setting-text">
            <span>{t.theme}</span>
            <small>{t.chooseLook}</small>
          </span>
          <Icon name="chevronRight" size={18} />
        </button>
        <button className="setting" onClick={() => setPickingWall(true)}>
          <span className="setting-text">
            <span>{t.wallpaper}</span>
            <small>
              {wallLabel(wall, t)} · {t.wallpaperHint}
            </small>
          </span>
          <Icon name="chevronRight" size={18} />
        </button>
        {/* Conversation tones: little sounds while a chat is open (sound.ts). The slider sets how loud,
            and plays one when you let go, so you can hear it. */}
        <Switch label={t.conversationTones} hint={t.conversationTonesHint} on={settings.conversationTones} onChange={(on) => setSetting('conversationTones', on)} />
        {settings.conversationTones && (
          <div className="setting static">
            <span className="setting-text">
              <span>{t.toneVolume}</span>
            </span>
            <span className="volume">
              <Icon name="volume" size={18} />
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(settings.toneVolume * 100)}
                aria-label={t.toneVolume}
                onChange={(e) => setSetting('toneVolume', Number(e.target.value) / 100)}
                onPointerUp={() => playConversationTone('received', true)}
                onKeyUp={() => playConversationTone('received', true)}
              />
              <span className="volume-number">{Math.round(settings.toneVolume * 100)}%</span>
            </span>
          </div>
        )}
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
            <span>{t.photoQuality}</span>
            <small>{t.photoQualityHint}</small>
          </span>
          <span className="segmented" role="radiogroup" aria-label={t.photoQuality}>
            <button role="radio" aria-checked={!settings.photoHD} className={settings.photoHD ? '' : 'on'} onClick={() => setSetting('photoHD', false)}>
              {t.standard}
            </button>
            <button role="radio" aria-checked={settings.photoHD} className={settings.photoHD ? 'on' : ''} onClick={() => setSetting('photoHD', true)}>
              {t.hd}
            </button>
          </span>
        </div>
        {/* Voice message transcripts: only where the browser can do it (transcribe.ts). */}
        <Switch
          label={t.transcripts}
          hint={canTranscribe() ? t.transcriptsHint : t.transcriptsUnsupported}
          on={settings.transcripts && canTranscribe()}
          disabled={!canTranscribe()}
          onChange={(on) => setSetting('transcripts', on)}
        />
        {settings.transcripts && canTranscribe() && (
          <div className="setting static">
            <span className="setting-text">
              <span>{t.transcriptLanguage}</span>
            </span>
            <span className="segmented" role="radiogroup" aria-label={t.transcriptLanguage}>
              <button role="radio" aria-checked={settings.transcriptLang === 'en'} className={settings.transcriptLang === 'en' ? 'on' : ''} onClick={() => setSetting('transcriptLang', 'en')}>
                English
              </button>
              <button role="radio" aria-checked={settings.transcriptLang === 'ur'} className={settings.transcriptLang === 'ur' ? 'on' : ''} onClick={() => setSetting('transcriptLang', 'ur')}>
                اردو
              </button>
            </span>
          </div>
        )}
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
    ),
    app: (
      <section className="info-section">
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
    ),
  }

  return createPortal(
    <div className="modal-backdrop settings-backdrop" onClick={onClose}>
      <div className={section ? 'settings-window open' : 'settings-window'} role="dialog" aria-label={t.settings} onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <header className="settings-head">
            <button className="icon phone-only" aria-label={t.back} onClick={onClose}>
              <Icon name="back" />
            </button>
            <h2>{t.settings}</h2>
          </header>
          <div className="field">
            <Icon name="search" size={18} />
            <input placeholder={t.search} aria-label={t.searchSettings} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="settings-items">
            {found([t.profile, profile.name, t.yourName, t.about, t.changePhoto]) && (
              <button className={section === 'profile' ? 'settings-me on' : 'settings-me'} onClick={() => setPicked('profile')}>
                <Avatar name={profile.name} size={56} photo={photo} />
                <span className="row-main">
                  <strong dir="auto">{profile.name}</strong>
                  <small dir="auto">{profile.about || t.defaultAbout}</small>
                </span>
              </button>
            )}
            {found([t.starredMessages]) && (
              <button className="nav-item" onClick={onStarred}>
                <Icon name="star" />
                {t.starredMessages}
              </button>
            )}
            {parts
              .filter(([, , label, words]) => found([label, ...words]))
              .map(([key, icon, label]) => (
                <button key={key} className={section === key ? 'nav-item on' : 'nav-item'} onClick={() => setPicked(key)}>
                  <Icon name={icon} />
                  {label}
                </button>
              ))}
            {found([t.logOut]) && (
              <button className="nav-item danger" onClick={() => signOut(auth)}>
                <Icon name="logout" />
                {t.logOut}
              </button>
            )}
          </div>
        </nav>

        {section && (
          <section className="settings-page" aria-label={titles[section]}>
            <header className="settings-head">
              <button className="icon phone-only" aria-label={t.back} onClick={() => setPicked(null)}>
                <Icon name="back" />
              </button>
              <h2>{titles[section]}</h2>
            </header>
            <div className="list settings">{pages[section]}</div>
            <footer className="settings-foot">
              <button className="btn small" onClick={onClose}>
                {t.done}
              </button>
            </footer>
          </section>
        )}
        {/* (Inside the window, so a click in these doesn't count as a click outside it.) */}
        {picking && <ThemePicker onClose={() => setPicking(false)} />}
        {statusPrivacy && <StatusPrivacyDialog me={me} prefs={statusPrefs} people={people} onClose={() => setStatusPrivacy(false)} />}
        {pickingWall && (
          <WallpaperPicker
            title={t.defaultWallpaper}
            current={wall}
            usual={null}
            onSave={(next) => setWallpaper(me.uid, ALL_CHATS, next)}
            onClose={() => setPickingWall(false)}
          />
        )}
        {toneFor && (
          <ToneDialog
            title={toneFor === 'messageTone' ? t.messageTone : t.groupTone}
            current={settings[toneFor]}
            onSave={(tone) => setSetting(toneFor, tone as Tone)}
            onClose={() => setToneFor(null)}
          />
        )}
      </div>
    </div>,
    document.body,
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
