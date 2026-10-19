// Loggning av flygningar. Över 10 kt frågar appen om flygningen ska loggas, ritar ett snigelspår under
// flygningen och frågar "Har du landat?" när man står still efter att ha varit i luften (över 30 kt).
// Efter landning visas en sammanfattning som sparas i loggboken (synkas med kontot).
// Med en bil som symbol (Land Rover, Saab) ställs inga automatiska frågor.
import { map } from './map.js';
import { nav, onNav } from './nav.js';
import { settings, fmtDist, fmtAlt, spdOut, spdUnit } from './settings.js';
import { symbolOf } from './aircraft.js';
import { nearestAirports } from './airports.js';
import { sunInfo } from './sun.js';
import * as lib from './library.js';
import { distNM, fmtHM, fmtUTC, toast, modal, note, esc, $, store, idb } from './util.js';
import { ic } from './icons.js';

const ASK_KT = 10, AIR_KT = 30, STILL_KT = 3, STILL_MS = 20000, REARM_MS = 60000, RE_ASK_MS = 120000;
let f = store.get('ulnav.flight', null); // pågående flygning: { start, takeoff, landing, lastAir, air }
let pts = [];                              // spårpunkter [{lat, lon, alt, t, gs}]
let lastT = 0, stillSince = null, declined = false, askedLanded = 0, lastSave = 0;
const trail = L.polyline([], { pane: 'ownPath', color: '#7048e8', weight: 4, opacity: 0.85, interactive: false });
const listeners = new Set();
export const onFlight = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());
const isCar = () => !!symbolOf(settings.ownSymbol).profile;
export const flightActive = () => !!f;
export const flightState = () => f && { ...f, pts: pts.length, dist: trackDist(pts) };

export async function initFlight() {
  trail.addTo(map);
  if (f) { pts = (await idb.get('flightlog')) || []; trail.setLatLngs(pts.map((p) => [p.lat, p.lon])); }
  onNav((n) => { const p = n.pos; if (!p || p.t === lastT || n.simulating) return; lastT = p.t; tick(p); });
}

function persist(force = false) {
  store.set('ulnav.flight', f);
  if (force || Date.now() - lastSave > 30000) { lastSave = Date.now(); idb.set('flightlog', pts); }
}

function tick(p) {
  const gs = p.gsKt ?? 0;
  if (gs < STILL_KT) stillSince ??= p.t; else stillSince = null;
  if (!f) {
    if (isCar() || !nav.tracking) return;
    if (declined && stillSince && p.t - stillSince > REARM_MS) declined = false; // fråga igen efter att ha stått still en stund
    if (gs > ASK_KT && !declined && !$('#flightBar')) askStart();
    return;
  }
  record(p);
  if (gs >= AIR_KT) { f.takeoff ??= p.t; f.air = true; f.lastAir = p.t; f.landing = null; }
  else if (f.air) { f.air = false; f.landing = p.t; } // farten föll under 30 kt: landning
  persist();
  if (f.takeoff && !f.air && stillSince && p.t - stillSince > STILL_MS && Date.now() - askedLanded > RE_ASK_MS && !isCar() && !$('#flightBar')) askLanded();
  emit();
}

function record(p) {
  const prev = pts[pts.length - 1];
  if (prev && p.t - prev.t < 5000 && distNM(prev, p) < 0.03) return;
  pts.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), alt: p.altFt != null ? Math.round(p.altFt) : null, t: p.t, gs: p.gsKt != null ? Math.round(p.gsKt) : null });
  trail.addLatLng([p.lat, p.lon]);
}

