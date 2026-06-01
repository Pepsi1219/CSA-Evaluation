// CSA Evaluation Calculator — Service Worker v1.2.1
// Strategy: Network-First (always fetch fresh, fallback to cache when offline)
const CACHE  = 'csa-v1.2.1';  // ← bump version on every deploy to clear old cache
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon.svg',
];

// Install: pre-cache core assets
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: delete ALL old caches immediately
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: Network-First
// - Online  → fetches fresh from network, updates cache
// - Offline → serves from cache (last downloaded version)
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

    e.respondWith(
        fetch(e.request)
            .then(res => {
                // Cache the fresh response for offline use
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request)) // Offline fallback
    );
});
