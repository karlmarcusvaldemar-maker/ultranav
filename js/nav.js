// GPS, rörlig karta, aktiv sträcka, direkt-till, glidräckvidd och varningar (loggning av flygningar: flight.js)
import { map } from './map.js';
import { ic } from './icons.js';
import { symbolSvg, symbolTransform } from './aircraft.js';
import { settings, onSettings, spdOut, spdUnit, oaipKey, proxyUrl, fmtDist, fmtAlt, VECTOR_MINS } from './settings.js';
import { route, onRouteChange, getLegs } from './route.js';
import { airspacesAt, limitFt, asLabel, fmtLimit } from './openaip.js';
import { elevationFt } from './terrain.js';
import { setProfileOwn } from './profile.js';
import { distNM, bearing, destPoint, crossTrack, norm360, fmtDeg, fmtHM, fmtUTC, toast, idb, download, esc, $, FT_PER_M, interp, pad } from './util.js';
import { raise, clear, clearExcept, unlockAudio } from './alerts.js';

export const nav = {
  pos: null, tracking: false, follow: true, trackUp: false, activeLeg: 0, dto: null,
  aglFt: null, terrFt: null, stale: false,
  glide: null, // { lat, lon, rNM } — glidcirkeln med vind, när den visas
};
let watchId = null, last = null, wakeLock = null;
const ownLayer = L.layerGroup();
let ownMarker, vecLine, glideCircle, dtoLine;
const vecTicks = []; // punkter på fartvektorn, en per valbar tid (VECTOR_MINS)
const listeners = new Set();
export const onNav = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f(nav));
// Vindkälla för glidcirkeln (vindrutans prognos) — sätts av windbadge.js för att undvika ett cirkelberoende
let glideWind = null;
export const setGlideWind = (fn) => { glideWind = fn; };

// Egen position: vald luftfarkost (Inställningar › Visning), standard lågvingat experimental
const planeHtml = () => symbolSvg(settings.ownSymbol, { size: 40 });

export async function initNav() {
  ownLayer.addTo(map);
  // Välj närmaste sträcka bara när geometrin ändras — namnbyte, sparning eller ny vindprognos ska inte flytta
  // en sträcka som piloten har valt eller flugit fram till
  let geo = '';
  onRouteChange(() => {
    const g = route.wps.map((w) => `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`).join(';');
    if (g !== geo) { const first = !geo; geo = g; if (!first && nav.dto?.routeIdx != null) nav.dto = null; if (nav.pos) pickLeg(); }
    else nav.activeLeg = Math.max(0, Math.min(nav.activeLeg, route.wps.length - 2));
    if (nav.pos) update();
  });
  onSettings((s, patch) => { if ('ownSymbol' in patch && ownMarker) { ownMarker.setIcon(L.divIcon({ className: 'own-ship', iconSize: [40, 40], iconAnchor: [20, 20], html: planeHtml() })); update(); } if ('vectorMin' in patch && nav.pos) update(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && nav.tracking) requestWake(); });
  // Drar man i kartan släpper Följ. I luften slås den på igen efter 20 s utan att kartan rörts.
  map.on('dragstart', () => { lastTouch = Date.now(); if (nav.follow && nav.tracking) { nav.follow = false; followOff = Date.now(); emit(); } });
  map.on('drag zoomstart', () => { lastTouch = Date.now(); });
  setInterval(gpsWatchdog, 1000);
}

// GPS-vakt: kommer inga nya positioner fryser annars instrumenten på gamla värden som ser giltiga ut
let followOff = null, lastTouch = 0;
function gpsWatchdog() {
  if (!nav.follow && followOff && nav.tracking && !nav.stale && (nav.pos?.gsKt || 0) > 30 && Date.now() - lastTouch > 20000) {
    followOff = null; setFollow(true); toast('Följer igen');
  }
  const age = nav.tracking && nav.pos ? Date.now() - nav.pos.rx : 0;
  const stale = age > 6000;
  if (stale !== nav.stale) { nav.stale = stale; ownMarker?.setOpacity(stale ? 0.4 : 1); emit(); }
  if (stale) raise('gps-lost', `GPS-signal saknas sedan ${Math.floor(age / 60000)}:${pad(Math.floor(age / 1000) % 60)} — värdena är inte aktuella`);
  else clear('gps-lost');
  const acc = nav.tracking && nav.pos && !stale ? nav.pos.acc : null;
  if (acc > 100) raise('gps-poor', `Osäker GPS-position (±${acc >= 1000 ? (acc / 1000).toFixed(1) + ' km' : Math.round(acc) + ' m'})`, { level: 'warn', sound: false });
  else clear('gps-poor');
}

