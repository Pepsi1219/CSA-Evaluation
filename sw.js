
// Keep this literal in lock-step with APP_VERSION in version.js — the byte
// change here is what forces old clients to re-install the SW and drop stale
// caches (some older browsers don't re-check importScripts'd files, so the
// canonical value is duplicated here on purpose). test/version.test.js fails
// the build if this drifts from version.js.
const CACHE  = 'csa-v1.16.0';  // ← bump on every deploy; must match version.js
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './version.js',
    './calc.js',
    './timeutil.js',
    './translations.js',
    './chart.js',
    './history.js',
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

// Fetch: Network-First with 3s timeout + robust offline fallback
// - Online + fast  → fresh from network, updates cache
// - Online + slow  → after 3s bail to cache (factory Wi-Fi is flaky)
// - Offline        → serve from cache; navigations fall back to index.html;
//                    everything else returns a synthetic 503 (never `undefined`,
//                    which would crash respondWith and show the browser's
//                    native offline page).
const NET_TIMEOUT_MS = 3000;

function fetchWithTimeout(request) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('net-timeout')), NET_TIMEOUT_MS);
        fetch(request).then(
            res => { clearTimeout(timer); resolve(res); },
            err => { clearTimeout(timer); reject(err); }
        );
    });
}

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

    e.respondWith((async () => {
        try {
            const res = await fetchWithTimeout(e.request);
            // Cache the fresh response for offline use (fire-and-forget)
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
            return res;
        } catch (_) {
            const cached = await caches.match(e.request);
            if (cached) return cached;
            // Navigation without a cache entry → serve the app shell
            if (e.request.mode === 'navigate') {
                const shell = await caches.match('./index.html');
                if (shell) return shell;
            }
            return new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' },
            });
        }
    })());
});
