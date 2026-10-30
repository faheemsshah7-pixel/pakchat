// Ticks.tsx: how far one of my messages got. A clock while it waits, one tick
// sent, two delivered, two blue read; a red mark if it couldn't go.

import type { MessageStatus } from '@pakchat/shared';

import { Icon } from './Icon';

export function Ticks({ status, size = 18 }: { status?: MessageStatus; size?: number }) {
  if (!status) return null;
  if (status === 'queued' || status === 'paused')
    return (
      <span className="tk" aria-label="Waiting to send">
        <Icon name="clock" size={size - 3} stroke={2} />
      </span>
    );
  if (status === 'failed')
    return (
      <span className="tk fail" aria-label="Not sent">
        <Icon name="warning" size={size - 3} stroke={2} />
      </span>
    );
  return (
    <span className={`tk ${status === 'read' ? 'read' : ''}`} aria-label={status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent'}>
      <Icon name={status === 'sent' ? 'tick' : 'ticks'} size={size} stroke={2} />
    </span>
  );
}
