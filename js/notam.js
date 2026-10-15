// NOTAM-lager: aktuella NOTAM för Sverige från FAA:s NOTAM-sökning (som även har internationella NOTAM).
// Hämtar FIR ESAA (luftrumsrestriktioner, varningar, hinder m.m.) och flygplatserna i kartvyn.
// FAA skickar inga CORS-huvuden, så anropen går alltid via CORS-proxyn.
import { map, registerOverlay } from './map.js';
import { proxyUrl } from './settings.js';
import { nearestAirports } from './airports.js';
import { esc, toast, withProxy, debounce, idb, distNM } from './util.js';

const FAA = 'https://notams.aim.faa.gov/notamSearch/search';
const FIR = ['ESAA'];
const TTL = 15 * 60e3;          // hämta om efter 15 min
const MAX_LOWER_FL = 95;        // visa inte områden som börjar över FL095 på kartan
const NM = 1852;

const notams = new Map();       // id → tolkad NOTAM
const fetched = new Map();      // plats → tidpunkt
let on = false, layer, renderer, loading = false;
const listeners = new Set();
export const onNotams = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

export function initNotam() {
  renderer = L.canvas({ pane: 'airspace', padding: 0.3 });
  layer = L.layerGroup();
  idb.get('notam').then((c) => { if (c?.items && !notams.size) { for (const n of c.items) notams.set(n.id, revive(n)); draw(); } }).catch(() => {});
  registerOverlay('notam', 'NOTAM', '', (v) => {
    on = v;
    if (v) { layer.addTo(map); refresh(); draw(); } else map.removeLayer(layer);
  });
  map.on('moveend', debounce(() => { if (on) refresh(); }, 800));
}

// ---------- hämtning ----------
async function faaSearch(locs, offset = 0) {
  const body = new URLSearchParams({
    searchType: '0', designatorsForLocation: locs.join(','), designatorForAccountable: '',
    latDegrees: '', latMinutes: '0', latSeconds: '0', longDegrees: '', longMinutes: '0', longSeconds: '0', radius: '10',
    sortColumns: '5 false', sortDirection: 'true', designatorForNotamNumberSearch: '', notamNumber: '',
    radiusSearchOnDesignator: 'false', radiusSearchDesignator: '', latitudeDirection: 'N', longitudeDirection: 'W',
    freeFormText: '', flightPathText: '', flightPathDivertAirfields: '', flightPathBuffer: '4', flightPathIncludeNavaids: 'true',
    flightPathIncludeArtcc: 'false', flightPathIncludeTfr: 'true', flightPathIncludeRegulatory: 'false', flightPathResultsType: 'All NOTAMs',
    archiveDate: '', archiveDesignator: '', offset: String(offset), notamsOnly: 'false', filters: '',
    minRunwayLength: '', minRunwayWidth: '', runwaySurfaceTypes: '', predefinedAbraka: '', predefinedDabraka: '', flightPathAddlBuffer: '', recaptchaToken: '',
  });
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(withProxy(FAA, proxyUrl()), { method: 'POST', body, signal: ctl.signal });
    if (!r.ok) {
      const msg = (await r.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(`HTTP ${r.status}${msg ? ': ' + msg : ''}`);
    }
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('FAA svarade inte med NOTAM-data: ' + text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)); }
    if (j?.error) throw new Error(j.error);
    if (!Array.isArray(j?.notamList)) throw new Error('oväntat svar från FAA');
    return j;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'tidsgräns' : /Failed to fetch|Load failed|NetworkError/.test(e.message) ? 'ingen kontakt med proxyn eller svar utan CORS' : e.message);
  } finally { clearTimeout(t); }
}

/** Hämta alla NOTAM för platserna (alla sidor, högst 600 st) */
export async function fetchNotams(locs) {
  const out = [];
  for (let off = 0; off < 600; off += 30) {
    const j = await faaSearch(locs, off);
    out.push(...j.notamList);
    if (!j.notamList.length || off + 30 >= (j.totalNotamCount || 0)) break;
  }
  return out.map(parse).filter(Boolean);
}

