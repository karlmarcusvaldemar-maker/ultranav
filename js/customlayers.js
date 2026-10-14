// Eget kartmaterial: KML/KMZ, shapefil (zip), GeoJSON, GPX och WMS-tjänster. Sparas i biblioteket (synkas).
import { map, registerCustomLayers, renderLayerPanel } from './map.js';
import * as lib from './library.js';
import { store, toast, modal, esc, $, fetchX } from './util.js';
import { settings } from './settings.js';
import { ic } from './icons.js';

const shown = new Map();                       // id → Leaflet-lager som visas
const on = store.get('ulnav.customOn', {});    // vilka lager som är tända (per enhet)
const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#e03131'];
const MAX_SYNC = 9e6;                           // större lager sparas bara på enheten

export function initCustomLayers() {
  registerCustomLayers({ list, toggle, add: openAddDialog, manage });
  refresh();
  lib.onLibrary((kind) => { if (kind === 'layer') { refresh(); renderLayerPanelIfOpen(); } });
}
const renderLayerPanelIfOpen = () => { if (!$('#layerPanel').classList.contains('hidden')) renderLayerPanel(); };

function list() { return lib.list('layer').map((l) => ({ id: l.id, name: l.name, on: !!on[l.id], type: l.data.type })); }
function toggle(id, v) { on[id] = v; store.set('ulnav.customOn', on); refresh(); }
function refresh() {
  for (const [id, lyr] of shown) { const l = lib.get('layer', id); if (!l || !on[id] || lyr._ver !== l.updated) { map.removeLayer(lyr); shown.delete(id); } }
  for (const l of lib.list('layer')) if (on[l.id] && !shown.has(l.id)) {
    const lyr = makeLayer(l);
    if (lyr) { lyr._ver = l.updated; lyr.addTo(map); shown.set(l.id, lyr); }
  }
}

