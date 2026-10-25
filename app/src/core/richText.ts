// richText.ts: reading a message's words the way WhatsApp shows them.
//
//   *bold*  _italic_  ~strike~  `code`  ```monospace```
//   "- " or "* " at the start of a line: a bullet (•); "> ": a quote
//   web addresses, emails and phone numbers: tappable
//
// The marks only count where WhatsApp counts them: the opening one at the
// start or after a space or punctuation, the closing one before a space,
// punctuation or the end, with no space just inside either, and on one line.
// Nothing inside a web address is ever taken as a mark (example.com/a_b_c).
// Kept free of React so it can be tested on a computer (test/richText.test.ts).

export type LinkKind = 'url' | 'email' | 'phone';

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: { kind: LinkKind; target: string };
};

export type Line = { kind: 'text' | 'bullet' | 'quote' | 'number'; spans: Span[]; number?: string };

// A web address: with http(s)://, starting www., or a name with a known ending
// (pakchat.pk, google.com/maps). Trailing punctuation stays outside it.
const URL_RE = /\b(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|pk|io|co|edu|gov|info|me|app|dev|ly|uk|in|ae|sa|tv|gg|ai)(?:\/[^\s<>"]*)?)/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
// A phone number: + and 8 to 15 digits (+92 300 1234567), or 10 to 13 starting
// with 0 (0300-1234567), maybe with spaces or dashes between groups.
const PHONE_RE = /(^|[\s(])(\+?\d[\d -]{5,17}\d)(?=$|[\s),.!?])/g;

function trimUrl(u: string, before: string | undefined) {
  // "see pakchat.pk." or "(www.x.com)": the dot or bracket isn't part of it.
  // A closing * _ ~ is only left off when the address is wrapped in that mark
  // ("*pakchat.pk*"); otherwise it belongs to the address (www.x.com/_a_).
  let out = u;
  for (;;) {
    const last = out[out.length - 1];
    if (/[.,!?;:'")\]]/.test(last ?? '')) {
      if (last === ')' && (out.match(/\(/g)?.length ?? 0) >= (out.match(/\)/g)?.length ?? 0)) break;
    } else if (!(last && '*_~'.includes(last) && before === last)) break;
    out = out.slice(0, -1);
  }
  return out;
}

/** Where the web addresses, emails and phone numbers are, in order, not overlapping. */
export function findLinks(text: string): { start: number; end: number; kind: LinkKind; target: string }[] {
  const found: { start: number; end: number; kind: LinkKind; target: string }[] = [];
  const add = (start: number, end: number, kind: LinkKind, target: string) => {
    if (found.some((f) => start < f.end && end > f.start)) return;
    found.push({ start, end, kind, target });
  };
  for (const m of text.matchAll(EMAIL_RE)) add(m.index, m.index + m[0].length, 'email', `mailto:${m[0]}`);
  for (const m of text.matchAll(URL_RE)) {
    const u = trimUrl(m[0], text[m.index - 1]);
    // "name@site.com" is an email (found above), not a web address.
    if (text[m.index - 1] === '@') continue;
    add(m.index, m.index + u.length, 'url', /^https?:\/\//i.test(u) ? u : `https://${u}`);
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const number = m[2];
    const digits = number.replace(/[^\d+]/g, '');
    const count = digits.replace('+', '').length;
    const ok = digits.startsWith('+') ? count >= 8 && count <= 15 : digits.startsWith('0') && count >= 10 && count <= 13;
    if (!ok) continue;
    const start = m.index + m[1].length;
    add(start, start + number.length, 'phone', `tel:${digits}`);
  }
  return found.sort((a, b) => a.start - b.start);
}

const MARKS: Record<string, keyof Pick<Span, 'bold' | 'italic' | 'strike' | 'code'>> = { '*': 'bold', _: 'italic', '~': 'strike', '`': 'code' };
// A letter or digit (English or Urdu): marks touching one aren't marks ("2*3*4", "snake_case").
const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9\u00C0-\u024F\u0600-\u06FF\u0750-\u077F]/.test(c);

/** One line's words, as styled pieces, with the links marked. */
export function parseInline(text: string): Span[] {
  const links = findLinks(text);
  const inLink = (i: number) => links.some((l) => i >= l.start && i < l.end);
  const out: Span[] = [];

  const emit = (from: number, to: number, style: Omit<Span, 'text' | 'link'>) => {
    if (to <= from) return;
    // Split the piece where links start and end.
    let at = from;
    for (const l of links) {
      if (l.end <= at || l.start >= to) continue;
      if (l.start > at) out.push({ ...style, text: text.slice(at, l.start) });
      const end = Math.min(l.end, to);
      out.push({ ...style, text: text.slice(Math.max(at, l.start), end), link: { kind: l.kind, target: l.target } });
      at = end;
    }
    if (at < to) out.push({ ...style, text: text.slice(at, to) });
  };

  const walk = (start: number, end: number, style: Omit<Span, 'text' | 'link'>) => {
    let from = start;
    let i = start;
    while (i < end) {
      // ```monospace```: nothing inside it is read as marks.
      if (text.startsWith('```', i) && !inLink(i)) {
        const close = text.indexOf('```', i + 3);
        if (close > i + 3 && close + 3 <= end) {
          emit(from, i, style);
          emit(i + 3, close, { ...style, code: true });
          i = close + 3;
          from = i;
          continue;
        }
      }
      const c = text[i];
      const kind = MARKS[c];
      if (kind && !inLink(i) && !isWord(text[i - 1]) && text[i + 1] !== undefined && !/\s/.test(text[i + 1]) && text[i + 1] !== c) {
        let j = i + 2;
        let close = -1;
        for (; j < end; j++) {
          if (text[j] === '\n') break;
          if (text[j] === c && !inLink(j) && !/\s/.test(text[j - 1]) && !isWord(text[j + 1])) {
            close = j;
            break;
          }
        }
        if (close > 0) {
          emit(from, i, style);
          if (kind === 'code') emit(i + 1, close, { ...style, code: true });
          else walk(i + 1, close, { ...style, [kind]: true });
          i = close + 1;
          from = i;
          continue;
        }
      }
      i++;
    }
    emit(from, end, style);
  };

  walk(0, text.length, {});
  return out;
}

/** The whole message, line by line, with bullets, numbers and quotes. */
export function parseRich(text: string): Line[] {
  return text.split('\n').map((raw): Line => {
    const bullet = /^\s*[-*] (?=\S)/.exec(raw);
    if (bullet) return { kind: 'bullet', spans: parseInline(raw.slice(bullet[0].length)) };
    const quote = /^> ?/.exec(raw);
    if (quote && raw.length > quote[0].length) return { kind: 'quote', spans: parseInline(raw.slice(quote[0].length)) };
    const number = /^\s*(\d{1,3})\. (?=\S)/.exec(raw);
    if (number) return { kind: 'number', number: number[1], spans: parseInline(raw.slice(number[0].length)) };
    return { kind: 'text', spans: parseInline(raw) };
  });
}

/** Just the words, without the marks (for the chat list and alerts). */
export function plainText(text: string) {
  return parseRich(text)
    .map((l) => (l.kind === 'bullet' ? '• ' : l.kind === 'number' ? `${l.number}. ` : '') + l.spans.map((s) => s.text).join(''))
    .join('\n');
}

/** One to three emoji and nothing else: shown large, like WhatsApp. 0 when it isn't. */
export function emojiOnly(text: string) {
  const t = text.trim();
  if (!t || t.length > 40) return 0;
  let count = 0;
  let joined = false;
  for (const ch of t) {
    const cp = ch.codePointAt(0)!;
    // Joiners and modifiers belong to the emoji before them.
    if (cp === 0x200d) {
      joined = true;
      continue;
    }
    if (cp === 0xfe0f || cp === 0x20e3 || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f)) continue;
    // Flags come in pairs of letters.
    const flagLetter = cp >= 0x1f1e6 && cp <= 0x1f1ff;
    const emoji =
      flagLetter ||
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2300 && cp <= 0x23ff) ||
      (cp >= 0x2b00 && cp <= 0x2bff) ||
      cp === 0x00a9 ||
      cp === 0x00ae ||
      cp === 0x3030 ||
      cp === 0x303d ||
      cp === 0x3297 ||
      cp === 0x3299 ||
      (cp >= 0x2190 && cp <= 0x21ff) ||
      cp === 0x2122 ||
      cp === 0x2139;
    if (!emoji) return 0;
    if (joined) {
      joined = false;
      continue;
    }
    count += flagLetter ? 0.5 : 1;
  }
  const n = Math.ceil(count);
  return n >= 1 && n <= 3 ? n : 0;
}

/** Long messages show their start and "Read more", like WhatsApp. Where to cut, or null for short ones. */
export function readMoreCut(text: string, max = 700) {
  if (text.length <= max + 100) return null;
  const space = text.lastIndexOf(' ', max);
  return space > max * 0.7 ? space : max;
}