// ---------- GPS ----------
export function startGps() {
  if (!('geolocation' in navigator)) { toast('Ingen GPS i den här webbläsaren'); return; }
  nav.tracking = true; nav.follow = true;
  unlockAudio(); // ljud för varningar kräver en användargest på iOS
  watchId = navigator.geolocation.watchPosition(onFix, (e) => {
    toast(e.code === 1 ? 'GPS nekad — tillåt platsåtkomst för ultranav.se i webbläsaren och för webbläsaren i enhetens inställningar' : 'GPS-fel: ' + e.message, 5000);
    if (e.code === 1) stopGps();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  requestWake(); emit();
}
export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; nav.tracking = false; nav.stale = false; releaseWake();
  clear('gps-lost'); clear('gps-poor'); clearExcept('as-', new Set());
  emit();
}

async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
  catch { /* ignoreras */ }
}
function releaseWake() { wakeLock?.release?.(); wakeLock = null; }

function onFix(p) {
  const c = p.coords;
  const fix = { lat: c.latitude, lon: c.longitude, t: p.timestamp, acc: c.accuracy,
    altFt: c.altitude != null ? c.altitude * FT_PER_M : null,
    gsKt: c.speed != null && c.speed >= 0 ? c.speed * 1.943844 : null,
    trk: c.heading != null && !isNaN(c.heading) ? c.heading : null, rx: Date.now() };
  ingest(fix);
}

function ingest(fix) {
  if (last && fix.t - last.t >= 1000) {
    const d = distNM(last, fix), h = (fix.t - last.t) / 3600e3;
    if (fix.gsKt == null) fix.gsKt = d / h;
    if (fix.trk == null && d > 0.005) fix.trk = bearing(last, fix);
  }
  if (fix.trk == null && nav.pos?.trk != null) fix.trk = nav.pos.trk;
  if (!last || fix.t - last.t >= 1000) last = fix;
  const first = !nav.pos;
  nav.pos = fix;
  if (first) pickLeg();
  terrainCheck(fix);
  airspaceCheck(fix);
  update();
}

// ---------- aktiv sträcka ----------
function pickLeg() {
  const w = route.wps;
  if (w.length < 2 || !nav.pos) { nav.activeLeg = 0; return; }
  let best = 0, bd = Infinity;
  for (let i = 0; i < w.length - 1; i++) {
    const { xtk, along } = crossTrack(w[i], w[i + 1], nav.pos);
    const len = distNM(w[i], w[i + 1]);
    const d = along < 0 ? distNM(w[i], nav.pos) : along > len ? distNM(w[i + 1], nav.pos) : Math.abs(xtk);
    if (d < bd) { bd = d; best = i; }
  }
  nav.activeLeg = best;
}
export function setActiveLeg(i) { nav.dto = null; nav.activeLeg = Math.max(0, Math.min(i, route.wps.length - 2)); update(); }
export function directTo(p) {
  const from = nav.pos ? { lat: nav.pos.lat, lon: nav.pos.lon } : null;
  if (typeof p === 'number') { // index i rutten
    nav.dto = null; nav.activeLeg = Math.max(0, p - 1);
    if (from && route.wps[p]) nav.dto = { ...route.wps[p], from, routeIdx: p }; // även första brytpunkten
  } else nav.dto = { lat: p.lat, lon: p.lon, name: p.name || 'Punkt', from: from || { lat: p.lat, lon: p.lon } };
  map.closePopup();
  toast('Direkt till ' + (nav.dto?.name || route.wps[p]?.name));
  update();
}
export function cancelDto() { nav.dto = null; update(); }

function target() {
  if (nav.dto) return { to: nav.dto, from: nav.dto.from };
  const w = route.wps;
  if (w.length < 2) return null;
  const i = Math.min(nav.activeLeg, w.length - 2);
  return { to: w[i + 1], from: w[i], idx: i };
}

