// CallsList.tsx: the Calls tab, like WhatsApp's.
//   Search      find someone in your calls, or type a number to call it
//   Favourites  people you call a lot: call them with one tap ("Add favourite" to add more)
//   Upcoming    calls you scheduled (or someone scheduled with you)
//   Recent      your last calls. Calls in a row with the same person on the same day share
//               one line: "Maaz (3)". A red name is a call you missed. Tap one for its details.
// On a computer the big buttons (Start call, Call link, Call a number, Schedule call) are on the
// right (CallsMain.tsx); on a phone they're at the top of this list.
import { useEffect, useState } from 'react'
import { recentCalls, startCall, type CallRecord } from '../calls'
import { cancelScheduledCall, directionText, groupCalls, isUpcoming, removeFavourite, scheduledWith, type CallGroup, type ScheduledCall } from '../callExtras'
import { findUser, type Person } from '../chats'
import { useT } from '../lang'
import type { CallPrefs } from '../private'
import { dayAndTime, dayOrTime, useNow } from '../time'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'

// What the big buttons do (Home.tsx opens the window for each).
export type CallAction = 'start' | 'link' | 'dial' | 'schedule'

type Props = {
  me: Person
  prefs: CallPrefs
  plans: ScheduledCall[]
  reload: number // goes up when a call ends, so the list loads again
  selected: string | null // the key of the group whose details are open
  onSelect: (group: CallGroup) => void
  onAction: (action: CallAction) => void
  onAddFavourite: () => void
}

