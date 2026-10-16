// StatusViewer.tsx: watching statuses, full screen, like WhatsApp.
//   The lines at the top: one for each of this person's statuses, filling up as it plays.
//   Tap the right side (or →) for the next one, the left side (or ←) to go back.
//   Hold your finger (or mouse button) down to pause.
//   Someone else's status: reply to it (it goes to your chat with them), or ♥ like it.
//   Your own: see who viewed it (and who liked it), or delete it.
// When one person's statuses end, the next person's start, until the list is done.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL, useBack } from '../back'
import type { Person } from '../chats'
import { useT } from '../lang'
import { loadParts, loadPartsUrl } from '../media'
import {
  deleteStatus,
  likeStatus,
  listenToViews,
  markSeen,
  muteStatus,
  PHOTO_SECONDS,
  STATUS_COLOURS,
  STATUS_FONTS,
  statusPlace,
  statusTextSize,
  useStatusMarks,
  type Status,
  type StatusGroup,
  type StatusView,
} from '../status'
import { useStable } from '../stable'
import { agoText, clock, useNow } from '../time'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'
import Popover from './Popover'

type Props = {
  me: Person
  groups: StatusGroup[] // everyone's statuses, kept up to date
  order: string[] // the people to go through (their uids), in order
  startItem?: number // which of the first person's statuses to start at (else the first one you haven't seen)
  muted: string[]
  onClose: () => void
  onReply: (s: Status, text: string) => Promise<void>
}

// The first status in a group that you haven't seen yet (or the first, if you've seen them all).
function firstUnseen(group: StatusGroup | undefined, seen: Set<string>) {
  const i = group?.items.findIndex((s) => !seen.has(s.id)) ?? -1
  return Math.max(0, i)
}

// How long words stay up: longer for more words.
const textMs = (text = '') => Math.min(12_000, Math.max(4_000, 2_500 + text.length * 60))

