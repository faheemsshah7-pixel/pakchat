// qr.ts: what a PakChat QR code says, like WhatsApp's "My QR code". It's a
// link to chat with me: scanned in PakChat (Settings › QR code › Scan) it opens
// our chat, and a phone's own camera opens PakChat with it.
import { create } from 'qrcode';

const LINK = 'pakchat://u/';

/** The link my QR code holds. */
export const qrLink = (userId: string) => `${LINK}${userId}`;

/** The person a scanned code is for, or null if it isn't a PakChat code. */
export function userFromQr(text: string): string | null {
  const id = /^pakchat:\/\/u\/([A-Za-z0-9_-]{1,64})\/?$/.exec(text.trim())?.[1];
  return id ?? null;
}

/** The squares of `text`'s code as one SVG path, on a grid `n` squares wide. */
export function qrPath(text: string) {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Runs of dark squares in a row are one rectangle.
      if (!modules.get(y, x)) continue;
      let w = 1;
      while (x + w < n && modules.get(y, x + w)) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return { d, n };
}
