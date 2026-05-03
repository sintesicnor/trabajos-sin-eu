const CACHE_NAME = 'gestor-sin-v1.65';

const LOCAL_ASSETS = [
    '/index.html',
    '/icon.svg',
];

const CDN_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js',
];

// Hosts whose requests should never be intercepted (live API calls)
const BYPASS_HOSTS = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'recaptchaenterprise.googleapis.com',
    'www.googleapis.com',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll(LOCAL_ASSETS).then(() =>
                Promise.allSettled(
                    CDN_ASSETS.map(url =>
                        fetch(url, { mode: 'cors' })
                            .then(res => { if (res.ok) return cache.put(url, res); })
                            .catch(() => {})
                    )
                )
            )
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) return;

    const isCDN = url.hostname !== self.location.hostname;

    if (isCDN) {
        // CDN assets: cache-first (versioned URLs won't change)
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.ok) {
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, response.clone()));
                    }
                    return response;
                });
            })
        );
    } else {
        // App shell: network-first, fall back to cache
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response.ok) {
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, response.clone()));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
    }
});
