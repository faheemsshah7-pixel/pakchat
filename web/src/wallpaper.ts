// wallpaper.ts: the background behind a chat's messages. "Default" is the look's own
// (with its little drawings, see index.css). You can pick a colour instead, or one of your photos.
//
// Saved in users/<you>/wallpapers/<chatId> for one chat, and users/<you>/wallpapers/default
// for every chat that doesn't have its own (Settings > Chats > Wallpaper).
// Private, like prefs.ts: only you see your wallpapers. They follow you to any device.
// No document = "Default".
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Strings } from './strings'

export type Wallpaper = {
  kind: 'colour' | 'photo'
  colour?: string // kind 'colour': like '#d9fdd3'
  doodles?: boolean // kind 'colour': the little drawings on top (false = a plain colour)
  data?: string // kind 'photo': the photo itself, shrunk (a "data URL", see media.ts)
  dim?: number // kind 'photo': 0 to 0.6, how much darker it is made (so messages stand out)
}

// The document for every chat without its own. (Chat ids never look like this.)
export const ALL_CHATS = 'default'
export const MAX_DIM = 0.6

// The colours to pick from: light ones, then dark ones.
export const WALL_COLOURS = [
  '#efeae2', '#d9fdd3', '#cfe9f5', '#e5ddf6', '#f8d9d9', '#fbe3c4', '#fff4b8', '#dce8d2',
  '#0b141a', '#1f2c34', '#103b2a', '#1b2a4a', '#3b1f33', '#33281c',
]

// Is a colour dark? Then its drawings are white; on a light colour they're dark brown.
// (How bright a colour looks: green counts most, blue least, like our eyes.)
export function isDark(colour: string) {
  const n = parseInt(colour.slice(1), 16)
  const [red, green, blue] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * red + 0.587 * green + 0.114 * blue < 128
}

const wallRef = (uid: string, id: string) => doc(db, 'users', uid, 'wallpapers', id)

// One wallpaper, kept up to date live. null = none ("Default").
// (It remembers which document the answer is for, so switching chats never shows the last chat's.)
export function useWallDoc(uid: string, id: string) {
  const [found, setFound] = useState<{ id: string; wall: Wallpaper | null } | null>(null)
  useEffect(
    () =>
      onSnapshot(
        wallRef(uid, id),
        (snap) => setFound({ id, wall: snap.exists() ? (snap.data() as Wallpaper) : null }),
        () => setFound({ id, wall: null }), // (can't read it: use the default)
      ),
    [uid, id],
  )
  return found?.id === id ? found.wall : null
}

// A chat's wallpaper: its own, or else the one for all chats.
//   own:  this chat's (null = it uses the one for all chats)
//   all:  the one for all chats (null = the look's own)
//   shown: the one to show
export function useWallpaper(uid: string, chatId: string) {
  const own = useWallDoc(uid, chatId)
  const all = useWallDoc(uid, ALL_CHATS)
  return { own, all, shown: own ?? all }
}

// "Default", "Colour" or "Your photo", for the line under "Wallpaper" in Settings and chat info.
export function wallLabel(wall: Wallpaper | null, t: Strings) {
  return !wall ? t.wallDefault : wall.kind === 'photo' ? t.wallPhoto : t.colour
}

// Save a wallpaper for one chat (or ALL_CHATS). null = back to "Default".
export function setWallpaper(uid: string, id: string, wall: Wallpaper | null) {
  return wall ? setDoc(wallRef(uid, id), wall) : deleteDoc(wallRef(uid, id))
}

// How a wallpaper is drawn: the style for the "wall" behind the messages (index.css, part 6).
//   a colour: the colour, and the drawings (--pattern) in white or dark brown, or none
//   a photo:  the photo, covering the wall, with a see-through black layer on top to darken it
// (useMemo: the same style object until the wallpaper changes, so a big photo isn't handled again
// every time the chat redraws.)
export function useWallStyle(wall: Wallpaper | null | undefined) {
  return useMemo(() => wallStyle(wall), [wall])
}

export function wallStyle(wall: Wallpaper | null | undefined): CSSProperties | undefined {
  if (wall?.kind === 'photo' && wall.data) {
    const dim = Math.min(MAX_DIM, Math.max(0, wall.dim ?? 0))
    return {
      backgroundImage: `linear-gradient(rgb(0 0 0 / ${dim}), rgb(0 0 0 / ${dim})), url("${wall.data}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      '--pattern-opacity': 0,
    } as CSSProperties
  }
  if (wall?.kind === 'colour' && wall.colour) {
    const dark = isDark(wall.colour)
    return {
      background: wall.colour,
      '--pattern': dark ? '#ffffff' : '#5c5040',
      '--pattern-opacity': wall.doodles === false ? 0 : dark ? 0.06 : 0.08,
    } as CSSProperties
  }
  return undefined // the look's own
}
