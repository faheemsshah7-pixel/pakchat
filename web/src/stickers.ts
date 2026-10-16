// stickers.ts: stickers. PakChat comes with a pack of its own (an emoji with a few words),
// and you can make your own from any photo. Smiley > Stickers.
//
// A sticker message is kind 'sticker' with either
//   sticker: 'pk:salam'   one of the pack below (only its name is sent, so it's tiny)
//   mediaId              a sticker you made: a small picture, saved like a photo (media.ts)
// "My stickers" (ones you made or saved) are kept on this device only.

export type PackSticker = { id: string; emoji: string; words: string; colour: string }

// The PakChat pack. To add one, add a line: its id (short, no spaces), emoji, words and colour.
export const PACK: PackSticker[] = [
  { id: 'pk:salam', emoji: '👋', words: 'Salam!', colour: '#25d366' },
  { id: 'pk:shukriya', emoji: '🙏', words: 'Shukriya', colour: '#ffb300' },
  { id: 'pk:mashallah', emoji: '✨', words: 'MashaAllah', colour: '#7e57c2' },
  { id: 'pk:inshallah', emoji: '🤲', words: 'InshaAllah', colour: '#26a69a' },
  { id: 'pk:chai', emoji: '☕', words: 'Chai?', colour: '#8d6e63' },
  { id: 'pk:wah', emoji: '🤩', words: 'Wah!', colour: '#ef6c00' },
  { id: 'pk:eid', emoji: '🌙', words: 'Eid Mubarak', colour: '#00897b' },
  { id: 'pk:lol', emoji: '😂', words: 'LOL', colour: '#fdd835' },
  { id: 'pk:love', emoji: '❤️', words: 'Love you', colour: '#e53935' },
  { id: 'pk:miss', emoji: '🥺', words: 'Miss you', colour: '#ec407a' },
  { id: 'pk:congrats', emoji: '🎉', words: 'Congrats!', colour: '#43a047' },
  { id: 'pk:onmyway', emoji: '🚗', words: 'On my way', colour: '#1e88e5' },
  { id: 'pk:goodnight', emoji: '😴', words: 'Good night', colour: '#3949ab' },
  { id: 'pk:goodmorning', emoji: '🌞', words: 'Good morning', colour: '#fb8c00' },
  { id: 'pk:yaar', emoji: '🤝', words: 'Yaar!', colour: '#00acc1' },
  { id: 'pk:kya', emoji: '😳', words: 'Kya?!', colour: '#f4511e' },
  { id: 'pk:theekhai', emoji: '👍', words: 'Theek hai', colour: '#5e35b1' },
  { id: 'pk:cricket', emoji: '🏏', words: 'Pakistan Zindabad', colour: '#2e7d32' },
  { id: 'pk:biryani', emoji: '🍛', words: 'Biryani time', colour: '#d84315' },
  { id: 'pk:jazak', emoji: '🌹', words: 'جزاک اللہ', colour: '#c2185b' },
  { id: 'pk:shukria-ur', emoji: '💐', words: 'شکریہ', colour: '#00796b' },
  { id: 'pk:khush', emoji: '😊', words: 'خوش رہو', colour: '#f9a825' },
]

export const packSticker = (id: string | undefined) => PACK.find((s) => s.id === id)

// ---------- My stickers (this device only) ----------
const KEY = 'pakchat.stickers'
const MAX_MINE = 20

export function myStickers(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

// Newest first. If the device runs out of room, the oldest ones go.
export function keepSticker(data: string) {
  let list = [data, ...myStickers().filter((s) => s !== data)].slice(0, MAX_MINE)
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list))
      return list
    } catch {
      list = list.slice(0, -1)
    }
  }
  return list
}

export function forgetSticker(data: string) {
  const list = myStickers().filter((s) => s !== data)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // (nothing to do: it just stays)
  }
  return list
}

// Make a sticker from a photo: a square from the middle, with round corners and a white edge,
// like WhatsApp's sticker maker. WebP keeps it small (PNG on browsers that can't make WebP).
export async function makeSticker(file: File) {
  const image = await createImageBitmap(file)
  const size = 384
  const edge = 14
  const side = Math.min(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const round = (inset: number, radius: number) => {
    g.beginPath()
    g.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius)
  }
  round(0, 64)
  g.fillStyle = '#fff'
  g.fill()
  g.save()
  round(edge, 52)
  g.clip()
  g.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, edge, edge, size - edge * 2, size - edge * 2)
  g.restore()
  const webp = canvas.toDataURL('image/webp', 0.8)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
}
