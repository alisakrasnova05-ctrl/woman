const CACHE = 'travelhub-shell-v1';
const SHELL = ['/', '/styles.css', '/app.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    try {
      const response = await fetch(request);
      if (response.ok && (new URL(request.url).pathname.startsWith('/api/') || SHELL.includes(new URL(request.url).pathname))) {
        const cache = await caches.open(CACHE); cache.put(request, response.clone());
      }
      return response;
    } catch {
      if (cached) return cached;
      if (request.mode === 'navigate') return (await caches.match('/')) || Response.error();
      return Response.error();
    }
  })());
});
