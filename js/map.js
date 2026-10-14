// Karta, baskartor, överlägg och lagerpanel
import { settings, saveSettings, onSettings } from './settings.js';
import { store, esc, $, fetchX, toast } from './util.js';
import { vectorLayer } from './vector.js';

export let map;
const state = store.get('ulnav.layers', { base: 'otm', overlays: ['openaipVec', 'oa', 'route'], opacity: {} });
const save = () => store.set('ulnav.layers', state);

// Tile-lager som hämtar med Basic-inloggning (Geotorget). Kräver att servern tillåter CORS.
export const basicAuth = () => 'Basic ' + btoa(unescape(encodeURIComponent(`${settings.lmUser}:${settings.lmPass}`)));
let lmErrShown = false;
const AuthTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement('img');
    img.alt = ''; img.setAttribute('role', 'presentation');
    fetch(this.getTileUrl(coords), { headers: { Authorization: basicAuth() } })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then((b) => { img.onload = () => { URL.revokeObjectURL(img.src); done(null, img); }; img.src = URL.createObjectURL(b); })
      .catch((e) => {
        if (!lmErrShown && navigator.onLine) { lmErrShown = true; toast('Lantmäteriet: ' + e.message + ' — använd "Testa anslutning" under Inställningar', 7000); }
        done(e, img);
      });
    return img;
  },
});

const tileOpts = (extra) => ({ maxZoom: 19, crossOrigin: true, className: 'basemap', ...extra });

