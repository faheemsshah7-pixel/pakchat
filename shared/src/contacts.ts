// Phone numbers and "who in my contacts is on PakChat?".
//
// Numbers are tidied into one form ("+923001234567") exactly as the server
// does it (server/lib/pakchat/phone.ex), then hashed (SHA-256) on the phone,
// so the address book's numbers are never sent as they are. The server
// answers which hashes belong to someone on PakChat.

/** Tidies a typed number into "+<country><number>", or null if it can't be a number. */
export function normalizePhone(typed: string, defaultCountry = '92'): string | null {
  const digits = typed.trim().replace(/[\s\-().]/g, '');
  let n: string;
  if (digits.startsWith('+')) n = digits.slice(1);
  else if (digits.startsWith('00')) n = digits.slice(2);
  else if (digits.startsWith('0')) n = defaultCountry + digits.slice(1);
  // No "+" or 0: "923001234567" already has the country, "3001234567" doesn't.
  else if (digits.startsWith(defaultCountry)) n = digits;
  else n = defaultCountry + digits;
  return /^[1-9][0-9]{7,14}$/.test(n) ? `+${n}` : null;
}

/** Shows "+923001234567" as "+92 300 1234567" (other countries are left as they are). */
export function formatPhone(phone: string): string {
  const pk = /^\+92(3\d{2})(\d{7})$/.exec(phone);
  return pk ? `+92 ${pk[1]} ${pk[2]}` : phone;
}

/** SHA-256 of some text, as base64. The phone and the website each bring their own. */
export type Sha256 = (text: string) => Promise<string>;

export type ContactCard = { name: string; phones: string[]; emails: string[] };

/**
 * Hashes every number and Gmail in some contacts, ready for `matchContacts`.
 * Returns the hashes, and which contact (by index) each hash came from.
 */
export async function hashContacts(cards: ContactCard[], sha256: Sha256, defaultCountry = '92') {
  const phones = new Map<string, number>();
  const emails = new Map<string, number>();
  for (const [i, card] of cards.entries()) {
    for (const p of card.phones) {
      const n = normalizePhone(p, defaultCountry);
      if (n) phones.set(await sha256(n), i);
    }
    for (const e of card.emails) {
      const clean = e.trim().toLowerCase();
      if (clean.includes('@')) emails.set(await sha256(clean), i);
    }
  }
  return { phones, emails };
}
