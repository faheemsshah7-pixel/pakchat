// links.ts: link previews, WhatsApp style. When you write a web address, your
// own phone reads the page and makes a little card (title, words, picture),
// which goes inside the locked message. The person you send it to never
// visits the page, and PakChat's server never sees it. Settings › Chats can
// turn the cards off.
import type { LinkPreview } from '@pakchat/shared';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { core } from './core';
import { firstUrl, readPage } from './linkParse';

export { firstUrl };

const cache = new Map<string, Promise<LinkPreview | null>>();

/** The card for a web address, or null if the page can't be read. Asked once per address. */
export function previewOf(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = make(url).catch(() => null);
    cache.set(url, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function make(url: string): Promise<LinkPreview | null> {
  if (!core.settings.linkPreviews) return null;
  const res = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) PakChat/1.0 (link preview)' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type.startsWith('image/')) {
    const thumb = await thumbOf(url);
    return thumb ? { url, thumb, site: new URL(url).hostname.replace(/^www\./, '') } : null;
  }
  if (!type.includes('html')) return null;
  const html = (await res.text()).slice(0, 400_000);
  const page = readPage(html, res.url || url);
  if (!page.title && !page.description) return null;
  const card: LinkPreview = { url };
  if (page.title) card.title = page.title;
  if (page.description) card.description = page.description;
  if (page.site) card.site = page.site;
  if (page.image) {
    const thumb = await thumbOf(page.image).catch(() => undefined);
    if (thumb) card.thumb = thumb;
  }
  return card;
}

/** A small copy of the page's picture, as base64 JPEG (it travels inside the message). */
async function thumbOf(image: string): Promise<string | undefined> {
  const tmp = new File(Paths.cache, `link-${core.newId()}`);
  try {
    const got = await File.downloadFileAsync(image, tmp);
    if (got.size > 8 * 1024 * 1024) return undefined;
    const ctx = ImageManipulator.manipulate(got.uri);
    ctx.resize({ width: 160 });
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ base64: true, compress: 0.55, format: SaveFormat.JPEG });
    return saved.base64 && saved.base64.length < 15_000 ? saved.base64 : undefined;
  } finally {
    if (tmp.exists) tmp.delete();
  }
}
