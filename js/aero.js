// Visning av luftrum, flygfält och rapportpunkter på kartan
import { map, registerOverlay } from './map.js';
import { airspaces, reportingPoints, asStyle, asVisible, asLabel, fmtLimit, limitFt, loadBounds, onOpenAipData, airspacesAt } from './openaip.js';
import { allAirports, onAirports, longestRwy } from './airports.js';
import { esc, debounce, distNM, bearing, fmtDeg, fmtLatLon } from './util.js';
import { settings, oaipKey, proxyUrl } from './settings.js';
import { fetchMetarTaf, metarHtml } from './wx.js';
import { ic } from './icons.js';
import { sunInfo } from './sun.js';

/** Åtgärder som app.js fyller i (undviker cirkulära beroenden) */
export const actions = { editMode: () => false, drawActive: () => false, drawTap() {}, addWaypoint() {}, directTo() {}, showWx() {}, ownPos: () => null };

const asLayer = L.layerGroup();
const apLayer = L.layerGroup();
const on = { airspace: false, fields: false };
const renderer = L.canvas({ padding: 0.3, tolerance: 10 }); // större träffyta för fingrar

export function initAero() {
  registerOverlay('airspace', 'Luftrum', '', (v) => toggle('airspace', asLayer, v));
  registerOverlay('fields', 'Flygfält', '', (v) => toggle('fields', apLayer, v));
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
  if (!(on.airspace || on.fields)) return;
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
        if (actions.drawActive()) actions.drawTap({ lat: a.lat, lng: a.lon });
        else if (actions.editMode()) actions.addWaypoint({ lat: a.lat, lon: a.lon, name: a.icao || a.name, elevFt: a.elevFt });
        else openAirport(a);
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
  return `<div class="pbtns"><button id="${id}d">${ic('arrowRight')}Direkt till</button><button id="${id}a" class="sec">${ic('plus')}Lägg till i rutt</button>
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
    ${a.icao ? `<div id="apwx-${esc(a.icao)}" class="muted" style="margin-top:6px">Hämtar METAR/TAF…</div>` : ''}
    ${sunLine(a)}
    <div class="muted" style="margin-top:4px">Källa: ${esc(a.src)} — kontrollera alltid mot AIP/fältets info</div>
    ${btns({ lat: a.lat, lon: a.lon, name: a.icao || a.name, icao: a.icao, elevFt: a.elevFt })}`;
}

function sunLine(a) {
  const s = sunInfo(new Date(), a.lat, a.lon);
  const f = (d) => d ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z` : '—';
  return `<div class="popinfo" style="margin-top:4px">${ic('sun', 16)} Upp ${f(s.sunrise)} · ned ${f(s.sunset)} · skymning ${f(s.civilDusk)}</div>`;
}

/** Visa fältinformation i popup och hämta METAR/TAF för fält med ICAO-kod */
export function openAirport(a) {
  // DOM-innehåll (inte sträng) så att METAR som fylls i efteråt finns kvar när popupen ritas om
  const box = document.createElement('div');
  box.innerHTML = airportHtml(a);
  const popup = L.popup({ maxWidth: 360, autoPanPaddingTopLeft: [10, 10], autoPanPaddingBottomRight: [90, 10] })
    .setLatLng([a.lat, a.lon]).setContent(box).openOn(map);
  if (!a.icao || !navigator.onLine) { const el = a.icao && document.getElementById('apwx-' + a.icao); if (el) el.textContent = 'Offline — ingen METAR'; return; }
  fetchMetarTaf([a.icao]).then(([r]) => {
    const el = box.querySelector('[id^="apwx-"]');
    if (!el) return;
    el.classList.remove('muted');
    el.innerHTML = r && (r.metar || r.taf) ? metarHtml(r) : '<span class="muted">Ingen METAR/TAF för fältet</span>';
    if (popup.isOpen()) popup.update(); // panorera om så att den större rutan syns helt
  }).catch(() => { const el = document.getElementById('apwx-' + a.icao); if (el) el.textContent = 'METAR kunde inte hämtas just nu'; });
}

/** Närmaste synliga fält inom px pixlar från en skärmpunkt (för tryck som missar prickens kant) */
export function airportNear(latlng, px = 30) {
  if (!on.fields || map.getZoom() < 6) return null;
  const pt = map.latLngToContainerPoint(latlng), b = map.getBounds();
  let best = null, bd = px;
  for (const a of allAirports()) {
    if (!b.contains([a.lat, a.lon])) continue;
    if (map.getZoom() < 8 && !(a.icao || a.ul)) continue;
    const d = pt.distanceTo(map.latLngToContainerPoint([a.lat, a.lon]));
    if (d < bd) { bd = d; best = a; }
  }
  return best;
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
    ${oaipKey() ? airspaceListHtml(as) : '<div class="muted">Luftrumsinfo saknas just nu</div>'}
    ${btns(p)}`).openOn(map);
}
export { longestRwy };
