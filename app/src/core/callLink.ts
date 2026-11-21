// callLink.ts: reads a pakchat://call/<id>?chat=<chat>[&answer=1&k=<key>] link.
// Any app on the phone, or a web page, can open such a link, so answer=1 on its
// own must never pick up a ringing call (a caller with a helper app would turn
// the microphone on). Our own alert's Answer button adds a one-time key the
// phone made for that call (CallAlerts.kt AnswerKeys); only a right key answers.
// Without one the link just opens the ringing call screen.

export type CallTap = { id: string; answer: boolean };

export function callLink(path: string, keyOk: (callId: string, key: string) => boolean): CallTap | null {
  const id = /call\/([A-Za-z0-9-]+)/.exec(path)?.[1];
  if (!id) return null;
  const key = /[?&]k=([A-Za-z0-9_-]+)/.exec(path)?.[1];
  const wantsAnswer = /[?&]answer=1(?:&|$)/.test(path);
  return { id, answer: wantsAnswer && !!key && keyOk(id, key) };
}

/**
 * Any other link from outside goes to the router as it is, but never with an
 * answer flag: pakchat://call?id=<id>&answer=1 would otherwise open the call
 * screen straight away and answer there (app/call.tsx).
 */
export function outsidePath(path: string): string {
  return path.replace(/([?&])answer=[^&#]*&?/g, '$1').replace(/[?&]$/, '');
}
