// The website's side of linking by QR code (the steps are in link.ts):
// show a QR, keep it fresh, and wait for the phone to say yes.

import { Socket } from 'phoenix';

import type { PakChat, Session } from './client';
import { identityCheck, newLinkKeys, openProvision, type Provision, qrText } from './link';
import { type HttpServer, linkedFromWire, ServerError, type SignedIn } from './server';

/** All six codes ran out with nobody scanning: show "Click to reload QR code". */
export class LinkExpired extends Error {}

type LinkedPayload = Parameters<typeof linkedFromWire>[0];

export type LinkOptions = {
  client: PakChat;
  server: HttpServer;
  /** The server's link socket, like "wss://example.com/link". */
  socketUrl: string;
  /** Called with each new QR text, and how many seconds it lasts. */
  onQr(text: string, seconds: number): void;
  /** Stops waiting (the person closed the page). */
  signal?: AbortSignal;
};

/**
 * Waits for the phone to scan this browser's QR. Resolves signed in, with
 * what the phone said about itself. Rejects with LinkExpired when the codes
 * run out (about 2½ minutes), like WhatsApp.
 */
export async function linkThisBrowser(o: LinkOptions): Promise<{ session: Session; provision: Provision }> {
  let provision: Provision | null = null;
  const session = await o.client.signInWith(async (device, keys) => {
    const linkKeys = await newLinkKeys();
    const check = await identityCheck(device.identityKey);
    const start = await o.server.startLink(device, keys);
    const { result, close } = waitOnSocket(o.socketUrl, start.id, start.secret);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      close();
    };

    try {
      const expired = new Promise<never>((_, reject) => {
        const show = (code: string, seconds: number) => {
          o.onQr(qrText(code, linkKeys.publicKey, check), seconds);
          timer = setTimeout(async () => {
            try {
              const next = await o.server.newLinkCode(start.id, start.secret);
              show(next.code, next.expiresIn);
            } catch (err) {
              reject(err instanceof ServerError && err.reason === 'expired' ? new LinkExpired('The QR code ran out') : err);
            }
          }, seconds * 1000);
        };
        show(start.code, start.expiresIn);
        o.signal?.addEventListener('abort', () => reject(new LinkExpired('Stopped')), { once: true });
      });
      const linked = await Promise.race([result, expired]);
      const { signedIn, provision: locked } = linkedFromWire(linked);
      provision = await openProvision(locked, linkKeys);
      // The phone must be the account the server signed us into.
      if (provision.userId !== signedIn.user.id) throw new Error('The phone and the server disagree');
      return signedIn satisfies SignedIn;
    } finally {
      stop();
    }
  });
  return { session, provision: provision! };
}

/** Joins "link:<id>" and resolves with the phone's yes (or the one that came while we were away). */
function waitOnSocket(socketUrl: string, id: string, secret: string) {
  const socket = new Socket(socketUrl, { params: { id, secret }, reconnectAfterMs: (tries: number) => [500, 1000, 2000][tries - 1] ?? 5000 });
  const channel = socket.channel(`link:${id}`, {});
  const result = new Promise<LinkedPayload>((resolve, reject) => {
    channel.on('linked', (p: LinkedPayload) => resolve(p));
    channel
      .join()
      .receive('ok', (reply: { linked?: LinkedPayload }) => {
        if (reply?.linked) resolve(reply.linked);
      })
      .receive('error', (reply: { reason?: string }) => {
        reject(reply?.reason === 'expired' ? new LinkExpired('The QR code ran out') : new Error(`Couldn't wait for the phone (${reply?.reason ?? 'error'})`));
      });
  });
  socket.connect();
  return {
    result,
    close: () => {
      // Tell the server we have it, so it can forget the request now.
      channel.push('done', {});
      setTimeout(() => socket.disconnect(), 200);
    },
  };
}
