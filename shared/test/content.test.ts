// The inside of a message comes from someone else's phone, so it's checked
// carefully: anything odd is dropped, never shown.

import { expect, test } from 'vitest';

import { parseContent } from '../src/content';

const base = { v: 1, id: 'm1', chat: 'c1', at: 1000 };
const parse = (x: object) => parseContent(JSON.stringify({ ...base, ...x }));

test('good messages pass, with only the fields we know', () => {
  expect(parse({ t: 'text', text: 'Salam', extra: 'dropped' })).toEqual({ ...base, t: 'text', text: 'Salam' });
  expect(parse({ t: 'poll', question: 'Tea?', options: ['Yes', 'No'] })).toEqual({ ...base, t: 'poll', question: 'Tea?', options: ['Yes', 'No'], multi: false });
  expect(parse({ t: 'vote', target: { author: 'u', id: 'p' }, options: [2, 0, 2] })).toMatchObject({ options: [0, 2] });
  expect(parse({ t: 'react', target: { author: 'u', id: 'p' }, emoji: null })).toMatchObject({ emoji: null });
});

test('anything odd is dropped', () => {
  expect(parseContent('not json')).toBeNull();
  expect(parseContent(JSON.stringify({ ...base, v: 2, t: 'text', text: 'from the future' }))).toBeNull();
  expect(parse({ t: 'text', text: '   ' })).toBeNull();
  expect(parse({ t: 'text', text: 'x'.repeat(20_001) })).toBeNull();
  expect(parse({ t: 'text', text: 7 })).toBeNull();
  expect(parse({ t: 'poll', question: 'Q', options: ['only one'] })).toBeNull();
  expect(parse({ t: 'vote', target: { author: 'u', id: 'p' }, options: [-1] })).toBeNull();
  expect(parse({ t: 'edit', target: { author: 'u', id: 'p' }, text: 'x' })).toBeNull();
  expect(parse({ t: 'timer', seconds: 1.5 })).toBeNull();
  expect(parse({ t: 'retry', seq: 3, why: 'because' })).toBeNull();
  expect(parse({ t: 'mystery' })).toBeNull();
  expect(parseContent(JSON.stringify({ t: 'text', text: 'no id' }))).toBeNull();
});

test('"ringing" comes back from a phone that is ringing, so the caller can show it', () => {
  expect(parse({ t: 'call', call: 'c1', op: 'ringing' })).toEqual({ ...base, t: 'call', call: 'c1', op: 'ringing' });
  expect(parse({ t: 'call', call: 'c1', op: 'ringing-ish' })).toBeNull();
});
