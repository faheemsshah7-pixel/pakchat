// drafts.ts: what you typed but didn't send yet, for each chat.
// It's kept on this device, so you can switch chats and come back to it,
// and the chat list shows "Draft: ..." in the meantime.
import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let version = 0

export function getDraft(chatId: string) {
  try {
    return localStorage.getItem('draft:' + chatId) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(chatId: string, text: string) {
  const before = getDraft(chatId)
  if (text === before) return
  try {
    if (text.trim()) localStorage.setItem('draft:' + chatId, text)
    else localStorage.removeItem('draft:' + chatId)
  } catch {
    return
  }
  // Only tell the screens when a draft appears or disappears, not on every letter:
  // the chat you're typing in doesn't show its draft, and re-drawing the whole chat list
  // on every key press made typing slow on phones. (The list reads the words again when you leave the chat.)
  if (!before.trim() === !text.trim()) return
  version++
  listeners.forEach((listener) => listener())
}

// Screens that show drafts call this, so they re-draw when a draft changes.
export function useDraftsVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}
