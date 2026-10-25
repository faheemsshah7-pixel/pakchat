// WhatsApp's formatting marks, links and big emoji in message words.
import { expect, test } from 'vitest';

import { emojiOnly, findLinks, parseInline, parseRich, plainText, readMoreCut } from '../src/core/richText';

const styled = (text: string) => parseInline(text).map((s) => [s.text, s.bold ? 'b' : '', s.italic ? 'i' : '', s.strike ? 's' : '', s.code ? 'c' : '', s.link?.kind ?? ''].join('|'));

test('bold, italic, strike and code', () => {
  expect(styled('a *big* day')).toEqual(['a |||||', 'big|b||||', ' day|||||']);
  expect(styled('_so_ ~not~ `x = 1`')).toEqual(['so||i|||', ' |||||', 'not|||s||', ' |||||', 'x = 1||||c|']);
  expect(styled('*_both_*')).toEqual(['both|b|i|||']);
  expect(styled('```*not bold*```')).toEqual(['*not bold*||||c|']);
});

test('marks that are not marks stay as they are', () => {
  expect(
    parseInline('2*3*4')
      .map((s) => s.text)
      .join(''),
  ).toBe('2*3*4');
  expect(parseInline('snake_case_name').every((s) => !s.italic)).toBe(true);
  expect(parseInline('* not bold *').every((s) => !s.bold)).toBe(true);
  expect(parseInline('*two\nlines*').every((s) => !s.bold)).toBe(true);
  expect(
    parseInline('**')
      .map((s) => s.text)
      .join(''),
  ).toBe('**');
});

test('links, emails and phone numbers', () => {
  const kinds = (t: string) => findLinks(t).map((l) => [t.slice(l.start, l.end), l.target]);
  expect(kinds('see pakchat.pk/help.')).toEqual([['pakchat.pk/help', 'https://pakchat.pk/help']]);
  expect(kinds('go to https://example.com/a_b_c now')).toEqual([['https://example.com/a_b_c', 'https://example.com/a_b_c']]);
  expect(kinds('mail ali@gmail.com')).toEqual([['ali@gmail.com', 'mailto:ali@gmail.com']]);
  expect(kinds('call 0300-1234567 or +92 321 7654321')).toEqual([
    ['0300-1234567', 'tel:03001234567'],
    ['+92 321 7654321', 'tel:+923217654321'],
  ]);
  expect(kinds('on 2026-10-25 at 12345')).toEqual([]);
  // Underscores in a link aren't italics.
  expect(parseInline('www.x.com/_a_').find((s) => s.link)?.text).toBe('www.x.com/_a_');
});

test('bullets, numbers and quotes', () => {
  const lines = parseRich('- milk\n* eggs\n1. first\n> said\nplain');
  expect(lines.map((l) => l.kind)).toEqual(['bullet', 'bullet', 'number', 'quote', 'text']);
  expect(plainText('*Hi* _there_\n- one')).toBe('Hi there\n• one');
});

test('emoji on their own', () => {
  expect(emojiOnly('😂')).toBe(1);
  expect(emojiOnly('❤️👍🏽')).toBe(2);
  expect(emojiOnly('👨‍👩‍👧')).toBe(1);
  expect(emojiOnly('🇵🇰')).toBe(1);
  expect(emojiOnly('😂😂😂😂')).toBe(0);
  expect(emojiOnly('ok 😂')).toBe(0);
});

test('read more only for long messages', () => {
  expect(readMoreCut('short')).toBeNull();
  const long = 'word '.repeat(300);
  const cut = readMoreCut(long)!;
  expect(cut).toBeGreaterThan(500);
  expect(long[cut]).toBe(' ');
});