function popupFor(name, props) {
  const title = props.name || props.Name || props.NAMN || props.namn || props.title || '';
  const rows = Object.entries(props).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').slice(0, 14);
  return `<h4>${esc(title || name)}</h4>${rows.length ? `<table>${rows.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(String(v).slice(0, 200))}</td></tr>`).join('')}</table>` : ''}`;
}
function makeLayer(l) {
  const d = l.data;
  if (d.type === 'wms') {
    return L.tileLayer.wms(d.url, { layers: d.layers, format: d.format || 'image/png', transparent: true, version: d.version || '1.3.0',
      maxZoom: 19, opacity: d.opacity ?? 0.8, attribution: esc(l.name) });
  }
  const color = d.color || COLORS[0];
  return L.geoJSON(d.geojson, {
    bubblingMouseEvents: false,
    style: () => ({ color, weight: 2.5, opacity: 0.95, fillOpacity: 0.15 }),
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, bubblingMouseEvents: false }),
    onEachFeature: (f, layer) => layer.bindPopup(popupFor(l.name, f.properties || {}), { maxWidth: 340 }),
  });
}

// ---------- import av filer ----------
let scripts = {};
function loadScript(src) {
  if (!scripts[src]) scripts[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('kunde inte ladda ' + src)); document.head.appendChild(s); });
  return scripts[src];
}

const coordsOf = (txt) => txt.trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && isFinite(c[0]) && isFinite(c[1])).map(([x, y]) => [x, y]);
const kids = (el, name) => [...el.getElementsByTagNameNS('*', name)];
const text = (el, name) => kids(el, name)[0]?.textContent?.trim() || '';

/** KML → GeoJSON (punkter, linjer, ytor, MultiGeometry, namn, beskrivning, ExtendedData) */
export function parseKML(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('KML-filen kunde inte läsas');
  const features = [];
  for (const pm of kids(doc, 'Placemark')) {
    const props = { name: text(pm, 'name') };
    const desc = text(pm, 'description'); if (desc) props.description = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const d of kids(pm, 'Data')) props[d.getAttribute('name')] = text(d, 'value');
    for (const sd of kids(pm, 'SimpleData')) props[sd.getAttribute('name')] = sd.textContent.trim();
    const geoms = [];
    for (const p of kids(pm, 'Point')) { const c = coordsOf(text(p, 'coordinates')); if (c[0]) geoms.push({ type: 'Point', coordinates: c[0] }); }
    for (const ls of kids(pm, 'LineString')) { const c = coordsOf(text(ls, 'coordinates')); if (c.length > 1) geoms.push({ type: 'LineString', coordinates: c }); }
    for (const pg of kids(pm, 'Polygon')) {
      const outer = kids(pg, 'outerBoundaryIs')[0], inner = kids(pg, 'innerBoundaryIs');
      const rings = [coordsOf(text(outer || pg, 'coordinates')), ...inner.map((i) => coordsOf(text(i, 'coordinates')))].filter((r) => r.length > 3);
      if (rings.length) geoms.push({ type: 'Polygon', coordinates: rings });
    }
    if (!geoms.length) continue;
    features.push({ type: 'Feature', properties: props, geometry: geoms.length === 1 ? geoms[0] : { type: 'GeometryCollection', geometries: geoms } });
  }
  return { type: 'FeatureCollection', features };
}

/** GPX → GeoJSON (waypoints, rutter, spår) */
function parseGPX(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const pt = (e) => [+e.getAttribute('lon'), +e.getAttribute('lat')];
  const features = [];
  for (const w of kids(doc, 'wpt')) features.push({ type: 'Feature', properties: { name: text(w, 'name') }, geometry: { type: 'Point', coordinates: pt(w) } });
  for (const r of kids(doc, 'rte')) features.push({ type: 'Feature', properties: { name: text(r, 'name') }, geometry: { type: 'LineString', coordinates: kids(r, 'rtept').map(pt) } });
  for (const t of kids(doc, 'trk')) for (const seg of kids(t, 'trkseg')) features.push({ type: 'Feature', properties: { name: text(t, 'name') }, geometry: { type: 'LineString', coordinates: kids(seg, 'trkpt').map(pt) } });
  return { type: 'FeatureCollection', features };
}

function normalize(gj) {
  if (Array.isArray(gj)) return { type: 'FeatureCollection', features: gj.flatMap((g) => normalize(g).features) };
  if (gj?.type === 'FeatureCollection') return gj;
  if (gj?.type === 'Feature') return { type: 'FeatureCollection', features: [gj] };
  if (gj?.type && gj.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: gj }] };
  throw new Error('Filen innehåller ingen giltig geodata');
}

export async function importFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  let gj;
  if (ext === 'geojson' || ext === 'json') gj = JSON.parse(await file.text());
  else if (ext === 'kml') gj = parseKML(await file.text());
  else if (ext === 'gpx') gj = parseGPX(await file.text());
  else if (ext === 'kmz') {
    await loadScript('vendor/jszip/jszip.min.js');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const kml = Object.values(zip.files).find((f) => /\.kml$/i.test(f.name));
    if (!kml) throw new Error('KMZ-filen innehåller ingen KML');
    gj = parseKML(await kml.async('text'));
  } else if (ext === 'zip') {
    await loadScript('vendor/shp/shp.min.js');
    gj = await window.shp(await file.arrayBuffer()); // läser .shp/.dbf/.prj och räknar om till WGS84
  } else if (ext === 'shp') throw new Error('Packa shapefilen som en zip-fil tillsammans med .dbf, .shx och .prj och importera zip-filen.');
  else throw new Error('Filtypen stöds inte. Använd KML, KMZ, GPX, GeoJSON eller shapefil i zip.');
  gj = normalize(gj);
  if (!gj.features.length) throw new Error('Filen innehåller inga objekt med koordinater');
  return addGeoJSON(name, gj);
}

async function addGeoJSON(name, geojson) {
  const size = JSON.stringify(geojson).length;
  const color = COLORS[lib.list('layer').length % COLORS.length];
  const id = lib.newId();
  on[id] = true; store.set('ulnav.customOn', on); // tänd innan sparning så att kartpanelen visar rätt läge
  await lib.put('layer', { id, name, data: { type: 'geojson', geojson, color, localOnly: size > MAX_SYNC } });
  refresh(); zoomTo(id);
  toast(`${name}: ${geojson.features.length} objekt importerade${size > MAX_SYNC ? ' (för stort för att synkas — sparas bara på enheten)' : ''}`, 5000);
  return id;
}

// ---------- WMS ----------
async function wmsLayers(url) {
  const u = url + (url.includes('?') ? '&' : '?') + 'service=WMS&request=GetCapabilities';
  const xml = await fetchX(u, { as: 'text', proxy: settings.corsProxy, timeout: 20000 });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const version = doc.documentElement.getAttribute('version') || '1.3.0';
  const layers = kids(doc, 'Layer').map((l) => ({ name: [...l.children].find((c) => c.localName === 'Name')?.textContent, title: [...l.children].find((c) => c.localName === 'Title')?.textContent })).filter((l) => l.name);
  return { version, layers };
}

function openAddDialog() {
  modal(`<h3>Lägg till kartmaterial</h3>
    <h3 class="sub">Fil</h3>
    <div class="muted">KML, KMZ, GPX, GeoJSON eller shapefil (zip med .shp, .dbf, .shx och .prj).</div>
    <div class="btnrow"><label class="btn primary">${ic('upload')}Välj fil<input type="file" id="clFile" accept=".kml,.kmz,.gpx,.geojson,.json,.zip,.shp" hidden></label></div>
    <div id="clFileRes"></div>
    <h3 class="sub">WMS-tjänst</h3>
    <div class="field"><span>Adress</span><input type="url" id="clUrl" placeholder="https://…/wms" autocapitalize="off"></div>
    <div class="btnrow"><button class="btn" id="clCaps">${ic('search')}Hämta lager</button></div>
    <div class="field"><span>Lager</span><input type="text" id="clLayers" placeholder="lagernamn (kommaseparerat)" autocapitalize="off" list="clLayerList"><datalist id="clLayerList"></datalist></div>
    <div class="field"><span>Namn</span><input type="text" id="clName" placeholder="Visas i kartlistan"></div>
    <div class="btnrow"><button class="btn primary" id="clAddWms">${ic('plus')}Lägg till WMS</button></div>
    <div id="clWmsRes"></div>`);
  let version = '1.3.0';
  $('#clFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#clFileRes').innerHTML = '<div class="muted">Läser in…</div>';
    try { await importFile(f); $('#modal').classList.add('hidden'); }
    catch (err) { $('#clFileRes').innerHTML = `<div class="badbox">${esc(err.message)}</div>`; }
  };
  $('#clCaps').onclick = async () => {
    const url = $('#clUrl').value.trim(); if (!url) return;
    $('#clWmsRes').innerHTML = '<div class="muted">Hämtar lager…</div>';
    try {
      const c = await wmsLayers(url); version = c.version;
      $('#clLayerList').innerHTML = c.layers.map((l) => `<option value="${esc(l.name)}">${esc(l.title || '')}</option>`).join('');
      if (c.layers[0] && !$('#clLayers').value) { $('#clLayers').value = c.layers[0].name; if (!$('#clName').value) $('#clName').value = c.layers[0].title || c.layers[0].name; }
      $('#clWmsRes').innerHTML = `<div class="okbox">${c.layers.length} lager hittade (WMS ${esc(version)}). Välj i fältet Lager.</div>`;
    } catch (err) {
      $('#clWmsRes').innerHTML = `<div class="warnbox">Kunde inte läsa tjänstens lagerlista (${esc(err.message)}). Ange lagernamnet för hand.</div>`;
    }
  };
  $('#clAddWms').onclick = async () => {
    const url = $('#clUrl').value.trim().replace(/\?.*$/, ''), layers = $('#clLayers').value.trim();
    if (!/^https:\/\//.test(url) || !layers) { $('#clWmsRes').innerHTML = '<div class="warnbox">Ange en adress som börjar med https:// och minst ett lager.</div>'; return; }
    const id = lib.newId();
    on[id] = true; store.set('ulnav.customOn', on);
    await lib.put('layer', { id, name: $('#clName').value.trim() || layers, data: { type: 'wms', url, layers, version, opacity: 0.8 } });
    refresh();
    $('#modal').classList.add('hidden'); toast('WMS-lager tillagt'); renderLayerPanelIfOpen();
  };
}

// ---------- hantera ----------
function bboxOf(gj) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  const g = (geom) => { if (!geom) return; if (geom.type === 'GeometryCollection') geom.geometries.forEach(g); else walk(geom.coordinates); };
  gj.features.forEach((f) => g(f.geometry));
  return b;
}
function zoomTo(id) {
  const l = lib.get('layer', id); if (!l || l.data.type !== 'geojson') return;
  const b = bboxOf(l.data.geojson); if (!isFinite(b[0])) return;
  map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [60, 100], maxZoom: 14 });
}
function manage(id) {
  const l = lib.get('layer', id); if (!l) return;
  const n = l.data.type === 'geojson' ? `${l.data.geojson.features.length} objekt` : `WMS: ${esc(l.data.layers)}`;
  modal(`<h3>${esc(l.name)}</h3><div class="muted">${n}${l.data.localOnly ? ' · sparas bara på den här enheten (för stort för molnet)' : ''}${l.share ? ' · delad' : ''}</div>
    <div class="btnrow">
      ${l.data.type === 'geojson' ? `<button class="btn" id="clZoom">${ic('search')}Visa på kartan</button><button class="btn" id="clColor">${ic('edit')}Byt färg</button>` : ''}
      <button class="btn" id="clShare">${ic('share')}Dela</button>
      <button class="btn" id="clRename">${ic('edit')}Byt namn</button>
      <button class="btn danger" id="clDel">${ic('trash')}Ta bort</button>
    </div>
    ${l.data.type === 'wms' ? `<div class="field"><span>Genomskinlighet</span><input type="range" id="clOp" min="20" max="100" value="${Math.round((l.data.opacity ?? 0.8) * 100)}"></div>` : ''}`);
  const close = () => $('#modal').classList.add('hidden');
  $('#clZoom')?.addEventListener('click', () => { close(); if (!on[id]) toggle(id, true); zoomTo(id); renderLayerPanelIfOpen(); });
  $('#clColor')?.addEventListener('click', () => { const i = (COLORS.indexOf(l.data.color) + 1) % COLORS.length; lib.put('layer', { ...l, data: { ...l.data, color: COLORS[i] } }); close(); });
  $('#clShare').onclick = () => { close(); window.ulnav.share('layer', id); };
  $('#clRename').onclick = () => { const v = prompt('Nytt namn:', l.name); if (v) { lib.put('layer', { ...l, name: v }); close(); } };
  $('#clDel').onclick = () => { if (confirm(`Ta bort "${l.name}"?`)) { lib.remove('layer', id); delete on[id]; store.set('ulnav.customOn', on); close(); } };
  $('#clOp')?.addEventListener('change', (e) => lib.put('layer', { ...l, data: { ...l.data, opacity: e.target.value / 100 } }));
}

/** Importera ett delat lager (från länk) */
export async function addSharedLayer(name, data) {
  const id = lib.newId();
  on[id] = true; store.set('ulnav.customOn', on);
  await lib.put('layer', { id, name, data });
  refresh(); zoomTo(id);
}
