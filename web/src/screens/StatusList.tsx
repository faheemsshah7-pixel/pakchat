// StatusList.tsx: the Status tab, like WhatsApp's "Updates".
// A card for each person who posted: their newest status behind it, their photo in a ring
// (green = something you haven't seen yet, grey = seen it all), and their name.
// Your own card comes first: "Add status", or your newest one.
// The camera button posts a photo or video; the pencil posts words on a colour.
import { useState } from 'react'
import type { Person } from '../chats'
import { useT } from '../lang'
import { setPrivate, type StatusMode, type StatusPrefs } from '../private'
import { useAvatar, type Profile } from '../profiles'
import { STATUS_COLOURS, STATUS_FONTS, type Status, type StatusGroup } from '../status'
import { fill } from '../strings'
import Avatar, { PersonAvatar } from './Avatar'
import { PeopleDialog } from './Dialogs'
import Icon from './Icon'
import Menu from './Menu'
import Modal from './Modal'
import Popover from './Popover'

type Props = {
  me: Person
  profile: Profile
  mine: StatusGroup | null
  groups: StatusGroup[] // other people, newest first
  muted: string[]
  onOpen: (list: StatusGroup[], index: number) => void // start watching at this person
  onMine: () => void
  onCamera: () => void
  onWrite: () => void
  onPrivacy: () => void
}

export default function StatusList({ me, profile, mine, groups, muted, onOpen, onMine, onCamera, onWrite, onPrivacy }: Props) {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null)
  const [showMuted, setShowMuted] = useState(false)
  const photo = useAvatar(me.uid, profile.photo)

  const q = search.trim().toLowerCase()
  const shown = groups.filter((g) => !q || g.owner.name.toLowerCase().includes(q))
  const loud = shown.filter((g) => !muted.includes(g.owner.uid))
  const fresh = loud.filter((g) => g.unseen > 0)
  const viewed = loud.filter((g) => g.unseen === 0)
  const quiet = shown.filter((g) => muted.includes(g.owner.uid))

  function addAt(e: React.MouseEvent) {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setAdding({ x: r.left, y: r.bottom + 4 })
  }

  return (
    <div className="pane status-pane">
      <header className="bar">
        <h2>{t.status}</h2>
        <button className="icon" aria-label={t.photoStatus} title={t.photoStatus} onClick={onCamera}>
          <Icon name="camera" />
        </button>
        <button className="icon" aria-label={t.textStatus} title={t.textStatus} onClick={onWrite}>
          <Icon name="edit" />
        </button>
        <Menu label={t.menu} items={[{ label: t.statusPrivacy, icon: 'lock', onClick: onPrivacy }]} />
      </header>
      <div className="newchat">
        <div className="field">
          <Icon name="search" size={20} />
          <input placeholder={t.search} aria-label={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="list">
        <div className="status-cards">
          {mine ? (
            <StatusCard group={mine} label={t.myStatus} mine onClick={onMine} onAdd={addAt} />
          ) : (
            <button className="status-card add-card" onClick={addAt}>
              <span className="add-photo">
                <Avatar name={profile.name} size={64} photo={photo} />
                <span className="plus-badge">
                  <Icon name="plus" size={16} />
                </span>
              </span>
              <span className="card-name">{t.addStatus}</span>
            </button>
          )}
          {fresh.map((g) => (
            <StatusCard key={g.owner.uid} group={g} label={g.owner.name} onClick={() => onOpen(fresh, fresh.indexOf(g))} />
          ))}
        </div>

        {viewed.length > 0 && (
          <>
            <p className="section-title">{t.viewedUpdates}</p>
            <div className="status-cards">
              {viewed.map((g) => (
                <StatusCard key={g.owner.uid} group={g} label={g.owner.name} onClick={() => onOpen(viewed, viewed.indexOf(g))} />
              ))}
            </div>
          </>
        )}

        {quiet.length > 0 && (
          <>
            <button className="section-title section-toggle" onClick={() => setShowMuted(!showMuted)}>
              {t.mutedUpdates} ({quiet.length}) <Icon name={showMuted ? 'chevronUp' : 'chevronDown'} size={16} />
            </button>
            {showMuted && (
              <div className="status-cards muted-cards">
                {quiet.map((g) => (
                  <StatusCard key={g.owner.uid} group={g} label={g.owner.name} onClick={() => onOpen(quiet, quiet.indexOf(g))} />
                ))}
              </div>
            )}
          </>
        )}

        {groups.length === 0 && <p className="empty">{t.noStatusYet}</p>}
        {groups.length > 0 && shown.length === 0 && <p className="empty">{t.nothingHere}</p>}
      </div>

      {adding && (
        <Popover
          x={adding.x}
          y={adding.y}
          onClose={() => setAdding(null)}
          items={[
            { label: t.photosVideos, icon: 'camera', onClick: onCamera },
            { label: t.textStatus, icon: 'edit', onClick: onWrite },
          ]}
        />
      )}
    </div>
  )
}

