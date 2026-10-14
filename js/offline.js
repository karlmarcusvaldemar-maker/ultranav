// Förladdning av kartbilder längs rutten (för flygning utan mobiltäckning)
import { settings } from './settings.js';
import { route } from './route.js';
import { currentBase, overlayOn } from './map.js';
import { interp, distNM, toast } from './util.js';

export const TILE_CACHE = 'ulnav-tiles-v1';

function tileXY(lat, lon, z) {
  const n = 2 ** z, φ = lat * Math.PI / 180;
  return { x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * n) };
}
function fill(tpl, z, x, y) {
  return tpl.replace('{s}', 'abc'[(x + y) % 3]).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{key}', encodeURIComponent(settings.openaipKey));
}

/** Lista tile-URL:er i en korridor (±corridor NM) längs rutten */
export function routeTiles({ corridor = 8, zMin = 7, zMax = 12 } = {}) {
  const sources = [];
  const base = currentBase();
  // OSM:s standardserver tillåter inte massnedladdning → hoppa över
  if (base === 'otm') sources.push({ tpl: settings.tiles.otm, max: 15 });
  if (base === 'esri') sources.push({ tpl: settings.tiles.esri, max: 18 });
  if (base === 'ofmBase') sources.push({ tpl: settings.tiles.ofmBase, max: 12 });
  if (overlayOn('ofmAero')) sources.push({ tpl: settings.tiles.ofmAero, max: 12 });
  if (overlayOn('openaipTiles') && settings.openaipKey) sources.push({ tpl: settings.tiles.openaip, max: 14 });
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
  const urls = routeTiles();
  if (urls.length > 6000) { toast(`För många kartbilder (${urls.length}). Korta rutten eller dela upp den.`); return; }
  if (currentBase() === 'osm') toast('OpenStreetMap-servern tillåter inte förladdning — välj OpenTopoMap, satellit eller OFM', 5000);
  const cache = await caches.open(TILE_CACHE);
  let done = 0, fail = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors' });
          if (r.ok) await cache.put(u, r); else fail++;
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
