// back.ts: the phone's Back button (or swipe), and the browser's ← button, inside PakChat.
//
// A website normally leaves when you press Back, because it's all one page. So PakChat keeps
// one extra step in the browser's history, called the "guard". Pressing Back uses up the guard.
// We put a new guard straight back, and close whatever is on top instead: a menu, a window,
// a photo, an info panel, a chat. On the main chat list there's nothing to close, so you stay.
//
// Anything that Back should close calls useBack() while it's open (see Modal.tsx for one).
import { useEffect } from 'react'
import { useStable } from './stable'

// How "high up" each kind of thing is. Back closes the highest one that's open
// (if two are level, the newest).
export const LEVEL = {
  page: 1, // Settings, Calls, New chat… (back to the chat list)
  chat: 2, // a chat
  panel: 3, // contact or group info, starred messages, search
  cover: 4, // a photo or video full screen, the call screen, picking photos to send
  window: 5, // a small window (Modal.tsx)
  menu: 6, // a menu or the emoji picker
}

type Layer = { level: number; order: number; close: () => void }
const layers = new Set<Layer>()
let opened = 0 // counts up, so we know which layer is newest

// While `open` is true, Back calls close().
export function useBack(open: boolean, level: number, close: () => void) {
  const onBack = useStable(close) // (always the latest close, without re-registering)
  useEffect(() => {
    if (!open) return
    const layer = { level, order: ++opened, close: onBack }
    layers.add(layer)
    return () => {
      layers.delete(layer)
    }
  }, [open, level, onBack])
}

const isGuard = () => history.state?.pakchat === 'guard'

function addGuard() {
  // (Same address: the guard is the page you're on, one step further on.)
  history.pushState({ ...history.state, pakchat: 'guard' }, '')
}

// Back was pressed: we're one step back, off the guard.
function backPressed() {
  if (isGuard()) return // (Forward was pressed, back onto the guard: nothing to do)
  addGuard()
  const top = [...layers].sort((a, b) => b.level - a.level || b.order - a.order)[0]
  top?.close()
}

// Called once when PakChat starts (main.tsx).
export function startBack() {
  if (!isGuard()) addGuard() // (after a reload we're already on the guard)
  window.addEventListener('popstate', backPressed)
  // Browsers may skip a guard that was added before you touched the page, so when you
  // tap or type, make sure there is one.
  const check = () => !isGuard() && addGuard()
  window.addEventListener('pointerdown', check, true)
  window.addEventListener('keydown', check, true)
}
