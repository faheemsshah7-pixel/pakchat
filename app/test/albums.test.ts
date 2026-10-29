import type { Message } from '@pakchat/shared';
import { expect, test } from 'vitest';

import { albumsIn } from '../src/ui/chat/albums';

let n = 0;
const photo = (author: string, at: number, extra: Partial<Message> = {}): Message =>
  ({ chatId: 'c', author, id: `m${++n}`, kind: 'file', sentAt: at, seq: n, file: { id: 'f', key: 'k', digest: 'd', size: 10, mime: 'image/jpeg', kind: 'image' }, ...extra }) as Message;
const text = (author: string, at: number): Message => ({ chatId: 'c', author, id: `m${++n}`, kind: 'text', text: 'hi', sentAt: at, seq: n }) as Message;

const T = Date.UTC(2026, 9, 25, 10, 0);

test('four or more photos in a row from one person make an album', () => {
  const ms = [photo('a', T), photo('a', T + 1000), photo('a', T + 2000), photo('a', T + 3000), photo('a', T + 4000)];
  const albums = albumsIn(ms);
  expect(albums.size).toBe(5);
  expect(albums.get(`a/${ms[0].id}`)).toEqual(ms);
});

test('three are not an album; words, another person or a long wait end one', () => {
  expect(albumsIn([photo('a', T), photo('a', T + 1), photo('a', T + 2)]).size).toBe(0);
  const run = [photo('a', T), photo('a', T + 1), photo('a', T + 2), text('a', T + 3), photo('a', T + 4)];
  expect(albumsIn(run).size).toBe(0);
  const two = [photo('a', T), photo('a', T + 1), photo('b', T + 2), photo('b', T + 3), photo('b', T + 4), photo('b', T + 5)];
  const albums = albumsIn(two);
  expect(albums.size).toBe(4);
  expect(albums.get(`a/${two[0].id}`)).toBeUndefined();
  const slow = [photo('a', T), photo('a', T + 1), photo('a', T + 10 * 60_000), photo('a', T + 10 * 60_000 + 1)];
  expect(albumsIn(slow).size).toBe(0);
});

test('a caption, a reply or View once stays on its own', () => {
  const ms = [photo('a', T), photo('a', T + 1, { text: 'look' }), photo('a', T + 2), photo('a', T + 3), photo('a', T + 4), photo('a', T + 5)];
  const albums = albumsIn(ms);
  expect(albums.get(`a/${ms[1].id}`)).toBeUndefined();
  expect(albums.get(`a/${ms[2].id}`)).toHaveLength(4);
});
