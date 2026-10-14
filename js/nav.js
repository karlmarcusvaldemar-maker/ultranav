// GPS, rörlig karta, aktiv sträcka, direkt-till, glidräckvidd, spårlogg och varningar
import { map } from './map.js';
import { ic } from './icons.js';
import { settings, spdOut, spdUnit } from './settings.js';
import { route, onRouteChange, getLegs } from './route.js';
import { airspacesAt, limitFt, asLabel, fmtLimit } from './openaip.js';
import { elevationFt } from './terrain.js';
import { setProfileOwn } from './profile.js';
import { distNM, bearing, destPoint, crossTrack, norm360, fmtDeg, fmtHM, fmtUTC, toast, idb, download, esc, $, FT_PER_M, interp } from './util.js';

export const nav = {
  pos: null, tracking: false, follow: true, trackUp: false, activeLeg: 0, dto: null, simulating: false,
  log: [], logging: true, aglFt: null, terrFt: null,
};
let watchId = null, last = null, wakeLock = null, simTimer = null;
const ownLayer = L.layerGroup();
let ownMarker, vecLine, glideCircle, dtoLine;
const listeners = new Set();
export const onNav = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f(nav));

const PLANE = `<svg viewBox="0 0 56 56"><path d="M28 4 L31 22 L50 30 L50 34 L31 30 L30 44 L36 48 L36 51 L28 49 L20 51 L20 48 L26 44 L25 30 L6 34 L6 30 L25 22 Z" fill="#d8b86e" stroke="#14200f" stroke-width="1.6"/></svg>`;

