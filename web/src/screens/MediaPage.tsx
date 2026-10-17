// MediaPage.tsx: "Media, links and docs" for one chat, like WhatsApp's. Three tabs:
//   Media   photos, videos and GIFs in small squares, by month ("This month", "September").
//           Tap one to see it full screen, and move through them all (MediaViewer.tsx).
//   Links   every message with a web address: its card (picture and title) when it has one.
//   Docs    documents: tap one to save it.
// At the end: how many there are ("12 photos, 3 videos").
// The messages come from shared.ts, a page at a time; the next page loads as you scroll down.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import { LEVEL, useBack } from '../back'
import type { Message } from '../chats'
import { useT } from '../lang'
import { belongs, byMonth, linkIn, loadShared, type SharedTab } from '../shared'
import { fill, type Strings } from '../strings'
import { dayLabel, useNow } from '../time'
import Icon, { type IconName } from './Icon'
import { FileBubble } from './MediaBubbles'
import { Thumb, type ViewMedia } from './MediaGrid'

type Props = {
  chatId: string
  title: string // the chat's name
  myUid: string
  clearedAt: number // after "Clear chat", only newer ones
  hidden?: string[] // messages you deleted for yourself
  loaded: Message[] // what the chat has loaded (for links in messages from before Batch 10)
  startTab: SharedTab
  onBack: () => void
  onView: ViewMedia
}

// What's loaded of one tab so far.
type Pages = { items: Message[]; last?: QueryDocumentSnapshot; more: boolean; failed?: boolean }
const TABS: SharedTab[] = ['media', 'links', 'docs']

