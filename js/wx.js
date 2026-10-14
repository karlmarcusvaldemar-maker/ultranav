// Väder: vind på höjd (Open-Meteo), METAR/TAF (aviationweather.gov / NOAA)
import { settings } from './settings.js';
import { fetchX, esc, toast, debounce, FT_PER_M, idb } from './util.js';
import { allAirports } from './airports.js';
import { map, registerOverlay } from './map.js';

const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];
const AWC = 'https://aviationweather.gov/api/data/';

// ---------- Open-Meteo ----------
/** Hämta prognos för en lista punkter. Returnerar array med hourly-data per punkt. */
export async function fetchForecast(points) {
  if (!points.length) return [];
  const hourly = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'temperature_2m', 'dew_point_2m', 'visibility',
    'cloud_cover_low', 'cloud_cover_mid', 'precipitation', 'pressure_msl', 'freezing_level_height',
    ...LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `geopotential_height_${l}hPa`, `temperature_${l}hPa`])];
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lon.toFixed(3)).join(','),
    hourly: hourly.join(','), wind_speed_unit: 'kn', timezone: 'GMT', forecast_days: '3', past_days: '1',
  });
  const j = await fetchX(url, { proxy: settings.corsProxy });
  return Array.isArray(j) ? j : [j];
}

export function hourIndex(fc, date) {
  const t = fc.hourly.time;
  const target = date.toISOString().slice(0, 13);
  let i = t.findIndex((x) => x.slice(0, 13) === target);
  if (i < 0) i = date < new Date(t[0] + 'Z') ? 0 : t.length - 1;
  return i;
}

/** Vind (från-riktning, kt) på given höjd ft MSL genom vektorinterpolation mellan tryckytor */
export function windAt(fc, i, altFt) {
  const h = fc.hourly, altM = altFt / FT_PER_M;
  const lv = LEVELS.map((l) => ({ z: h[`geopotential_height_${l}hPa`]?.[i], s: h[`wind_speed_${l}hPa`]?.[i], d: h[`wind_direction_${l}hPa`]?.[i], t: h[`temperature_${l}hPa`]?.[i] }))
    .filter((x) => x.z != null && x.s != null && x.d != null).sort((a, b) => a.z - b.z);
  if (!lv.length) return { dir: h.wind_direction_10m[i], spd: h.wind_speed_10m[i], temp: h.temperature_2m[i] };
  const uv = (x) => ({ u: -x.s * Math.sin(x.d * Math.PI / 180), v: -x.s * Math.cos(x.d * Math.PI / 180) });
  let a = lv[0], b = lv[0];
  if (altM >= lv[lv.length - 1].z) a = b = lv[lv.length - 1];
  else for (let k = 0; k < lv.length - 1; k++) if (altM >= lv[k].z && altM <= lv[k + 1].z) { a = lv[k]; b = lv[k + 1]; break; }
  const f = b.z === a.z ? 0 : (altM - a.z) / (b.z - a.z);
  const A = uv(a), B = uv(b);
  const u = A.u + (B.u - A.u) * f, v = A.v + (B.v - A.v) * f;
  return { dir: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360, spd: Math.hypot(u, v), temp: a.t + ((b.t ?? a.t) - a.t) * f };
}

/** Sammanfattning av markväder ur prognos */
export function surfaceWx(fc, i) {
  const h = fc.hourly;
  const spread = h.temperature_2m[i] - h.dew_point_2m[i];
  return {
    wdir: h.wind_direction_10m[i], wspd: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], temp: h.temperature_2m[i], dew: h.dew_point_2m[i],
    visKm: h.visibility?.[i] != null ? h.visibility[i] / 1000 : null, low: h.cloud_cover_low?.[i], mid: h.cloud_cover_mid?.[i],
    precip: h.precipitation?.[i], qnh: h.pressure_msl?.[i], frzFt: h.freezing_level_height?.[i] != null ? h.freezing_level_height[i] * FT_PER_M : null,
    baseFt: spread >= 0 ? Math.round(spread * 400 / 100) * 100 : null, // tumregel: (T−Td)×400 ft
  };
}

// ---------- METAR/TAF ----------
export async function fetchMetarTaf(ids) {
  ids = ids.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{3,4}$/.test(s));
  if (!ids.length) return [];
  const q = ids.join(',');
  const [m0, t0] = await Promise.all([
    fetchX(`${AWC}metar?ids=${q}&format=json&hours=3`, { proxy: settings.corsProxy }).catch((e) => { throw new Error('METAR: ' + e.message); }),
    fetchX(`${AWC}taf?ids=${q}&format=json`, { proxy: settings.corsProxy }).catch(() => []),
  ]);
  const m = Array.isArray(m0) ? m0 : [], t = Array.isArray(t0) ? t0 : []; // tomt svar = ingen data
  return ids.map((id) => {
    const ms = (m || []).filter((x) => x.icaoId === id).sort((a, b) => (b.obsTime || 0) - (a.obsTime || 0));
    const tf = (t || []).find((x) => x.icaoId === id);
    return { id, name: ms[0]?.name || tf?.name || '', metar: ms[0]?.rawOb || null, cat: ms[0]?.fltCat || calcCat(ms[0]), taf: tf?.rawTAF || null, lat: ms[0]?.lat, lon: ms[0]?.lon };
  });
}

