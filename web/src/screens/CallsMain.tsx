// CallsMain.tsx: the right-hand side of the Calls tab on a computer.
//   Nothing picked: four big buttons, like WhatsApp's: Start call, New call link,
//   Call a number, Schedule call.
//   A call picked in the list: its details (CallInfo), with buttons to message or call them again.
//   (A group call: the group's, with who joined each call.)
// (On a phone, the details fill the screen, and the big buttons are at the top of the list.)
import { startCall } from '../calls'
import { addFavourite, directionText, removeFavourite, type CallGroup, type RecentCall } from '../callExtras'
import type { Chat, Person } from '../chats'
import { startGroupCall } from '../groupCalls'
import { useT } from '../lang'
import type { CallPrefs } from '../private'
import { fill, type Strings } from '../strings'
import { clock, duration } from '../time'
import { CallAvatar, type CallAction } from './CallsList'
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

// onMessage: open your chat with them (or the group's chat)
type InfoProps = { me: Person; group: CallGroup; chats: Chat[]; prefs: CallPrefs; onBack: () => void; onMessage: (person: Person) => void }

export function CallInfo({ me, group, chats, prefs, onBack, onMessage }: InfoProps) {
  const { t } = useT()
  const { peer, inGroup } = group
  const chat = inGroup ? chats.find((c) => c.id === peer.uid) : undefined // (missing if you left the group)
  const favourite = (prefs.favourites ?? []).some((p) => p.uid === peer.uid)
  const call = (video: boolean) => (inGroup ? chat && startGroupCall(me, chat, video) : startCall(me, peer, video))
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
          <CallAvatar group={group} chat={chat} size={110} />
          <h3 dir="auto">{peer.name}</h3>
          {(!inGroup || chat) && (
            <div className="hero-actions">
              <button onClick={() => onMessage(peer)}>
                <Icon name="chat" />
                {t.message}
              </button>
              <button onClick={() => call(false)}>
                <Icon name="phone" />
                {t.voiceCall}
              </button>
              <button onClick={() => call(true)}>
                <Icon name="video" />
                {t.videoCall}
              </button>
            </div>
          )}
        </div>
        <section className="info-section">
          <p className="section-title">{day ? day.toLocaleDateString(t.locale, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</p>
          {group.calls.map((call) => {
            const seconds = call.answeredAt && call.endedAt ? (call.endedAt.toMillis() - call.answeredAt.toMillis()) / 1000 : 0
            const kind = inGroup ? (call.video ? t.groupVideoCall : t.groupVoiceCall) : call.video ? t.videoCall : t.voiceCall
            return (
              <div key={call.id} className={group.missed ? 'row call-detail missed' : 'row call-detail'}>
                <Icon name={group.outgoing ? 'arrowUpRight' : 'arrowDownLeft'} size={18} />
                <span className="row-main">
                  <strong>
                    {directionText(group, t)} · {kind}
                  </strong>
                  <small>{call.startedAt ? clock(call.startedAt.toDate(), t.locale) : ''}</small>
                  {inGroup && <small className="who-joined">{whoJoined(call, me.uid, t)}</small>}
                </span>
                <small className="muted">{seconds > 0 ? duration(seconds) : inGroup ? '' : endText(call.state, group.outgoing, t)}</small>
              </div>
            )
          })}
        </section>
        {!inGroup && (
          <section className="info-section">
            <button
              className="row action"
              onClick={() => (favourite ? removeFavourite(me.uid, prefs, peer.uid) : addFavourite(me.uid, prefs, peer)).catch(console.error)}
            >
              <Icon name={favourite ? 'heartFilled' : 'heart'} />
              <span className="row-main">{favourite ? t.removeFavourite : t.addToFavourites}</span>
            </button>
          </section>
        )}
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

// A group call: who else was in it. "Joined: Ali, Sara" (or "Nobody joined").
// (Calls from before Batch 10 don't say, so nothing is shown.)
function whoJoined(call: RecentCall, myUid: string, t: Strings) {
  const came = call.group?.came
  if (!came) return ''
  const others = came.filter((uid) => uid !== myUid).map((uid) => call.group?.names[uid] ?? '?')
  return others.length ? fill(t.whoJoined, { names: others.join(', ') }) : t.nobodyJoined
}
