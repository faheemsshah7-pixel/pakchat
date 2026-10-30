// main.tsx: starts PakChat Web.

import './styles/tokens.css';
import './styles/app.css';
import './styles/live.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { core } from './core/core';
import { onPhone } from './device';

// Phones only see "Get the PakChat app", so they never load the chat engine.
if (!onPhone) void core.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After a new version goes live, an open tab may ask for a screen's old file, which is gone.
// Load the new version instead (once a minute at most, so a real outage can't loop).
addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const last = Number(sessionStorage.getItem('pakchat-reloaded') ?? 0);
  if (Date.now() - last > 60_000) {
    sessionStorage.setItem('pakchat-reloaded', String(Date.now()));
    location.reload();
  }
});

// The saved copy of the app's files, so a second visit opens at once (and offline).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
