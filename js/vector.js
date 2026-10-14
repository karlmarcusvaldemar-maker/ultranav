// Vektorkartor med MapLibre GL (via @maplibre/maplibre-gl-leaflet). Laddas först när en vektorkarta väljs.
import { settings } from './settings.js';
import { toast } from './util.js';

export const VECTOR_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
  positron: 'https://tiles.openfreemap.org/styles/positron',
};

let loading;
function addScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('kunde inte ladda ' + src)); document.head.appendChild(s); });
}
/** Ladda MapLibre och Leaflet-bryggan en gång (≈1 MB, sparas sedan offline av service workern) */
export function loadMaplibre() {
  if (!loading) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'vendor/maplibre/maplibre-gl.css';
    document.head.appendChild(css);
    loading = addScript('vendor/maplibre/maplibre-gl.js').then(() => addScript('vendor/maplibre/leaflet-maplibre-gl.js')).then(() => defineLayer());
  }
  return loading;
}

let RotatableGL;
function defineLayer() {
  // Bryggan placerar GL-ytan från kartans övre vänstra hörn. Med leaflet-rotate ligger den i det
  // roterande lagret, så vi centrerar ytan kring kartans mittpunkt och gör den stor nog att täcka
  // skärmens diagonal — annars blir hörnen tomma i kurs-upp-läge.
  RotatableGL = L.MaplibreGL.extend({
    _topLeft() {
      const size = this.getSize();
      return this._map.latLngToLayerPoint(this._map.getCenter()).subtract(size.divideBy(2));
    },
    _initContainer() {
      L.MaplibreGL.prototype._initContainer.call(this);
      L.DomUtil.setPosition(this._container, this._roundPoint(this._topLeft()));
    },
    _update(e) {
      if (!this._map) return;
      this._offset = this._map.containerPointToLayerPoint([0, 0]);
      if (this._zooming) return;
      L.DomUtil.setPosition(this._container, this._roundPoint(this._topLeft()));
      this._transformGL(this._glMap);
    },
  });
}

/** Lägg till terrängskuggning från AWS Terrain Tiles (Terrarium) under första textlagret */
function addHillshade(gl) {
  if (!settings.vectorHillshade || gl.getSource('ulnav-dem')) return;
  gl.addSource('ulnav-dem', { type: 'raster-dem', tiles: [settings.tiles.terrain], encoding: 'terrarium', tileSize: 256, maxzoom: 14,
    attribution: 'Höjddata: AWS Terrain Tiles' });
  const firstSymbol = gl.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  gl.addLayer({ id: 'ulnav-hillshade', type: 'hillshade', source: 'ulnav-dem',
    paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3d3d3d', 'hillshade-highlight-color': '#ffffff' } }, firstSymbol);
}

/** Leaflet-lager som visar en MapLibre-stil. Returneras direkt; GL-kartan läggs in när biblioteket laddats. */
export function vectorLayer(styleKey, attribution) {
  const grp = L.layerGroup();
  grp.getAttribution = () => attribution;
  let gl = null, cancelled = false;
  grp.on('add', () => {
    cancelled = false;
    loadMaplibre().then(() => {
      if (cancelled || !grp._map) return;
      const rotating = !!grp._map.getPane('rotatePane');
      gl = new RotatableGL({
        style: VECTOR_STYLES[styleKey] || styleKey,
        padding: rotating ? 0.36 : 0.1, // 0,36 räcker för att täcka diagonalen i både liggande och stående läge
        className: 'basemap', interactive: false, attribution,
      });
      gl.addTo(grp);
      const m = gl.getMaplibreMap();
      m.on('style.load', () => addHillshade(m));
      m.on('error', (e) => { if (navigator.onLine && e?.error?.status !== 404) console.warn('MapLibre', e?.error?.message || e); });
    }).catch((e) => toast('Vektorkarta: ' + e.message));
  });
  grp.on('remove', () => { cancelled = true; if (gl) { grp.removeLayer(gl); gl = null; } });
  return grp;
}
