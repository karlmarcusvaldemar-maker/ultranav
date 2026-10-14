// Ritverktyg: snabbmätning av avstånd, samt linjer, ytor (polygoner) och punkter som sparas
import { map, registerOverlay } from './map.js';
import { settings } from './settings.js';
import { icon, ic } from './icons.js';
import { distNM, bearing, norm360, fmtDeg, fmtLatLon, esc, store, toast, download, $, interp } from './util.js';

const R_M = 6371008.8;
export const drawings = store.get('ulnav.drawings', []);
const save = () => store.set('ulnav.drawings', drawings);
const listeners = new Set();
export const onDrawings = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f(drawings));

/** Åtgärder från app.js (rutt, direkt till, egen position) */
export const drawActions = { addWaypoint() {}, directTo() {}, setRoute() {}, ownPos: () => null, onModeChange() {} };

const COLORS = { line: '#0a84ff', polygon: '#ff9f0a', point: '#30d158', measure: '#ff375f' };
const savedLayer = L.layerGroup();
const liveLayer = L.layerGroup();
let mode = null;        // null | 'measure' | 'line' | 'polygon' | 'point'
let pts = [];           // [{lat, lon}] för pågående ritning
let savedOn = false;

// ---------- geometri ----------
export function lengthNM(c) { let d = 0; for (let i = 1; i < c.length; i++) d += distNM(c[i - 1], c[i]); return d; }
/** Area i m² på sfär (Chamberlain & Duquette) */
export function areaM2(c) {
  if (c.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    s += (b.lon - a.lon) * Math.PI / 180 * (2 + Math.sin(a.lat * Math.PI / 180) + Math.sin(b.lat * Math.PI / 180));
  }
  return Math.abs(s * R_M * R_M / 2);
}
const fmtLen = (nm) => `${nm < 10 ? nm.toFixed(2) : nm.toFixed(1)} NM (${(nm * 1.852).toFixed(nm * 1.852 < 10 ? 2 : 1)} km)`;
function fmtArea(m2) {
  const km2 = m2 / 1e6;
  return km2 >= 1 ? `${km2.toFixed(km2 < 10 ? 2 : 1)} km² (${(km2 / 3.4299).toFixed(2)} NM²)` : `${Math.round(m2 / 1e4 * 10) / 10} ha (${Math.round(m2).toLocaleString('sv-SE')} m²)`;
}
const magBrg = (a, b) => fmtDeg(norm360(bearing(a, b) - settings.variation));
const ll = (p) => [p.lat, p.lon];

export function describe(f) {
  if (f.type === 'point') return fmtLatLon(f.coords[0].lat, f.coords[0].lon);
  if (f.type === 'polygon') return `Yta ${fmtArea(areaM2(f.coords))} · omkrets ${fmtLen(lengthNM([...f.coords, f.coords[0]]))}`;
  return `Längd ${fmtLen(lengthNM(f.coords))}`;
}

// ---------- init ----------
export function initDraw() {
  liveLayer.addTo(map);
  registerOverlay('drawings', 'Mina ritningar', 'Sparade linjer, ytor och punkter', (v) => { savedOn = v; if (v) { savedLayer.addTo(map); drawSaved(); } else map.removeLayer(savedLayer); });
  buildToolbar();
}

export const drawActive = () => mode !== null;
export function setMode(m) {
  if (mode && pts.length && mode !== 'measure' && mode !== m && !confirm('Avbryta pågående ritning?')) return;
  mode = m; pts = [];
  if (m) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  $('#drawBar').classList.toggle('hidden', !m);
  $('#drawBar').querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  drawLive();
  drawActions.onModeChange(m);
}

/** Tryck på kartan när ritverktyget är aktivt */
export function drawTap(latlng) {
  const p = { lat: latlng.lat, lon: latlng.lng ?? latlng.lon };
  if (mode === 'point') { savePoint(p); return; }
  pts.push(p); drawLive();
}

