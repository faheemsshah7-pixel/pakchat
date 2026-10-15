// Ticks.tsx: the little clock / ✓ / ✓✓ next to your own messages.
// Blue ✓✓ means read. The colours are in index.css.
import type { Tick } from '../chats'
import { useT } from '../lang'
import Icon, { type IconName } from './Icon'

const SYMBOL: Record<Tick, IconName> = { pending: 'clock', sent: 'check', delivered: 'checks', read: 'checks' }

export default function Ticks({ tick }: { tick: Tick }) {
  const { t } = useT()
  const label = { pending: t.tickPending, sent: t.tickSent, delivered: t.tickDelivered, read: t.tickRead }[tick]
  return (
    <span className={'tick ' + tick} title={label} aria-label={label}>
      <Icon name={SYMBOL[tick]} size={tick === 'pending' ? 12 : 16} />
    </span>
  )
}
