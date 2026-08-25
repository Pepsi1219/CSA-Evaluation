// Copyright (c) 2025 Pongsathon. All rights reserved. Proprietary — see LICENSE.
//
// SERVICE WORKER — source. vite-plugin-pwa (injectManifest strategy) reads
// this file, replaces `self.__WB_MANIFEST` with the array of hashed asset
// filenames Vite emitted into dist/, and writes the result to dist/sw.js.
//
// Cache strategy stays the same as pre-Vite:
//   - Install pre-caches the injected manifest (Vite's hashed filenames, so
//     bumping any asset invalidates it automatically).
//   - Fetch is network-first with a 3 s timeout — factory Wi-Fi is flaky and
//     we'd rather show a slightly stale cache than a spinner. Cascade:
//       online + fast  → fresh network, update cache
//       online + slow  → cache
//       offline        → cache; navigations fall back to /index.html;
//                        anything else returns a synthetic 503 (never
//                        `undefined`, which would crash respondWith)
//   - Activate deletes every cache whose name != CACHE.
//
// Keep the CACHE literal in lock-step with APP_VERSION (src/version.js).
// The byte change is what forces old clients to drop stale caches, so it can't
// be derived from an import (this file is not an ES module). test/version.test.js
// fails the build if this literal drifts.
const CACHE = 'csa-v1.22.0';
const NET_TIMEOUT_MS = 3000;

// Injected at build time by vite-plugin-pwa. In dev the manifest is empty,
// so precache no-ops silently.
const MANIFEST = self.__WB_MANIFEST || [];
const ASSETS = MANIFEST.map(e => (typeof e === 'string' ? e : e.url));

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            // Individual .add() calls so one 404 doesn't kill the whole install
            // (Cache.addAll is atomic — one failure rolls the batch back).
            .then(cache => Promise.all(ASSETS.map(url => cache.add(url).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

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
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
            return res;
        } catch (_) {
            const cached = await caches.match(e.request);
            if (cached) return cached;
            if (e.request.mode === 'navigate') {
                const shell = await caches.match('/index.html');
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