/** Flygväderkategori ur METAR-JSON om fltCat saknas */
function calcCat(m) {
  if (!m) return '';
  const vis = parseFloat(String(m.visib).replace('+', '')); // statute miles
  const ceil = (m.clouds || []).filter((c) => ['BKN', 'OVC', 'OVX'].includes(c.cover)).map((c) => c.base).sort((a, b) => a - b)[0] ?? 99999;
  if (vis < 1 || ceil < 500) return 'LIFR';
  if (vis < 3 || ceil < 1000) return 'IFR';
  if (vis <= 5 || ceil <= 3000) return 'MVFR';
  return 'VFR';
}

// ---------- sökbara väderstationer ----------
let stations = null, stationsLoading = null;
const NORDIC_BBOX = '54,4,72,32'; // lat0,lon0,lat1,lon1 — Norden med omnejd
/** Stationer med METAR/TAF (aviationweather.gov stationsregister), cachade i 30 dygn */
export function loadStationList() {
  if (stations) return Promise.resolve(stations);
  if (!stationsLoading) stationsLoading = (async () => {
    const cached = await idb.get('awc:stations');
    if (cached && (Date.now() - cached.t < 30 * 864e5 || !navigator.onLine)) return (stations = cached.list);
    try {
      const j = await fetchX(`${AWC}stationinfo?bbox=${NORDIC_BBOX}&format=json`, { proxy: settings.corsProxy, timeout: 30000 });
      const list = (Array.isArray(j) ? j : []).filter((s) => s.icaoId && (!s.siteType || s.siteType.some((t) => /METAR|TAF/.test(t))))
        .map((s) => ({ id: s.icaoId, name: s.site || s.name || '', lat: s.lat, lon: s.lon, taf: !!s.siteType?.includes('TAF'), known: true }));
      if (list.length) { await idb.set('awc:stations', { t: Date.now(), list }); return (stations = list); }
    } catch { /* faller tillbaka på flygfältslistan */ }
    return cached?.list || null;
  })().finally(() => { stationsLoading = null; });
  return stationsLoading;
}
/** Sök på ICAO-kod eller namn. Utan stationsregister används flygfält med ICAO-kod (METAR okänt). */
export async function searchStations(q, n = 10) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const list = (await loadStationList()) || allAirports().filter((a) => /^[A-Z]{4}$/.test(a.icao)).map((a) => ({ id: a.icao, name: a.name, known: false }));
  const seen = new Set();
  return list.map((s) => {
    const id = s.id.toLowerCase(), name = s.name.toLowerCase();
    const score = id === q ? 0 : id.startsWith(q) ? 1 : name.startsWith(q) ? 2 : name.includes(q) ? 3 : 9;
    return { s, score };
  }).filter((x) => x.score < 9 && !seen.has(x.s.id) && seen.add(x.s.id))
    .sort((a, b) => a.score - b.score || a.s.id.localeCompare(b.s.id)).slice(0, n).map((x) => x.s);
}

export function metarHtml(r) {
  return `<div class="metar"><div class="st"><span>${esc(r.id)} <span class="muted">${esc(r.name)}</span></span>${r.cat ? `<span class="cat ${esc(r.cat)}">${esc(r.cat)}</span>` : ''}</div>${
    r.metar ? esc(r.metar) : `<span class="muted">Ingen METAR för ${esc(r.id)} just nu${r.taf ? '' : ' — fältet rapporterar troligen inte väder'}</span>`}${r.taf ? '\n\n' + esc(r.taf).replace(/ (BECMG|TEMPO|FM\d+|PROB\d+)/g, '\n  $1') : ''}</div>`;
}

// ---------- METAR-stationer på kartan ----------
const wxLayer = L.layerGroup();
let wxOn = false, lastKey = '';
const CAT_COL = { VFR: '#2d9d4f', MVFR: '#1f6fd0', IFR: '#d33', LIFR: '#a020c0' };

export function initWxOverlay() {
  registerOverlay('metar', 'METAR-stationer', '', (v) => {
    wxOn = v; if (v) { wxLayer.addTo(map); loadStations(); } else map.removeLayer(wxLayer);
  });
  map.on('moveend', debounce(() => wxOn && loadStations(), 800));
}

async function loadStations() {
  if (map.getZoom() < 6) return;
  const b = map.getBounds().pad(0.2);
  const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(1)).join(',') + '@' + Math.floor(Date.now() / 6e5);
  if (key === lastKey) return;
  lastKey = key;
  try {
    const j = await fetchX(`${AWC}metar?bbox=${b.getSouth().toFixed(2)},${b.getWest().toFixed(2)},${b.getNorth().toFixed(2)},${b.getEast().toFixed(2)}&format=json`, { proxy: settings.corsProxy });
    wxLayer.clearLayers();
    for (const m of j || []) {
      const cat = m.fltCat || calcCat(m);
      L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', iconSize: [18, 18], html: `<div class="wxdot" style="background:${CAT_COL[cat] || '#888'}"></div>` }), bubblingMouseEvents: false })
        .bindPopup(() => metarHtml({ id: m.icaoId, name: m.name, metar: m.rawOb, cat }) + `<div class="pbtns"><button onclick="window.ulnav.showWx('${esc(m.icaoId)}')">Visa TAF</button></div>`, { maxWidth: 380 })
        .addTo(wxLayer);
    }
  } catch (e) {
    toast('METAR-stationer: ' + e.message + (settings.corsProxy ? '' : ' — prova en CORS-proxy i Inställningar'), 5000);
  }
}
