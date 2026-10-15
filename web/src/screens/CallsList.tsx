// CallsList.tsx: your recent calls, like WhatsApp's Calls tab.
//   ↗  a call you made        ↙ a call you got        a red name: a call you missed
// The phone (or camera) on the right calls that person again.
import { useEffect, useState } from 'react'
import { recentCalls, startCall, type CallRecord } from '../calls'
import type { Person } from '../chats'
import { useT } from '../lang'
import type { Strings } from '../strings'
import { clock, duration, isToday, isYesterday, shortDate } from '../time'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'

export default function CallsList({ me, onBack }: { me: Person; onBack: () => void }) {
  const { t } = useT()
  const [calls, setCalls] = useState<CallRecord[] | null>(null) // null = still loading
  const [failed, setFailed] = useState(false)

  // Loaded once when you open the list (not live), to keep the free plan's reads low.
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
  }, [me.uid])

  return (
    <div className="pane">
      <header className="bar">
        <button className="icon back-always" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2>{t.calls}</h2>
      </header>
      <div className="list">
        {failed && <p className="error pad">{t.somethingWrong}</p>}
        {!calls && !failed && <p className="empty">{t.loading}</p>}
        {calls?.length === 0 && <p className="empty">{t.noCalls}</p>}
        {calls?.map((call) => (
          <CallRow key={call.id} call={call} me={me} />
        ))}
      </div>
    </div>
  )
}

function CallRow({ call, me }: { call: CallRecord; me: Person }) {
  const { t } = useT()
  const outgoing = call.from === me.uid
  const peer: Person = outgoing ? { uid: call.to, name: call.toName } : { uid: call.from, name: call.fromName }
  const answered = call.state === 'accepted' || call.state === 'ended'
  const missed = !outgoing && !answered
  const seconds = call.answeredAt && call.endedAt ? (call.endedAt.toMillis() - call.answeredAt.toMillis()) / 1000 : 0
  const kind = call.video ? t.videoCall : t.voiceCall

  return (
    <div className={missed ? 'row call-row missed' : 'row call-row'}>
      <PersonAvatar uid={peer.uid} name={peer.name} size={46} />
      <span className="row-main">
        <strong dir="auto">{peer.name}</strong>
        <small>
          <Icon name={outgoing ? 'arrowUpRight' : 'arrowDownLeft'} size={15} />
          {when(call.startedAt?.toDate(), t)}
          {seconds > 0 && ` · ${duration(seconds)}`}
        </small>
      </span>
      <button className="icon" aria-label={`${kind}: ${peer.name}`} title={kind} onClick={() => startCall(me, peer, call.video)}>
        <Icon name={call.video ? 'video' : 'phone'} />
      </button>
    </div>
  )
}

// "14:32", "Yesterday, 14:32" or "12 Oct, 14:32"
function when(date: Date | undefined, t: Strings) {
  if (!date) return ''
  const time = clock(date, t.locale)
  if (isToday(date)) return time
  if (isYesterday(date)) return `${t.yesterday}, ${time}`
  return `${shortDate(date, t.locale)}, ${time}`
}
