// Förladdning av kartbilder längs rutten (för flygning utan mobiltäckning)
import { settings, oaipKey, proxyUrl } from './settings.js';
import { route } from './route.js';
import { currentBase, overlayOn } from './map.js';
import { interp, distNM, toast } from './util.js';

export const TILE_CACHE = 'ulnav-tiles-v1';

function tileXY(lat, lon, z) {
  const n = 2 ** z, φ = lat * Math.PI / 180;
  return { x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * n) };
}
function fill(tpl, z, x, y) {
  return tpl.replace('{s}', 'abc'[(x + y) % 3]).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{key}', encodeURIComponent(oaipKey()));
}

/** Lista tile-URL:er i en korridor (±corridor NM) längs rutten */
// Bara Standardkartan (OpenFreeMap) får förladdas. OpenStreetMap, OpenTopoMap och Esri tillåter inte massnedladdning.
export function routeTiles({ corridor = 8, zMin = 7, zMax = 12 } = {}, vecTpl = null) {
  const sources = [];
  if (vecTpl) sources.push({ tpl: vecTpl, max: 14 });
  sources.push({ tpl: settings.tiles.terrain, max: 10, only: 10 });
  const urls = new Set();
  const w = route.wps;
  for (let z = zMin; z <= zMax; z++) {
    const set = new Set();
    for (let i = 0; i < w.length - 1; i++) {
      const d = distNM(w[i], w[i + 1]), n = Math.max(1, Math.ceil(d / 2));
      for (let j = 0; j <= n; j++) {
        const p = interp(w[i], w[i + 1], j / n);
        const dLat = corridor / 60, dLon = corridor / 60 / Math.cos(p.lat * Math.PI / 180);
        const a = tileXY(p.lat + dLat, p.lon - dLon, z), b = tileXY(p.lat - dLat, p.lon + dLon, z);
        for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) set.add(`${x}/${y}`);
      }
    }
    for (const s of sources) {
      if (z > s.max || (s.only && z !== s.only)) continue;
      for (const k of set) { const [x, y] = k.split('/'); urls.add(fill(s.tpl, z, +x, +y)); }
    }
  }
  return [...urls];
}

export async function downloadRoute(onProgress) {
  if (route.wps.length < 2) { toast('Skapa en rutt först'); return; }
  if (!('caches' in window)) { toast('Webbläsaren saknar stöd för offline-cache'); return; }
  let vecTpl = null;
  try { vecTpl = (await (await fetch('https://tiles.openfreemap.org/planet')).json()).tiles?.[0] || null; }
  catch { toast('Kunde inte nå Standardkartan — sparar bara terräng', 5000); }
  const urls = routeTiles({}, vecTpl);
  if (urls.length > 8000) { toast(`För många kartbilder (${urls.length}). Korta rutten eller dela upp den.`); return; }
  if (currentBase() !== 'vecLiberty') toast('Offline sparas Standardkartan (övriga baskartor tillåter inte förladdning). Byt till Standardkartan under flygningen.', 6000);
  const cache = await caches.open(TILE_CACHE);
  let done = 0, fail = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        if (!(await cache.match(u))) {
          // Försök med CORS först; källor utan CORS-huvuden sparas som opaka svar
          const r = await fetch(u, { mode: 'cors' }).catch(() => fetch(u, { mode: 'no-cors' }));
          if (r.ok || r.type === 'opaque') await cache.put(u, r); else fail++;
        }
      } catch { fail++; }
      done++; onProgress?.(done, urls.length, fail);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  toast(`Offline: ${done - fail} av ${urls.length} kartbilder sparade${fail ? ` (${fail} misslyckades)` : ''}`, 5000);
}

export async function cacheInfo() {
  if (!('caches' in window)) return null;
  const c = await caches.open(TILE_CACHE);
  const n = (await c.keys()).length;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  return { n, usedMB: est ? est.usage / 1e6 : null, quotaMB: est ? est.quota / 1e6 : null };
}
export async function clearTiles() { await caches.delete(TILE_CACHE); }
