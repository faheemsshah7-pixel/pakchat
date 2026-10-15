// EmojiPicker.tsx: a panel of emojis, in groups. Tap one to add it.
// The first tab is the ones you used most recently.
import { useEffect, useState } from 'react'
import { EMOJI_GROUPS, recentEmojis, rememberEmoji } from '../emoji'
import { useT } from '../lang'

type Props = { onPick: (emoji: string) => void; onClose: () => void; className?: string }

export default function EmojiPicker({ onPick, onClose, className = '' }: Props) {
  const { t } = useT()
  const [recent] = useState(recentEmojis)
  const [tab, setTab] = useState(recent.length ? -1 : 0) // -1 = recent

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const emojis = tab === -1 ? recent : EMOJI_GROUPS[tab].emojis.split(' ')
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className={'emoji-picker ' + className} role="dialog" aria-label={t.emoji}>
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
      </div>
    </>
  )
}
