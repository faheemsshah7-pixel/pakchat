// +native-intent.tsx: links that open PakChat from outside. A QR code
// (pakchat://u/<id>) opens our chat (qr.tsx). A tap on a message
// alert opens pakchat://chat/<id> (ChatAlerts.kt); a ringing call opens
// pakchat://call/<id>?chat=<chat>, with &answer=1 from its Answer button
// (CallAlerts.kt). The root layout opens the chat or the call once you're
// signed in. On a cold start the link itself lands on the chat list, so Back
// from the chat goes there, like WhatsApp. When PakChat is already running we
// answer null: the router then leaves the screens alone, because sending it to
// the chat list would pop the chat the layout is opening at the same moment.
import { tappedCall } from '../core/calls';
import { tappedAlert } from '../core/push';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  // A PakChat QR code scanned with the phone's own camera (core/qr.ts).
  const user = /^(?:pakchat:\/\/|\/)?u\/([A-Za-z0-9_-]+)/.exec(path)?.[1];
  if (user) return `/qr?user=${user}`;
  const call = /call\/([A-Za-z0-9-]+)/.exec(path)?.[1];
  if (call) {
    tappedCall(call, /[?&]answer=1/.test(path));
    return initial ? '/' : null;
  }
  const chat = /chat\/([A-Za-z0-9-]+)/.exec(path)?.[1];
  if (!chat) return path;
  tappedAlert(chat);
  return initial ? '/' : null;
}
