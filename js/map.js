// Karta, baskartor, överlägg och lagerpanel
import { settings, saveSettings, onSettings, oaipKey, proxyUrl } from './settings.js';
import { store, esc, $, fetchX, toast } from './util.js';
import { vectorLayer } from './vector.js';
import { ic } from './icons.js';

export let map;
const state = store.get('ulnav.layers', { base: 'vecLiberty', overlays: ['airspace', 'fields'], opacity: {}, v: 2 });
// Migrering: tidigare versioner sparade lagernamn som inte längre finns, vilket stängde av luftrum/fält
{
  const MAP = { openaipVec: ['airspace', 'rp'], oa: ['fields'], route: [] };
  if (state.overlays.some((id) => id in MAP)) {
    state.overlays = [...new Set(state.overlays.flatMap((id) => MAP[id] ?? [id]))];
    store.set('ulnav.layers', state);
  }
  // Standardkartan blev förvald baskarta i version 2 — byt en gång, därefter gäller användarens val
  if ((state.v || 1) < 2) { state.base = 'vecLiberty'; state.v = 2; store.set('ulnav.layers', state); }
}
const save = () => store.set('ulnav.layers', state);

// crossOrigin av: bilderna visas även om servern inte skickar CORS-huvuden (appen läser aldrig pixlarna)
const tileOpts = (extra) => ({ maxZoom: 19, crossOrigin: false, className: 'basemap', ...extra });

