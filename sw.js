// Service worker: appskal offline, kartbilder cache-först, API-data nätverk-först
const APP = 'ulnav-app-v78';
const TILES = 'ulnav-tiles-v1';
const DATA = 'ulnav-data-v1';
const SHELL = [
  './', 'index.html', 'integritet.html', 'manual.html', 'manifest.webmanifest', 'css/app.css',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet-rotate.js',
  'js/app.js', 'js/util.js', 'js/settings.js', 'js/map.js', 'js/openaip.js', 'js/airports.js', 'js/aero.js',
  'js/terrain.js', 'js/vector.js', 'js/draw.js', 'js/diag.js', 'js/icons.js', 'js/config.js', 'js/library.js', 'js/cloud.js', 'js/account.js', 'js/customlayers.js', 'js/logbook.js', 'js/login.js', 'js/scene.js',
  'vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/maplibre-gl.css', 'vendor/maplibre/leaflet-maplibre-gl.js', 'vendor/supabase/supabase.js', 'vendor/shp/shp.min.js', 'vendor/jszip/jszip.min.js', 'js/sun.js', 'js/wx.js', 'js/route.js', 'js/profile.js', 'js/nav.js', 'js/offline.js', 'js/version.js', 'js/hillshade.js', 'js/traffic.js', 'js/aircraft.js', 'js/fields.js', 'js/flight.js',
  'icons/icon.svg', 'fonts/outfit-700.woff2', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const TILE_HOSTS = /tile\.openstreetmap\.org|tile\.opentopomap\.org|arcgisonline\.com|newaydata\.com|tiles\.openaip\.net|elevation-tiles-prod|tilecache\.rainviewer\.com|tiles\.openfreemap\.org|cache\.kartverket\.no|geodata\.naturvardsverket\.se|lansstyrelsen\.se/;
const MAX_TILES = 20000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![APP, TILES, DATA].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // appskal: nätverk först (så uppdateringar slår igenom), annars cache.
    // cache: 'no-cache' gör att webbläsarens HTTP-cache (GitHub Pages: 10 min) alltid valideras mot servern.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(APP).then((ca) => ca.put(req, c)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  if (/tiles\.openfreemap\.org$/.test(url.hostname) && !/\.(pbf|png|jpg|webp|mvt)$/.test(url.pathname)) {
    // vektorkartans stil och tileset-beskrivning: nätverk först (pekar ut aktuell kartversion), cache som reserv
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(TILES).then((ca) => ca.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
    return;
  }
  if (TILE_HOSTS.test(url.hostname) && !/rainviewer\.com$/.test(url.hostname)) {
    // kartbilder: cache först. Radarbilder sparas inte (de blir inaktuella).
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trim(c); }
        return r;
      } catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  if (/open-meteo\.com|aviationweather\.gov|ourairports-data/.test(url.href)) {
    // väder/data: nätverk först, cache som reserv offline
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(DATA).then((ca) => ca.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
  }
});

let trimming = false, puts = 0;
async function trim(c) {
  if (trimming || ++puts % 200) return; trimming = true;
  try {
    const keys = await c.keys();
    if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES)) await c.delete(k);
  } finally { trimming = false; }
}
