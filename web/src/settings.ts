// settings.ts: settings saved on THIS device only (in the browser's "localStorage"),
// like sounds and text size. Your look (theme.ts) and language work the same way.
import { useSyncExternalStore } from 'react'

export type TextSize = 'small' | 'medium' | 'large'
export type Settings = {
  sounds: boolean // a little sound when a message arrives
  textSize: TextSize // how big messages are written
  enterSends: boolean // Enter sends; Shift+Enter makes a new line
  lowDataCalls: boolean // lower picture quality in video calls, to save mobile data (calls.ts)
}

const DEFAULTS: Settings = { sounds: true, textSize: 'medium', enterSends: true, lowDataCalls: false }
const listeners = new Set<() => void>()
let current: Settings = load()

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }
  } catch {
    return DEFAULTS // private windows can block storage
  }
}

export function getSetting<K extends keyof Settings>(key: K) {
  return current[key]
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  current = { ...current, [key]: value } // a new object, so React sees the change
  try {
    localStorage.setItem('settings', JSON.stringify(current))
  } catch {
    // not saved, but still works until you close the tab
  }
  applySettings()
  listeners.forEach((listener) => listener())
}

// Text size is a CSS rule in index.css: [data-text-size='large'] makes bubbles bigger.
export function applySettings() {
  document.documentElement.dataset.textSize = current.textSize
}

// All the settings, for a screen. The screen re-draws when one changes.
export function useSettings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
