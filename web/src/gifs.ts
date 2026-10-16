// gifs.ts: GIFs, from KLIPY (a free GIF library; Google closed Tenor's to new apps in 2026).
// The smiley panel has a GIF tab: the popular ones, or search for one ("eid mubarak", "cricket").
// Tap one to send it.
//
// KLIPY needs PakChat's own key, which you get free from their website (see LEARN.md, "Step 21").
// It goes in web/.env.local on your computer as VITE_KLIPY_KEY. Without a key the GIF tab
// simply isn't there.
//
// A GIF message only keeps the GIF's web addresses at KLIPY (small, so the chat stays small):
//   kind: 'gif', gif: { mp4, preview, width, height }
// It plays as a short silent video on a loop, like on WhatsApp. (The rules only allow KLIPY's
// addresses, so nobody can put a picture from some other website in your chat.)
import { useT } from './lang'

export type Gif = {
  mp4: string // the GIF as a small video (much smaller than a .gif file)
  preview: string // a small still-ish .gif, for the panel and while the video loads
  width: number
  height: number
}

const KLIPY = 'https://api.klipy.com/v2/' // (the same questions and answers Tenor's had)
const KEY: string = import.meta.env.VITE_KLIPY_KEY ?? ''

// PakChat's KLIPY key, or '' if there isn't one. (The tests can set one while trying things out.)
export function gifKey() {
  return (import.meta.env.DEV && (window as { pakchatGifKey?: string }).pakchatGifKey) || KEY
}

// The GIFs in the panel: popular ones (no words), or what you searched for.
export async function findGifs(words: string, locale: string) {
  const params = new URLSearchParams({
    key: gifKey(),
    limit: '30',
    media_filter: 'tinygif,mp4',
    contentfilter: 'medium', // nothing rude (KLIPY's "medium" filter)
    country: 'PK',
    locale,
  })
  if (words) params.set('q', words)
  const res = await fetch(KLIPY + (words ? 'search' : 'featured') + '?' + params)
  if (!res.ok) throw new Error('klipy ' + res.status) // (404: KLIPY didn't accept the key)
  const { results } = await res.json()
  const gifs: Gif[] = []
  for (const r of results ?? []) {
    const mp4 = r.media_formats?.mp4
    const tiny = r.media_formats?.tinygif
    if (!isKlipy(mp4?.url) || !isKlipy(tiny?.url)) continue
    const [width, height] = mp4.dims ?? tiny.dims ?? [1, 1]
    gifs.push({ mp4: mp4.url, preview: tiny.url, width, height })
  }
  return gifs
}

export const isKlipy = (url: unknown): url is string => typeof url === 'string' && url.startsWith('https://static.klipy.com/') && url.length <= 300

// The panel's language for KLIPY ("en_PK" or "ur_PK").
export function useGifLocale() {
  const { lang } = useT()
  return lang === 'ur' ? 'ur_PK' : 'en_PK'
}
