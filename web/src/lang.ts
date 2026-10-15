// lang.ts: which language the app is in. Any screen can call useT() to get the words.
import { createContext, useContext } from 'react'
import { en, type Strings } from './strings'

export type Lang = 'en' | 'ur'
export type LangState = { lang: Lang; t: Strings; setLang: (lang: Lang) => void }

export const LangContext = createContext<LangState>({ lang: 'en', t: en, setLang: () => {} })

export function useT() {
  return useContext(LangContext)
}
