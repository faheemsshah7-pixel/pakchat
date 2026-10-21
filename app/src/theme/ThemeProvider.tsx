// ThemeProvider.tsx: the look (Sky or Graphite), the accent colour and the language,
// saved on the phone so the app opens the same way next time.
//
// Any screen can call useTheme() to get the colours, and useT() (src/i18n) for the words.
import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { makeTheme, type Accent, type ModeChoice, type Theme } from './palette';

export type Lang = 'en' | 'ur';

type Prefs = { mode: ModeChoice; accent: Accent; lang: Lang };

type ThemeState = Prefs & {
  theme: Theme;
  rtl: boolean;
  reduceMotion: boolean;
  setPrefs: (change: Partial<Prefs>) => void;
};

const KEY = 'prefs.look';
const DEFAULTS: Prefs = { mode: 'auto', accent: 'blue', lang: 'en' };

// Read once, straight away, so the first frame already has the right look (no flash).
function loadPrefs(): Prefs {
  try {
    const saved = Storage.getItemSync(KEY);
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(loadPrefs);
  const system = useColorScheme();
  const reduceMotion = useReducedMotion();

  const setPrefs = useCallback((change: Partial<Prefs>) => {
    setState((old) => {
      const next = { ...old, ...change };
      Storage.setItemSync(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<ThemeState>(() => {
    // "Auto" follows the phone: dark mode on the phone means Graphite.
    const mode = prefs.mode === 'auto' ? (system === 'dark' ? 'graphite' : 'sky') : prefs.mode;
    return {
      ...prefs,
      theme: makeTheme(mode, prefs.accent),
      rtl: prefs.lang === 'ur',
      reduceMotion,
      setPrefs,
    };
  }, [prefs, system, reduceMotion, setPrefs]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useLook(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error('useLook must be inside ThemeProvider');
  return state;
}

/** Just the colours. */
export function useTheme(): Theme {
  return useLook().theme;
}