// ---------- verktygsfält ----------
function buildToolbar() {
  const bar = document.createElement('div');
  bar.id = 'drawBar'; bar.className = 'hidden';
  bar.innerHTML = `<div class="dbtns">
      <button data-mode="measure">${icon('measure')}<small>Mät</small></button><button data-mode="line">${icon('polyline')}<small>Linje</small></button>
      <button data-mode="polygon">${icon('polygon')}<small>Yta</small></button><button data-mode="point">${icon('pin')}<small>Punkt</small></button>
      <span class="sep"></span>
      <button id="dOwn" title="Börja från min position">${icon('crosshair')}<small>Min pos</small></button>
      <button id="dUndo">${icon('undo')}<small>Ångra</small></button><button id="dDone" class="primary">${icon('check')}<small>Spara</small></button>
      <button id="dClose">${icon('close')}<small>Stäng</small></button></div>
    <div id="drawReadout"></div>`;
  $('#mapwrap').appendChild(bar);
  bar.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $('#dUndo').onclick = () => { pts.pop(); drawLive(); };
  $('#dOwn').onclick = () => {
    const o = drawActions.ownPos();
    if (!o) { toast('Ingen GPS-position — starta GPS först'); return; }
    if (mode === 'point') { savePoint({ lat: o.lat, lon: o.lon }); return; }
    pts.unshift({ lat: o.lat, lon: o.lon }); drawLive();
  };
  $('#dDone').onclick = finish;
  $('#dClose').onclick = () => {
    if (pts.length > 1 && mode !== 'measure' && !confirm('Stänga utan att spara?')) return;
    setMode(null);
  };
  L.DomEvent.disableClickPropagation(bar);
}

// ---------- pågående ritning ----------
const vIcon = (i) => L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: `<div class="dvert">${i + 1}</div>` });
function drawLive() {
  liveLayer.clearLayers();
  const col = COLORS[mode] || '#ff375f';
  if (pts.length > 1) {
    const path = mode === 'polygon' ? [...pts, pts[0]] : pts;
    if (mode === 'polygon' && pts.length > 2) L.polygon(pts.map(ll), { pane: 'route', color: col, weight: 3, fillOpacity: 0.15, interactive: false }).addTo(liveLayer);
    else L.polyline(path.map(ll), { pane: 'route', color: col, weight: 4, dashArray: mode === 'measure' ? '8 6' : null, interactive: false }).addTo(liveLayer);
    // sträcketiketter
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const px = map.latLngToContainerPoint(ll(a)).distanceTo(map.latLngToContainerPoint(ll(b)));
      if (px < 90) continue;
      const m = interp(a, b, 0.5), d = distNM(a, b);
      L.tooltip({ permanent: true, direction: 'center', className: 'draw-seg', interactive: false })
        .setLatLng(ll(m)).setContent(`${d < 10 ? d.toFixed(2) : d.toFixed(1)} NM · ${magBrg(a, b)}°M`).addTo(liveLayer);
    }
  }
  pts.forEach((p, i) => {
    const mk = L.marker(ll(p), { icon: vIcon(i), draggable: true, pane: 'routeIcons', bubblingMouseEvents: false }).addTo(liveLayer);
    mk.on('drag', () => { const q = mk.getLatLng(); p.lat = q.lat; p.lon = q.lng; readout(); });
    mk.on('dragend', drawLive);
    mk.on('click', () => { if (mode === 'polygon' && i === 0 && pts.length > 2) finish(); });
  });
  readout();
}

function readout() {
  const el = $('#drawReadout');
  if (!el) return;
  const hint = { measure: 'Tryck på kartan för att mäta. Dra punkterna för att justera.', line: 'Tryck för att lägga till punkter i linjen.',
    polygon: 'Tryck för att lägga till hörn. Tryck på punkt 1 eller Spara för att avsluta.', point: 'Tryck på kartan för att placera en punkt.' }[mode] || '';
  if (pts.length < 2) { el.innerHTML = `<span class="muted">${hint}</span>`; return; }
  const total = lengthNM(pts);
  const last = distNM(pts[pts.length - 2], pts[pts.length - 1]);
  let h = mode === 'polygon'
    ? `<b>Yta ${pts.length > 2 ? fmtArea(areaM2(pts)) : '—'}</b> · omkrets ${fmtLen(lengthNM([...pts, pts[0]]))}`
    : `<b>${fmtLen(total)}</b> · senaste ${last.toFixed(2)} NM ${magBrg(pts[pts.length - 2], pts[pts.length - 1])}°M`;
  if (mode !== 'polygon' && settings.tas) h += ` · ${fmtTime(total / settings.tas)} vid TAS`;
  el.innerHTML = h;
}
const fmtTime = (h) => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function finish() {
  if (mode === 'point') { setMode(null); return; }
  const min = mode === 'polygon' ? 3 : 2;
  if (pts.length < min) { toast(mode === 'polygon' ? 'En yta behöver minst tre hörn' : 'Lägg till minst två punkter'); return; }
  const type = mode === 'measure' ? 'line' : mode;
  const n = drawings.filter((f) => f.type === type).length + 1;
  const name = prompt('Namn:', `${type === 'polygon' ? 'Yta' : 'Linje'} ${n}`);
  if (name === null) return;
  addDrawing({ type, name: name || `${type} ${n}`, coords: pts.map((p) => ({ lat: p.lat, lon: p.lon })) });
  setMode(null);
}
function savePoint(p) {
  const n = drawings.filter((f) => f.type === 'point').length + 1;
  const name = prompt('Namn på punkten:', `P${n}`);
  if (name === null) return;
  addDrawing({ type: 'point', name: name || `P${n}`, coords: [p] });
}
function addDrawing(f) {
  f.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  drawings.push(f); save();
  if (!savedOn) { savedOn = true; savedLayer.addTo(map); }
  drawSaved(); emit();
  toast(`Sparat: ${f.name}`);
}

