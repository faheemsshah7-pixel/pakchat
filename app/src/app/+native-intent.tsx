// +native-intent.tsx: links that open PakChat from outside. A tap on a message
// alert opens pakchat://chat/<id> (ChatAlerts.kt). The chat is opened by the
// root layout once you're signed in, so the link itself lands on the chat list.
import { tappedAlert } from '../core/push';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const chat = /chat\/([A-Za-z0-9-]+)/.exec(path)?.[1];
  if (!chat) return path;
  tappedAlert(chat);
  return '/';
}
