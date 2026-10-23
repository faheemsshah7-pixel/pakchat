// The live connection to the server: one always-open WebSocket per device,
// through Phoenix's own JavaScript client. It reconnects by itself when the
// network comes back, and the server then sends everything that was waiting.

import { Socket, type Channel } from 'phoenix';

import { OfflineError, ServerError } from './server';

/** One envelope as the server sends it (see server/lib/pakchat_web/wire.ex). */
export type WireEnvelope = {
  id: number;
  chat_id: string;
  /** The chat's number for it. Null for receipts. */
  seq: number | null;
  from: string;
  from_device: number | null;
  kind: 'message' | 'reaction' | 'control' | 'receipt' | 'system' | 'call';
  sent_at: string;
  /** Locked messages: Signal's type and the locked bytes (base64). */
  type?: number;
  body?: string;
  /** Receipts and group notes: plain facts the server already knows. */
  data?: Record<string, unknown>;
};

export type TypingEvent = { chat_id: string; user_id: string; typing: boolean };

export type ConnectionHandlers = {
  envelopes(list: WireEnvelope[]): void;
  typing(event: TypingEvent): void;
  presence(event: Record<string, unknown>): void;
  /** True once joined (again), false when the connection drops. */
  status(connected: boolean): void;
};

export interface Connection {
  open(handlers: ConnectionHandlers): void;
  close(): void;
  /** Sends one event and waits for the server's answer. */
  push(event: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
}

/** Makes a connection for a signed-in device. */
export type ConnectionFactory = (session: { token: string; deviceUuid: string }) => Connection;

/**
 * The real connection. `socketUrl` is the server's socket address, like
 * "wss://example.com/socket" (or "ws://localhost:4000/socket" on the Mac).
 */
export function phoenixConnection(socketUrl: string): ConnectionFactory {
  return ({ token, deviceUuid }) => {
    let socket: Socket | null = null;
    let channel: Channel | null = null;
    let joined = false;
    // Sends still waiting for an answer. When the connection drops they will
    // never get one, so we give up on them at once instead of waiting for
    // their timeout (which would hold up everything queued behind them).
    const waiting = new Set<(err: Error) => void>();
    const giveUp = () => {
      for (const fail of [...waiting]) fail(new OfflineError('Connection lost'));
      waiting.clear();
    };
    const dropped = (h: ConnectionHandlers) => {
      if (joined) h.status(false);
      joined = false;
      giveUp();
    };

    return {
      open(h) {
        socket = new Socket(socketUrl, {
          params: { token },
          // Try again quickly at first, then every 10 seconds.
          reconnectAfterMs: (tries: number) => [500, 1000, 2000, 5000][tries - 1] ?? 10_000,
        });
        socket.onClose(() => dropped(h));
        socket.connect();

        channel = socket.channel(`device:${deviceUuid}`, {});
        channel.on('envelopes', (p: { envelopes: WireEnvelope[] }) => h.envelopes(p.envelopes));
        channel.on('typing', (p: TypingEvent) => h.typing(p));
        channel.on('presence', (p: Record<string, unknown>) => h.presence(p));
        channel.onError(() => dropped(h));
        // Phoenix calls this again every time it rejoins after a drop.
        const mine = channel;
        channel.join().receive('ok', () => {
          // Ignore a late answer for a connection that was already closed.
          if (channel !== mine) return;
          joined = true;
          h.status(true);
        });
      },

      close() {
        channel?.leave();
        socket?.disconnect();
        channel = null;
        socket = null;
        joined = false;
        giveUp();
      },

      push(event, payload, timeoutMs = 10_000) {
        return new Promise((resolve, reject) => {
          if (!channel || !joined) return reject(new OfflineError('Not connected'));
          const fail = (err: Error) => {
            waiting.delete(fail);
            reject(err);
          };
          waiting.add(fail);
          channel
            .push(event, payload, timeoutMs)
            .receive('ok', (reply?: Record<string, unknown>) => {
              waiting.delete(fail);
              resolve(reply ?? {});
            })
            .receive('error', (reply?: Record<string, unknown>) => fail(new ServerError(String(reply?.reason ?? 'error'), 0, reply ?? {})))
            .receive('timeout', () => fail(new OfflineError(`No answer to "${event}"`)));
        });
      },
    };
  };
}
