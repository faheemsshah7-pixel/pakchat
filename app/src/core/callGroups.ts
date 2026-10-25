// callGroups.ts: the Calls tab's rows. Calls one after another with the same
// chat, the same way, on the same day are one row ("Ali (3)"), like WhatsApp.
import type { CallLogEntry } from './calls';

/** Calls in a row with the same chat, the same way (all missed, or not), on the same day: one row, like WhatsApp. */
export type CallGroup = { key: string; first: CallLogEntry; all: CallLogEntry[] };

export function grouped(list: CallLogEntry[]): CallGroup[] {
  const out: CallGroup[] = [];
  for (const e of list) {
    const g = out.at(-1);
    if (g && g.first.chatId === e.chatId && g.first.direction === e.direction && g.first.missed === e.missed && sameDay(g.first.at, e.at)) g.all.push(e);
    else out.push({ key: e.id, first: e, all: [e] });
  }
  return out;
}

/** The same day on this phone's clock. */
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
