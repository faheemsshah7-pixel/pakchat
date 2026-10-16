// links.ts: link previews, like WhatsApp's. Type or paste a web address and a card appears above
// the message box: the page's picture, title and a line about it. Send, and the card goes with
// the message.
//
// A browser can't read other websites by itself (they don't allow it), so two free services help:
//   microlink.io   reads the page and says its title, description and picture
//   wsrv.nl        shrinks that picture to a small thumbnail
// Only the SENDER asks them. The card (with the thumbnail inside it) is saved in the message,
// so the people you send it to don't visit those services, or the website, until they tap it.
// Settings > Privacy > Link previews turns this off (then nothing is sent to those services).
import { blobToDataUrl } from './media'

export type LinkPreview = {
  url: string
  title: string
  description?: string
  site?: string // "dawn.com"
  image?: string // a small thumbnail, as a data: address
}

// The first web address in some words (the same ones RichText.tsx makes clickable).
const LINK = /\b(?:https?:\/\/|www\.)[^\s<]+/i
export function firstLink(text: string) {
  const found = text.match(LINK)?.[0].replace(/[.,!?;:)\]'"]+$/, '')
  if (!found) return null
  return found.toLowerCase().startsWith('www.') ? 'https://' + found : found
}

const cache = new Map<string, Promise<LinkPreview | null>>()
const THUMB_MAX = 40_000 // letters in the thumbnail's data address (about 30 KB)

// The card for a web address (or null if the page has nothing to show). Asked once per address.
export function fetchPreview(url: string) {
  let got = cache.get(url)
  if (!got) {
    got = load(url).catch((err) => {
      console.warn('No preview for', url, err)
      return null
    })
    cache.set(url, got)
  }
  return got
}

async function load(url: string): Promise<LinkPreview | null> {
  const res = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))
  if (!res.ok) return null
  const { data } = await res.json()
  const title = cut(data?.title, 200)
  if (!title) return null
  const preview: LinkPreview = { url, title }
  const description = cut(data.description, 300)
  if (description && description !== title) preview.description = description
  preview.site = cut(data.publisher, 100) || new URL(url).hostname.replace(/^www\./, '')
  const picture = data.image?.url ?? data.logo?.url
  if (typeof picture === 'string' && picture.startsWith('http')) {
    const image = await thumbnail(picture).catch(() => '')
    if (image) preview.image = image
  }
  return preview
}

// The page's picture, shrunk to a square of 160 by 160 (a JPEG, about 5 to 15 KB).
async function thumbnail(picture: string) {
  const res = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(picture)}&w=160&h=160&fit=cover&output=jpg&q=70`)
  if (!res.ok) return ''
  const data = await blobToDataUrl(await res.blob())
  return data.length <= THUMB_MAX && data.startsWith('data:image/') ? data : ''
}

function cut(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
