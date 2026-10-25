// linkParse.ts: finding a web address in what you write, and reading a page's
// title, description and picture from its HTML (the "Open Graph" tags most
// sites have). No phone code here, so the tests run on a computer.

/** The first web address in some words, without the full stop or bracket after it. */
export function firstUrl(text: string): string | null {
  const m = /\bhttps?:\/\/[^\s<>"'`]+/i.exec(text);
  if (!m) return null;
  let url = m[0];
  // "see https://x.com/a." or "(https://x.com/a)": the last mark isn't part of it.
  while (/[.,!?;:'")\]}]$/.test(url)) {
    if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  try {
    const u = new URL(url);
    return u.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+[0-9]*);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

const tidy = (s: string | undefined, max: number) => {
  if (!s) return undefined;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : undefined;
};

/** One <meta> tag's content, by its property or name (in either order of attributes). */
function meta(html: string, key: string): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${k}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i').exec(html);
  if (a) return a[1];
  const b = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${k}["']`, 'i').exec(html);
  return b?.[1];
}

export type PageInfo = { title?: string; description?: string; site?: string; image?: string };

/** What a page says about itself. `url` is where it came from (for pictures named relative to it). */
export function readPage(html: string, url: string): PageInfo {
  const head = html.slice(0, 300_000);
  const title = tidy(meta(head, 'og:title') ?? meta(head, 'twitter:title') ?? /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1], 300);
  const description = tidy(meta(head, 'og:description') ?? meta(head, 'twitter:description') ?? meta(head, 'description'), 500);
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Not a real address: no site name.
  }
  const site = tidy(meta(head, 'og:site_name'), 100) ?? (host || undefined);
  const raw = meta(head, 'og:image') ?? meta(head, 'og:image:url') ?? meta(head, 'twitter:image');
  let image: string | undefined;
  if (raw) {
    try {
      const abs = new URL(decodeEntities(raw.trim()), url);
      if (abs.protocol === 'https:' || abs.protocol === 'http:') image = abs.toString();
    } catch {
      // A broken picture address: no picture.
    }
  }
  return { title, description, site, image };
}
