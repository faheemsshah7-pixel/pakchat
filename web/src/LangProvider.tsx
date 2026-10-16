// LangProvider.tsx: holds the chosen language and remembers it in the browser.
// The layout stays the same in both languages (you asked for that): only the words change.
// Urdu words still read right-to-left by themselves: the browser knows Urdu letters go that way.
import { useEffect, useState, type ReactNode } from 'react'
import { LangContext, type Lang } from './lang'
import { en, ur } from './strings'

function savedLang(): Lang {
  try {
    return localStorage.getItem('lang') === 'ur' ? 'ur' : 'en'
  } catch {
    return 'en'
  }
}

export default function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(savedLang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = 'ltr' // (Urdu doesn't flip the screen around)
  }, [lang])

  function setLang(next: Lang) {
    setLangState(next)
    try {
      localStorage.setItem('lang', next)
    } catch {
      // Private windows can block storage. The app still works, it just forgets.
    }
  }

  return <LangContext.Provider value={{ lang, t: lang === 'ur' ? ur : en, setLang }}>{children}</LangContext.Provider>
}