// ---------- sparade ritningar ----------
export function drawSaved() {
  savedLayer.clearLayers();
  for (const f of drawings) {
    const col = f.color || COLORS[f.type];
    let lyr;
    if (f.type === 'point') {
      lyr = L.marker(ll(f.coords[0]), { pane: 'routeIcons', bubblingMouseEvents: false,
        icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 26], html: `<div class="dpin" style="background:${col}"></div>` }) });
      lyr.bindTooltip(esc(f.name), { permanent: true, direction: 'right', offset: [8, -14], className: 'draw-label' });
    } else {
      lyr = f.type === 'polygon'
        ? L.polygon(f.coords.map(ll), { pane: 'route', color: col, weight: 3, fillOpacity: 0.12, bubblingMouseEvents: false })
        : L.polyline(f.coords.map(ll), { pane: 'route', color: col, weight: 4, bubblingMouseEvents: false });
      lyr.bindTooltip(`${esc(f.name)} · ${f.type === 'polygon' ? fmtArea(areaM2(f.coords)) : lengthNM(f.coords).toFixed(1) + ' NM'}`,
        { permanent: true, direction: 'center', className: 'draw-label', sticky: false });
    }
    lyr.on('click', (e) => {
      if (mode) { drawTap(e.latlng); return; }
      L.popup({ maxWidth: 340 }).setLatLng(e.latlng).setContent(popupHtml(f)).openOn(map);
    });
    lyr.addTo(savedLayer);
  }
}

function popupHtml(f) {
  const id = f.id;
  const own = drawActions.ownPos();
  const c = f.type === 'point' ? f.coords[0] : null;
  const rel = c && own ? `<div><b>${distNM(own, c).toFixed(1)} NM</b> · ${magBrg(own, c)}°M från dig</div>` : '';
  return `<h4>${esc(f.name)}</h4><div>${describe(f)}</div>${rel}
    <div class="pbtns">${f.type === 'point' ? `<button onclick="window.ulnavDraw.dto('${id}')">${ic('arrowRight')}Direkt till</button><button class="sec" onclick="window.ulnavDraw.addWp('${id}')">${ic('plus')}Rutt</button>` : ''}
    ${f.type === 'line' ? `<button onclick="window.ulnavDraw.asRoute('${id}')">${ic('route')}Använd som rutt</button>` : ''}
    <button class="sec" onclick="window.ulnavDraw.rename('${id}')">${ic('edit')}Byt namn</button><button class="sec" onclick="window.ulnavDraw.del('${id}')">${ic('trash')}Ta bort</button></div>`;
}

const byId = (id) => drawings.find((f) => f.id === id);
window.ulnavDraw = {
  dto(id) { const f = byId(id); map.closePopup(); drawActions.directTo({ ...f.coords[0], name: f.name }); },
  addWp(id) { const f = byId(id); map.closePopup(); drawActions.addWaypoint({ ...f.coords[0], name: f.name }); toast('+ ' + f.name); },
  asRoute(id) {
    const f = byId(id); map.closePopup();
    if (!confirm(`Ersätta aktuell rutt med "${f.name}"?`)) return;
    drawActions.setRoute({ name: f.name, wps: f.coords.map((p, i) => ({ lat: p.lat, lon: p.lon, name: i === 0 ? 'Start' : i === f.coords.length - 1 ? 'Mål' : `WP${i + 1}`, alt: settings.cruiseAlt })) });
  },
  rename(id) { const f = byId(id); const n = prompt('Nytt namn:', f.name); if (!n) return; f.name = n; save(); drawSaved(); emit(); map.closePopup(); },
  del(id) { const i = drawings.findIndex((f) => f.id === id); if (i < 0 || !confirm(`Ta bort "${drawings[i].name}"?`)) return; drawings.splice(i, 1); save(); drawSaved(); emit(); map.closePopup(); },
  zoom(id) {
    const f = byId(id);
    if (f.type === 'point') map.setView(ll(f.coords[0]), Math.max(map.getZoom(), 12));
    else map.fitBounds(f.coords.map(ll), { padding: [60, 100] });
    if (!savedOn) { savedOn = true; savedLayer.addTo(map); drawSaved(); }
  },
};

