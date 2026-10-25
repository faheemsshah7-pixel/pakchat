// The Calls tab's rows: calls in a row with the same chat, the same way, on
// the same day are one row ("Ali (3)"), like WhatsApp.
import { expect, test } from 'vitest';

import { grouped } from '../src/core/callGroups';
import type { CallLogEntry } from '../src/core/calls';

const at = new Date(2026, 9, 25, 12).getTime();
let n = 0;
const call = (c: Partial<CallLogEntry>): CallLogEntry => ({ id: `c${n++}`, chatId: 'ali', with: ['ali'], direction: 'in', video: false, group: false, at, seconds: 30, missed: false, ...c });

test('calls one after another with the same person, the same way, are one row', () => {
  const list = [call({}), call({ at: at - 60_000 }), call({ video: true, at: at - 120_000 })];
  expect(grouped(list).map((g) => g.all.length)).toEqual([3]);
});

test('missed, the other way, someone else, or another day: a new row', () => {
  const list = [
    call({}),
    call({ missed: true, seconds: 0 }),
    call({ missed: true, seconds: 0 }),
    call({ direction: 'out' }),
    call({ chatId: 'sara', with: ['sara'] }),
    call({ chatId: 'sara', with: ['sara'], at: at - 86_400_000 }),
    call({}),
  ];
  expect(grouped(list).map((g) => [g.first.chatId, g.all.length])).toEqual([
    ['ali', 1],
    ['ali', 2],
    ['ali', 1],
    ['sara', 1],
    ['sara', 1],
    ['ali', 1],
  ]);
});
