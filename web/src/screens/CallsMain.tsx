// CallsMain.tsx: the right-hand side of the Calls tab on a computer.
//   Nothing picked: four big buttons, like WhatsApp's: Start call, New call link,
//   Call a number, Schedule call.
//   A call picked in the list: its details (CallInfo), with buttons to message or call them again.
// (On a phone, the details fill the screen, and the big buttons are at the top of the list.)
import { startCall } from '../calls'
import { addFavourite, directionText, removeFavourite, type CallGroup } from '../callExtras'
import type { Person } from '../chats'
import { useT } from '../lang'
import type { CallPrefs } from '../private'
import type { Strings } from '../strings'
import { clock, duration } from '../time'
import { PersonAvatar } from './Avatar'
import type { CallAction } from './CallsList'
import Icon from './Icon'

export function CallsHome({ onAction }: { onAction: (action: CallAction) => void }) {
  const { t } = useT()
  const tiles: [CallAction, 'video' | 'videoLink' | 'dialpad' | 'calendar', string][] = [
    ['start', 'video', t.startCall],
    ['link', 'videoLink', t.newCallLink],
    ['dial', 'dialpad', t.callANumber],
    ['schedule', 'calendar', t.scheduleCall],
  ]
  return (
    <div className="pane calls-home">
      <div className="call-tiles">
        {tiles.map(([action, icon, label]) => (
          <button key={action} className={'call-tile tile-' + action} onClick={() => onAction(action)}>
            <span>
              <Icon name={icon} size={30} />
            </span>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

type InfoProps = { me: Person; group: CallGroup; prefs: CallPrefs; onBack: () => void; onMessage: (person: Person) => void }

export function CallInfo({ me, group, prefs, onBack, onMessage }: InfoProps) {
  const { t } = useT()
  const { peer } = group
  const favourite = (prefs.favourites ?? []).some((p) => p.uid === peer.uid)
  const day = group.calls[0].startedAt?.toDate()
  return (
    <div className="pane call-info">
      <header className="bar">
        <button className="icon back" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{t.callInfo}</h2>
      </header>
      <div className="list">
        <div className="info-hero">
          <PersonAvatar uid={peer.uid} name={peer.name} size={110} />
          <h3 dir="auto">{peer.name}</h3>
          <div className="hero-actions">
            <button onClick={() => onMessage(peer)}>
              <Icon name="chat" />
              {t.message}
            </button>
            <button onClick={() => startCall(me, peer, false)}>
              <Icon name="phone" />
              {t.voiceCall}
            </button>
            <button onClick={() => startCall(me, peer, true)}>
              <Icon name="video" />
              {t.videoCall}
            </button>
          </div>
        </div>
        <section className="info-section">
          <p className="section-title">{day ? day.toLocaleDateString(t.locale, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</p>
          {group.calls.map((call) => {
            const seconds = call.answeredAt && call.endedAt ? (call.endedAt.toMillis() - call.answeredAt.toMillis()) / 1000 : 0
            return (
              <div key={call.id} className={group.missed ? 'row call-detail missed' : 'row call-detail'}>
                <Icon name={group.outgoing ? 'arrowUpRight' : 'arrowDownLeft'} size={18} />
                <span className="row-main">
                  <strong>
                    {directionText(group, t)} · {call.video ? t.videoCall : t.voiceCall}
                  </strong>
                  <small>{call.startedAt ? clock(call.startedAt.toDate(), t.locale) : ''}</small>
                </span>
                <small className="muted">{seconds > 0 ? duration(seconds) : endText(call.state, group.outgoing, t)}</small>
              </div>
            )
          })}
        </section>
        <section className="info-section">
          <button
            className="row action"
            onClick={() => (favourite ? removeFavourite(me.uid, prefs, peer.uid) : addFavourite(me.uid, prefs, peer)).catch(console.error)}
          >
            <Icon name={favourite ? 'heartFilled' : 'heart'} />
            <span className="row-main">{favourite ? t.removeFavourite : t.addToFavourites}</span>
          </button>
        </section>
      </div>
    </div>
  )
}

// Why a call that never started didn't: "Not answered", "Declined", "Busy"...
function endText(state: string, outgoing: boolean, t: Strings) {
  if (state === 'declined') return t.callDeclined
  if (state === 'busy') return t.callBusy
  if (state === 'cancelled') return outgoing ? t.callCancelled : t.missed
  return outgoing ? t.callNoAnswer : t.missed
}
