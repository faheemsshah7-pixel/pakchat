// EmojiPicker.tsx: a panel of emojis, in groups. Tap one to add it.
// The first tab is the ones you used most recently.
// In the message box it also has GIFs (Gifs.tsx) and Stickers (Stickers.tsx): switch at the bottom, like WhatsApp.
import { useEffect, useState } from 'react'
import { LEVEL, useBack } from '../back'
import { EMOJI_GROUPS, recentEmojis, rememberEmoji } from '../emoji'
import { gifKey, type Gif } from '../gifs'
import { useT } from '../lang'
import { GifPanel } from './Gifs'
import Icon from './Icon'
import { StickerPanel, type PickedSticker } from './Stickers'

type Props = {
  onPick: (emoji: string) => void
  onClose: () => void
  onSticker?: (picked: PickedSticker) => void // (only in the message box, not for reactions)
  onGif?: (gif: Gif) => void // (the same)
  className?: string
}

export default function EmojiPicker({ onPick, onClose, onSticker, onGif: sendGif, className = '' }: Props) {
  const { t } = useT()
  const onGif = gifKey() ? sendGif : undefined // (no GIF tab until PakChat has a KLIPY key: gifs.ts)
  const [recent] = useState(recentEmojis)
  const [tab, setTab] = useState(recent.length ? -1 : 0) // -1 = recent
  const [mode, setMode] = useState<'emoji' | 'gif' | 'stickers'>('emoji')
  useBack(true, LEVEL.menu, onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const emojis = tab === -1 ? recent : EMOJI_GROUPS[tab].emojis.split(' ')
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className={'emoji-picker ' + className} role="dialog" aria-label={mode === 'stickers' ? t.stickers : mode === 'gif' ? t.gif : t.emoji}>
        {mode === 'stickers' && onSticker ? (
          <StickerPanel onSticker={onSticker} />
        ) : mode === 'gif' && onGif ? (
          <GifPanel onGif={onGif} />
        ) : (
          <>
            <div className="emoji-tabs" role="tablist">
              {recent.length > 0 && (
                <button role="tab" aria-selected={tab === -1} className={tab === -1 ? 'on' : ''} onClick={() => setTab(-1)} title={t.recent}>
                  🕘
                </button>
              )}
              {EMOJI_GROUPS.map((group, i) => (
                <button key={group.icon} role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>
                  {group.icon}
                </button>
              ))}
            </div>
            <div className="emoji-grid">
              {emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    rememberEmoji(emoji)
                    onPick(emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
        {onSticker && (
          <div className="picker-modes" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'emoji'} className={mode === 'emoji' ? 'on' : ''} onClick={() => setMode('emoji')}>
              <Icon name="smile" size={20} /> {t.emoji}
            </button>
            {onGif && (
              <button type="button" role="tab" aria-selected={mode === 'gif'} className={mode === 'gif' ? 'on' : ''} onClick={() => setMode('gif')}>
                <span className="gif-word" aria-hidden>
                  GIF
                </span>{' '}
                {t.gifs}
              </button>
            )}
            <button type="button" role="tab" aria-selected={mode === 'stickers'} className={mode === 'stickers' ? 'on' : ''} onClick={() => setMode('stickers')}>
              <Icon name="sticker" size={20} /> {t.stickers}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
