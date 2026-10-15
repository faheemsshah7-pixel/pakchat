// MediaGrid.tsx: the photos shared in a chat, as little squares (in contact and group info).
// It shows photos from the messages already loaded, newest first.
import type { Message } from '../chats'
import { useT } from '../lang'
import { useMedia } from '../media'

export default function MediaGrid({ chatId, messages, onView }: { chatId: string; messages: Message[]; onView: (m: Message, data: string) => void }) {
  const { t } = useT()
  const photos = messages.filter((m) => m.kind === 'photo' && !m.deleted && m.mediaId).reverse()
  if (photos.length === 0) return null
  return (
    <section className="info-section">
      <p className="section-title">
        {t.media} <span className="muted">{photos.length}</span>
      </p>
      <div className="media-grid">
        {photos.slice(0, 12).map((m) => (
          <Thumb key={m.id} chatId={chatId} m={m} onView={onView} />
        ))}
      </div>
    </section>
  )
}

function Thumb({ chatId, m, onView }: { chatId: string; m: Message; onView: (m: Message, data: string) => void }) {
  const data = useMedia(chatId, m.mediaId)
  if (!data) return <span className="thumb-box loading" />
  return (
    <button className="thumb-box" onClick={() => onView(m, data)}>
      <img src={data} alt="" />
    </button>
  )
}
