// MediaGrid.tsx: the photos, videos and documents shared in a chat (in contact and group info).
// It shows them from the messages already loaded, newest first.
// (Not "view once" ones, which can't be seen again, or round video messages, which are more like voice notes.)
import { useState } from 'react'
import type { Message } from '../chats'
import { useT } from '../lang'
import { loadMediaUrl, useMedia } from '../media'
import Icon from './Icon'
import { FileBubble } from './MediaBubbles'

type Props = { chatId: string; messages: Message[]; onView: (m: Message, data: string) => void }

export default function MediaGrid({ chatId, messages, onView }: Props) {
  const { t } = useT()
  const shared = messages.filter((m) => !m.deleted && m.mediaId && !m.once && !m.round).reverse()
  const media = shared.filter((m) => m.kind === 'photo' || m.kind === 'video')
  const docs = shared.filter((m) => m.kind === 'file')
  return (
    <>
      {media.length > 0 && (
        <section className="info-section">
          <p className="section-title">
            {t.media} <span className="muted">{media.length}</span>
          </p>
          <div className="media-grid">
            {media.slice(0, 12).map((m) => (
              <Thumb key={m.id} chatId={chatId} m={m} onView={onView} />
            ))}
          </div>
        </section>
      )}
      {docs.length > 0 && (
        <section className="info-section">
          <p className="section-title">
            {t.documents} <span className="muted">{docs.length}</span>
          </p>
          <div className="doc-shelf">
            {docs.slice(0, 5).map((m) => (
              <FileBubble key={m.id} chatId={chatId} m={m} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

// One square. A video shows its first picture with a ▶, and loads when you tap it.
function Thumb({ chatId, m, onView }: { chatId: string; m: Message; onView: (m: Message, data: string) => void }) {
  const video = m.kind === 'video'
  const picture = useMedia(chatId, video ? m.posterId : m.mediaId)
  const [opening, setOpening] = useState(false)

  async function open(picture: string) {
    if (!video) return onView(m, picture)
    setOpening(true)
    try {
      onView(m, await loadMediaUrl(chatId, m.mediaId ?? ''))
    } catch (err) {
      console.error(err)
    }
    setOpening(false)
  }

  if (!picture) return <span className="thumb-box loading" />
  return (
    <button className="thumb-box" onClick={() => open(picture)}>
      <img src={picture} alt="" />
      {video && <span className="thumb-play">{opening ? <span className="spinner" /> : <Icon name="play" size={18} />}</span>}
    </button>
  )
}
