// Stickers.tsx: how a sticker looks in the chat, and the Stickers tab of the smiley panel
// (PakChat's own pack, and "My stickers": ones you made from a photo or saved from a chat).
// How stickers are saved: see stickers.ts.
import { useRef, useState } from 'react'
import type { Message } from '../chats'
import { useT } from '../lang'
import { useMedia } from '../media'
import { forgetSticker, keepSticker, makeSticker, myStickers, PACK, packSticker, type PackSticker } from '../stickers'
import Icon from './Icon'

// One of PakChat's own stickers: a big emoji with a few bold words, drawn by the browser
// (so it's sharp at any size and costs nothing to send).
export function PackStickerArt({ sticker, size = 140 }: { sticker: PackSticker; size?: number }) {
  return (
    <span className="pack-sticker" style={{ width: size, height: size, ['--sticker' as string]: sticker.colour, fontSize: (size / 140) * 16 + 'px' }}>
      <span className="pack-emoji" aria-hidden>
        {sticker.emoji}
      </span>
      <span className="pack-words" dir="auto">
        {sticker.words}
      </span>
    </span>
  )
}

// A sticker message.
export function StickerBubble({ chatId, m }: { chatId: string; m: Message }) {
  const data = useMedia(chatId, m.sticker ? undefined : m.mediaId)
  const pack = packSticker(m.sticker)
  if (pack) return <PackStickerArt sticker={pack} />
  if (m.sticker) return <span className="sticker-missing">🙂</span> // (from a newer PakChat with stickers we don't have yet)
  return data ? <img className="sticker-img" src={data} alt="" /> : <span className="sticker-img loading" />
}

// The Stickers tab. Tap one to send it.
export type PickedSticker = { sticker: string } | { data: string }
export function StickerPanel({ onSticker }: { onSticker: (picked: PickedSticker) => void }) {
  const { t } = useT()
  const [mine, setMine] = useState(myStickers)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // "Create": pick a photo, make it a sticker, keep it in My stickers and send it.
  async function create(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const data = await makeSticker(file)
      setMine(keepSticker(data))
      onSticker({ data })
    } catch (err) {
      console.error(err)
      setError(t.stickerFailed)
    }
  }

  return (
    <div className="sticker-panel">
      <p className="section-title">{t.myStickers}</p>
      <div className="sticker-grid">
        <button type="button" className="sticker-add" onClick={() => input.current?.click()} title={t.createSticker}>
          <Icon name="plus" size={26} />
          <small>{t.createSticker}</small>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={create} />
        {mine.map((data) => (
          <span key={data} className="sticker-cell">
            <button type="button" onClick={() => onSticker({ data })} aria-label={t.sticker}>
              <img src={data} alt="" />
            </button>
            <button type="button" className="sticker-remove" aria-label={t.removeSticker} title={t.removeSticker} onClick={() => setMine(forgetSticker(data))}>
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <p className="section-title">{t.pakchatStickers}</p>
      <div className="sticker-grid">
        {PACK.map((s) => (
          <button key={s.id} type="button" className="sticker-cell" onClick={() => onSticker({ sticker: s.id })} aria-label={s.words}>
            <PackStickerArt sticker={s} size={84} />
          </button>
        ))}
      </div>
    </div>
  )
}
