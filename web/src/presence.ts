// presence.ts: "online" and "last seen".
//
// While PakChat is open on your screen, it writes the time into
// users/<you>.lastSeen once a minute (a "heartbeat").
// Your friend's app reads that time:
//   less than 90 seconds old -> "online"
//   older                    -> "last seen today at 1:43 PM"
import { doc, serverTimestamp, updateDoc, type Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { fill, type Strings } from './strings'
import { clock, isToday, isYesterday, shortDate } from './time'

// Starts the heartbeat. Returns a function that stops it (React calls it on log out).
export function startHeartbeat(uid: string) {
  const beat = () => {
    updateDoc(doc(db, 'users', uid), { lastSeen: serverTimestamp() }).catch(console.error)
  }
  const beatIfVisible = () => {
    if (document.visibilityState === 'visible') beat()
  }
  beat()
  const timer = setInterval(beatIfVisible, 60_000)
  // Also beat when you switch tabs, so "last seen" is the moment you left.
  document.addEventListener('visibilitychange', beat)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', beat)
  }
}

export function presenceText(lastSeen: Timestamp | null | undefined, now: number, t: Strings) {
  if (!lastSeen) return ''
  if (now - lastSeen.toMillis() < 90_000) return t.online
  const date = lastSeen.toDate()
  const time = clock(date, t.locale)
  if (isToday(date)) return fill(t.lastSeenToday, { time })
  if (isYesterday(date)) return fill(t.lastSeenYesterday, { time })
  return fill(t.lastSeenDate, { date: shortDate(date, t.locale) })
}