export const BASES = {
  otm: { name: 'OpenTopoMap', note: 'Topografi, höjdkurvor', make: () => L.tileLayer(settings.tiles.otm, tileOpts({ maxNativeZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' })) },
  vecLiberty: { name: 'Vektorkarta (MapLibre)', note: 'OpenFreeMap/OSM, skarp i alla zoomnivåer, terrängskuggning', make: () => vectorLayer('liberty', '© OpenFreeMap © OpenMapTiles © OpenStreetMap') },
  vecPositron: { name: 'Vektorkarta ljus (MapLibre)', note: 'Nedtonad – flygdata syns tydligt', make: () => vectorLayer('positron', '© OpenFreeMap © OpenMapTiles © OpenStreetMap') },
  osm: { name: 'OpenStreetMap', note: 'Gatukarta', make: () => L.tileLayer(settings.tiles.osm, tileOpts({ maxNativeZoom: 19, attribution: '© OpenStreetMap-bidragsgivare' })) },
  lm: { name: 'Lantmäteriet Topowebb', note: 'Sverige, officiell topo (kräver Geotorget-inloggning)', needsLmKey: true,
    // crossOrigin av: tjänsten behöver inte skicka CORS-huvuden för att bilderna ska visas
    make: () => settings.lmUser
      ? new AuthTileLayer(settings.tiles.lmBasic, tileOpts({ maxNativeZoom: 14, crossOrigin: false, attribution: '© Lantmäteriet' }))
      : L.tileLayer(settings.tiles.lm.replace('{key}', encodeURIComponent(settings.lmKey)), tileOpts({ maxNativeZoom: 14, crossOrigin: false, attribution: '© Lantmäteriet' })) },
  esri: { name: 'Satellit (Esri)', note: 'Flyg-/satellitbild', make: () => L.tileLayer(settings.tiles.esri, tileOpts({ maxNativeZoom: 18, attribution: 'Bild © Esri, Maxar, Earthstar Geographics' })) },
  ofmBase: { name: 'OpenFlightMaps bas', note: 'Där OFM har täckning', make: () => L.tileLayer(settings.tiles.ofmBase, tileOpts({ maxNativeZoom: 12, attribution: '© open flightmaps' })) },
};

export const OVERLAYS = {
  ofmAero: { name: 'OpenFlightMaps VFR', note: 'Flygkarta (där täckning finns)', opacity: 1, make: () => L.tileLayer(settings.tiles.ofmAero, { maxNativeZoom: 12, maxZoom: 19, crossOrigin: true, attribution: '© open flightmaps' }) },
  openaipTiles: { name: 'OpenAIP-karta (raster)', note: 'Kräver API-nyckel', needsKey: true, opacity: 1, make: () => L.tileLayer(settings.tiles.openaip.replace('{key}', encodeURIComponent(settings.openaipKey)), { maxNativeZoom: 14, maxZoom: 19, crossOrigin: true, attribution: '© OpenAIP (CC BY-NC 4.0)' }) },
  radar: { name: 'Nederbördsradar', note: 'RainViewer, senaste bild', opacity: 0.6, make: makeRadar },
};

let baseLayer;
const overlayLayers = {};  // id → aktivt lager
const external = {};       // vektorlager som andra moduler registrerar

export function initMap() {
  const start = store.get('ulnav.view', { lat: 59.33, lon: 18.07, z: 8 });
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
    if (patch.tiles || 'lmKey' in patch || 'lmUser' in patch || 'lmPass' in patch || 'vectorHillshade' in patch) { lmErrShown = false; setBase(state.base); }
    if ('openaipKey' in patch || patch.tiles) for (const id of Object.keys(OVERLAYS)) if (overlayLayers[id]) { enableOverlay(id, false); enableOverlay(id, true); }
  });
  return map;
}

export function setBase(id) {
  if (!BASES[id]) id = 'otm';
  if (BASES[id].needsLmKey && !settings.lmKey && !settings.lmUser) toast('Ange inloggning för Lantmäteriet under Inställningar', 5000);
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = BASES[id].make().addTo(map);
  baseLayer.on('tileerror', tileErr(BASES[id].name));
  state.base = id; save();
}
export const currentBase = () => state.base;

function tileErr(name) {
  let shown = false;
  return () => { if (!shown && navigator.onLine) { shown = true; toast(`Kunde inte hämta kartbilder från ${name}`); } };
}

function enableOverlay(id, on) {
  const def = OVERLAYS[id];
  if (on) {
    if (overlayLayers[id]) return;
    if (def.needsKey && !settings.openaipKey) { toast('Ange OpenAIP API-nyckel under Inställningar'); return false; }
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
  fetchX('https://api.rainviewer.com/public/weather-maps.json', { proxy: settings.corsProxy })
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

// ---------- Lagerpanel ----------
export function renderLayerPanel() {
  const el = $('#layerPanel');
  const row = (type, id, name, note, checked, extra = '') =>
    `<div class="lrow"><label><input type="${type}" name="${type === 'radio' ? 'base' : id}" value="${id}" ${checked ? 'checked' : ''}>
     <span>${esc(name)}<span class="note">${esc(note || '')}</span></span></label>${extra}</div>`;
  let h = '<h3>Baskarta</h3>';
  for (const [id, b] of Object.entries(BASES)) h += row('radio', id, b.name, b.note, state.base === id);
  h += '<h3>Flygdata & väder</h3>';
  for (const [id, o] of Object.entries(external)) h += row('checkbox', id, o.name, o.note, state.overlays.includes(id));
  for (const [id, o] of Object.entries(OVERLAYS)) {
    const op = Math.round((state.opacity[id] ?? o.opacity ?? 1) * 100);
    h += row('checkbox', id, o.name, o.note, state.overlays.includes(id), `<input type="range" min="20" max="100" value="${op}" data-op="${id}">`);
  }
  el.innerHTML = h;
  el.querySelectorAll('input[type=radio]').forEach((r) => r.onchange = () => setBase(r.value));
  el.querySelectorAll('input[type=checkbox]').forEach((c) => c.onchange = () => {
    const id = c.value;
    if (external[id]) { external[id].onToggle(c.checked); setOverlayState(id, c.checked); return; }
    const ok = enableOverlay(id, c.checked);
    if (ok === false) { c.checked = false; return; }
    setOverlayState(id, c.checked);
  });
  el.querySelectorAll('input[data-op]').forEach((r) => r.oninput = () => {
    const id = r.dataset.op; state.opacity[id] = r.value / 100; save();
    overlayLayers[id]?.setOpacity?.(r.value / 100);
  });
}
