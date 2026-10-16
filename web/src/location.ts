// location.ts: sharing where you are, like WhatsApp.
//   - Current location: one spot, sent once.
//   - Live location: for 15 minutes, 1 hour or 8 hours, your app keeps moving the pin
//     in the message as you move. On the web this only works while PakChat is open on
//     your device (a website can't run in the background), so the message says when it last moved.
// The phone or computer finds you with "geolocation" (GPS, Wi-Fi or the network). The browser
// asks you first; nobody can see your location unless you send it.
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

export type Spot = { lat: number; lng: number; accuracy: number }
export const LIVE_CHOICES = [15, 60, 480] // minutes

// Where you are now (asks for permission the first time).
export function findMe() {
  return new Promise<Spot>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    )
  })
}

// A link that opens the spot in a maps app or website.
export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

// ---------- Live location ----------
// Which live locations you're sharing from this device. Saved on the device, so if you reload
// PakChat, it carries on (until the time is up).
type Share = { uid: string; chatId: string; messageId: string; until: number }
const KEY = 'liveShares'
let shares: Share[] = load()
let watcher: number | null = null // the browser telling us when you move
let beat: ReturnType<typeof setInterval> | null = null // a save once a minute, even if you stand still
let saving: ReturnType<typeof setTimeout> | null = null // a save waiting to happen
let latest: GeolocationCoordinates | null = null // where the device last said you are
let last = { at: 0, lat: 0, lng: 0 } // the last spot we saved

function load(): Share[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
function store() {
  try {
    localStorage.setItem(KEY, JSON.stringify(shares))
  } catch {
    // not saved: it still works until you reload
  }
}

export function startSharing(share: Share) {
  shares.push(share)
  store()
  watch()
}

// Stop early: the message shows "Live location ended" for everyone.
export async function stopSharing(chatId: string, messageId: string) {
  shares = shares.filter((s) => s.messageId !== messageId)
  store()
  if (shares.length === 0) unwatch()
  await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), { liveUntil: serverTimestamp() })
}

// When PakChat opens: carry on with the shares that still have time left (yours only).
export function resumeSharing(uid: string) {
  shares = shares.filter((s) => s.until > Date.now() && s.uid === uid)
  store()
  if (shares.length) watch()
}

function watch() {
  if (watcher !== null || !navigator.geolocation) return
  watcher = navigator.geolocation.watchPosition((at) => moved(at.coords), (err) => console.warn('Live location:', err.message), {
    enableHighAccuracy: true,
    maximumAge: 10_000,
  })
  beat = setInterval(() => latest && moved(latest), 60_000)
}
function unwatch() {
  if (watcher !== null) navigator.geolocation.clearWatch(watcher)
  if (beat !== null) clearInterval(beat)
  if (saving !== null) clearTimeout(saving)
  watcher = beat = saving = null
}

// The device says where you are. Save it at most once every 10 seconds: if a save was
// a moment ago, wait, then save wherever you are by then.
function moved(coords: GeolocationCoordinates) {
  latest = coords
  saving ??= setTimeout(save, Math.max(0, last.at + 10_000 - Date.now()))
}

// Move the pin in every live location you're sharing. Only if you moved 10 metres or more,
// or it's been about a minute (so the others see "Updated just now" and know it's still on).
function save() {
  saving = null
  const now = Date.now()
  shares = shares.filter((s) => s.until > now)
  store()
  if (shares.length === 0) return unwatch()
  if (!latest) return
  const spot = { lat: latest.latitude, lng: latest.longitude }
  if (metres(last, spot) < 10 && now - last.at < 55_000) return
  last = { at: now, ...spot }
  for (const share of shares) {
    updateDoc(doc(db, 'chats', share.chatId, 'messages', share.messageId), {
      ...spot,
      accuracy: Math.round(latest.accuracy),
      movedAt: serverTimestamp(),
    }).catch(() => {
      // Stopped on another device, or deleted: stop here too.
      shares = shares.filter((s) => s !== share)
      store()
    })
  }
}

// The distance between two spots, in metres (near enough, for short distances).
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * 6_371_000
}
