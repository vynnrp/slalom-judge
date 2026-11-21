// Offline cache: after the first visit the app (pose model included) works without internet.
const VERSION = 'slalom-judge-v5';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './src/app.js', './src/styles.css', './src/features.js', './src/classifier.js', './src/cones.js',
  './src/default-config.js', './src/tricks-matrix.js',
  './vendor/tasks-vision/vision_bundle.mjs',
  './vendor/tasks-vision/wasm/vision_wasm_internal.js', './vendor/tasks-vision/wasm/vision_wasm_internal.wasm',
  './vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.js', './vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm',
  './models/pose_landmarker_full.task',
  './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first for the app code (so updates arrive), cache first for the big model/runtime files.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const big = /\.(wasm|task)$|vision_bundle\.mjs$|vision_wasm/.test(url.pathname);
  if (big) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  } else {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request)));
  }
});