export const BASES = {
  otm: { name: 'Topografikarta', make: () => L.tileLayer(settings.tiles.otm, tileOpts({ maxNativeZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' })) },
  vecLiberty: { name: 'Standardkarta', make: () => vectorLayer('liberty', '© OpenFreeMap © OpenMapTiles © OpenStreetMap') },
  osm: { name: 'Vägkarta', make: () => L.tileLayer(settings.tiles.osm, tileOpts({ maxNativeZoom: 19, attribution: '© OpenStreetMap-bidragsgivare' })) },
  kartverket: { name: 'Norgekarta', make: () => L.tileLayer(settings.tiles.kartverket, tileOpts({ maxNativeZoom: 18, attribution: '© Kartverket (CC BY 4.0)' })) },
  esri: { name: 'Satellitkarta', make: () => L.tileLayer(settings.tiles.esri, tileOpts({ maxNativeZoom: 18, attribution: 'Bild © Esri, Maxar, Earthstar Geographics' })) },
};

export const OVERLAYS = {
  radar: { name: 'Nederbördsradar', opacity: 0.6, make: makeRadar },
  protected: { name: 'Skyddade områden', opacity: 0.7, make: makeProtected },
};

let baseLayer;
const overlayLayers = {};  // id → aktivt lager
const external = {};       // vektorlager som andra moduler registrerar

export function initMap() {
  const start = store.get('ulnav.view', { lat: 64.1592, lon: 17.2744, z: 10 }); // standard: Åsele flygfält (ESUS)
  map = L.map('map', {
    zoomControl: false, attributionControl: true, rotate: true, bearing: 0,
    touchRotate: false, rotateControl: false, shiftKeyRotate: false, compassBearing: false,
    preferCanvas: true, worldCopyJump: true, tap: false, zoomSnap: 0.25, zoomDelta: 1,
  }).setView([start.lat, start.lon], start.z);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
  // Egen skala i NM
  const NmScale = L.Control.Scale.extend({
    _updateMetric(maxMeters) { const nm = this._getRoundNum(maxMeters / 1852 * 10) / 10 || 0.1; this._updateScale(this._mScale, nm + ' NM', nm * 1852 / maxMeters); },
  });
  new NmScale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Vektorlager i det roterande lagret, ikoner i det icke-roterande (leaflet-rotate)
  const rot = map.getPane('rotatePane') || map.getPane('mapPane'), norot = map.getPane('norotatePane') || map.getPane('mapPane');
  const pane = (n, z, parent) => { map.createPane(n, parent); map.getPane(n).style.zIndex = z; };
  pane('airspace', 380, rot); pane('route', 450, rot); pane('ownPath', 460, rot);
  pane('routeIcons', 620, norot); pane('own', 660, norot);

  map.on('moveend', () => { const c = map.getCenter(); store.set('ulnav.view', { lat: c.lat, lon: c.lng, z: map.getZoom() }); });
  setBase(state.base);
  for (const id of state.overlays) if (OVERLAYS[id]) enableOverlay(id, true);
  onSettings((s, patch) => {
    if (patch.tiles || 'vectorHillshade' in patch) setBase(state.base);
    if ('openaipKey' in patch || patch.tiles) for (const id of Object.keys(OVERLAYS)) if (overlayLayers[id]) { enableOverlay(id, false); enableOverlay(id, true); }
  });
  return map;
}

export function setBase(id) {
  if (!BASES[id]) id = 'vecLiberty';
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[id].make().addTo(map);
  watchErrors(baseLayer, BASES[id].name);
  state.base = id; save();
}
export const currentBase = () => state.base;

/** Varna bara om inga kartrutor alls kunde hämtas i vyn — enstaka saknade rutor (utanför täckning, utzoomning) är normalt */
let lastErrToast = 0;
function watchErrors(layer, name) {
  let ok = 0, err = 0;
  layer.on('loading', () => { ok = 0; err = 0; });
  layer.on('tileload', () => ok++);
  layer.on('tileerror', () => err++);
  layer.on('load', () => {
    if (err > 0 && ok === 0 && navigator.onLine && Date.now() - lastErrToast > 60000) {
      lastErrToast = Date.now();
      toast(`${name} svarar inte just nu. Prova en annan baskarta.`, 6000);
    }
  });
}

function enableOverlay(id, on) {
  const def = OVERLAYS[id];
  if (on) {
    if (overlayLayers[id]) return;
    if (def.needsKey && !oaipKey()) { toast('Kartlagret är inte tillgängligt just nu'); return false; }
    const lyr = def.make();
    if (!lyr) return false;
    lyr.setOpacity?.(state.opacity[id] ?? def.opacity ?? 1);
    lyr.addTo(map); overlayLayers[id] = lyr;
  } else if (overlayLayers[id]) { map.removeLayer(overlayLayers[id]); delete overlayLayers[id]; }
  return true;
}

/** Låt andra moduler registrera vektoröverlägg som visas i lagerpanelen */
export function registerOverlay(id, name, note, onToggle) {
  external[id] = { name, note, onToggle };
  onToggle(state.overlays.includes(id));
}
export const overlayOn = (id) => state.overlays.includes(id);

function setOverlayState(id, on) {
  state.overlays = state.overlays.filter((x) => x !== id);
  if (on) state.overlays.push(id);
  save();
}

// ---------- RainViewer ----------
function makeRadar() {
  const grp = L.layerGroup();
  fetchX('https://api.rainviewer.com/public/weather-maps.json', { proxy: proxyUrl() })
    .then((j) => {
      const frames = j?.radar?.past || [];
      const f = frames[frames.length - 1];
      if (!f) throw new Error('inga radarbilder');
      const t = new Date(f.time * 1000);
      L.tileLayer(`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: state.opacity.radar ?? 0.6, maxNativeZoom: 7, maxZoom: 19, zIndex: 50,
        attribution: `Radar © RainViewer (${t.toISOString().slice(11, 16)}Z)`,
      }).addTo(grp);
      toast(`Radarbild från ${t.toISOString().slice(11, 16)}Z`);
    })
    .catch((e) => toast('Radar: ' + e.message));
  grp.setOpacity = (o) => grp.eachLayer((l) => l.setOpacity?.(o));
  return grp;
}

// ---------- Naturvårdsverkets skyddade områden (WMS) ----------
// Lagernamnen läses ur tjänstens GetCapabilities (sparas en vecka). Reserv: kända INSPIRE-lager.
const PROTECTED_FALLBACK = { url: 'https://geodata.naturvardsverket.se/inspire/ps-nvr/ows', layers: 'PS.ProtectedSites.NR,PS.ProtectedSites.DVO', version: '1.3.0' };
const PROTECTED_MATCH = /nationalpark|naturreservat|djur.*växt|växt.*djur|naturvårdsområde|naturminne|fågel/i;
async function protectedLayers() {
  const cached = store.get('ulnav.protectedWms', null);
  if (cached && cached.url === settings.tiles.protected && Date.now() - cached.t < 7 * 864e5) return cached;
  try {
    const url = settings.tiles.protected;
    const xml = await fetchX(url + (url.includes('?') ? '&' : '?') + 'service=WMS&request=GetCapabilities', { as: 'text', proxy: proxyUrl(), timeout: 20000 });
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const child = (el, n) => [...el.children].find((c) => c.localName === n)?.textContent || '';
    const named = [...doc.getElementsByTagNameNS('*', 'Layer')].map((l) => ({ name: child(l, 'Name'), title: child(l, 'Title') })).filter((l) => l.name);
    const pick = named.filter((l) => PROTECTED_MATCH.test(l.title) || PROTECTED_MATCH.test(l.name));
    if (!pick.length) throw new Error('inga lager');
    const res = { t: Date.now(), url, layers: pick.map((l) => l.name).join(','), titles: pick.map((l) => l.title), version: doc.documentElement.getAttribute('version') || '1.3.0' };
    store.set('ulnav.protectedWms', res);
    return res;
  } catch (e) { console.warn('skyddade områden', e); return PROTECTED_FALLBACK; }
}
function makeProtected() {
  const grp = L.layerGroup();
  let wms = null;
  protectedLayers().then((c) => {
    wms = L.tileLayer.wms(c.url, { layers: c.layers, format: 'image/png', transparent: true, version: c.version, maxZoom: 19, zIndex: 40,
      opacity: state.opacity.protected ?? 0.7, attribution: 'Skyddade områden © Naturvårdsverket' }).addTo(grp);
  });
  grp.setOpacity = (o) => wms?.setOpacity(o);
  return grp;
}

// ---------- test av baskarta ----------
export async function testCurrentBase() {
  const id = state.base, b = BASES[id];
  const { testTile } = await import('./diag.js');
  if (id.startsWith('vec')) return testTile('https://tiles.openfreemap.org/styles/liberty', b.name, true);
  const c = map.getCenter(), z = Math.min(Math.round(map.getZoom()), 12), n = 2 ** z, φ = c.lat * Math.PI / 180;
  const x = Math.floor((c.lng + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * n);
  const tpl = { otm: settings.tiles.otm, osm: settings.tiles.osm, esri: settings.tiles.esri, kartverket: settings.tiles.kartverket }[id];
  return testTile(tpl.replace('{s}', 'a').replace('{z}', z).replace('{x}', x).replace('{y}', y), b.name);
}

// ---------- eget kartmaterial (customlayers.js registrerar sig här) ----------
let custom = null;
export function registerCustomLayers(provider) { custom = provider; }

// ---------- Lagerpanel ----------
const BASE_ICON = { otm: 'mapTopo', vecLiberty: 'mapDetail', osm: 'mapRoad', kartverket: 'mapTopo', esri: 'satellite' };
const OVERLAY_ORDER = ['airspace', 'fields', 'protected', 'metar', 'radar', 'drawings'];

export function renderLayerPanel() {
  const el = $('#layerPanel');
  let h = '<h3>Baskarta</h3><div class="basegrid">';
  for (const [id, b] of Object.entries(BASES)) {
    h += `<label class="basecard ${state.base === id ? 'on' : ''}"><input type="radio" name="base" value="${id}" ${state.base === id ? 'checked' : ''}>
      ${ic(BASE_ICON[id] || 'layers', 20)}<span>${esc(b.name)}</span></label>`;
  }
  h += '</div><h3>Kartlager</h3>';
  for (const id of OVERLAY_ORDER) {
    const o = external[id] || OVERLAYS[id];
    if (!o) continue;
    const on = state.overlays.includes(id);
    const raster = !!OVERLAYS[id];
    const op = Math.round((state.opacity[id] ?? OVERLAYS[id]?.opacity ?? 1) * 100);
    h += `<div class="lrow"><label><span>${esc(o.name)}</span><input type="checkbox" class="switch" value="${id}" ${on ? 'checked' : ''}></label>
      ${raster && on ? `<input type="range" min="20" max="100" value="${op}" data-op="${id}" aria-label="Genomskinlighet ${esc(o.name)}">` : ''}</div>`;
  }
  if (custom) {
    h += '<h3>Eget kartmaterial</h3>';
    for (const c of custom.list()) {
      h += `<div class="lrow"><label><span>${esc(c.name)}</span><input type="checkbox" class="switch" data-custom="${c.id}" ${c.on ? 'checked' : ''}></label>
        <button class="btn small icon" data-manage="${c.id}" aria-label="Hantera ${esc(c.name)}">${ic('dots', 18)}</button></div>`;
    }
    h += `<div class="btnrow"><button class="btn small" id="lpAdd">${ic('plus')}Lägg till kartmaterial</button></div>`;
  }
  el.innerHTML = h;
  el.querySelectorAll('[data-custom]').forEach((c) => c.onchange = (e) => { e.stopPropagation(); custom.toggle(c.dataset.custom, c.checked); });
  el.querySelectorAll('[data-manage]').forEach((b) => b.onclick = () => custom.manage(b.dataset.manage));
  el.querySelector('#lpAdd')?.addEventListener('click', () => custom.add());
  el.querySelectorAll('input[type=radio]').forEach((r) => r.onchange = () => { setBase(r.value); renderLayerPanel(); });
  el.querySelectorAll('input[type=checkbox]:not([data-custom])').forEach((c) => c.onchange = () => {
    const id = c.value;
    if (external[id]) { external[id].onToggle(c.checked); setOverlayState(id, c.checked); return; }
    const ok = enableOverlay(id, c.checked);
    if (ok === false) { c.checked = false; return; }
    setOverlayState(id, c.checked);
    renderLayerPanel(); // visa/dölj genomskinlighetsreglaget
  });
  el.querySelectorAll('input[data-op]').forEach((r) => r.oninput = () => {
    const id = r.dataset.op; state.opacity[id] = r.value / 100; save();
    overlayLayers[id]?.setOpacity?.(r.value / 100);
  });
}
