// pwa.ts: installing PakChat as an app on a computer or phone.
// It's still the same website, but it gets its own icon and opens in its own window.
// This needs two files in web/public: manifest.webmanifest (the app's name and icons)
// and sw.js (a "service worker", a small helper the browser runs for the website).
import { useSyncExternalStore } from 'react'

// Chrome and Edge fire "beforeinstallprompt" when the site can be installed.
// We keep it, and show it when you click "Install PakChat".
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let promptEvent: InstallPrompt | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // don't show the browser's own little bar; we have a button
  promptEvent = e as InstallPrompt
  changed()
})
window.addEventListener('appinstalled', () => {
  promptEvent = null
  changed()
})

export function registerServiceWorker() {
  // Only on the real website. While building (npm run dev) it would keep old files around.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error)
  }
}

// Already running as an installed app?
export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches

// true when the browser can install PakChat right now.
export function useCanInstall() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => promptEvent !== null,
  )
}

export async function install() {
  if (!promptEvent) return
  await promptEvent.prompt() // the browser asks "Install PakChat?"
  await promptEvent.userChoice
  promptEvent = null
  changed()
}
