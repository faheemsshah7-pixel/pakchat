// MyStatus.tsx: the right-hand side of the Status tab on a computer: "My status".
// Add a status (camera or pencil), see your updates from the last 24 hours, how many people
// saw each one, and delete them.
import { useEffect, useState } from 'react'
import type { Person } from '../chats'
import { useT } from '../lang'
import { useAvatar, type Profile } from '../profiles'
import { countViews, deleteStatus, type StatusGroup } from '../status'
import { fill } from '../strings'
import { agoText, useNow } from '../time'
import Avatar from './Avatar'
import Icon from './Icon'
import { StatusBackdrop, StatusRing } from './StatusList'

type Props = { me: Person; profile: Profile; mine: StatusGroup | null; onView: (index: number) => void; onCamera: () => void; onWrite: () => void }

export default function MyStatus({ me, profile, mine, onView, onCamera, onWrite }: Props) {
  const { t } = useT()
  const photo = useAvatar(me.uid, profile.photo)
  const now = useNow(60_000)
  const items = mine?.items ?? []
  const [views, setViews] = useState<Map<string, number>>(new Map())

  // How many saw each one (one cheap count each, when this opens or a new one is posted).
  const ids = items.map((s) => s.id).join(',')
  useEffect(() => {
    let stillHere = true
    for (const id of ids ? ids.split(',') : []) {
      countViews(id)
        .then((n) => stillHere && setViews((old) => new Map(old).set(id, n)))
        .catch(() => {})
    }
    return () => {
      stillHere = false
    }
  }, [ids])

  return (
    <div className="pane my-status">
      <header className="bar">
        <h2>{t.myStatus}</h2>
      </header>
      <div className="list">
        <div className="my-status-card">
          <span className="add-photo" role="button" tabIndex={0} onClick={() => (items.length ? onView(0) : onCamera())}>
            {items.length ? (
              <StatusRing total={items.length} unseen={items.length}>
                <Avatar name={profile.name} size={44} photo={photo} />
              </StatusRing>
            ) : (
              <Avatar name={profile.name} size={48} photo={photo} />
            )}
            <span className="plus-badge">
              <Icon name="plus" size={14} />
            </span>
          </span>
          <span className="row-main">
            <strong>{t.myStatus}</strong>
            <small className="muted">{items.length ? fill(items.length === 1 ? t.oneUpdate : t.nUpdates, { n: items.length }) : t.addStatusHint}</small>
          </span>
          <button className="round-btn soft" aria-label={t.photoStatus} title={t.photoStatus} onClick={onCamera}>
            <Icon name="camera" />
          </button>
          <button className="round-btn soft" aria-label={t.textStatus} title={t.textStatus} onClick={onWrite}>
            <Icon name="edit" />
          </button>
        </div>

        {[...items].reverse().map((s) => (
          <div key={s.id} className="row my-update">
            <button className="update-thumb" aria-label={t.viewStatus} onClick={() => onView(items.indexOf(s))}>
              <StatusBackdrop s={s} small />
            </button>
            <span className="row-main clickable" onClick={() => onView(items.indexOf(s))}>
              <strong>{agoText(s.postedAt?.toDate(), now, t)}</strong>
              <small className="muted views-count">
                <Icon name="eye" size={14} /> {views.get(s.id) ?? '…'}
              </small>
            </span>
            <button
              className="icon"
              aria-label={t.deleteStatus}
              title={t.deleteStatus}
              onClick={() => confirm(t.confirmDeleteStatus) && deleteStatus(s).catch(console.error)}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}

        <p className="hint center status-note">
          <Icon name="lock" size={14} /> {t.statusNote}
        </p>
      </div>
    </div>
  )
}
