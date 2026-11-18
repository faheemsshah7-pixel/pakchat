// lookupKind.ts: does what's typed in New chat's search look like a phone number or a Gmail?
// Then a "Find on PakChat" row shows, like core.lookup reads it: only digits (and + - ( )
// spaces) is a number, an address with "@" is that address, and a plain word of 6 to 30
// letters, digits and dots is the part before "@gmail.com".
import { normalizePhone } from '@pakchat/shared';

export type LookupKind = { kind: 'phone'; phone: string } | { kind: 'email'; email: string };

export function lookupKind(typed: string): LookupKind | null {
  const q = typed.trim().toLowerCase();
  if (!q) return null;
  if (/^[+(0-9][0-9\s\-()]{6,}$/.test(q)) {
    const phone = normalizePhone(q);
    return phone ? { kind: 'phone', phone } : null;
  }
  if (q.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) ? { kind: 'email', email: q } : null;
  return /^[a-z0-9.]{6,30}$/.test(q) && !q.startsWith('.') && !q.endsWith('.') ? { kind: 'email', email: `${q}@gmail.com` } : null;
}