export async function initNav() {
  ownLayer.addTo(map);
  nav.log = (await idb.get('tracklog')) || [];
  onRouteChange(() => { if (nav.pos) { pickLeg(); update(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && nav.tracking) requestWake(); });
  map.on('dragstart', () => { if (nav.follow && nav.tracking) { nav.follow = false; emit(); } });
}

// ---------- GPS ----------
export function startGps() {
  if (!('geolocation' in navigator)) { toast('Ingen GPS i den här webbläsaren'); return; }
  stopSim();
  nav.tracking = true; nav.follow = true;
  watchId = navigator.geolocation.watchPosition(onFix, (e) => {
    toast(e.code === 1 ? 'GPS nekad — tillåt plats för Safari i Inställningar › Integritet' : 'GPS-fel: ' + e.message, 5000);
    if (e.code === 1) stopGps();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  requestWake(); emit();
}
export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; nav.tracking = false; releaseWake(); emit();
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
    trk: c.heading != null && !isNaN(c.heading) ? c.heading : null };
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
  logFix(fix);
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
    if (from && p > 0) nav.dto = { ...route.wps[p], from, routeIdx: p };
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
const warned = new Map();
async function terrainCheck(fix) {
  if (fix.t - lastTerr < 4000) return;
  lastTerr = fix.t;
  const t = await elevationFt(fix.lat, fix.lon, 1);
  nav.terrFt = t;
  nav.aglFt = t != null && fix.altFt != null ? fix.altFt - t : null;
}
function airspaceCheck(fix) {
  if (fix.t - lastAs < 8000 || !settings.openaipKey) return;
  lastAs = fix.t;
  const alt = fix.altFt;
  const check = (p, ahead) => {
    for (const a of airspacesAt(p.lat, p.lon)) {
      if (![1, 2, 3, 4, 7, 13, 26, 36].includes(a.type)) continue;
      const lo = limitFt(a.lowerLimit), up = limitFt(a.upperLimit);
      const terr = nav.terrFt || 0;
      const loF = lo.ft + (lo.agl ? terr : 0), upF = up.ft + (up.agl ? terr : 0);
      if (alt != null && (alt < loF - 200 || alt > upF + 200)) continue;
      const k = a._id + (ahead ? 'a' : 'i');
      if (Date.now() - (warned.get(k) || 0) < 5 * 6e4) continue;
      warned.set(k, Date.now());
      toast(`${ahead ? 'Varning – om ca 2 min: ' : 'Varning – inne i '}${a.name} — ${asLabel(a)} ${fmtLimit(a.lowerLimit)}–${fmtLimit(a.upperLimit)}`, 7000);
      return;
    }
  };
  check(fix, false);
  if (fix.trk != null && fix.gsKt > 20) check(destPoint(fix, fix.trk, fix.gsKt * 2 / 60), true);
}

// ---------- ritning och instrument ----------
function update() {
  sequence();
  const p = nav.pos;
  if (!p) { emit(); return; }
  const ll = [p.lat, p.lon];
  if (!ownMarker) {
    ownMarker = L.marker(ll, { pane: 'own', interactive: false, icon: L.divIcon({ className: 'own-ship', iconSize: [56, 56], iconAnchor: [28, 28], html: PLANE }) }).addTo(ownLayer);
    vecLine = L.polyline([], { pane: 'ownPath', color: '#d8b86e', weight: 3, dashArray: '2 6', interactive: false }).addTo(ownLayer);
    dtoLine = L.polyline([], { pane: 'route', color: '#ff2fd0', weight: 4, dashArray: '10 8', interactive: false }).addTo(ownLayer);
    glideCircle = L.circle(ll, { pane: 'ownPath', radius: 1, color: '#2ecc71', weight: 2, fill: true, fillOpacity: 0.05, dashArray: '6 6', interactive: false }).addTo(ownLayer);
  }
  ownMarker.setLatLng(ll);
  const svg = ownMarker.getElement()?.querySelector('svg');
  const mb = map.getBearing ? map.getBearing() : 0;
  if (svg) svg.style.transform = `rotate(${(p.trk ?? 0) + mb}deg)`;
  // fartvektor 5 min
  if (p.trk != null && p.gsKt > 10) vecLine.setLatLngs([ll, Object.values(destPoint(p, p.trk, p.gsKt * 5 / 60))]);
  else vecLine.setLatLngs([]);
  // glidräckvidd
  if (nav.aglFt != null && nav.aglFt > 100) {
    glideCircle.setLatLng(ll).setRadius(nav.aglFt * settings.glideRatio / FT_PER_M);
    glideCircle.setStyle({ opacity: 0.9 });
  } else glideCircle.setStyle({ opacity: 0, fillOpacity: 0 });
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

export function setFollow(v) { nav.follow = v; if (v && nav.pos) update(); emit(); }
export function setTrackUp(v) {
  nav.trackUp = v;
  if (!v && map.setBearing) map.setBearing(0);
  update(); emit();
}

// ---------- spårlogg ----------
let lastSave = 0;
function logFix(f) {
  if (!nav.logging || nav.simulating) return;
  const prev = nav.log[nav.log.length - 1];
  if (prev && f.t - prev.t < 5000 && distNM(prev, f) < 0.03) return;
  nav.log.push({ lat: +f.lat.toFixed(6), lon: +f.lon.toFixed(6), alt: f.altFt != null ? Math.round(f.altFt) : null, t: f.t, gs: f.gsKt != null ? Math.round(f.gsKt) : null });
  if (Date.now() - lastSave > 30000) { lastSave = Date.now(); idb.set('tracklog', nav.log); }
}
export function clearLog() { nav.log = []; idb.set('tracklog', []); emit(); }
export function exportLog() {
  if (!nav.log.length) { toast('Loggen är tom'); return; }
  const pts = nav.log.map((p) => `      <trkpt lat="${p.lat}" lon="${p.lon}">${p.alt != null ? `<ele>${(p.alt / FT_PER_M).toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
  const d = new Date(nav.log[0].t).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  download(`spar-${d}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Ultranav" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>Flygning ${d}</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>\n`);
}
export function logStats() {
  const l = nav.log;
  if (l.length < 2) return null;
  let d = 0, maxAlt = -Infinity, maxGs = 0;
  for (let i = 1; i < l.length; i++) { d += distNM(l[i - 1], l[i]); if (l[i].alt != null) maxAlt = Math.max(maxAlt, l[i].alt); if (l[i].gs) maxGs = Math.max(maxGs, l[i].gs); }
  return { n: l.length, d, h: (l[l.length - 1].t - l[0].t) / 3600e3, maxAlt: isFinite(maxAlt) ? maxAlt : null, maxGs, start: new Date(l[0].t) };
}
export function renderLogTab(el) {
  const s = logStats();
  el.innerHTML = `<h3>Spårlogg</h3>
    <div class="field"><span>Logga spår när GPS är på</span><input type="checkbox" id="lgOn" ${nav.logging ? 'checked' : ''}></div>
    ${s ? `<div class="kv" style="margin-top:8px"><span>Start</span><b>${s.start.toLocaleString('sv-SE')}</b><span>Punkter</span><b>${s.n}</b>
      <span>Sträcka</span><b>${s.d.toFixed(1)} NM</b><span>Tid</span><b>${fmtHM(s.h)}</b>
      <span>Max höjd</span><b>${s.maxAlt != null ? s.maxAlt + ' ft' : '—'}</b><span>Max GS</span><b>${Math.round(spdOut(s.maxGs))} ${spdUnit()}</b></div>` : '<div class="muted">Ingen logg ännu.</div>'}
    <div class="btnrow"><button class="btn" id="lgExp">${ic('download')}Exportera GPX</button><button class="btn danger" id="lgClr">${ic('trash')}Rensa logg</button></div>
    <h3>Simulering (träning på marken)</h3>
    <div class="muted">Flyger rutten med din TAS och prognosvind ×10 i tid, så att du kan öva på instrumentlisten, sekvensering och varningar.</div>
    <div class="btnrow"><button class="btn ${nav.simulating ? 'primary' : ''}" id="simBtn">${nav.simulating ? ic('stop') + 'Stoppa simulering' : ic('play') + 'Simulera rutten'}</button></div>`;
  $('#lgOn', el).onchange = (e) => { nav.logging = e.target.checked; };
  $('#lgExp', el).onclick = exportLog;
  $('#lgClr', el).onclick = () => { if (confirm('Rensa spårloggen?')) clearLog(); };
  $('#simBtn', el).onclick = () => { nav.simulating ? stopSim() : startSim(); renderLogTab(el); };
}

// ---------- simulering ----------
export function startSim() {
  const w = route.wps;
  if (w.length < 2) { toast('Skapa en rutt med minst två punkter först'); return; }
  stopGps();
  nav.simulating = true; nav.tracking = true; nav.follow = true; nav.dto = null; nav.activeLeg = 0; nav.pos = null; last = null;
  let leg = 0, f = 0, t = Date.now();
  const legsArr = getLegs();
  simTimer = setInterval(() => {
    const L0 = legsArr[leg] || {};
    const gs = isFinite(L0.gs) ? L0.gs : settings.tas;
    const d = distNM(w[leg], w[leg + 1]);
    f += (gs * 10 / 3600) / Math.max(d, 0.01); // 10× hastighet, 1 s steg
    if (f >= 1) { f = 0; leg++; if (leg >= w.length - 1) { stopSim(); toast('Simulering klar'); return; } }
    const pt = interp(w[leg], w[leg + 1], f);
    t += 10000;
    ingest({ lat: pt.lat, lon: pt.lon, t, altFt: w[leg + 1].alt, gsKt: gs, trk: bearing(w[leg], w[leg + 1]), acc: 5 });
  }, 1000);
  emit();
}
export function stopSim() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  if (nav.simulating) { nav.simulating = false; nav.tracking = false; }
  emit();
}