function sequence() {
  const tg = target();
  if (!tg || !nav.pos) return;
  const d = distNM(nav.pos, tg.to);
  const { along } = crossTrack(tg.from, tg.to, nav.pos);
  const passed = along > distNM(tg.from, tg.to) + 0.1;
  if (d < settings.arrivalRadius || (passed && d < 3)) {
    if (nav.dto) {
      const ri = nav.dto.routeIdx;
      nav.dto = null;
      if (ri != null && ri < route.wps.length - 1) { nav.activeLeg = ri; toast('Nästa: ' + route.wps[ri + 1].name); }
      else toast('Framme vid ' + tg.to.name);
    } else if (tg.idx < route.wps.length - 2) {
      nav.activeLeg = tg.idx + 1;
      toast('Nästa: ' + route.wps[nav.activeLeg + 1].name + ` — ${fmtDeg(norm360(bearing(route.wps[nav.activeLeg], route.wps[nav.activeLeg + 1]) - settings.variation))}°M`, 5000);
    }
  }
}

// ---------- varningar ----------
let lastTerr = 0, lastAs = 0;
async function terrainCheck(fix) {
  if (fix.t - lastTerr < 4000) return;
  lastTerr = fix.t;
  const t = await elevationFt(fix.lat, fix.lon, 1);
  nav.terrFt = t;
  nav.aglFt = t != null && fix.altFt != null ? fix.altFt - t : null;
}
function airspaceCheck(fix) {
  if (fix.t - lastAs < 8000 || !oaipKey()) return;
  lastAs = fix.t;
  const alt = fix.altFt;
  // Kontrollerade luftrum, restriktioner och zoner med krav på radio/transponder (TMZ, RMZ, TRA, TSA, TIZ, TIA)
  const TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 23, 24, 26, 36];
  const hit = (p) => airspacesAt(p.lat, p.lon).filter((a) => {
    if (!TYPES.includes(a.type)) return false;
    const lo = limitFt(a.lowerLimit), up = limitFt(a.upperLimit);
    const terr = nav.terrFt || 0;
    const loF = lo.ft + (lo.agl ? terr : 0), upF = up.ft + (up.agl ? terr : 0);
    return alt == null || (alt >= loF - 200 && alt <= upF + 200);
  });
  const keep = new Set(), inside = new Set();
  for (const a of hit(fix)) {
    inside.add(a._id); keep.add('as-i-' + a._id);
    raise('as-i-' + a._id, `Inne i ${a.name} — ${asLabel(a)} ${fmtLimit(a.lowerLimit)}–${fmtLimit(a.upperLimit)}`);
  }
  // framåt längs kursen: flera punkter upp till 2 min, så att luftrum strax efter en sväng också fångas
  if (fix.trk != null && fix.gsKt > 20) {
    for (const min of [0.5, 1, 1.5, 2]) {
      for (const a of hit(destPoint(fix, fix.trk, fix.gsKt * min / 60))) {
        const id = 'as-a-' + a._id;
        if (inside.has(a._id) || keep.has(id)) continue;
        keep.add(id);
        raise(id, `Om ca ${min < 1 ? '½' : min} min: ${a.name} — ${asLabel(a)} ${fmtLimit(a.lowerLimit)}–${fmtLimit(a.upperLimit)}`, { level: 'warn' });
      }
    }
  }
  clearExcept('as-', keep);
}