// One person's card: their newest status, their photo in a ring, their name.
function StatusCard({ group, label, mine = false, onClick, onAdd }: { group: StatusGroup; label: string; mine?: boolean; onClick: () => void; onAdd?: (e: React.MouseEvent) => void }) {
  const { t } = useT()
  const latest = group.items[group.items.length - 1]
  return (
    <div className="status-card" role="button" tabIndex={0} aria-label={label} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <StatusBackdrop s={latest} small />
      <span className="card-ring">
        <StatusRing total={group.items.length} unseen={mine ? group.items.length : group.unseen}>
          <PersonAvatar uid={group.owner.uid} name={group.owner.name} size={38} />
        </StatusRing>
      </span>
      {mine && onAdd && (
        <button className="plus-badge card-add" aria-label={t.addStatus} onClick={onAdd}>
          <Icon name="plus" size={14} />
        </button>
      )}
      <span className="card-name" dir="auto">
        {label}
      </span>
    </div>
  )
}

// What a status looks like behind a card (and the small squares in "My status"):
// the tiny copy of its photo, or its words on their colour.
export function StatusBackdrop({ s, small = false }: { s: Status; small?: boolean }) {
  if (s.kind === 'text') {
    return (
      <span className="status-backdrop text" style={{ background: STATUS_COLOURS[s.bg ?? 0] ?? STATUS_COLOURS[0], fontFamily: STATUS_FONTS[s.font ?? 0] }}>
        <span dir="auto">{small ? (s.text ?? '').slice(0, 80) : s.text}</span>
      </span>
    )
  }
  return <span className="status-backdrop" style={s.thumb ? { backgroundImage: `url(${s.thumb})` } : undefined} />
}

// The ring around a photo: one piece for each status, green until you've seen it.
export function StatusRing({ total, unseen, children }: { total: number; unseen: number; children: React.ReactNode }) {
  const size = 48
  const r = 22.5
  const round = 2 * Math.PI * r
  const gap = total > 1 ? Math.min(6, round / total / 3) : 0
  const piece = round / total
  return (
    <span className="status-ring">
      {children}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            className={i >= total - unseen ? 'ring-new' : 'ring-seen'}
            strokeDasharray={`${piece - gap} ${round - piece + gap}`}
            strokeDashoffset={-(i * piece) - gap / 2}
          />
        ))}
      </svg>
    </span>
  )
}

// Settings > Privacy > Status, and the Status tab's ⋮ menu: who can see your status updates.
export function StatusPrivacyDialog({ me, prefs, people, onClose }: { me: Person; prefs: StatusPrefs; people: Person[]; onClose: () => void }) {
  const { t } = useT()
  const [picking, setPicking] = useState<'except' | 'only' | null>(null)
  const mode = prefs.mode ?? 'contacts'
  const choices: [StatusMode, string, string][] = [
    ['contacts', t.myContacts, t.myContactsHint],
    ['except', t.myContactsExcept, fill(t.nExcluded, { n: prefs.except?.length ?? 0 })],
    ['only', t.onlyShareWith, fill(t.nIncluded, { n: prefs.only?.length ?? 0 })],
  ]
  function choose(next: StatusMode) {
    if (next === 'contacts') setPrivate(me.uid, 'status', { mode: next }).catch(console.error)
    else setPicking(next)
  }
  return (
    <Modal title={t.statusPrivacy} onClose={onClose} className="narrow">
      <p className="hint">{t.statusPrivacyHint}</p>
      <div className="choices" role="radiogroup">
        {choices.map(([value, label, hint]) => (
          <label key={value} className="choice">
            <input type="radio" name="status-privacy" checked={mode === value} onChange={() => choose(value)} onClick={() => mode === value && choose(value)} />
            <span className="setting-text">
              <span>{label}</span>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="hint">{t.statusPrivacyLater}</p>
      {picking && (
        <PeopleDialog
          title={picking === 'except' ? t.myContactsExcept : t.onlyShareWith}
          hint={picking === 'except' ? t.exceptHint : t.onlyHint}
          people={people}
          picked={prefs[picking]}
          onDone={(uids) => setPrivate(me.uid, 'status', { mode: picking, [picking]: uids }).catch(console.error)}
          onClose={() => setPicking(null)}
        />
      )}
    </Modal>
  )
}
