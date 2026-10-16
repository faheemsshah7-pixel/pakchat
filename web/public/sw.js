// sw.js: PakChat's "service worker", a small helper the browser runs for the website.
// It's what lets you install PakChat as an app, and it keeps a copy of the app's files
// so PakChat still opens when the internet is slow or down. (Messages still need the internet.)
// Only files from PakChat's own website are kept. Messages and photos are never stored here.
const CACHE = 'pakchat-v1'

self.addEventListener('install', () => self.skipWaiting()) // use a new version straight away
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/__/')) return

  if (request.mode === 'navigate') {
    // The page itself: always try the internet first (so you get updates), else the saved copy.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/')),
    )
  } else if (url.pathname.startsWith('/assets/')) {
    // Built files have a fingerprint in their name (like index-BqJLAJMK.js), so a saved copy is never out of date.
    // (A file from an old version that's gone comes back as the page instead. That isn't kept:
    // PakChat then reloads itself into the new version, see src/screens/lazy.ts.)
    event.respondWith(
      caches.match(request).then(
        (saved) =>
          saved ||
          fetch(request).then((response) => {
            const isPage = (response.headers.get('content-type') ?? '').includes('text/html')
            if (response.ok && !isPage) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
