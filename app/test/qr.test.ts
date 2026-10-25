import { describe, expect, test } from 'vitest';

import { qrLink, qrPath, userFromQr } from '../src/core/qr';

describe('QR codes', () => {
  test('my code is a link that reads back as me', () => {
    expect(userFromQr(qrLink('u_123-abc'))).toBe('u_123-abc');
    expect(userFromQr(' pakchat://u/abc/ ')).toBe('abc');
    expect(userFromQr('https://example.com/u/abc')).toBeNull();
    expect(userFromQr('pakchat://u/a b')).toBeNull();
  });

  test('the drawing has the three corner squares', () => {
    const { d, n } = qrPath(qrLink('0b5f2c1e-1111-2222-3333-444455556666'));
    expect(n).toBeGreaterThanOrEqual(21);
    // A finder pattern's top edge: seven dark squares from the top-left corner.
    expect(d.startsWith('M0 0h7v1h-7z')).toBe(true);
  });
});
