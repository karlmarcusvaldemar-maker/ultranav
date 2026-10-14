// Terränghöjd från AWS Terrain Tiles (Terrarium-PNG, öppen data: SRTM, GMTED, ETOPO m.fl.)
import { settings } from './settings.js';
import { interp, distNM, FT_PER_M } from './util.js';

const Z = 10;               // ≈ 75 m/pixel på 60°N
const cache = new Map();    // "x/y" → Promise<ImageData|null>

function tileXY(lat, lon, z) {
  const n = 2 ** z, φ = lat * Math.PI / 180;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * n;
  return { x, y };
}

function loadTile(x, y) {
  const k = `${x}/${y}`;
  if (!cache.has(k)) {
    const url = settings.tiles.terrain.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
    cache.set(k, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        const c = document.createElement('canvas'); c.width = 256; c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, 256, 256);
      })
      .catch(() => { cache.delete(k); return null; }));
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return cache.get(k);
}

/** Höjd i meter över havet (null om okänd) */
export async function elevationM(lat, lon, r = 0) {
  const t = tileXY(lat, lon, Z);
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  const img = await loadTile(tx, ty);
  if (!img) return null;
  const px = Math.min(255, Math.floor((t.x - tx) * 256)), py = Math.min(255, Math.floor((t.y - ty) * 256));
  const d = img.data;
  let m = -Infinity;
  // r > 0: högsta värdet i omgivningen (±r pixlar) så att toppar mellan samplingspunkter inte missas
  for (let y = Math.max(0, py - r); y <= Math.min(255, py + r); y++)
    for (let x = Math.max(0, px - r); x <= Math.min(255, px + r); x++) {
      const i = (y * 256 + x) * 4;
      m = Math.max(m, d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768);
    }
  return Math.max(m, 0); // hav/sjö → 0
}
export const elevationFt = async (lat, lon, r = 0) => { const m = await elevationM(lat, lon, r); return m == null ? null : m * FT_PER_M; };

/** Profil längs rutt: [{d (NM från start), lat, lon, ft, leg}] */
export async function routeProfile(points, maxSamples = 360) {
  if (points.length < 2) return [];
  const legs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) { const d = distNM(points[i], points[i + 1]); legs.push(d); total += d; }
  const step = Math.max(0.25, total / maxSamples);
  const samples = [];
  let acc = 0;
  for (let i = 0; i < legs.length; i++) {
    const n = Math.max(1, Math.ceil(legs[i] / step));
    for (let j = 0; j <= n; j++) {
      if (j === 0 && i > 0) continue;
      const f = j / n, p = interp(points[i], points[i + 1], f);
      samples.push({ d: acc + legs[i] * f, lat: p.lat, lon: p.lon, leg: i });
    }
    acc += legs[i];
  }
  // Högsta terräng inom ≈ ±150 m runt varje punkt (master/byggnader ingår INTE i höjddata)
  await Promise.all(samples.map(async (s) => { s.ft = await elevationFt(s.lat, s.lon, 2); }));
  return samples;
}
