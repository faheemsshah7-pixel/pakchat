// The link cards' parts that run on a computer: finding the address, and
// reading a page's title, description and picture.
import { describe, expect, test } from 'vitest';

import { decodeEntities, firstUrl, readPage } from '../src/core/linkParse';

describe('firstUrl', () => {
  test('finds the first address, without the full stop or bracket after it', () => {
    expect(firstUrl('see https://dawn.com/news/1.')).toBe('https://dawn.com/news/1');
    expect(firstUrl('(https://x.com/a) and http://b.pk')).toBe('https://x.com/a');
    expect(firstUrl('wiki https://en.wikipedia.org/wiki/Lahore_(city) ok')).toBe('https://en.wikipedia.org/wiki/Lahore_(city)');
  });
  test('none, or not a real site', () => {
    expect(firstUrl('no links here')).toBeNull();
    expect(firstUrl('http://localhost:4000/x')).toBeNull();
  });
});

describe('readPage', () => {
  test('Open Graph tags win over the title, in either attribute order', () => {
    const html = `<html><head><title>Plain</title>
      <meta content="Dawn &amp; more" property="og:title">
      <meta property="og:description" content="  News   from Pakistan ">
      <meta property="og:image" content="/pic.jpg"></head></html>`;
    expect(readPage(html, 'https://www.dawn.com/news')).toEqual({ title: 'Dawn & more', description: 'News from Pakistan', site: 'dawn.com', image: 'https://www.dawn.com/pic.jpg' });
  });
  test('falls back to <title>, and drops pictures that are not web addresses', () => {
    const r = readPage('<title>Hello</title><meta property="og:image" content="javascript:alert(1)">', 'https://a.pk');
    expect(r.title).toBe('Hello');
    expect(r.image).toBeUndefined();
  });
  test('entities', () => {
    expect(decodeEntities('&#39;a&#x41;&quot;')).toBe(`'aA"`);
  });
});
