// New chat's "Find on PakChat" row: what counts as a number or a Gmail.
import { describe, expect, it } from 'vitest';

import { lookupKind } from '../src/core/lookupKind';

describe('lookupKind', () => {
  it('reads Pakistani numbers with and without +92', () => {
    for (const typed of ['0300 1234567', '03001234567', '+92 300 1234567', '+923001234567', '923001234567', '0300-1234567', '(0300) 1234567']) {
      expect(lookupKind(typed), typed).toEqual({ kind: 'phone', phone: '+923001234567' });
    }
  });

  it('reads other countries with their code', () => {
    expect(lookupKind('+44 7700 900123')).toEqual({ kind: 'phone', phone: '+447700900123' });
  });

  it('reads Gmail with and without "@gmail.com"', () => {
    expect(lookupKind('sara.khan@gmail.com')).toEqual({ kind: 'email', email: 'sara.khan@gmail.com' });
    expect(lookupKind('Sara.Khan@Gmail.com')).toEqual({ kind: 'email', email: 'sara.khan@gmail.com' });
    expect(lookupKind('sarakhan92')).toEqual({ kind: 'email', email: 'sarakhan92@gmail.com' });
    expect(lookupKind('  sara.khan  ')).toEqual({ kind: 'email', email: 'sara.khan@gmail.com' });
  });

  it('leaves names and half-typed things alone', () => {
    for (const typed of ['', '   ', 'Sara', 'Sara Khan', 'ali', '0300', '12345', 'sara@', '@gmail.com', 'sara khan@gmail.com', '.sarakhan', 'sarakhan.', 'علی رضا']) {
      expect(lookupKind(typed), typed).toBeNull();
    }
  });
});