export default function MediaPage({ chatId, title, myUid, clearedAt, hidden, loaded, startTab, onBack, onView }: Props) {
  const { t } = useT()
  const [tab, setTab] = useState(startTab)
  const [pages, setPages] = useState<Partial<Record<SharedTab, Pages>>>({})
  const busy = useRef(new Set<SharedTab>())
  const sentinel = useRef<HTMLDivElement>(null)
  const now = useNow(60_000)
  useBack(true, LEVEL.panel, onBack)

  // The next page of a tab. (Nothing if it's already loading one, or there's no more.)
  const loadMore = useCallback(
    (which: SharedTab, before?: Pages) => {
      if (busy.current.has(which) || (before && !before.more)) return
      busy.current.add(which)
      loadShared(chatId, which, clearedAt, before?.last)
        .then((page) => setPages((all) => ({ ...all, [which]: { items: [...(all[which]?.items ?? []), ...page.messages], last: page.last, more: page.more } })))
        .catch((err) => {
          console.error(err)
          setPages((all) => ({ ...all, [which]: { items: all[which]?.items ?? [], more: false, failed: true } }))
        })
        .finally(() => busy.current.delete(which))
    },
    [chatId, clearedAt],
  )

  // Open a tab the first time: its first page.
  const current = pages[tab]
  useEffect(() => {
    if (!current) loadMore(tab)
  }, [tab, current, loadMore])

  // Scrolled to the bottom: the next page.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !current?.more) return
    const watch = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(tab, current), { rootMargin: '400px' })
    watch.observe(el)
    return () => watch.disconnect()
  }, [tab, current, loadMore])

  // What this tab shows. Links: also the ones in messages from before Batch 10 that the chat has loaded.
  let items = (current?.items ?? []).filter((m) => belongs(m, tab, hidden, now))
  if (tab === 'links') {
    const ids = new Set(items.map((m) => m.id))
    const older = loaded.filter((m) => !ids.has(m.id) && belongs(m, 'links', hidden, now))
    items = [...items, ...older].sort((a, b) => (b.sentAt?.toMillis() ?? 0) - (a.sentAt?.toMillis() ?? 0))
  }
  const months = byMonth(items, t.locale, t.thisMonth)
  const oldestFirst = tab === 'media' ? [...items].reverse() : []
  const icons: Record<SharedTab, IconName> = { media: 'image', links: 'link', docs: 'file' }
  const names: Record<SharedTab, string> = { media: t.media, links: t.links, docs: t.docs }

  return (
    <div className="pane info-pane media-page">
      <header className="bar">
        <button className="icon back-always" onClick={onBack} aria-label={t.back}>
          <Icon name="back" />
        </button>
        <h2 dir="auto">{title}</h2>
      </header>
      <div className="media-tabs" role="tablist" style={{ '--tab': TABS.indexOf(tab) } as React.CSSProperties}>
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>
            {names[name]}
          </button>
        ))}
        <span className="tab-line" aria-hidden />
      </div>

      <div className="list media-list" key={tab}>
        {!current && <Skeleton tab={tab} />}
        {current && items.length === 0 && !current.more && (
          <p className="empty media-empty">
            <Icon name={icons[tab]} size={40} />
            {current.failed ? t.somethingWrong : tab === 'media' ? t.noMedia : tab === 'links' ? t.noLinks : t.noDocs}
          </p>
        )}
        {months.map((month) => (
          <section key={month.label} className="media-month">
            <p className="month-title">{month.label}</p>
            {tab === 'media' ? (
              <div className="media-grid">
                {month.items.map((m) => (
                  <Thumb key={m.id} chatId={chatId} m={m} lazy onOpen={() => onView(m, oldestFirst)} />
                ))}
              </div>
            ) : tab === 'docs' ? (
              <div className="doc-shelf">
                {month.items.map((m) => (
                  <div key={m.id} className="doc-item">
                    <FileBubble chatId={chatId} m={m} />
                    <small>{whoAndWhen(m, myUid, t)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="link-list">
                {month.items.map((m) => (
                  <LinkRow key={m.id} m={m} myUid={myUid} />
                ))}
              </div>
            )}
          </section>
        ))}
        <div ref={sentinel} className="load-more">
          {current?.more && <span className="spinner" />}
        </div>
        {current && !current.more && items.length > 0 && <p className="media-count">{countText(tab, items, t)}</p>}
      </div>
    </div>
  )
}

// One link: its card's picture and title (or the address), the address, and the message's words.
function LinkRow({ m, myUid }: { m: Message; myUid: string }) {
  const { t } = useT()
  const url = linkIn(m)!
  const card = m.preview?.url === url ? m.preview : undefined
  const words = (m.text ?? m.caption ?? '').trim()
  let site = url
  try {
    site = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // (an odd address: show it as it is)
  }
  return (
    <a className="link-row" href={url} target="_blank" rel="noopener noreferrer">
      <span className="link-thumb">{card?.image ? <img src={card.image} alt="" /> : <Icon name="link" />}</span>
      <span className="link-words">
        <strong dir="auto">{card?.title ?? site}</strong>
        <span className="link-url" dir="ltr">
          {url}
        </span>
        {words !== url && <small dir="auto">{words}</small>}
        <small className="muted">{whoAndWhen(m, myUid, t)}</small>
      </span>
    </a>
  )
}

// "You · Today" or "Ali · 12 September"
function whoAndWhen(m: Message, myUid: string, t: Strings) {
  const who = m.senderId === myUid ? t.you : (m.senderName ?? '')
  return [who, m.sentAt ? dayLabel(m.sentAt.toDate(), t) : ''].filter(Boolean).join(' · ')
}

// "12 photos, 3 videos, 1 GIF" / "4 links" / "2 documents"
function countText(tab: SharedTab, items: Message[], t: Strings) {
  const count = (n: number, one: string, many: string) => fill(n === 1 ? one : many, { n })
  if (tab === 'links') return count(items.length, t.oneLink, t.nLinks)
  if (tab === 'docs') return count(items.length, t.oneDoc, t.nDocs)
  const photos = items.filter((m) => m.kind === 'photo').length
  const videos = items.filter((m) => m.kind === 'video').length
  const gifs = items.filter((m) => m.kind === 'gif').length
  return [
    photos && count(photos, t.onePhoto, t.nPhotos),
    videos && count(videos, t.oneVideo, t.nVideos),
    gifs && count(gifs, t.oneGif, t.nGifs),
  ]
    .filter(Boolean)
    .join(', ')
}

// Grey shapes while the first page loads.
function Skeleton({ tab }: { tab: SharedTab }) {
  return tab === 'media' ? (
    <div className="media-grid skeleton">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="thumb-box loading" />
      ))}
    </div>
  ) : (
    <div className="doc-shelf skeleton">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="skeleton-row loading" />
      ))}
    </div>
  )
}