async function refresh() {
  if (loading || !navigator.onLine) return;
  const now = Date.now();
  const want = [...FIR];
  if (map.getZoom() >= 7) {
    const b = map.getBounds(), c = map.getCenter();
    for (const { a } of nearestAirports({ lat: c.lat, lon: c.lng }, 40)) {
      if (a.icao && /^[A-Z]{4}$/.test(a.icao) && b.contains([a.lat, a.lon])) want.push(a.icao);
      if (want.length >= 21) break;
    }
  }
  const need = want.filter((l) => now - (fetched.get(l) || 0) > TTL);
  if (!need.length) return;
  loading = true;
  try {
    const list = await fetchNotams(need);
    for (const l of need) fetched.set(l, now);
    // ersätt allt som gäller de hämtade platserna
    for (const [id, n] of notams) if (need.includes(n.loc)) notams.delete(id);
    for (const n of list) notams.set(n.id, n);
    draw(); emit();
    idb.set('notam', { t: now, items: [...notams.values()].map(({ geo, ...n }) => n) }).catch(() => {});
  } catch (e) {
    for (const l of need) fetched.set(l, now - TTL + 60e3); // försök igen om en minut
    toast('NOTAM: ' + e.message, 5000);
  } finally { loading = false; }
}

// ---------- tolkning ----------
const dms = (deg, min, sec = 0) => +deg + +min / 60 + +sec / 3600;
/** "5920N01805E" eller "592012N0180530E" → {lat, lon} */
function coord(la, ns, lo, ew) {
  const lat = dms(la.slice(0, 2), la.slice(2, 4), la.slice(4, 6) || 0) * (ns === 'S' ? -1 : 1);
  const lon = dms(lo.slice(0, 3), lo.slice(3, 5), lo.slice(5, 7) || 0) * (ew === 'W' ? -1 : 1);
  return { lat, lon };
}
const COORDS = /\b(\d{4}(?:\d{2})?)(?:[.,]\d+)?([NS])\s?(\d{5}(?:\d{2})?)(?:[.,]\d+)?([EW])\b/g;
/** YYMMDDHHMM (UTC) → Date */
const ntime = (s) => s && /^\d{10}$/.test(s) ? new Date(Date.UTC(2000 + +s.slice(0, 2), +s.slice(2, 4) - 1, +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10))) : null;
/** Text i ett NOTAM-fält, t.ex. E), fram till nästa fält */
const field = (txt, f, next) => {
  const stop = next.split('|').map((x) => /^[A-G]$/.test(x) ? `${x}\\)` : `${x}:`).join('|');
  const m = txt.match(new RegExp(`(?:^|\\s)${f}\\)\\s*([\\s\\S]*?)(?=\\s+(?:${stop})|\\s*$)`));
  return m ? m[1].trim() : '';
};

