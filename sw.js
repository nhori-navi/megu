// sw.js：ホーム画面のアプリのための裏方（MeguMiru 版14。版15〜18：キャッシュの番号を上げた）
// ・アプリの画面（html・css・js・絵）は、電波がつながっていれば毎回新しいものを取り、取れないときはしまってある分を使う（ネット優先）
// ・地図の道具（Mapbox の js・css）は版の番号付きなので、しまってある分を先に使う
// ・場所データ（data/）・地図の絵・Wikipedia・フリマの取り次ぎ役などは、アプリが自分で覚えているので、ここでは何もしない
const CACHE = 'megu-shell-v18';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/base.js', 'js/data.js', 'js/rec.js', 'js/map.js', 'js/zukan.js', 'js/gpx.js', 'js/michi.js', 'js/near.js',
  'js/wiki.js', 'js/plan.js', 'js/flea.js', 'js/ui.js', 'js/help.js', 'js/main.js', 'config.js'];
const MAPBOX = /^https:\/\/api\.mapbox\.com\/mapbox-gl-js\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('megu-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (MAPBOX.test(req.url)) {                      // 地図の道具：しまってある分を先に
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;  // ほかのサイトは何もしない
  if (url.pathname.includes('/data/')) return;      // 場所データはアプリが覚えている
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      // 電波がないとき：同じ名前のファイル（?v= の番号は見ない）をしまった分から
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
