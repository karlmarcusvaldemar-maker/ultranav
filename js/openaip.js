// OpenAIP: luftrum, flygfält och rapportpunkter (vektor). Kräver gratis API-nyckel från openaip.net.
import { settings } from './settings.js';
import { idb, fetchX, toast, pointInGeometry, FT_PER_M, distNM } from './util.js';

const API = 'https://api.core.openaip.net/api';
const CELL = 2;                 // cellstorlek: 2° latitud × 4° longitud
const KEY = 'oaip2:';           // ny cachenyckel — äldre cache kan innehålla data från fel område
const MAX_AGE = 7 * 864e5;      // cache 7 dygn

export const airspaces = new Map();   // _id → airspace
export const oaipAirports = new Map();
export const reportingPoints = new Map();
const loadedCells = new Set();
const pending = new Map();
const listeners = new Set();
export const onOpenAipData = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

// ---------- koder ----------
export const AS_TYPE = {
  0: 'Övrigt', 1: 'R (restriktion)', 2: 'D (fara)', 3: 'P (förbud)', 4: 'CTR', 5: 'TMZ', 6: 'RMZ', 7: 'TMA', 8: 'TRA', 9: 'TSA',
  10: 'FIR', 11: 'UIR', 12: 'ADIZ', 13: 'ATZ', 14: 'MATZ', 15: 'Luftled', 16: 'MTR', 17: 'Alert', 18: 'Warning', 19: 'Skyddat',
  20: 'HTZ', 21: 'Segelflygsektor', 22: 'TRP', 23: 'TIZ', 24: 'TIA', 25: 'MTA', 26: 'CTA', 27: 'ACC', 28: 'Flygsport/fritid',
  29: 'Överflygningsbegr.', 30: 'MRT', 31: 'TFR', 32: 'VFR-sektor', 33: 'FIS-sektor', 34: 'LTA', 35: 'UTA', 36: 'MCTR',
};
const ICAO_CLASS = { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G', 8: '–' };
export const AP_TYPE = {
  0: 'Flygplats', 1: 'Segelflygfält', 2: 'Flygfält', 3: 'Int. flygplats', 4: 'Militär helikopter', 5: 'Militär flygplats',
  6: 'UL-fält', 7: 'Helikopterplats', 8: 'Stängt', 9: 'IFR-flygplats', 10: 'Sjöflyg', 11: 'Landningsbana', 12: 'Agri-bana', 13: 'Altiport',
};
const SURFACE = { 0: 'asfalt', 1: 'betong', 2: 'gräs', 3: 'sand', 4: 'vatten', 5: 'asfalt/bitumen', 6: 'tegel', 7: 'makadam',
  8: 'sten', 9: 'korall', 10: 'lera', 11: 'laterit', 12: 'grus', 13: 'jord', 14: 'is', 15: 'snö', 16: 'gummi', 17: 'metall',
  18: 'landningsmatta', 19: 'stålplåt', 20: 'trä', 21: 'icke-bitumen', 22: 'okänt' };
const HIDDEN_TYPES = new Set([10, 11, 15, 27, 33, 35]); // FIR/UIR/luftleder m.m. visas inte

export function asStyle(a) {
  const t = a.type;
  if ([1, 3].includes(t)) return { color: '#d0021b', weight: 2, fillOpacity: 0.12, dashArray: null };
  if (t === 2 || t === 17 || t === 18) return { color: '#e0671b', weight: 2, fillOpacity: 0.08, dashArray: '6 4' };
  if (t === 4 || t === 36) return { color: '#c2185b', weight: 2.5, fillOpacity: 0.10, dashArray: '10 5' };
  if (t === 7 || t === 26) return { color: '#1565c0', weight: 2, fillOpacity: 0.04, dashArray: null };
  if (t === 13 || t === 14 || t === 23 || t === 24) return { color: '#7b1fa2', weight: 2, fillOpacity: 0.08, dashArray: '4 4' };
  if (t === 5 || t === 6) return { color: '#00838f', weight: 2, fillOpacity: 0.05, dashArray: '2 6' };
  if (t === 8 || t === 9 || t === 25) return { color: '#8d6e00', weight: 2, fillOpacity: 0.06, dashArray: '8 4 2 4' };
  if (t === 21 || t === 28) return { color: '#2e7d32', weight: 1.5, fillOpacity: 0.05, dashArray: '3 3' };
  return { color: '#546e7a', weight: 1.5, fillOpacity: 0.03, dashArray: '3 5' };
}
export const asVisible = (a) => !HIDDEN_TYPES.has(a.type);

export function fmtLimit(l) {
  if (!l) return '?';
  if (l.referenceDatum === 0 && !l.value) return 'GND';
  if (l.unit === 6) return `FL${String(l.value).padStart(2, '0')}`;
  const ft = l.unit === 0 ? Math.round(l.value * FT_PER_M) : l.value;
  return `${ft} ft ${['AGL', 'MSL', 'STD'][l.referenceDatum] ?? ''}`.trim();
}
/** Gräns i ft. Returnerar {ft, agl} — FL räknas om med standardtryck (≈) */
export function limitFt(l) {
  if (!l) return { ft: 0, agl: true };
  if (l.unit === 6) return { ft: l.value * 100, agl: false };
  const ft = l.unit === 0 ? l.value * FT_PER_M : l.value;
  return { ft, agl: l.referenceDatum === 0 };
}
export const asClass = (a) => ICAO_CLASS[a.icaoClass] ?? '';
export const asLabel = (a) => `${AS_TYPE[a.type] ?? 'Luftrum'}${asClass(a) && asClass(a) !== '–' ? ' (' + asClass(a) + ')' : ''}`;

// ---------- normalisering av flygfält ----------
export function normAirport(a) {
  const [lon, lat] = a.geometry?.coordinates || [];
  const elev = a.elevation ? (a.elevation.unit === 0 ? a.elevation.value * FT_PER_M : a.elevation.value) : null;
  return {
    id: 'oaip:' + a._id, src: 'OpenAIP', name: a.name, icao: a.icaoCode || '', lat, lon,
    elevFt: elev != null ? Math.round(elev) : null, type: AP_TYPE[a.type] ?? 'Flygfält', ul: a.type === 6,
    closed: a.type === 8, heli: a.type === 4 || a.type === 7, ppr: !!a.ppr, private: !!a.private,
    rwys: (a.runways || []).map((r) => ({ des: r.designator, lenM: r.dimension?.length?.value, widM: r.dimension?.width?.value,
      surf: SURFACE[r.surface?.mainComposite] ?? '' })),
    freqs: (a.frequencies || []).map((f) => ({ name: f.name || '', mhz: f.value })),
  };
}

// ---------- hämtning per cell ----------
const cellKey = (x, y) => `${x}_${y}`;
function cellsFor(bounds) {
  const out = [];
  const y0 = Math.floor(bounds.getSouth() / CELL), y1 = Math.floor(bounds.getNorth() / CELL);
  const x0 = Math.floor(bounds.getWest() / (2 * CELL)), x1 = Math.floor(bounds.getEast() / (2 * CELL));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

/** Bygg områdesfilter. OpenAIP stöder bevisligen pos (lat,lon) + dist; bbox används bara om testet visat att det fungerar. */
function areaQuery(bbox) {
  const [w, sLat, e, n] = bbox;
  if (settings.openaipQuery === 'bbox') return `bbox=${bbox.join(',')}`;
  const c = { lat: (sLat + n) / 2, lon: (w + e) / 2 };
  const m = Math.ceil(distNM(c, { lat: n, lon: e }) * 1852); // halva diagonalen
  return `pos=${c.lat.toFixed(4)},${c.lon.toFixed(4)}&dist=${settings.openaipQuery === 'poskm' ? Math.ceil(m / 1000) : m}`;
}
export function oaipUrl(path, query) {
  const q = settings.openaipAuth === 'header' ? '' : `&apiKey=${encodeURIComponent(settings.openaipKey)}`;
  return `${API}/${path}?${query}${q}`;
}
export const oaipHeaders = () => (settings.openaipAuth === 'header' ? { 'x-openaip-api-key': settings.openaipKey } : undefined);

/** Ligger objektet inom området? (filtrerar bort data från fel plats om servern skulle ignorera filtret) */
function inArea(item, [w, s, e, n]) {
  const g = item.geometry;
  if (!g) return false;
  if (g.type === 'Point') { const [lon, lat] = g.coordinates; return lon >= w && lon <= e && lat >= s && lat <= n; }
  const bb = item._bb || (item._bb = geomBBox(g));
  return !(bb[2] < w || bb[0] > e || bb[3] < s || bb[1] > n);
}

async function getAll(path, bbox) {
  const items = [];
  let limit = settings.openaipLimit || 50;
  for (let page = 1; page <= 25; page++) {
    let j;
    try { j = await fetchX(oaipUrl(path, `${areaQuery(bbox)}&limit=${limit}&page=${page}`), { headers: oaipHeaders() }); }
    catch (e) {
      if (/HTTP 4\d\d/.test(e.message) && !/40[13]/.test(e.message) && limit > 50) { limit = 50; page--; continue; } // för stort limit?
      throw e;
    }
    items.push(...(j.items || []));
    if (!j.totalPages || page >= j.totalPages) break;
  }
  return items.filter((it) => inArea(it, bbox));
}

async function loadCell(x, y) {
  const k = cellKey(x, y);
  if (loadedCells.has(k)) return;
  if (pending.has(k)) return pending.get(k);
  const p = (async () => {
    let data = await idb.get(KEY + k);
    if (!data || Date.now() - data.t > MAX_AGE) {
      if (!settings.openaipKey || !navigator.onLine) { if (!data) return; }
      else {
        const bbox = [x * 2 * CELL, y * CELL, (x + 1) * 2 * CELL, (y + 1) * CELL];
        try {
          const [as, ap, rp] = await Promise.all([getAll('airspaces', bbox), getAll('airports', bbox), getAll('reporting-points', bbox)]);
          data = { t: Date.now(), as, ap, rp };
          idb.set(KEY + k, data);
        } catch (e) {
          if (!data) { reportErr(e); return; }
        }
      }
    }
    for (const a of data.as) airspaces.set(a._id, a);
    for (const a of data.ap) oaipAirports.set(a._id, normAirport(a));
    for (const r of data.rp) reportingPoints.set(r._id, r);
    loadedCells.add(k);
  })().finally(() => pending.delete(k));
  pending.set(k, p);
  return p;
}
let errShown = 0;
function reportErr(e) {
  if (Date.now() - errShown < 30000) return;
  errShown = Date.now();
  toast(`OpenAIP: ${e.message}. Tryck "Testa OpenAIP" under Inställningar för att se orsaken.`, 6000);
}

/** Ladda alla celler inom bounds (L.LatLngBounds). Max 12 celler per anrop. */
// ---------- hämtning per land (reserv när områdessökning inte godtas av servern) ----------
const loadedCountries = new Set();
const pendingCountries = new Map();
async function getCountry(path, cc) {
  const items = [];
  for (let page = 1; page <= 80; page++) {
    const j = await fetchX(oaipUrl(path, `country=${cc}&limit=${settings.openaipLimit || 50}&page=${page}`), { headers: oaipHeaders() });
    items.push(...(j.items || []));
    if (!j.totalPages || page >= j.totalPages) break;
  }
  return items;
}
function loadCountry(cc) {
  if (loadedCountries.has(cc)) return;
  if (pendingCountries.has(cc)) return pendingCountries.get(cc);
  const p = (async () => {
    let data = await idb.get(KEY + 'cc:' + cc);
    if (!data || Date.now() - data.t > MAX_AGE) {
      if (settings.openaipKey && navigator.onLine) {
        try {
          const [as, ap, rp] = await Promise.all([getCountry('airspaces', cc), getCountry('airports', cc), getCountry('reporting-points', cc)]);
          data = { t: Date.now(), as, ap, rp };
          idb.set(KEY + 'cc:' + cc, data);
        } catch (e) { if (!data) { reportErr(e); return; } }
      }
    }
    if (!data) return;
    for (const a of data.as) airspaces.set(a._id, a);
    for (const a of data.ap) oaipAirports.set(a._id, normAirport(a));
    for (const r of data.rp) reportingPoints.set(r._id, r);
    loadedCountries.add(cc);
  })().finally(() => pendingCountries.delete(cc));
  pendingCountries.set(cc, p);
  return p;
}
async function loadCountries() {
  const list = settings.oaCountries.toUpperCase().split(/[,\s]+/).filter(Boolean);
  const before = airspaces.size + oaipAirports.size;
  for (const cc of list) await loadCountry(cc); // ett land i taget — skonsamt mot servern
  if (airspaces.size + oaipAirports.size !== before) emit();
}

export async function loadBounds(bounds) {
  if (settings.openaipQuery === 'country') return loadCountries();
  const cells = cellsFor(bounds);
  if (cells.length > 20) return; // mycket utzoomat: hämta inte (luftrum visas från zoom 7)
  const before = airspaces.size + oaipAirports.size;
  await Promise.all(cells.map(([x, y]) => loadCell(x, y)));
  if (airspaces.size + oaipAirports.size !== before) emit();
}

/** Ladda alla celler längs en rutt (för luftrumskontroll och offline) */
export async function loadRoute(points) {
  if (points.length < 1) return;
  if (settings.openaipQuery === 'country') return loadCountries();
  const set = new Map();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[i + 1] || a;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lon - a.lon)) / 0.25));
    for (let j = 0; j <= n; j++) {
      const lat = a.lat + (b.lat - a.lat) * j / n, lon = a.lon + (b.lon - a.lon) * j / n;
      const x = Math.floor(lon / (2 * CELL)), y = Math.floor(lat / CELL);
      set.set(cellKey(x, y), [x, y]);
    }
  }
  const before = airspaces.size;
  await Promise.all([...set.values()].map(([x, y]) => loadCell(x, y)));
  if (airspaces.size !== before) emit();
}

function geomBBox(g) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
  }
  return bb;
}

export function airspacesAt(lat, lon) {
  const out = [];
  for (const a of airspaces.values()) {
    if (!asVisible(a)) continue;
    const bb = a._bb || (a._bb = geomBBox(a.geometry));
    if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    if (pointInGeometry(lon, lat, a.geometry)) out.push(a);
  }
  return out.sort((x, y) => limitFt(x.lowerLimit).ft - limitFt(y.lowerLimit).ft);
}

/** Status för felsökning */
export const oaipStatus = () => ({ airspaces: airspaces.size, airports: oaipAirports.size, rp: reportingPoints.size, cells: loadedCells.size + loadedCountries.size });
/** Glöm inläst data (efter ny nyckel eller nytt frågesätt) */
export function resetOpenAip() { airspaces.clear(); oaipAirports.clear(); reportingPoints.clear(); loadedCells.clear(); loadedCountries.clear(); emit(); }
