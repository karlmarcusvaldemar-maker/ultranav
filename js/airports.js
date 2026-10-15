// Flygfält: OurAirports (public domain, hela världen, filtreras per land) + OpenAIP (rikare data, kräver nyckel)
import { settings, oaipKey, proxyUrl } from './settings.js';
import { idb, fetchX, toast, distNM } from './util.js';
import { oaipAirports } from './openaip.js';

const OA = 'https://davidmegginson.github.io/ourairports-data/';
export let oaAirports = [];
let oaMeta = null;
const listeners = new Set();
export const onAirports = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

/** Enkel men korrekt CSV-tolkning (citattecken, kommatecken i fält) */
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const TYPE_SV = { small_airport: 'Litet fält', medium_airport: 'Flygplats', large_airport: 'Stor flygplats', heliport: 'Helikopterplats',
  seaplane_base: 'Sjöflyg', balloonport: 'Ballong', closed: 'Stängt' };

export async function loadOurAirports(force = false) {
  const countries = settings.oaCountries.toUpperCase().split(/[,\s]+/).filter(Boolean);
  const key = countries.join(',') + (settings.oaIncludeHeli ? '+H' : '');
  if (!force) {
    const cached = await idb.get('oa:data');
    if (cached && cached.key === key) {
      oaAirports = cached.list; oaMeta = cached; emit();
      if (Date.now() - cached.t < 30 * 864e5 || !navigator.onLine) return;
    }
  }
  if (!navigator.onLine) return;
  try {
    toast('Hämtar flygfält från OurAirports…', 4000);
    const opt = { as: 'text', proxy: proxyUrl(), timeout: 60000 };
    const [ap, rw, fq] = await Promise.all([
      fetchX(OA + 'airports.csv', opt), fetchX(OA + 'runways.csv', opt), fetchX(OA + 'airport-frequencies.csv', opt)]);
    const set = new Set(countries);
    const keep = new Map();
    for (const a of parseCSV(ap)) {
      if (set.size && !set.has(a.iso_country)) continue;
      if (a.type === 'closed' || a.type === 'balloonport') continue;
      if (a.type === 'heliport' && !settings.oaIncludeHeli) continue;
      const lat = +a.latitude_deg, lon = +a.longitude_deg;
      if (!isFinite(lat) || !isFinite(lon)) continue;
      keep.set(a.id, {
        id: 'oa:' + a.id, src: 'OurAirports', name: a.name, icao: a.icao_code || (/^[A-Z]{4}$/.test(a.ident) ? a.ident : a.gps_code || ''),
        ident: a.ident, lat, lon, elevFt: a.elevation_ft ? +a.elevation_ft : null, type: TYPE_SV[a.type] || a.type,
        ul: /\b(UL|ultral)/i.test(a.name + ' ' + (a.keywords || '')), heli: a.type === 'heliport', closed: false,
        municipality: a.municipality, rwys: [], freqs: [],
      });
    }
    for (const r of parseCSV(rw)) {
      const a = keep.get(r.airport_ref);
      if (!a || r.closed === '1') continue;
      a.rwys.push({ des: [r.le_ident, r.he_ident].filter(Boolean).join('/'), lenM: r.length_ft ? Math.round(r.length_ft / 3.28084) : null,
        widM: r.width_ft ? Math.round(r.width_ft / 3.28084) : null, surf: r.surface || '' });
    }
    for (const f of parseCSV(fq)) {
      const a = keep.get(f.airport_ref);
      if (a) a.freqs.push({ name: f.description || f.type, mhz: f.frequency_mhz });
    }
    oaAirports = [...keep.values()];
    oaMeta = { key, t: Date.now(), list: oaAirports };
    await idb.set('oa:data', oaMeta);
    toast(`${oaAirports.length} flygfält inlästa (${countries.join(', ')})`);
    emit();
  } catch (e) {
    toast('Flygfältsdata kunde inte hämtas: ' + e.message, 6000);
  }
}
export const oaInfo = () => oaMeta ? { n: oaMeta.list.length, t: new Date(oaMeta.t) } : null;

/** Alla kända fält, dubbletter (samma ICAO eller < 400 m) borttagna — OpenAIP prioriteras */
export function allAirports() {
  const out = [...oaipAirports.values()].filter((a) => !a.closed);
  const icaos = new Set(out.map((a) => a.icao).filter(Boolean));
  const grid = new Map();
  const gk = (lat, lon) => `${Math.round(lat * 50)}_${Math.round(lon * 25)}`;
  for (const a of out) grid.set(gk(a.lat, a.lon), a);
  for (const a of oaAirports) {
    if (a.icao && icaos.has(a.icao)) continue;
    const near = grid.get(gk(a.lat, a.lon));
    if (near && distNM(near, a) < 0.22) continue;
    out.push(a);
  }
  return out;
}

export function nearestAirports(pos, n = 25, { excludeHeli = true } = {}) {
  return allAirports()
    .filter((a) => !(excludeHeli && a.heli))
    .map((a) => ({ a, d: distNM(pos, a) }))
    .sort((x, y) => x.d - y.d).slice(0, n);
}

export function searchAirports(q, n = 40) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const res = [];
  for (const a of allAirports()) {
    const s = `${a.icao} ${a.ident || ''} ${a.name} ${a.municipality || ''}`.toLowerCase();
    const i = s.indexOf(q);
    if (i >= 0) res.push({ a, score: (a.icao.toLowerCase() === q ? -10 : 0) + i });
  }
  return res.sort((x, y) => x.score - y.score).slice(0, n).map((r) => r.a);
}

export const longestRwy = (a) => a.rwys?.reduce((m, r) => (r.lenM > (m?.lenM || 0) ? r : m), null);