function parse(raw) {
  const txt = String(raw.icaoMessage || raw.traditionalMessage || '').replace(/\r/g, '');
  if (!txt || /NOTAMC/.test(txt.slice(0, 40))) return null;
  const num = raw.notamNumber || txt.match(/^[A-Z]\d{4}\/\d{2}/)?.[0] || '';
  const q = txt.match(/Q\)\s*([A-Z]{4})\/Q([A-Z]{2})([A-Z]{2})\/\s*([A-Z ]*)\/\s*([A-Z ]*)\/\s*([A-Z ]*)\/\s*(\d{3})\/\s*(\d{3})\/\s*(\d{4})([NS])(\d{5})([EW])(\d{3})?/);
  const n = {
    id: `${raw.facilityDesignator || raw.icaoId || ''}-${num}`, num,
    loc: (raw.facilityDesignator || raw.icaoId || field(txt, 'A', 'B') || '').slice(0, 4),
    a: field(txt, 'A', 'B'), name: raw.airportName || '',
    from: ntime(field(txt, 'B', 'C')), to: ntime(field(txt, 'C', 'D|E').replace(/\s*EST$/, '')),
    est: /C\)\s*\d{10}\s*EST/.test(txt), perm: /C\)\s*PERM/.test(txt),
    d: field(txt, 'D', 'E'), e: field(txt, 'E', 'F|G|CREATED|SOURCE'), f: field(txt, 'F', 'G'), g: field(txt, 'G', 'CREATED|SOURCE'),
    subj: q?.[2] || '', cond: q?.[3] || '', scope: (q?.[6] || '').trim(),
    lower: q ? +q[7] : 0, upper: q ? +q[8] : 999,
    c: q ? coord(q[9], q[10], q[11], q[12]) : null, r: q?.[13] ? +q[13] : null,
    poly: null,
  };
  if (n.to && n.to < Date.now()) return null; // utgången
  const pts = [...n.e.matchAll(COORDS)].map((m) => coord(m[1], m[2], m[3], m[4]));
  if (pts.length >= 3 && 'RW'.includes(n.subj[0] || '-')) n.poly = pts.map((p) => [p.lat, p.lon]);
  return revive(n);
}
function revive(n) {
  n.from = n.from ? new Date(n.from) : null; n.to = n.to ? new Date(n.to) : null;
  return n;
}

/** Kategori för färg: luftrumsrestriktion, varning, hinder eller övrigt (flygplats/navigering) */
const kind = (n) => n.subj[0] === 'R' ? 'r' : n.subj[0] === 'W' ? 'w' : n.subj[0] === 'O' ? 'o' : 'x';
const COLOR = { r: '#e03131', w: '#f08c00', o: '#9c36b5', x: '#1c7ed6' };
const KIND_NAME = { r: 'Luftrumsrestriktion', w: 'Varning', o: 'Hinder', x: 'Övrigt' };
const active = (n, t = Date.now()) => (!n.from || n.from <= t) && (!n.to || n.to >= t);
const soon = (n) => n.from && n.from > Date.now() && n.from - Date.now() < 24 * 3600e3;

// ---------- ritning ----------
function draw() {
  if (!layer) return;
  layer.clearLayers();
  if (!on) return;
  for (const n of notams.values()) {
    const k = kind(n);
    if (k === 'x' || n.lower >= MAX_LOWER_FL) continue;   // flygplats-NOTAM visas i fältinfo, inte som områden
    if (!active(n) && !soon(n)) continue;
    const style = { renderer, interactive: false, color: COLOR[k], weight: 2, opacity: 0.9, fillOpacity: active(n) ? 0.12 : 0.04, dashArray: active(n) ? null : '6 6' };
    if (n.poly) L.polygon(n.poly, style).addTo(layer);
    else if (n.c && n.r != null && n.r < 100) {
      if (k === 'o' && n.r <= 1) L.circleMarker([n.c.lat, n.c.lon], { ...style, radius: 5, fillOpacity: 0.6 }).addTo(layer);
      else L.circle([n.c.lat, n.c.lon], { ...style, radius: Math.max(n.r, 0.5) * NM }).addTo(layer);
    }
  }
}

// ---------- sökning och presentation ----------
function pointInPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** NOTAM-områden som täcker en punkt (för info vid tryck på kartan) */
export function notamsAt(lat, lon) {
  if (!on) return [];
  return [...notams.values()].filter((n) => {
    const k = kind(n);
    if (k === 'x' || (!active(n) && !soon(n))) return false;
    if (n.poly) return pointInPoly(lat, lon, n.poly);
    return n.c && n.r != null && n.r < 100 && distNM({ lat, lon }, n.c) <= Math.max(n.r, 0.5);
  }).sort((a, b) => a.lower - b.lower);
}
/** NOTAM för en flygplats (ICAO) */
export const notamsFor = (icao) => [...notams.values()].filter((n) => n.loc === icao || n.a.split(/\s+/).includes(icao));
export const notamCount = () => notams.size;

