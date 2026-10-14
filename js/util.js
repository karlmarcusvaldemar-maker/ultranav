// Gemensamma hjälpfunktioner: geodesi, formattering, lagring, UI-hjälp.
import { icon } from './icons.js';

export const R_NM = 3440.065;          // jordradie i nautiska mil
export const FT_PER_M = 3.28084;
export const KMH_PER_KT = 1.852;
const d2r = Math.PI / 180, r2d = 180 / Math.PI;

export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => { a = norm360(a); return a > 180 ? a - 360 : a; };

/** Storcirkelavstånd i NM */
export function distNM(a, b) {
  const φ1 = a.lat * d2r, φ2 = b.lat * d2r, dφ = φ2 - φ1, dλ = (b.lon - a.lon) * d2r;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial sann bäring a→b i grader */
export function bearing(a, b) {
  const φ1 = a.lat * d2r, φ2 = b.lat * d2r, dλ = (b.lon - a.lon) * d2r;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return norm360(Math.atan2(y, x) * r2d);
}

/** Punkt på avstånd d (NM) och bäring brg från p */
export function destPoint(p, brg, d) {
  const δ = d / R_NM, θ = brg * d2r, φ1 = p.lat * d2r, λ1 = p.lon * d2r;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * r2d, lon: norm180(λ2 * r2d) };
}

/** Interpolera längs storcirkel, f ∈ [0,1] */
export function interp(a, b, f) {
  const d = distNM(a, b);
  if (d < 1e-6) return { lat: a.lat, lon: a.lon };
  return destPoint(a, bearing(a, b), d * f);
}

/** Tvärsavvikelse (NM, + = höger om kurslinjen) och avstånd längs linjen från a */
export function crossTrack(a, b, p) {
  const d13 = distNM(a, p) / R_NM;
  const θ13 = bearing(a, p) * d2r, θ12 = bearing(a, b) * d2r;
  const xt = Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12));
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt))));
  return { xtk: xt * R_NM, along: at * R_NM * Math.sign(Math.cos(θ13 - θ12)) };
}

/** Punkt-i-polygon (GeoJSON-ring [[lon,lat],...]) */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeometry(lon, lat, g) {
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((rings) => pointInRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => pointInRing(lon, lat, h)));
}

/** Vindtriangel: returnerar vindkorrektionsvinkel (WCA), sann kurs (TH) och GS */
export function windTriangle(tc, tas, windFrom, windSpd) {
  if (!windSpd || !tas) return { wca: 0, th: tc, gs: tas };
  const wa = (windFrom - tc) * d2r;
  const s = (windSpd / tas) * Math.sin(wa);
  if (Math.abs(s) >= 1) return { wca: NaN, th: NaN, gs: NaN }; // vinden starkare än TAS
  const wca = Math.asin(s);
  const gs = tas * Math.cos(wca) - windSpd * Math.cos(wa);
  return { wca: wca * r2d, th: norm360(tc + wca * r2d), gs };
}

// ---------- formattering ----------
export const pad = (n, w = 2) => String(Math.trunc(n)).padStart(w, '0');
export const fmtDeg = (d) => (d == null || isNaN(d) ? '---' : pad(Math.round(norm360(d)) % 360 || 360, 3));
export function fmtHM(hours) {
  if (hours == null || !isFinite(hours) || hours < 0) return '--:--';
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}
export const fmtUTC = (date) => (date ? `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : '--:--');
export const fmtLocal = (date) => (date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '--:--');
export function fmtLatLon(lat, lon) {
  const f = (v, p, n) => {
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return `${v >= 0 ? p : n}${d}°${m.toFixed(2).padStart(5, '0')}'`;
  };
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- lagring ----------
export const store = {
  get(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('localStorage', e); } },
};

// Minimal IndexedDB nyckel/värde-lagring (för stora datamängder)
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('ulnav', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export const idb = {
  async get(k) {
    try { const d = await db(); return await new Promise((res, rej) => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
    catch { return undefined; }
  },
  async set(k, v) {
    try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
    catch (e) { console.warn('idb', e); }
  },
};

// ---------- nätverk ----------
/** Bygg proxyadress. Godtar "https://x.workers.dev/?url={url}", ett prefix som slutar på "=", eller bara grundadressen. */
export function withProxy(url, proxy) {
  if (!proxy) return url;
  proxy = proxy.trim();
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(url));
  if (/[=?]$/.test(proxy)) return proxy + encodeURIComponent(url);
  return proxy.replace(/\/?$/, '/') + '?url=' + encodeURIComponent(url); // bara grundadressen angiven
}
/** fetch med timeout. Med proxy: prova direkt först och gå via proxyn bara om direktanropet misslyckas,
 *  så att en felkonfigurerad proxy inte slår ut källor som klarar sig utan den. */
export async function fetchX(url, { timeout = 20000, proxy = '', headers, as = 'json' } = {}) {
  const once = async (u) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(u, { signal: ctl.signal, headers });
      if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.http = true; throw e; }
      if (as === 'blob') return await r.blob();
      const text = await r.text();
      if (as !== 'json') return text;
      return text.trim() ? JSON.parse(text) : null; // tomt svar (t.ex. HTTP 204: ingen data) → null
    } finally { clearTimeout(t); }
  };
  if (!proxy) return once(url);
  try { return await once(url); }
  catch (e) {
    if (e.http && !/HTTP (0|403|429)/.test(e.message)) throw e; // servern svarade med ett riktigt fel — proxyn hjälper inte
    try { return await once(withProxy(url, proxy)); }
    catch (e2) { throw new Error(`${e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'blockerad' : e.message}; via proxy: ${e2.message}`); }
  }
}

// ---------- UI ----------
let toastT;
export function toast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), ms);
}
export function modal(html) {
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
/** Meddelanderuta med ikon: kind = 'ok' | 'warn' | 'bad' */
export const note = (kind, html, ico) => `<div class="${kind}box">${icon(ico || { ok: 'ok', warn: 'alert', bad: 'alert' }[kind], 20)}<div>${html}</div></div>`;
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function download(filename, text, type = 'application/gpx+xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