// ---------- ritning och instrument ----------
function update() {
  sequence();
  const p = nav.pos;
  if (!p) { emit(); return; }
  const ll = [p.lat, p.lon];
  if (!ownMarker) {
    ownMarker = L.marker(ll, { pane: 'own', interactive: false, icon: L.divIcon({ className: 'own-ship', iconSize: [40, 40], iconAnchor: [20, 20], html: planeHtml() }) }).addTo(ownLayer);
    vecLine = L.polyline([], { pane: 'ownPath', color: '#f2b632', weight: 3, dashArray: '2 6', interactive: false }).addTo(ownLayer);
    dtoLine = L.polyline([], { pane: 'route', color: '#ff2fd0', weight: 4, dashArray: '10 8', interactive: false }).addTo(ownLayer);
    for (const min of VECTOR_MINS) vecTicks.push(L.marker(ll, { pane: 'own', interactive: false, keyboard: false, opacity: 0,
      icon: L.divIcon({ className: 'vtick', iconSize: [14, 14], iconAnchor: [7, 7], html: `<i></i><b>${min}</b>` }) }).addTo(ownLayer));
    glideCircle = L.circle(ll, { pane: 'ownPath', radius: 1, color: '#2ecc71', weight: 2, fill: true, fillOpacity: 0.05, dashArray: '6 6', interactive: false }).addTo(ownLayer);
  }
  ownMarker.setLatLng(ll);
  const svg = ownMarker.getElement()?.querySelector('svg');
  const mb = map.getBearing ? map.getBearing() : 0;
  if (svg) svg.style.transform = symbolTransform(settings.ownSymbol, (p.trk ?? 0) + mb);
  // fartvektor (vald längd i minuter), med punkter där du är efter varje kortare tid
  const vec = p.trk != null && p.gsKt > 10, len = VECTOR_MINS.includes(settings.vectorMin) ? settings.vectorMin : 10;
  if (vec) vecLine.setLatLngs([ll, Object.values(destPoint(p, p.trk, p.gsKt * len / 60))]);
  else vecLine.setLatLngs([]);
  VECTOR_MINS.forEach((min, i) => {
    const show = vec && min <= len;
    if (show) vecTicks[i].setLatLng(Object.values(destPoint(p, p.trk, p.gsKt * min / 60)));
    vecTicks[i].setOpacity(show ? 1 : 0);
  });
  // glidräckvidd
  // Radien är sträckan i stillastående luft. Under glidtiden (sträckan / bästa glidfart) driver luften
  // med vinden, så cirkelns mitt flyttas medvind: du når längre medvind och kortare i motvind.
  if (nav.aglFt != null && nav.aglFt > 100) {
    const stillM = nav.aglFt * settings.glideRatio / FT_PER_M;
    const w = settings.glideSpeed > 0 ? glideWind?.(p.altFt ?? null, nav.terrFt) : null;
    const c = w && w.spd > 0 ? destPoint(p, w.dir + 180, w.spd * (stillM / 1852) / settings.glideSpeed) : null;
    glideCircle.setLatLng(c ? [c.lat, c.lon] : ll).setRadius(stillM);
    nav.glide = { lat: c ? c.lat : p.lat, lon: c ? c.lon : p.lon, rNM: stillM / 1852 };
    glideCircle.setStyle({ opacity: 0.9, fillOpacity: 0.05 });
  } else { glideCircle.setStyle({ opacity: 0, fillOpacity: 0 }); nav.glide = null; }
  const tg = target();
  dtoLine.setLatLngs(nav.dto ? [[nav.dto.from.lat, nav.dto.from.lon], [nav.dto.lat, nav.dto.lon]] : []);

  if (nav.follow) {
    if (nav.trackUp && map.setBearing && p.trk != null) map.setBearing(-p.trk);
    // Kurs-upp: flygplanet placeras i nedre delen av skärmen så att man ser mer framåt
    const size = map.getSize();
    const want = L.point(size.x / 2, size.y * (nav.trackUp ? 0.68 : 0.5));
    const shift = map.latLngToContainerPoint(ll).subtract(want);
    if (Math.abs(shift.x) > 2 || Math.abs(shift.y) > 2) {
      map.panTo(map.containerPointToLatLng(size.divideBy(2).add(shift)), { animate: true, duration: 0.5, noMoveStart: true });
    }
  }

  // profil
  if (tg && !nav.dto) {
    const legsArr = getLegs();
    const l = legsArr[tg.idx];
    if (l) { const { along } = crossTrack(tg.from, tg.to, p); setProfileOwn({ d: l.cum - l.d + Math.max(0, Math.min(l.d, along)), altFt: p.altFt }); }
  }
  emit();
}

/** Värden till instrumentlisten */
export function instrumentData() {
  const p = nav.pos, tg = target();
  const o = { gs: p?.gsKt, trk: p?.trk, alt: p?.altFt, agl: nav.aglFt, wp: tg?.to?.name, brg: null, dist: null, ete: null, eta: null, xtk: null };
  if (p && tg) {
    o.dist = distNM(p, tg.to);
    o.brg = norm360(bearing(p, tg.to) - settings.variation);
    if (p.gsKt > 5) { o.ete = o.dist / p.gsKt; o.eta = new Date(Date.now() + o.ete * 3600e3); }
    o.xtk = crossTrack(tg.from, tg.to, p).xtk;
  } else if (tg) {
    o.dist = distNM(tg.from, tg.to); o.brg = norm360(bearing(tg.from, tg.to) - settings.variation);
  }
  return o;
}

export function setFollow(v) { followOff = null; nav.follow = v; if (v && nav.pos) update(); emit(); }
export function setTrackUp(v) {
  nav.trackUp = v;
  if (!v && map.setBearing) map.setBearing(0);
  update(); emit();
}