// ---------- flik ----------
export function renderDrawTab(el) {
  el.innerHTML = `<h3>Verktyg</h3>
    <div class="btnrow"><button class="btn" data-m="measure">${ic('measure')}Mät avstånd</button><button class="btn" data-m="line">${ic('polyline')}Linje</button>
    <button class="btn" data-m="polygon">${ic('polygon')}Yta</button><button class="btn" data-m="point">${ic('pin')}Punkt</button></div>
    <div class="muted">Avstånd visas i NM och km, kurs i grader magnetiskt (variation ${settings.variation}°). Ytor räknas på jordklotet.</div>
    <h3>Sparade (${drawings.length})</h3>
    ${drawings.length ? `<ul class="aplist">${drawings.map((f) => `<li><div class="info"><b class="popinfo">${ic({ point: 'pin', line: 'polyline', polygon: 'polygon' }[f.type], 16)} ${esc(f.name)}</b><span>${describe(f)}</span></div>
      <button class="btn small" onclick="window.ulnavDraw.zoom('${f.id}')">${ic('search')}Visa</button><button class="btn small danger" onclick="window.ulnavDraw.del('${f.id}')" aria-label="Ta bort">${ic('trash')}</button></li>`).join('')}</ul>`
      : `<div class="empty">${ic('ruler', 34)}<b>Inget sparat ännu</b><span>Mät en sträcka eller rita en linje, yta eller punkt — de sparas här.</span></div>`}
    <div class="btnrow"><button class="btn" id="dExp">${ic('download')}Exportera GeoJSON</button>
    <label class="btn">${ic('upload')}Importera GeoJSON<input type="file" id="dImp" accept=".geojson,.json,application/geo+json,application/json" hidden></label></div>`;
  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { drawActions.closeSide?.(); setMode(b.dataset.m); });
  $('#dExp', el).onclick = () => { if (!drawings.length) return toast('Inget att exportera'); download('ritningar.geojson', JSON.stringify(toGeoJSON(), null, 1), 'application/geo+json'); };
  $('#dImp', el).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const n = importGeoJSON(JSON.parse(await file.text())); toast(`${n} objekt importerade`); }
    catch (err) { toast('Kunde inte läsa filen: ' + err.message); }
  };
}

export function toGeoJSON() {
  return { type: 'FeatureCollection', features: drawings.map((f) => ({
    type: 'Feature', properties: { name: f.name, kind: f.type },
    geometry: f.type === 'point' ? { type: 'Point', coordinates: [f.coords[0].lon, f.coords[0].lat] }
      : f.type === 'line' ? { type: 'LineString', coordinates: f.coords.map((p) => [p.lon, p.lat]) }
      : { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]].map((p) => [p.lon, p.lat])] },
  })) };
}
function importGeoJSON(gj) {
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
  let n = 0;
  for (const ft of feats) {
    const g = ft.geometry, name = ft.properties?.name || ft.properties?.namn || `Import ${++n}`;
    const P = ([lon, lat]) => ({ lat, lon });
    const add = (type, coords) => { drawings.push({ id: Math.random().toString(36).slice(2, 10), type, name, coords }); n++; };
    if (!g) continue;
    if (g.type === 'Point') add('point', [P(g.coordinates)]);
    else if (g.type === 'LineString') add('line', g.coordinates.map(P));
    else if (g.type === 'Polygon') add('polygon', g.coordinates[0].slice(0, -1).map(P));
    else if (g.type === 'MultiPoint') g.coordinates.forEach((c) => add('point', [P(c)]));
    else if (g.type === 'MultiLineString') g.coordinates.forEach((c) => add('line', c.map(P)));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((c) => add('polygon', c[0].slice(0, -1).map(P)));
  }
  save(); if (!savedOn) { savedOn = true; savedLayer.addTo(map); } drawSaved(); emit();
  return n;
}
