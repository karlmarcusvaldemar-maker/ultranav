// Inställningar (sparas i localStorage)
import { store } from './util.js';

export const DEFAULT_TILES = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  otm: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  lm: 'https://maps.lantmateriet.se/open/topowebb-ccby/v1/wmts/1.0.0/topowebb/default/3857/{z}/{y}/{x}.png',
  ofmAero: 'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest',
  ofmBase: 'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/base/latest',
  openaip: 'https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey={key}',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
};

const DEFAULTS = {
  speedUnit: 'kt',        // 'kt' | 'kmh'
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
  lmUser: '', lmPass: '',
  corsProxy: '',
  oaCountries: 'SE,NO,DK,FI',
  oaIncludeHeli: false,
  wxAutoStations: true,
  arrivalRadius: 0.5,     // NM för automatisk växling till nästa punkt
  tiles: { ...DEFAULT_TILES },
};

const saved = store.get('ulnav.settings', {});
export const settings = { ...DEFAULTS, ...saved, tiles: { ...DEFAULT_TILES, ...(saved.tiles || {}) } };

const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); }
export function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  store.set('ulnav.settings', settings);
  listeners.forEach((fn) => fn(settings, patch));
}

// Hastighetsenheter — internt alltid knop
export const spdOut = (kt) => (settings.speedUnit === 'kmh' ? kt * 1.852 : kt);
export const spdIn = (v) => (settings.speedUnit === 'kmh' ? v / 1.852 : v);
export const spdUnit = () => (settings.speedUnit === 'kmh' ? 'km/h' : 'kt');
