// i18n: the website in English or Urdu (Settings › Chats › Language, or the
// link on the QR page). Words are looked up by their English, so English is
// always there to fall back on: ur.ts has the Urdu, most of it the same as
// the phone app's. Urdu turns the page right to left and uses Noto Nastaliq.
// The choice is kept in this browser, so the QR page shows it too. Changing
// it reloads the page, so every word (lists made when a file loads too) is
// in the new language.

import { UR } from './ur';

export type Lang = 'en' | 'ur';

const KEY = 'pakchat:lang';
let lang: Lang = read();

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
}

export const getLang = () => lang;

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private windows: it lasts until the tab closes.
  }
  location.reload();
}

/** The page's direction and font, for the language now. */
export function applyLang() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ur' ? 'rtl' : 'ltr';
  if (lang === 'ur' && !document.getElementById('urdu-font')) {
    const link = Object.assign(document.createElement('link'), {
      id: 'urdu-font',
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap',
    });
    document.head.append(link);
  }
}

/** The words in the language now (`tr`, so it never clashes with a `t` in the code); `{name}`-style gaps filled from `values`. */
export function tr(text: string, values?: Record<string, string | number>) {
  const words = lang === 'ur' ? (UR[text] ?? text) : text;
  return values ? words.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? String(values[k]) : all)) : words;
}
