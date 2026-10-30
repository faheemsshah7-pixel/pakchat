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
  expect(parse({ t: 'call', call: 'c1', op: 'ringing', early: true })).toEqual({ ...base, t: 'call', call: 'c1', op: 'ringing', early: true });
  expect(parse({ t: 'call', call: 'c1', op: 'ringing', early: 'yes' })).toEqual({ ...base, t: 'call', call: 'c1', op: 'ringing' });
  expect(parse({ t: 'call', call: 'c1', op: 'ringing-ish' })).toBeNull();
});

test('sharing my screen says so, so the others show it whole', () => {
  expect(parse({ t: 'call', call: 'c1', op: 'media', audio: true, video: true, screen: true })).toEqual({ ...base, t: 'call', call: 'c1', op: 'media', audio: true, video: true, screen: true });
  expect(parse({ t: 'call', call: 'c1', op: 'media', video: true, screen: 'yes' })).not.toHaveProperty('screen');
});

test('a ring to someone added to a call says who else is in it', () => {
  const ring = { t: 'call', call: 'c1', op: 'ring', group: true };
  expect(parse({ ...ring, people: ['a', 'b', 'a'] })).toMatchObject({ people: ['a', 'b'] });
  expect(parse({ ...ring, people: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })).toBeNull();
  expect(parse({ ...ring, people: [7] })).toBeNull();
});

test('a forward says how many times it was forwarded, for "Forwarded many times"', () => {
  expect(parse({ t: 'text', text: 'Hi', forwarded: true, hops: 6 })).toEqual({ ...base, t: 'text', text: 'Hi', forwarded: true, hops: 6 });
  // Once is just "forwarded"; nonsense and a count without "forwarded" are dropped.
  expect(parse({ t: 'text', text: 'Hi', forwarded: true, hops: 1 })).toEqual({ ...base, t: 'text', text: 'Hi', forwarded: true });
  expect(parse({ t: 'text', text: 'Hi', forwarded: true, hops: -3 })).toEqual({ ...base, t: 'text', text: 'Hi', forwarded: true });
  expect(parse({ t: 'text', text: 'Hi', hops: 9 })).toEqual({ ...base, t: 'text', text: 'Hi' });
  expect(parse({ t: 'text', text: 'Hi', forwarded: true, hops: 1e9 })).toMatchObject({ hops: 1000 });
});
