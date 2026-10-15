// Ticks.tsx: the little 🕓 / ✓ / ✓✓ next to your own messages.
import type { Tick } from '../chats'
import { useT } from '../lang'

const SYMBOL: Record<Tick, string> = { pending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓' }

export default function Ticks({ tick }: { tick: Tick }) {
  const { t } = useT()
  const label = { pending: t.tickPending, sent: t.tickSent, delivered: t.tickDelivered, read: t.tickRead }[tick]
  return (
    <span className={'tick ' + tick} title={label} aria-label={label}>
      {SYMBOL[tick]}
    </span>
  )
}
