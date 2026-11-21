import { describe, expect, it } from 'vitest';
import { callLink, outsidePath } from '../src/core/callLink';

// Another app (or a web page) can open pakchat://call/<id>?answer=1 while a call
// rings. Only our own alert's Answer, which carries the one-time key the phone
// made for that call, may pick up.
describe('call links', () => {
  const ok = (id: string, key: string) => id === 'c1' && key === 'goodkey';

  it('a plain answer=1 link from outside only opens the ringing screen', () => {
    expect(callLink('pakchat://call/c1?chat=x&answer=1', ok)).toEqual({ id: 'c1', answer: false });
  });

  it('a wrong key, or the key of another call, does not answer', () => {
    expect(callLink('pakchat://call/c1?chat=x&answer=1&k=badkey', ok)).toEqual({ id: 'c1', answer: false });
    expect(callLink('pakchat://call/c2?chat=x&answer=1&k=goodkey', ok)).toEqual({ id: 'c2', answer: false });
  });

  it("our own alert's Answer (with its key) answers", () => {
    expect(callLink('pakchat://call/c1?chat=x&answer=1&k=goodkey', ok)).toEqual({ id: 'c1', answer: true });
  });

  it('a tap on the alert itself opens the call; other links are not calls', () => {
    expect(callLink('pakchat://call/c1?chat=x', ok)).toEqual({ id: 'c1', answer: false });
    expect(callLink('pakchat://chat/c1', ok)).toBeNull();
  });
});

describe('other links from outside', () => {
  it('never carry an answer flag to the call screen', () => {
    expect(outsidePath('pakchat://call?id=c1&answer=1')).toBe('pakchat://call?id=c1');
    expect(outsidePath('/call?answer=1&id=c1')).toBe('/call?id=c1');
    expect(outsidePath('/(tabs)/call?id=c1&answer=1&x=2')).toBe('/(tabs)/call?id=c1&x=2');
    expect(outsidePath('/qr?user=abc')).toBe('/qr?user=abc');
  });
});