export default function CallsList({ me, prefs, plans, reload, selected, onSelect, onAction, onAddFavourite }: Props) {
  const { t } = useT()
  const [calls, setCalls] = useState<CallRecord[] | null>(null) // null = still loading
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const now = useNow(60_000)

  // Loaded when you open the tab and after each call (not live), to keep the free plan's reads low.
  useEffect(() => {
    let stillHere = true
    recentCalls(me.uid)
      .then((list) => stillHere && setCalls(list))
      .catch((err) => {
        console.error(err)
        if (stillHere) setFailed(true)
      })
    return () => {
      stillHere = false
    }
  }, [me.uid, reload])

  const q = search.trim().toLowerCase()
  const looksLikeNumber = q.includes('@') ? q.includes('.') : q.replace(/\D/g, '').length >= 10
  const matches = (name: string) => !q || name.toLowerCase().includes(q)
  const favourites = (prefs.favourites ?? []).filter((p) => matches(p.name))
  const upcoming = plans.filter((plan) => isUpcoming(plan, now) && matches(scheduledWith(plan, me.uid).name))
  const groups = groupCalls(calls ?? [], me.uid).filter((g) => matches(g.peer.name))

  // Typed a number: find who has it, and call them.
  async function callNumber(video: boolean) {
    setError('')
    try {
      const person = await findUser(search)
      if (!person) return setError(t.notOnPakChat)
      if (person.uid === me.uid) return setError(t.ownNumber)
      setSearch('')
      startCall(me, person, video)
    } catch (err) {
      console.error(err)
      setError(t.somethingWrong)
    }
  }

  const actions: [CallAction, 'phone' | 'videoLink' | 'dialpad' | 'calendar', string][] = [
    ['start', 'phone', t.call],
    ['link', 'videoLink', t.callLink],
    ['dial', 'dialpad', t.keypad],
    ['schedule', 'calendar', t.schedule],
  ]

  return (
    <div className="pane calls-pane">
      <header className="bar">
        <h2>{t.calls}</h2>
      </header>
      <div className="newchat">
        <div className="field">
          <Icon name="search" size={20} />
          <input placeholder={t.searchCalls} aria-label={t.searchCalls} value={search} onChange={(e) => (setSearch(e.target.value), setError(''))} />
          {search && (
            <button type="button" className="icon small" aria-label={t.close} onClick={() => setSearch('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
      {error && <p className="error pad">{error}</p>}

      <div className="list">
        {/* Phones: the big buttons go here (index.css hides them on a computer) */}
        <div className="call-actions phone-only">
          {actions.map(([action, icon, label]) => (
            <button key={action} onClick={() => onAction(action)}>
              <span>
                <Icon name={icon} />
              </span>
              {label}
            </button>
          ))}
        </div>

        {looksLikeNumber && (
          <div className="row call-number">
            <span className="avatar accent">
              <Icon name="dialpad" />
            </span>
            <span className="row-main">
              <strong>{t.callThisNumber}</strong>
              <small className="muted" dir="ltr">
                {search.trim()}
              </small>
            </span>
            <button className="icon" aria-label={t.voiceCall} title={t.voiceCall} onClick={() => callNumber(false)}>
              <Icon name="phone" />
            </button>
            <button className="icon" aria-label={t.videoCall} title={t.videoCall} onClick={() => callNumber(true)}>
              <Icon name="video" />
            </button>
          </div>
        )}

        <p className="section-title">{t.favourites}</p>
        {favourites.map((person) => (
          <div key={person.uid} className="row favourite-row">
            <PersonAvatar uid={person.uid} name={person.name} size={46} />
            <strong className="row-main" dir="auto">
              {person.name}
            </strong>
            <button className="icon" aria-label={`${t.voiceCall}: ${person.name}`} title={t.voiceCall} onClick={() => startCall(me, person, false)}>
              <Icon name="phone" />
            </button>
            <button className="icon" aria-label={`${t.videoCall}: ${person.name}`} title={t.videoCall} onClick={() => startCall(me, person, true)}>
              <Icon name="video" />
            </button>
            <button className="icon small faint" aria-label={`${t.removeFavourite}: ${person.name}`} title={t.removeFavourite} onClick={() => removeFavourite(me.uid, prefs, person.uid)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        {!q && (
          <button className="row add-favourite" onClick={onAddFavourite}>
            <span className="avatar plus">
              <Icon name="plus" />
            </span>
            <strong className="row-main">{t.addFavourite}</strong>
          </button>
        )}

        {upcoming.length > 0 && <p className="section-title">{t.upcoming}</p>}
        {upcoming.map((plan) => {
          const peer = scheduledWith(plan, me.uid)
          const started = plan.startsAt.toMillis() <= now
          return (
            <div key={plan.id} className={started ? 'row plan-row now' : 'row plan-row'}>
              <span className="avatar plan-icon">
                <Icon name="calendar" />
              </span>
              <span className="row-main">
                <strong dir="auto">{plan.title}</strong>
                <small dir="auto">
                  {peer.name} · {started ? t.startedNow : dayAndTime(plan.startsAt.toDate(), t.locale)}
                </small>
              </span>
              <button
                className="icon accent"
                aria-label={`${plan.video ? t.videoCall : t.voiceCall}: ${peer.name}`}
                title={plan.video ? t.videoCall : t.voiceCall}
                onClick={() => startCall(me, peer, plan.video)}
              >
                <Icon name={plan.video ? 'video' : 'phone'} />
              </button>
              {plan.by === me.uid && (
                <button
                  className="icon small faint"
                  aria-label={`${t.cancelCall}: ${plan.title}`}
                  title={t.cancelCall}
                  onClick={() => confirm(t.confirmCancelCall) && cancelScheduledCall(plan).catch(console.error)}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          )
        })}

        <p className="section-title">{t.recent}</p>
        {failed && <p className="error pad">{t.somethingWrong}</p>}
        {!calls && !failed && <p className="empty">{t.loading}</p>}
        {calls?.length === 0 && <p className="empty">{t.noCalls}</p>}
        {groups.map((group) => (
          <CallRow key={group.key} group={group} active={group.key === selected} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function CallRow({ group, active, onSelect }: { group: CallGroup; active: boolean; onSelect: (group: CallGroup) => void }) {
  const { t } = useT()
  const first = group.calls[0] // (the newest)
  const classes = ['row', 'call-row', group.missed && 'missed', active && 'active'].filter(Boolean).join(' ')
  return (
    <button className={classes} onClick={() => onSelect(group)}>
      <PersonAvatar uid={group.peer.uid} name={group.peer.name} size={46} />
      <span className="row-main">
        <strong dir="auto">
          {group.peer.name}
          {group.calls.length > 1 && ` (${group.calls.length})`}
        </strong>
        <small>
          <Icon name={group.outgoing ? 'arrowUpRight' : 'arrowDownLeft'} size={15} />
          {directionText(group, t)}
          {group.video && <Icon name="video" size={15} />}
        </small>
      </span>
      <time>{dayOrTime(first.startedAt?.toDate(), t.locale, t.yesterday)}</time>
    </button>
  )
}
