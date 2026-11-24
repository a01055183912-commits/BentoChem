// 앱처럼 설치하고, 인터넷이 약해도 화면이 열리도록 최소한만 저장합니다. 페이지·공고 데이터는 항상 새 것을 먼저 받습니다.
const V = 'bentochem-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/logo.png', 'assets/mascot.webp', 'assets/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  const fresh = r.mode === 'navigate' || /\.(html|json)$/.test(u.pathname) || u.pathname.endsWith('/');
  if (fresh) {
    e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); return res; })
      .catch(() => caches.match(r).then((m) => m || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); return res; })));
  }
});
