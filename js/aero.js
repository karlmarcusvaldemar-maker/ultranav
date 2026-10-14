// Visning av luftrum, flygfält och rapportpunkter på kartan
import { map, registerOverlay } from './map.js';
import { airspaces, reportingPoints, asStyle, asVisible, asLabel, fmtLimit, limitFt, loadBounds, onOpenAipData, airspacesAt } from './openaip.js';
import { allAirports, onAirports, longestRwy } from './airports.js';
import { esc, debounce, distNM, bearing, fmtDeg, fmtLatLon } from './util.js';
import { settings } from './settings.js';

/** Åtgärder som app.js fyller i (undviker cirkulära beroenden) */
export const actions = { editMode: () => false, addWaypoint() {}, directTo() {}, showWx() {}, ownPos: () => null };

const asLayer = L.layerGroup();
const apLayer = L.layerGroup();
const rpLayer = L.layerGroup();
const on = { airspace: false, fields: false, rp: false };
const renderer = L.canvas({ padding: 0.3 });

export function initAero() {
  registerOverlay('airspace', 'Luftrum (OpenAIP)', 'CTR, TMA, R/D/P, ATZ … tryck på kartan för info', (v) => toggle('airspace', asLayer, v));
  registerOverlay('fields', 'Flygfält', 'OpenAIP + OurAirports, UL-fält i grönt', (v) => toggle('fields', apLayer, v));
  registerOverlay('rp', 'Rapportpunkter (OpenAIP)', 'VFR-rapportpunkter', (v) => toggle('rp', rpLayer, v));
  const refresh = debounce(() => { fetchView(); drawAll(); }, 250);
  map.on('moveend zoomend', refresh);
  onOpenAipData(() => { drawAirspace(); drawAll(); });
  onAirports(() => drawAll());
  fetchView(); drawAirspace(); drawAll();
}

function toggle(id, layer, v) {
  on[id] = v;
  if (v) layer.addTo(map); else map.removeLayer(layer);
  if (v) { fetchView(); if (id === 'airspace') drawAirspace(); else drawAll(); }
}

function fetchView() {
  if (!(on.airspace || on.fields || on.rp)) return;
  if (map.getZoom() < 7) return;
  loadBounds(map.getBounds().pad(0.2));
}

// ---------- luftrum ----------
let asDrawn = 0;
function drawAirspace() {
  if (!on.airspace) return;
  if (asDrawn === airspaces.size) return;
  asDrawn = airspaces.size;
  asLayer.clearLayers();
  const list = [...airspaces.values()].filter((a) => asVisible(a) && limitFt(a.lowerLimit).ft < 10000)
    .sort((a, b) => (b.type === 7) - (a.type === 7)); // TMA längst ner
  for (const a of list) {
    L.geoJSON(a.geometry, { pane: 'airspace', interactive: false, renderer, style: { ...asStyle(a), opacity: 0.9 } }).addTo(asLayer);
  }
}

// ---------- flygfält och rapportpunkter ----------
function apColor(a) {
  if (a.ul) return '#1b9e3e';
  if (/Segel/i.test(a.type)) return '#0f8b8d';
  if (a.heli) return '#777';
  if (/Int|Stor|IFR|Militär flygplats|^Flygplats$/.test(a.type)) return '#1a4fb4';
  return '#6a3fb5';
}

function drawAll() {
  const z = map.getZoom();
  const b = map.getBounds().pad(0.1);
  apLayer.clearLayers();
  if (on.fields && z >= 6) {
    let list = allAirports().filter((a) => b.contains([a.lat, a.lon]));
    if (z < 8) list = list.filter((a) => a.icao || a.ul);
    list = list.slice(0, 700);
    for (const a of list) {
      const big = /Int|Stor|IFR|^Flygplats$/.test(a.type);
      const m = L.circleMarker([a.lat, a.lon], { renderer, radius: big ? 8 : 6, color: '#fff', weight: 2, fillColor: apColor(a),
        fillOpacity: 1, bubblingMouseEvents: false }).addTo(apLayer);
      if (z >= 10) m.bindTooltip(esc(a.icao || a.name), { permanent: true, direction: 'right', className: 'ap-label', offset: [6, 0] });
      m.on('click', () => {
        if (actions.editMode()) actions.addWaypoint({ lat: a.lat, lon: a.lon, name: a.icao || a.name, elevFt: a.elevFt });
        else L.popup({ maxWidth: 340 }).setLatLng([a.lat, a.lon]).setContent(airportHtml(a)).openOn(map);
      });
    }
  }
  rpLayer.clearLayers();
  if (on.rp && z >= 9) {
    for (const r of reportingPoints.values()) {
      const [lon, lat] = r.geometry.coordinates;
      if (!b.contains([lat, lon])) continue;
      const m = L.marker([lat, lon], { bubblingMouseEvents: false, icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 12],
        html: `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 2 L17 16 L1 16 Z" fill="${r.compulsory ? '#1a4fb4' : '#fff'}" stroke="#1a4fb4" stroke-width="2"/></svg>` }) }).addTo(rpLayer);
      if (z >= 10) m.bindTooltip(esc(r.name), { permanent: true, direction: 'right', className: 'ap-label', offset: [8, 0] });
      m.on('click', () => {
        const name = r.name;
        if (actions.editMode()) actions.addWaypoint({ lat, lon, name });
        else L.popup().setLatLng([lat, lon]).setContent(`<h4>▲ ${esc(name)}</h4><div>${r.compulsory ? 'Obligatorisk' : 'Vid anmodan'} rapportpunkt</div>
          <div class="muted">${fmtLatLon(lat, lon)}</div>${btns({ lat, lon, name })}`).openOn(map);
      });
    }
  }
}

