// theme.ts: the app's "looks". Each look is a set of colours in index.css,
// switched on by <html data-theme="...">. Your choice is remembered in the browser.
//   Aurora is the default, and the login screens are always Aurora.
//   auto = Emerald by day, Midnight when your device is in dark mode.
import { useLayoutEffect } from 'react'

export const THEMES = ['aurora', 'emerald', 'midnight', 'sunset', 'ocean', 'auto'] as const
export type Theme = (typeof THEMES)[number]

const darkMode = window.matchMedia('(prefers-color-scheme: dark)')

export function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme') as Theme | null
    return saved && THEMES.includes(saved) ? saved : 'aurora' // nothing picked yet: Aurora
  } catch {
    return 'aurora'
  }
}

// Put a look on the page (and remember it, if `save` is true).
export function applyTheme(theme: Theme, save = true) {
  const look = theme === 'auto' ? (darkMode.matches ? 'midnight' : 'emerald') : theme
  document.documentElement.dataset.theme = look
  // Phones colour their address bar to match. index.css says which colour, in --theme-color.
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colour)
  if (!save) return
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // Private windows can block storage. The look still changes, it just isn't remembered.
  }
}

// If you picked "auto" and your device switches between light and dark, follow it.
darkMode.addEventListener('change', () => {
  if (savedTheme() === 'auto') applyTheme('auto', false)
})

// Show one look on this screen only, then go back to yours when the screen closes.
// The login screens use it, so they're always Aurora whatever look you picked.
// (useLayoutEffect runs before the screen is drawn, so there's no flash of the other look.)
export function useFixedTheme(theme: Exclude<Theme, 'auto'>) {
  useLayoutEffect(() => {
    applyTheme(theme, false)
    return () => applyTheme(savedTheme(), false)
  }, [theme])
}
