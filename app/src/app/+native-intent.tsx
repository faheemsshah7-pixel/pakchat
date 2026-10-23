// +native-intent.tsx: links that open PakChat from outside. A tap on a message
// alert opens pakchat://chat/<id> (ChatAlerts.kt); a ringing call opens
// pakchat://call/<id>?chat=<chat>, with &answer=1 from its Answer button
// (CallAlerts.kt). The root layout opens the chat or the call once you're
// signed in, so the link itself lands on the chat list.
import { tappedCall } from '../core/calls';
import { tappedAlert } from '../core/push';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const call = /call\/([A-Za-z0-9-]+)/.exec(path)?.[1];
  if (call) {
    tappedCall(call, /[?&]answer=1/.test(path));
    return '/';
  }
  const chat = /chat\/([A-Za-z0-9-]+)/.exec(path)?.[1];
  if (!chat) return path;
  tappedAlert(chat);
  return '/';
}