function btns(p) {
  const id = 'p' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    document.getElementById(id + 'd')?.addEventListener('click', () => { map.closePopup(); actions.directTo(p); });
    document.getElementById(id + 'a')?.addEventListener('click', () => { map.closePopup(); actions.addWaypoint(p); });
    document.getElementById(id + 'w')?.addEventListener('click', () => { map.closePopup(); actions.showWx(p.icao); });
  }, 0);
  return `<div class="pbtns"><button id="${id}d">→ Direkt till</button><button id="${id}a" class="sec">+ Lägg till i rutt</button>
    ${p.icao ? `<button id="${id}w" class="sec">METAR/TAF</button>` : ''}</div>`;
}

function relPos(p) {
  const own = actions.ownPos();
  if (!own) return '';
  return `<div><b>${distNM(own, p).toFixed(1)} NM</b> · ${fmtDeg(bearing(own, p) - settings.variation)}°M från dig</div>`;
}

export function airportHtml(a) {
  const rw = a.rwys.length ? a.rwys.map((r) => `<tr><td><b>${esc(r.des)}</b></td><td>${r.lenM ? r.lenM + ' m' : ''}${r.widM ? ' × ' + r.widM : ''}</td><td>${esc(r.surf)}</td></tr>`).join('') : '<tr><td class="muted">Inga baner i data</td></tr>';
  const fq = a.freqs.length ? a.freqs.map((f) => `<tr><td>${esc(f.name)}</td><td><b>${esc(f.mhz)}</b></td></tr>`).join('') : '';
  return `<h4>${a.ul ? '<span class="tag ul">UL</span>' : ''}${esc(a.name)}</h4>
    <div>${esc(a.icao || a.ident || '')} · ${esc(a.type)}${a.elevFt != null ? ' · ' + a.elevFt + ' ft' : ''}${a.ppr ? ' · <b>PPR</b>' : ''}${a.private ? ' · privat' : ''}</div>
    ${relPos(a)}
    <table style="margin-top:6px">${rw}</table>${fq ? `<table style="margin-top:6px">${fq}</table>` : ''}
    <div class="muted" style="margin-top:4px">Källa: ${esc(a.src)} — kontrollera alltid mot AIP/fältets info</div>
    ${btns({ lat: a.lat, lon: a.lon, name: a.icao || a.name, icao: a.icao, elevFt: a.elevFt })}`;
}

export function airspaceListHtml(list) {
  if (!list.length) return '<div class="muted">Inget luftrum i OpenAIP-data på denna punkt (klass G eller ej inläst).</div>';
  return list.map((a) => `<div class="asp" style="border-left-color:${asStyle(a).color}"><b>${esc(a.name)}</b><br>${esc(asLabel(a))}
    · ${esc(fmtLimit(a.lowerLimit))} – ${esc(fmtLimit(a.upperLimit))}${a.frequencies?.length ? '<br>' + a.frequencies.map((f) => esc(f.value) + ' ' + esc(f.name || '')).join(', ') : ''}</div>`).join('');
}

/** Info vid tryck på kartan (utanför ruttläge) */
export function mapInfoPopup(latlng, elevFt) {
  const p = { lat: latlng.lat, lon: latlng.lng, name: 'Punkt' };
  const as = airspacesAt(p.lat, p.lon);
  L.popup({ maxWidth: 360 }).setLatLng(latlng).setContent(`<h4>${fmtLatLon(p.lat, p.lon)}</h4>
    ${elevFt != null ? `<div>Terräng ≈ <b>${Math.round(elevFt)} ft</b></div>` : ''}${relPos(p)}
    ${settings.openaipKey ? airspaceListHtml(as) : '<div class="muted">Ange OpenAIP-nyckel för luftrumsinfo</div>'}
    ${btns(p)}`).openOn(map);
}
export { longestRwy };