const fmtT = (d) => d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z` : '';
const fl = (v) => v === 0 ? 'SFC' : v >= 999 ? 'UNL' : `FL${String(v).padStart(3, '0')}`;
export function notamHtml(n) {
  const k = kind(n);
  const lim = n.f || n.g ? `${esc(n.f || fl(n.lower))} – ${esc(n.g || fl(n.upper))}` : `${fl(n.lower)} – ${fl(n.upper)}`;
  const when = `${fmtT(n.from)} – ${n.perm ? 'PERM' : fmtT(n.to)}${n.est ? ' (EST)' : ''}`;
  return `<div class="asp notam" style="border-left-color:${COLOR[k]}"><b>${esc(n.num)}</b> · ${KIND_NAME[k]}${active(n) ? '' : ' · <i>kommande</i>'}<br>
    <span class="muted">${esc(when)} · ${esc(lim)}</span>${n.d ? `<br><span class="muted">${esc(n.d)}</span>` : ''}
    <div class="ntxt">${esc(n.e)}</div></div>`;
}
export function notamListHtml(list, empty = '') {
  if (!list.length) return empty;
  return `<details class="notams"><summary><b>NOTAM (${list.length})</b></summary>${list.map(notamHtml).join('')}</details>`;
}

/** Felsökning: kontrollera proxyn steg för steg och hämta NOTAM för FIR ESAA */
export async function testNotam() {
  const rows = [];
  const row = (ok, txt) => rows.push(`<div class="${ok ? 'okbox' : 'badbox'}"><div>${txt}</div></div>`);
  const proxy = proxyUrl();
  // 1) svarar proxyn, och vilken version körs?
  try {
    const r = await fetch(proxy.replace(/\?.*$/, '').replace(/\/?$/, '/') + '?ping', { cache: 'no-store' });
    const t = await r.text();
    if (/ultranav-proxy/.test(t)) {
      const allowed = /Tillåten: ja/.test(t);
      row(allowed, `Proxyn svarar: ${esc(t.split('\n')[0])}. ${allowed ? 'Den här webbplatsen är tillåten.' : `Webbplatsen <b>${esc(location.origin)}</b> är <b>inte</b> tillåten — lägg till den i ALLOWED_ORIGINS och tryck Deploy.`}`);
      if (!allowed) return rows.join('');
    } else if (/hello world/i.test(t)) { row(false, 'Workern kör fortfarande "Hello World" — koden är inte utbytt.'); return rows.join(''); }
    else row(false, `Proxyn svarar men kör en äldre kod (HTTP ${r.status}: ${esc(t.slice(0, 80))}). Klistra in senaste tools/cors-proxy-worker.js i Cloudflare och tryck <b>Deploy</b>.`);
  } catch (e) {
    // Når vi den alls? Ett "no-cors"-anrop lyckas om servern svarar, även utan CORS-tillåtelse.
    const reach = await fetch(proxy, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
    row(false, reach
      ? `Proxyn svarar, men utan CORS-tillåtelse för den här webbplatsen — troligen körs en äldre kod. Klistra in senaste tools/cors-proxy-worker.js i Cloudflare och tryck <b>Deploy</b>. (${esc(proxy)})`
      : `Proxyn går inte att nå: ${esc(proxy)}. Kontrollera adressen.`);
    return rows.join('');
  }
  // 2) NOTAM via proxyn
  const t0 = performance.now();
  try {
    const list = await fetchNotams(FIR);
    row(true, `NOTAM fungerar: ${list.length} gällande NOTAM för ${FIR.join(', ')} (${Math.round(performance.now() - t0)} ms).`);
  } catch (e) { row(false, `NOTAM: ${esc(e.message)}`); }
  return rows.join('');
}
