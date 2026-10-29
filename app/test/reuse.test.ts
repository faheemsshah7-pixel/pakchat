import { expect, test } from 'vitest';

import { reuse, same } from '../src/core/reuse';

test('same compares what JSON can hold', () => {
  expect(same({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
  expect(same({ a: 1 }, { a: 2 })).toBe(false);
  expect(same({ a: 1 }, { a: 1, b: null })).toBe(false);
  expect(same({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  expect(same([1, 2], [1, 2, 3])).toBe(false);
  expect(same([], {})).toBe(false);
  expect(same(null, {})).toBe(false);
  expect(same('a', 'a')).toBe(true);
});

const key = (m: { id: string }) => m.id;

test('nothing changed: the old list itself comes back', () => {
  const old = [
    { id: '1', s: 'sent' },
    { id: '2', s: 'read' },
  ];
  const fresh = old.map((m) => ({ ...m }));
  expect(reuse(old, fresh, key)).toBe(old);
});

test('one changed: only that one is new, the rest keep their old copies', () => {
  const old = [
    { id: '1', s: 'sent' },
    { id: '2', s: 'sent' },
  ];
  const fresh = [
    { id: '1', s: 'sent' },
    { id: '2', s: 'read' },
  ];
  const out = reuse(old, fresh, key);
  expect(out).not.toBe(old);
  expect(out[0]).toBe(old[0]);
  expect(out[1]).toBe(fresh[1]);
});

test('added, removed or moved: a new list, unchanged items still reused', () => {
  const old = [{ id: '1' }, { id: '2' }];
  const added = reuse(old, [{ id: '0' }, { id: '1' }, { id: '2' }], key);
  expect(added).toHaveLength(3);
  expect(added[1]).toBe(old[0]);
  expect(added[2]).toBe(old[1]);
  const removed = reuse(old, [{ id: '2' }], key);
  expect(removed).toEqual([{ id: '2' }]);
  expect(removed[0]).toBe(old[1]);
  const moved = reuse(old, [{ id: '2' }, { id: '1' }], key);
  expect(moved).not.toBe(old);
  expect(moved[0]).toBe(old[1]);
  expect(reuse(null, old, key)).toBe(old);
});
