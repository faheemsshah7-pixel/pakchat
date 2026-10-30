// App.tsx: which page to show. Phones get "Get the PakChat app"; computers
// get the QR page, then "Loading your chats", then the app itself.

import { lazy, Suspense, useEffect } from 'react';

import { WALLPAPERS } from './core/core';
import { usePhase, useSettings } from './core/hooks';
import { onPhone } from './device';
import { LinkPage } from './screens/LinkPage';
import { Loading } from './screens/Loading';
import { PhonePage } from './screens/PhonePage';
import { Overlays } from './ui/overlay';

// The app itself loads while the QR shows, so it's ready by the time the phone has scanned.
const loadShell = () => import('./screens/Shell');
const Shell = lazy(() => loadShell().then((m) => ({ default: m.Shell })));

export function App() {
  const phase = usePhase();
  useTheme();

  useEffect(() => {
    if (phase === 'signedOut' || phase === 'syncing') {
      const id = setTimeout(() => void loadShell(), 300);
      return () => clearTimeout(id);
    }
  }, [phase]);

  useEffect(() => {
    document.body.classList.toggle('page', onPhone || phase === 'signedOut');
  }, [phase]);

  if (onPhone) return <PhonePage />;
  return (
    <div className="app">
      {phase === 'loading' ? (
        <Loading quiet />
      ) : phase === 'signedOut' ? (
        <LinkPage />
      ) : phase === 'syncing' ? (
        <Loading />
      ) : (
        <Suspense fallback={<Loading quiet />}>
          <Shell />
        </Suspense>
      )}
      <Overlays />
    </div>
  );
}

/** Light, dark, or the computer's own setting. The QR page is always light, like WhatsApp's. */
function useTheme() {
  const { theme, wallpaper } = useSettings();
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      // A chat wallpaper colour, in place of the theme's own.
      const wall = wallpaper != null ? WALLPAPERS[wallpaper] : undefined;
      const root = document.documentElement.style;
      if (wall) {
        root.setProperty('--wall', dark ? wall.dark : wall.light);
        root.setProperty('--wallSolid', dark ? wall.dark : wall.light);
      } else {
        root.removeProperty('--wall');
        root.removeProperty('--wallSolid');
      }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161717' : '#F7F5F3');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, wallpaper]);
}