export default function StatusViewer({ me, groups, order, startItem, muted, onClose, onReply }: Props) {
  const { t } = useT()
  const marks = useStatusMarks()
  const now = useNow(30_000)
  const [at, setAt] = useState(() => ({ person: 0, item: startItem ?? firstUnseen(groups.find((g) => g.owner.uid === order[0]), marks.seen), round: 0 }))
  const [media, setMedia] = useState<{ id: string; url: string } | null>(null)
  const [held, setHeld] = useState(false)
  const [typing, setTyping] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showViews, setShowViews] = useState(false)
  const [seenBy, setSeenBy] = useState<{ id: string; views: StatusView[] } | null>(null)
  const [reply, setReply] = useState('')
  const [toast, setToast] = useState('')
  const [hidden, setHidden] = useState(document.visibilityState === 'hidden')
  const bar = useRef<HTMLSpanElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const pressed = useRef(0)
  const elapsed = useRef(0)

  const group = groups.find((g) => g.owner.uid === order[at.person])
  const item = group ? Math.min(at.item, group.items.length - 1) : 0
  const s: Status | undefined = group?.items[item]
  const mine = group?.owner.uid === me.uid
  const key = s ? `${s.id}:${at.round}` : ''
  const ready = !!s && (s.kind === 'text' || media?.id === s.id)
  const paused = held || typing || !!menu || showViews || hidden
  const liked = !!s && marks.liked.has(s.id)

  useBack(true, LEVEL.cover, onClose)

  // ----- moving along -----
  const next = useStable(() => {
    if (!group) return onClose()
    if (item + 1 < group.items.length) return setAt({ ...at, item: item + 1 })
    for (let p = at.person + 1; p < order.length; p++) {
      const g = groups.find((x) => x.owner.uid === order[p])
      if (g) return setAt({ person: p, item: firstUnseen(g, marks.seen), round: at.round })
    }
    onClose()
  })
  const prev = useStable(() => {
    if (item > 0) return setAt({ ...at, item: item - 1 })
    for (let p = at.person - 1; p >= 0; p--) {
      if (groups.some((x) => x.owner.uid === order[p])) return setAt({ person: p, item: 0, round: at.round })
    }
    setAt({ ...at, round: at.round + 1 }) // the very first one: start it again
  })

  // Everything was deleted (or ran out of time) while you watched: close.
  useEffect(() => {
    if (!s) onClose()
  }, [s, onClose])

  // ----- its photo or video -----
  const sid = s?.id
  const skind = s?.kind
  const smedia = s?.mediaId
  useEffect(() => {
    if (!sid || skind === 'text' || !smedia) return
    let stillHere = true
    const load = skind === 'video' ? loadPartsUrl : loadParts
    load(statusPlace(sid), smedia)
      .then((url) => stillHere && setMedia({ id: sid, url }))
      .catch((err) => {
        console.warn(err)
        if (stillHere) setMedia({ id: sid, url: '' }) // (shows the small copy, and moves on)
      })
    return () => {
      stillHere = false
    }
  }, [sid, skind, smedia])

  // Seen it (they'll see your name in "Viewed by").
  useEffect(() => {
    if (s && ready) markSeen(me, s)
  }, [s, ready, me])

  // ----- the timer for words and photos (videos time themselves) -----
  const total = !s ? 0 : s.kind === 'text' ? textMs(s.text) : PHOTO_SECONDS * 1000
  useEffect(() => {
    elapsed.current = 0
    if (bar.current) bar.current.style.transform = 'scaleX(0)'
  }, [key])
  useEffect(() => {
    if (!key || skind === 'video' || !ready || paused) return
    let last = performance.now()
    let frame = 0
    const step = (time: number) => {
      elapsed.current += time - last
      last = time
      const done = Math.min(1, elapsed.current / total)
      if (bar.current) bar.current.style.transform = `scaleX(${done})`
      if (done >= 1) next()
      else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [key, skind, ready, paused, total, next])

  // Videos pause too.
  useEffect(() => {
    const v = video.current
    if (!v || !ready) return
    if (paused) v.pause()
    else
      v.play().catch(() => {
        v.muted = true // (a browser that won't play sound yet still plays the picture)
        v.play().catch(() => {})
      })
  }, [paused, ready, key])

  // Pause while PakChat isn't on screen.
  useEffect(() => {
    const onVisible = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // The arrow keys move along; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'Escape' && showViews) setShowViews(false) // (Esc closes the top thing first)
      else if (e.key === 'Escape' && !menu) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [next, prev, onClose, showViews, menu])

  // Your own status: who saw it, live.
  useEffect(() => {
    if (!mine || !sid) return
    return listenToViews(sid, (views) => setSeenBy({ id: sid, views }))
  }, [mine, sid])
  const views = seenBy && seenBy.id === sid ? seenBy.views : []

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2000)
    return () => clearTimeout(timer)
  }, [toast])

  if (!s || !group) return null

  // A quick tap on the left third goes back, anywhere else goes on. Holding pauses.
  function release(e: React.PointerEvent) {
    setHeld(false)
    if (Date.now() - pressed.current > 300 || e.button !== 0) return
    const r = stage.current!.getBoundingClientRect()
    const rtl = getComputedStyle(stage.current!).direction === 'rtl'
    const left = e.clientX - r.left < r.width / 3
    if (left !== rtl) prev()
    else next()
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = reply.trim()
    if (!text || !s) return
    setReply('')
    try {
      await onReply(s, text)
      setToast(t.replySent)
    } catch (err) {
      console.error(err)
      setToast(t.somethingWrong)
    }
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const menuItems = mine
    ? [{ label: t.deleteStatus, icon: 'trash' as const, danger: true, onClick: () => confirm(t.confirmDeleteStatus) && deleteStatus(s).catch(console.error) }]
    : muted.includes(group.owner.uid)
      ? [{ label: t.unmute, icon: 'bell' as const, onClick: () => muteStatus(me.uid, group.owner.uid, false).catch(console.error) }]
      : [{ label: t.mute, icon: 'bellOff' as const, onClick: () => muteStatus(me.uid, group.owner.uid, true).catch(console.error) }]

  return createPortal(
    <div className="status-viewer" role="dialog" aria-label={mine ? t.myStatus : group.owner.name}>
      <div className="status-column">
        <div className="status-bars">
          {group.items.map((x, i) => (
            <span key={x.id} className="seg">
              <span
                className={x.kind === 'video' && i === item ? 'fill video' : 'fill'}
                ref={i === item ? bar : undefined}
                style={i < item ? { transform: 'scaleX(1)' } : i > item ? { transform: 'scaleX(0)' } : undefined}
              />
            </span>
          ))}
        </div>
        <header className="status-head">
          <button className="icon" aria-label={t.close} onClick={onClose}>
            <Icon name="back" />
          </button>
          <PersonAvatar uid={group.owner.uid} name={group.owner.name} size={40} />
          <span className="row-main">
            <strong dir="auto">{mine ? t.myStatus : group.owner.name}</strong>
            <small>{agoText(s.postedAt?.toDate(), now, t)}</small>
          </span>
          <button
            className="icon"
            aria-label={t.menu}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.left - 160, y: r.bottom + 4 })
            }}
          >
            <Icon name="dots" />
          </button>
        </header>

        <div
          ref={stage}
          className={'status-stage ' + s.kind}
          style={s.kind === 'text' ? { background: STATUS_COLOURS[s.bg ?? 0] ?? STATUS_COLOURS[0] } : undefined}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            pressed.current = Date.now()
            setHeld(true)
          }}
          onPointerUp={release}
          onPointerCancel={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {s.kind === 'text' && (
            <p dir="auto" style={{ fontFamily: STATUS_FONTS[s.font ?? 0], fontSize: statusTextSize(s.text) }}>
              {s.text}
            </p>
          )}
          {s.kind !== 'text' && !ready && (
            <>
              {s.thumb && <img className="status-thumb" src={s.thumb} alt="" />}
              <span className="spinner" />
            </>
          )}
          {s.kind === 'photo' && ready && <img src={media?.url || s.thumb} alt="" draggable={false} />}
          {s.kind === 'video' && ready && (
            <video
              key={key}
              ref={video}
              src={media?.url || undefined}
              poster={s.thumb}
              playsInline
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                if (bar.current && v.duration) bar.current.style.transform = `scaleX(${Math.min(1, v.currentTime / v.duration)})`
              }}
              onEnded={next}
              onError={() => setTimeout(next, 3000)}
            />
          )}
          {held && <span className="status-paused" aria-hidden />}
        </div>

        {s.caption && (
          <p className="status-caption" dir="auto">
            {s.caption}
          </p>
        )}

        {mine ? (
          <button className="views-btn" onClick={() => setShowViews(true)} aria-label={t.viewedBy}>
            <Icon name="eye" size={20} /> {views.length}
          </button>
        ) : (
          <form className="status-reply" onSubmit={send}>
            <input
              dir="auto"
              placeholder={t.replyToStatus}
              aria-label={t.replyToStatus}
              value={reply}
              maxLength={4000}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
            />
            {reply.trim() ? (
              <button className="round-btn" aria-label={t.send} title={t.send}>
                <Icon name="send" />
              </button>
            ) : (
              <button
                type="button"
                className={liked ? 'icon like on' : 'icon like'}
                aria-label={liked ? t.unlike : t.like}
                aria-pressed={liked}
                title={liked ? t.unlike : t.like}
                onClick={() => likeStatus(me, s, !liked).catch(console.warn)}
              >
                <Icon name={liked ? 'heartFilled' : 'heart'} />
              </button>
            )}
          </form>
        )}
        {toast && <p className="toast">{toast}</p>}
      </div>

      {/* On a computer: arrows either side */}
      <button className="icon status-prev" aria-label={t.previous} onClick={prev}>
        <Icon name="chevronLeft" size={30} />
      </button>
      <button className="icon status-next" aria-label={t.next} onClick={next}>
        <Icon name="chevronRight" size={30} />
      </button>

      {showViews && <ViewsSheet views={views} onClose={() => setShowViews(false)} />}
      {menu && <Popover x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>,
    document.body,
  )
}

// "Viewed by 3": who saw your status, newest first, with a ♥ if they liked it.
function ViewsSheet({ views, onClose }: { views: StatusView[]; onClose: () => void }) {
  const { t } = useT()
  useBack(true, LEVEL.window, onClose)
  return (
    <div className="views-sheet" role="dialog" aria-label={t.viewedBy}>
      <header>
        <h3>
          {t.viewedBy} {views.length}
        </h3>
        <button className="icon" aria-label={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="list">
        {views.length === 0 && <p className="empty">{t.noViewsYet}</p>}
        {views.map((view) => (
          <div key={view.uid} className="row">
            <PersonAvatar uid={view.uid} name={view.name} size={42} />
            <span className="row-main">
              <strong dir="auto">{view.name}</strong>
              <small className="muted">{view.at ? clock(view.at.toDate(), t.locale) : ''}</small>
            </span>
            {view.liked && (
              <span className="liked" aria-label={t.liked}>
                <Icon name="heartFilled" size={18} />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
