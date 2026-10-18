// Inställningar (sparas i localStorage)
import { store } from './util.js';
import { OPENAIP_KEY, DEFAULT_PROXY } from './config.js';

export const DEFAULT_TILES = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  otm: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  esriRoads: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
  esriPlaces: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  kartverket: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
  protected: 'https://geodata.naturvardsverket.se/naturvardsregistret/wms',
  wind: 'https://ext-geodata-applikationer.lansstyrelsen.se/arcgis/services/VBK/lst_vbk_wms_vindbrukskollen/MapServer/WMSServer',
  clouds: 'https://view.eumetsat.int/geoserver/wms',
};

const DEFAULTS = {
  speedUnit: 'kt',        // 'kt' | 'kmh'
  distUnit: 'nm',         // 'nm' | 'km'
  altUnit: 'ft',          // 'ft' | 'm'
  vectorMin: 10,          // fartvektorns längd i minuter framåt
  tas: 80,                // kt (lagras alltid i knop)
  fuelBurn: 14,           // l/h
  fuelUsable: 65,         // l
  reserveMin: 30,         // minuter
  taxiFuel: 1.5,          // l
  glideRatio: 10,         // glidtal 1:x
  minClearance: 500,      // ft över terräng
  variation: 6,           // magnetisk variation, + = ost (E)
  cruiseAlt: 1500,        // ft MSL standard
  theme: 'dark',          // 'dark' | 'day' | 'night'
  openaipKey: '',
  vectorHillshade: true,  // terrängskuggning i vektorkartor
  openaipAuth: 'query',
  openaipLimit: 50,       // sidstorlek som servern godtar (testas)
  openaipQuery: 'country',    // områdesfilter: 'pos' (dist i meter), 'poskm' eller 'bbox' — väljs av testknappen   // 'query' (apiKey i adressen, ingen CORS-förfrågan) eller 'header'
  corsProxy: '',
  oaCountries: 'SE,NO,DK,FI',
  oaIncludeHeli: false,
  wxAutoStations: true,
  ownSymbol: 'experimental', // symbol för egen position (se aircraft.js)
  shareTraffic: false,    // dela min position med andra Ultranav-piloter (av som standard, per enhet)
  shareCallsign: '',
  arrivalRadius: 0.5,     // NM för automatisk växling till nästa punkt
  tiles: { ...DEFAULT_TILES },
};

const saved = store.get('ulnav.settings', {});
export const settings = { ...DEFAULTS, ...saved, tiles: { ...DEFAULT_TILES, ...(saved.tiles || {}) } };
// Lantmäteriet-åtkomsten är borttagen: rensa gamla sparade värden
if (['lmUser', 'lmPass', 'lmKey'].some((k) => k in settings) || 'lm' in settings.tiles || 'lmBasic' in settings.tiles) {
  for (const k of ['lmUser', 'lmPass', 'lmKey']) delete settings[k];
  delete settings.tiles.lm; delete settings.tiles.lmBasic;
  store.set('ulnav.settings', settings); // radera även från lagringen på enheten
}

const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); }
export function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  store.set('ulnav.settings', settings);
  listeners.forEach((fn) => fn(settings, patch));
}

// Effektiva värden: egna inställningar, annars appens inbyggda nyckel och proxy
export const oaipKey = () => settings.openaipKey?.trim() || OPENAIP_KEY;
export const proxyUrl = () => settings.corsProxy?.trim() || DEFAULT_PROXY;

// Hastighetsenheter — internt alltid knop
export const spdOut = (kt) => (settings.speedUnit === 'kmh' ? kt * 1.852 : kt);
export const spdIn = (v) => (settings.speedUnit === 'kmh' ? v / 1.852 : v);
export const spdUnit = () => (settings.speedUnit === 'kmh' ? 'km/h' : 'kt');

/** Valbara längder på fartvektorn (minuter). Punkter sätts ut vid varje kortare tid längs linjen. */
export const VECTOR_MINS = [2, 5, 10, 15, 20, 30, 45];

// Avstånd och höjd — internt alltid NM och ft
export const distOut = (nm) => (settings.distUnit === 'km' ? nm * 1.852 : nm);
export const distIn = (v) => (settings.distUnit === 'km' ? v / 1.852 : v);
export const distUnit = () => (settings.distUnit === 'km' ? 'km' : 'NM');
export const fmtDist = (nm, dec = 1) => `${distOut(nm).toFixed(dec)} ${distUnit()}`;
export const altOut = (ft) => (settings.altUnit === 'm' ? ft / 3.28084 : ft);
export const altIn = (v) => (settings.altUnit === 'm' ? v * 3.28084 : v);
export const altUnit = () => (settings.altUnit === 'm' ? 'm' : 'ft');
/** Höjd med enhet. coarse: avrunda till 100 ft / 50 m (uppskattningar som molnbas) */
export const fmtAlt = (ft, coarse = false) => { const st = coarse ? (settings.altUnit === 'm' ? 50 : 100) : 1; return `${Math.round(altOut(ft) / st) * st} ${altUnit()}`; };