// ---------- frågor på kartan ----------
function bar(html, buttons) {
  $('#flightBar')?.remove();
  const el = document.createElement('div');
  el.id = 'flightBar';
  el.innerHTML = `<div class="info">${html}</div>${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''}" data-i="${i}">${b.label}</button>`).join('')}`;
  $('#mapwrap').appendChild(el);
  L.DomEvent.disableClickPropagation(el);
  el.querySelectorAll('[data-i]').forEach((btn) => btn.onclick = () => { el.remove(); buttons[+btn.dataset.i].fn(); });
}
function askStart() {
  bar('<b>Logga flygningen?</b>', [
    { label: 'Nej', fn: () => { declined = true; } },
    { label: `${ic('play')}Starta loggning`, primary: true, fn: startFlight },
  ]);
}
function askLanded() {
  askedLanded = Date.now();
  bar('<b>Har du landat?</b>', [
    { label: 'Nej', fn: () => { askedLanded = Date.now(); } },
    { label: `${ic('check')}Ja, avsluta`, primary: true, fn: finishFlight },
  ]);
}

// ---------- start och avslut ----------
export function startFlight() {
  if (f) return;
  const p = nav.pos;
  f = { start: p?.t ?? Date.now(), takeoff: null, landing: null, lastAir: null, air: false };
  pts = []; trail.setLatLngs([]);
  if (p) record(p);
  persist(true); emit();
  toast('Loggning startad');
}

/** Avsluta: dölj snigelspåret och visa sammanfattningen för loggboken */
export function finishFlight() {
  if (!f) return;
  $('#flightBar')?.remove();
  const done = { ...f, end: nav.pos?.t ?? Date.now(), landing: f.landing ?? (f.air ? (nav.pos?.t ?? Date.now()) : null) };
  const track = pts.slice();
  f = null; pts = []; trail.setLatLngs([]);
  store.set('ulnav.flight', null); idb.set('flightlog', []);
  emit();
  if (track.length < 2) { toast('Flygningen var för kort för att sparas'); return; }
  summary(done, track);
}
/** Avbryt utan att spara */
export function discardFlight() {
  if (!f || !confirm('Avbryta loggningen utan att spara?')) return;
  f = null; pts = []; trail.setLatLngs([]);
  store.set('ulnav.flight', null); idb.set('flightlog', []);
  $('#flightBar')?.remove(); emit();
}

const trackDist = (t) => { let d = 0; for (let i = 1; i < t.length; i++) d += distNM(t[i - 1], t[i]); return d; };
const fieldName = (p) => { const n = nearestAirports(p, 1)[0]; return n && n.d < 3 ? (n.a.icao || n.a.name) : `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`; };
const loc = (t) => t ? new Date(t).toTimeString().slice(0, 5) : '—';
const utc = (t) => t ? fmtUTC(new Date(t)) + 'Z' : '—';

function stats(fl, track) {
  const air = track.filter((p) => fl.takeoff && p.t >= fl.takeoff && p.t <= (fl.landing ?? fl.end));
  let maxAlt = null, maxGs = 0;
  for (const p of track) { if (p.alt != null) maxAlt = Math.max(maxAlt ?? -Infinity, p.alt); if (p.gs) maxGs = Math.max(maxGs, p.gs); }
  const airH = fl.takeoff && fl.landing ? (fl.landing - fl.takeoff) / 3600e3 : 0;
  const blockH = (fl.end - fl.start) / 3600e3;
  const airDist = trackDist(air);
  return { dist: trackDist(track), airH, blockH, maxAlt, maxGs, avgGs: airH > 0.01 ? airDist / airH : null,
    from: fieldName(track[0]), to: fieldName(track[track.length - 1]) };
}

function summary(fl, track) {
  const s = stats(fl, track);
  const fuelUsed = (settings.taxiFuel || 0) + (settings.fuelBurn || 0) * s.airH;
  const totH = lib.list('flight').reduce((a, x) => a + (x.data.durH || 0), 0) + s.airH;
  const end = track[track.length - 1], sun = sunInfo(new Date(fl.end), end.lat, end.lon);
  const late = fl.landing && sun.sunset && fl.landing > +sun.sunset;
  const d = new Date(fl.start);
  modal(`<h3>Flygningen är avslutad</h3>
    <div class="field"><span>Namn</span><input type="text" id="fsName" value="${esc(`${s.from} – ${s.to}`)}"></div>
    <div class="kv fsum">
      <span>Datum</span><b>${d.toLocaleDateString('sv-SE')}</b>
      <span>Från – till</span><b>${esc(s.from)} – ${esc(s.to)}</b>
      <span>Start</span><b>${utc(fl.takeoff)} (${loc(fl.takeoff)})</b>
      <span>Landning</span><b>${utc(fl.landing)} (${loc(fl.landing)})</b>
      <span>Flygtid</span><b>${fmtHM(s.airH)}</b>
      <span>Total tid</span><b>${fmtHM(s.blockH)} <span class="muted">${utc(fl.start)}–${utc(fl.end)}</span></b>
      <span>Sträcka</span><b>${fmtDist(s.dist)}</b>
      <span>Max höjd</span><b>${s.maxAlt != null ? fmtAlt(s.maxAlt) : '—'}</b>
      <span>Fart</span><b>${s.avgGs != null ? `snitt ${Math.round(spdOut(s.avgGs))} · ` : ''}max ${Math.round(spdOut(s.maxGs))} ${spdUnit()}</b>
      <span>Bränsle</span><b id="fsFuel"></b>
      <span>Loggbok totalt</span><b>${fmtHM(totH)}</b>
    </div>
    ${late ? note('warn', `Landningen skedde efter solnedgång (${utc(+sun.sunset)}).`, 'moon') : ''}
    <div class="field"><span>Bränsle vid start (l)</span><input type="number" id="fsStart" inputmode="decimal" step="1" value="${settings.fuelUsable}"></div>
    <div class="field"><span>Antal landningar</span><input type="number" id="fsLdg" inputmode="numeric" min="0" step="1" value="${fl.takeoff ? 1 : 0}"></div>
    <div class="field col"><span>Anteckning</span><textarea id="fsNote" rows="2"></textarea></div>
    <div class="btnrow"><button class="btn primary" id="fsSave">${ic('book')}Spara i loggboken</button><button class="btn danger" id="fsDrop">Släng</button></div>`);
  const fuel = () => { const left = +$('#fsStart').value - fuelUsed; $('#fsFuel').innerHTML = `≈ ${fuelUsed.toFixed(1)} l förbrukat · ≈ ${left.toFixed(1)} l kvar`; };
  $('#fsStart').oninput = fuel; fuel();
  const close = () => $('#modal').classList.add('hidden');
  $('#fsDrop').onclick = () => { if (confirm('Slänga flygningen utan att spara?')) close(); };
  $('#fsSave').onclick = async () => {
    const step = Math.max(1, Math.ceil(track.length / 3000)); // högst ≈ 3000 punkter
    const tr = track.filter((_, i) => i % step === 0 || i === track.length - 1).map((p) => [p.lat, p.lon, p.alt, p.t]);
    await lib.put('flight', { id: lib.newId(), name: $('#fsName').value.trim() || `${s.from} – ${s.to}`, data: {
      start: fl.start, end: fl.end, takeoff: fl.takeoff, landing: fl.landing, durH: s.airH, blockH: s.blockH, distNM: s.dist,
      maxAlt: s.maxAlt, maxGs: s.maxGs, avgGs: s.avgGs, from: s.from, to: s.to, fuelStart: +$('#fsStart').value, fuelUsed: +fuelUsed.toFixed(1),
      landings: +$('#fsLdg').value || 0, note: $('#fsNote').value.trim(), track: tr } });
    close(); toast('Flygningen är sparad i loggboken');
  };
}

// ---------- Logg-fliken ----------
export function renderFlightCard(el) {
  const st = flightState();
  el.innerHTML = `<h3>Flygning</h3>${st ? `<div class="kv">
      <span>Loggning</span><b>sedan ${loc(st.start)}</b>
      <span>Läge</span><b>${st.air ? 'i luften' : st.takeoff ? 'på marken efter landning' : 'på marken'}</b>
      ${st.takeoff ? `<span>Start</span><b>${utc(st.takeoff)}</b>` : ''}
      <span>Sträcka</span><b>${fmtDist(st.dist)}</b></div>
    <div class="btnrow"><button class="btn primary" id="flEnd">${ic('check')}Avsluta flygning</button><button class="btn" id="flDrop">Avbryt loggning</button></div>`
    : `<div class="btnrow"><button class="btn primary" id="flStart">${ic('play')}Starta loggning</button></div>`}`;
  $('#flStart', el)?.addEventListener('click', () => { startFlight(); renderFlightCard(el); });
  $('#flEnd', el)?.addEventListener('click', () => finishFlight());
  $('#flDrop', el)?.addEventListener('click', () => { discardFlight(); renderFlightCard(el); });
}
