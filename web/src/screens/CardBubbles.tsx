// CardBubbles.tsx: a location (a small map), a contact card and a scheduled call, inside a chat bubble.
import type { Message, SharedContact } from '../chats'
import { useClockAt } from '../disappearing'
import { useT } from '../lang'
import { mapsLink, stopSharing } from '../location'
import { fill } from '../strings'
import { clock, dayAndTime, useNow } from '../time'
import Avatar, { PersonAvatar } from './Avatar'
import Icon from './Icon'

const TILE = 256 // OpenStreetMap's map pictures ("tiles") are 256 × 256 pixels

// A small map with a pin in the middle, made from OpenStreetMap's tiles (free, no key needed).
// The world is cut into 2^zoom × 2^zoom tiles. We work out where the spot is in pixels,
// then put the few tiles around it in place, like a jigsaw.
export function MapPreview({ lat, lng, width, height, zoom = 15 }: { lat: number; lng: number; width: number; height: number; zoom?: number }) {
  const n = 2 ** zoom
  const rad = (lat * Math.PI) / 180
  const x = ((lng + 180) / 360) * n * TILE
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * TILE
  const left = x - width / 2
  const top = y - height / 2
  const tiles = []
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue
      const wrapped = ((tx % n) + n) % n // (the map repeats sideways)
      tiles.push(
        <img
          key={`${tx},${ty}`}
          src={`https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`}
          style={{ left: tx * TILE - left, top: ty * TILE - top }}
          alt=""
          draggable={false}
        />,
      )
    }
  }
  return (
    <span className="map" style={{ width, height }}>
      {tiles}
      <span className="map-pin">
        <Icon name="mapPin" size={30} />
      </span>
      <small className="map-credit">© OpenStreetMap</small>
    </span>
  )
}

// A location in a chat. Tap the map to open it in Google Maps.
// A live one also says until when, and when it last moved; the person sharing it can stop.
export function LocationBubble({ chatId, m, mine }: { chatId: string; m: Message; mine: boolean }) {
  const { t } = useT()
  const until = m.liveUntil?.toMillis() ?? 0
  // The time now: every 30 seconds (for "Updated 2 min ago"), and right when sharing ends
  // (on time, or straight away when it's stopped early).
  const now = Math.max(useNow(30_000), useClockAt([until]))
  const live = !!m.live && until > now
  const moved = (m.movedAt ?? m.sentAt)?.toMillis() ?? now
  const minutes = Math.floor((now - moved) / 60_000)
  return (
    <div className="location">
      <a className="map-link" href={mapsLink(m.lat ?? 0, m.lng ?? 0)} target="_blank" rel="noreferrer" aria-label={t.openMap}>
        <MapPreview lat={m.lat ?? 0} lng={m.lng ?? 0} width={280} height={150} />
      </a>
      {m.live && (
        <div className="live-row">
          <span className={live ? 'live-dot on' : 'live-dot'} />
          <span className="live-words">
            <strong>{live ? t.liveLocation : t.liveEnded}</strong>
            {live && (
              <small>
                {fill(t.liveUntil, { time: clock(new Date(until), t.locale) })} · {minutes < 1 ? t.updatedJustNow : fill(t.updatedAgo, { n: minutes })}
              </small>
            )}
          </span>
          {mine && live && (
            <button type="button" className="btn small secondary danger" onClick={() => stopSharing(chatId, m.id).catch(console.error)}>
              {t.stopSharing}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// A contact card: their photo, name and number, and a button to message them.
export function ContactBubble({ contact, onMessage }: { contact: SharedContact; onMessage: (contact: SharedContact) => void }) {
  const { t } = useT()
  return (
    <div className="contact-card">
      <div className="contact-top">
        {contact.uid ? <PersonAvatar uid={contact.uid} name={contact.name} size={46} /> : <Avatar name={contact.name} size={46} />}
        <span className="contact-words">
          <strong dir="auto">{contact.name}</strong>
          <small dir="ltr">{contact.phone ?? contact.email ?? ''}</small>
        </span>
      </div>
      <button type="button" className="contact-action" onClick={() => onMessage(contact)}>
        {t.message}
      </button>
    </div>
  )
}

// A call planned for later (Calls > Schedule call): its name, when, and a button to call.
export function ScheduledCallBubble({ m, onCall }: { m: Message; onCall?: (video: boolean) => void }) {
  const { t } = useT()
  const when = m.startsAt?.toDate()
  return (
    <div className={m.cancelled ? 'plan-card cancelled' : 'plan-card'}>
      <div className="contact-top">
        <span className="call-icon">
          <Icon name="calendar" size={20} />
        </span>
        <span className="contact-words">
          <small>{t.scheduledCall}</small>
          <strong dir="auto">{m.text}</strong>
          <small>
            {when ? dayAndTime(when, t.locale) : ''} · {m.video ? t.videoCall : t.voiceCall}
          </small>
        </span>
      </div>
      {m.cancelled ? (
        <p className="plan-cancelled">{t.callCancelled}</p>
      ) : (
        <button type="button" className="contact-action" disabled={!onCall} onClick={() => onCall?.(!!m.video)}>
          <Icon name={m.video ? 'video' : 'phone'} size={16} /> {t.call}
        </button>
      )}
    </div>
  )
}
