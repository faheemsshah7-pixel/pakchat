// letters.ts: a person's letters and colours, with no UI or core imports.
// The core (alerts, calls) uses these too, so they must not pull in kit.tsx:
// kit reads the core, and importing it from the core made a loop that
// crashed the app at start.

const URDU = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** True when the words have Urdu (or Arabic) letters in them. */
export const hasUrdu = (s: string) => URDU.test(s);

export const TINTS_SKY: [string, string, string][] = [
  ['#DCE9FF', '#C5D9FD', '#1E3A8A'],
  ['#D9F0FF', '#C0E3FB', '#0B4A75'],
  ['#E3E2FF', '#CFCDFB', '#3730A3'],
];
export const TINTS_DARK: [string, string, string][] = [
  ['#24262C', '#24262C', '#C9D3E6'],
  ['#272A31', '#272A31', '#BFD0F0'],
  ['#22252B', '#22252B', '#D3D7E0'],
];

export function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A person's picture colours (the light look), for alerts drawn outside the app. */
export function avatarTint(id: string) {
  const [a, b, ink] = TINTS_SKY[hash(id) % TINTS_SKY.length];
  return { a, b, ink };
}

/** "Ayesha Khan" → "A", "FAST CS-B" → "FC". */
export function initials(name: string) {
  // "~ Sara" (someone not in my contacts) is still S.
  const words = name.replace(/^~\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1 || hasUrdu(name)) return [...words[0]][0].toUpperCase();
  const two = words[0] === words[0].toUpperCase() && words[1] === words[1].toUpperCase();
  return two ? ([...words[0]][0] + [...words[1]][0]).toUpperCase() : [...words[0]][0].toUpperCase();
}
