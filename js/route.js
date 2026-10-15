// Ruttplanering och navlogg
import { map } from './map.js';
import { settings, spdOut, spdUnit, oaipKey, proxyUrl } from './settings.js';
import { distNM, bearing, interp, windTriangle, norm360, fmtDeg, fmtHM, fmtUTC, fmtLocal, esc, store, toast, debounce, download, $, note } from './util.js';
import { ic } from './icons.js';
import { fetchForecast, hourIndex, windAt } from './wx.js';
import { allAirports } from './airports.js';
import { reportingPoints, airspacesAt, loadRoute, limitFt, asLabel, fmtLimit, asStyle } from './openaip.js';
import { routeProfile } from './terrain.js';
import { sunInfo } from './sun.js';
import * as lib from './library.js';

export const route = store.get('ulnav.route', { name: 'Ny rutt', wps: [], depTime: null });
let fc = null, fcSig = '';            // vindprognos för sträckornas mittpunkter
export let profile = [];              // terrängsampel
export let crossings = [];            // luftrum längs rutten
let legs = [];
const listeners = new Set();
export const onRouteChange = (fn) => listeners.add(fn);

const lineLayer = L.layerGroup();
const wpLayer = L.layerGroup();
const labelLayer = L.layerGroup();

export function initRoute() {
  lineLayer.addTo(map); labelLayer.addTo(map); wpLayer.addTo(map);
  map.on('zoomend', drawLabels);
  map.on('rotate', debounce(drawLabels, 300));
  changed(false);
}

const persist = () => store.set('ulnav.route', route);
const sig = () => route.wps.map((w) => `${w.lat.toFixed(3)},${w.lon.toFixed(3)},${w.alt}`).join(';') + '|' + depDate().toISOString().slice(0, 13);
export const depDate = () => (route.depTime ? new Date(route.depTime) : nextHalfHour());
function nextHalfHour() { const d = new Date(Date.now() + 15 * 6e4); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return d; }

const slowUpdate = debounce(async () => {
  const g0 = geoSig;
  await Promise.all([updateWind(), updateProfile()]);
  await updateAirspace(); // använder terrängprofilen för AGL-gränser
  if (g0 !== geoSig) { profile = []; crossings = []; return; } // rutten ändrades under hämtningen
  computeLegs(); draw(); emit();
}, 1200);

let geoSig = '';
function changed(slow = true) {
  // Ny geometri → gamla terräng-/luftrumsdata gäller inte längre (index per sträcka ändras)
  const g = route.wps.map((w) => `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`).join(';');
  if (g !== geoSig) { geoSig = g; profile = []; crossings = []; }
  persist(); computeLegs(); draw(); emit();
  if (slow) slowUpdate(); else if (route.wps.length > 1) slowUpdate();
}
function emit() { listeners.forEach((f) => f(route, legs)); }

// ---------- ändringar ----------
export function addWaypoint(p, index = route.wps.length) {
  const wp = { lat: +p.lat, lon: +p.lon, name: p.name || `WP${route.wps.length + 1}`, alt: p.alt ?? settings.cruiseAlt, elevFt: p.elevFt ?? null };
  route.wps.splice(index, 0, wp);
  changed();
}
export function removeWp(i) { route.wps.splice(i, 1); changed(); }
export function moveWp(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= route.wps.length) return;
  [route.wps[i], route.wps[j]] = [route.wps[j], route.wps[i]]; changed();
}
export function reverseRoute() { route.wps.reverse(); changed(); }
export function clearRoute() { route.wps = []; route.name = 'Ny rutt'; changed(); }
export function recompute() { changed(); }
export function setRoute(r) { Object.assign(route, { name: r.name || 'Rutt', wps: r.wps || [], depTime: r.depTime || null }); fcSig = ''; changed(); }

// ---------- snäppning vid tryck i ruttläge ----------
export function handleEditTap(latlng) {
  const pt = map.latLngToContainerPoint(latlng);
  // 1) nära befintlig sträcka → infoga
  for (let i = 0; i < route.wps.length - 1; i++) {
    const a = map.latLngToContainerPoint([route.wps[i].lat, route.wps[i].lon]);
    const b = map.latLngToContainerPoint([route.wps[i + 1].lat, route.wps[i + 1].lon]);
    if (L.LineUtil.pointToSegmentDistance(pt, a, b) < 14 && pt.distanceTo(a) > 30 && pt.distanceTo(b) > 30) {
      addWaypoint({ ...snap(latlng, pt) }, i + 1); return;
    }
  }
  addWaypoint(snap(latlng, pt));
}
function snap(latlng, pt) {
  let best = null, bd = 26;
  const test = (lat, lon, name, elevFt) => {
    const d = pt.distanceTo(map.latLngToContainerPoint([lat, lon]));
    if (d < bd) { bd = d; best = { lat, lon, name, elevFt }; }
  };
  const b = map.getBounds();
  for (const a of allAirports()) if (b.contains([a.lat, a.lon])) test(a.lat, a.lon, a.icao || a.name, a.elevFt);
  for (const r of reportingPoints.values()) { const [lon, lat] = r.geometry.coordinates; if (b.contains([lat, lon])) test(lat, lon, r.name); }
  return best || { lat: latlng.lat, lon: latlng.lng };
}

// ---------- beräkningar ----------
async function updateWind() {
  if (route.wps.length < 2 || !navigator.onLine) return;
  const s = sig();
  if (s === fcSig && fc) return;
  try {
    const mids = route.wps.slice(1).map((w, i) => interp(route.wps[i], w, 0.5));
    fc = await fetchForecast(mids);
    fcSig = s;
  } catch (e) { toast('Vind (Open-Meteo): ' + e.message); }
}
async function updateProfile() {
  try { profile = route.wps.length > 1 ? await routeProfile(route.wps) : []; }
  catch (e) { profile = []; }
}
async function updateAirspace() {
  crossings = [];
  if (route.wps.length < 2 || !oaipKey()) return;
  await loadRoute(route.wps);
  // sampla var ~0,5 NM
  const pts = [];
  let acc = 0;
  for (let i = 0; i < route.wps.length - 1; i++) {
    const a = route.wps[i], b = route.wps[i + 1], d = distNM(a, b), n = Math.max(1, Math.ceil(d / 0.5));
    for (let j = 0; j <= n; j++) { if (j === 0 && i > 0) continue; const p = interp(a, b, j / n); pts.push({ ...p, d: acc + d * j / n, leg: i }); }
    acc += d;
  }
  const open = new Map();
  for (const p of pts) {
    const here = new Set();
    for (const a of airspacesAt(p.lat, p.lon)) {
      here.add(a._id);
      if (!open.has(a._id)) open.set(a._id, { as: a, from: p.d, to: p.d, legs: new Set([p.leg]) });
      else { const c = open.get(a._id); c.to = p.d; c.legs.add(p.leg); }
    }
  }
  crossings = [...open.values()].sort((x, y) => x.from - y.from);
  for (const c of crossings) {
    // Bedöm varje sträcka för sig — "inne" om NÅGON sträcka genom luftrummet ligger inom gränserna
    const terr = maxTerrain(c.from, c.to);
    const lo = limitFt(c.as.lowerLimit), up = limitFt(c.as.upperLimit);
    c.lowFt = lo.ft + (lo.agl ? terr : 0); c.upFt = up.ft + (up.agl ? terr : 0);
    const alts = [...c.legs].map((l) => route.wps[l + 1].alt);
    const insideAlts = alts.filter((a) => a >= c.lowFt && a <= c.upFt);
    c.inside = insideAlts.length > 0;
    c.alt = c.inside ? insideAlts[0] : alts[0];
    c.below = !c.inside && alts.every((a) => a < c.lowFt);
    c.mixed = !c.inside && !c.below && alts.some((a) => a < c.lowFt);
  }
}
function maxTerrain(from, to) {
  let m = 0;
  for (const s of profile) if (s.d >= from - 0.3 && s.d <= to + 0.3 && s.ft > m) m = s.ft;
  return m;
}

function computeLegs() {
  const tas = settings.tas, dep = depDate();
  let t = 0, cum = 0;
  legs = [];
  for (let i = 0; i < route.wps.length - 1; i++) {
    const a = route.wps[i], b = route.wps[i + 1];
    const d = distNM(a, b), tc = bearing(a, b);
    let wind = null;
    if (fc?.[i]?.hourly) {
      const at = new Date(dep.getTime() + t * 3600e3);
      wind = windAt(fc[i], hourIndex(fc[i], at), b.alt);
    }
    const w = windTriangle(tc, tas, wind?.dir, wind?.spd);
    const gs = isFinite(w.gs) && w.gs > 5 ? w.gs : NaN;
    const ete = d / (gs || tas);
    const mt = norm360(tc - settings.variation), mh = norm360(w.th - settings.variation);
    cum += d; t += ete;
    const terr = profile.filter((s) => s.leg === i).reduce((m, s) => Math.max(m, s.ft ?? 0), 0);
    legs.push({ i, from: a, to: b, d, tc, mt, wind, wca: w.wca, th: w.th, mh, gs, ete, fuel: ete * settings.fuelBurn, cum, t,
      eta: new Date(dep.getTime() + t * 3600e3), terr: profile.length ? terr : null,
      lowClear: profile.length ? b.alt - terr < settings.minClearance : false });
  }
}
export const getLegs = () => legs;

export function totals() {
  const d = legs.reduce((s, l) => s + l.d, 0), t = legs.reduce((s, l) => s + l.ete, 0);
  const trip = t * settings.fuelBurn, reserve = settings.reserveMin / 60 * settings.fuelBurn;
  const need = trip + reserve + settings.taxiFuel;
  const last = route.wps[route.wps.length - 1];
  const eta = legs.length ? legs[legs.length - 1].eta : null;
  const sun = last ? sunInfo(eta || depDate(), last.lat, last.lon) : null;
  return { d, t, trip, reserve, need, extra: settings.fuelUsable - need, endurance: settings.fuelUsable / settings.fuelBurn, eta, sun };
}

// ---------- ritning ----------
const wpIcon = (n) => L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="wp-icon">${n}</div>` });

function draw() {
  lineLayer.clearLayers(); wpLayer.clearLayers();
  const ll = route.wps.map((w) => [w.lat, w.lon]);
  if (ll.length > 1) {
    L.polyline(ll, { pane: 'route', color: '#fff', weight: 9, opacity: 0.8, interactive: false }).addTo(lineLayer);
    L.polyline(ll, { pane: 'route', color: getComputedStyle(document.body).getPropertyValue('--route').trim() || '#d63bd6', weight: 5, interactive: false }).addTo(lineLayer);
  }
  route.wps.forEach((w, i) => {
    const m = L.marker([w.lat, w.lon], { icon: wpIcon(i + 1), draggable: editing, pane: 'routeIcons', autoPan: true, bubblingMouseEvents: false })
      .bindTooltip(esc(w.name), { permanent: true, direction: 'top', offset: [0, -14], className: 'wp-label' }).addTo(wpLayer);
    m.on('dragend', () => { const p = m.getLatLng(); w.lat = p.lat; w.lon = p.lng; changed(); });
    m.on('click', () => {
      if (editing) return;
      L.popup().setLatLng([w.lat, w.lon]).setContent(`<h4>${i + 1}. ${esc(w.name)}</h4><div class="pbtns">
        <button onclick="window.ulnav.directTo(${i})">${ic('arrowRight')}Direkt till</button><button class="sec" onclick="window.ulnav.removeWp(${i})">${ic('trash')}Ta bort</button></div>`).openOn(map);
    });
  });
  drawLabels();
}

function drawLabels() {
  labelLayer.clearLayers();
  if (map.getZoom() < 8) return;
  for (const l of legs) {
    const A = map.latLngToContainerPoint([l.from.lat, l.from.lon]), B = map.latLngToContainerPoint([l.to.lat, l.to.lon]);
    const px = A.distanceTo(B);
    if (px < 160) continue;
    const mid = interp(l.from, l.to, 0.5);
    // förskjut etiketten vinkelrätt från linjen (mot skärmens överkant) så att den inte döljer rutten
    let nx = -(B.y - A.y) / px, ny = (B.x - A.x) / px;
    if (ny > 0 || (Math.abs(ny) < 0.2 && nx < 0)) { nx = -nx; ny = -ny; }
    const k = 22 + 40 * Math.abs(nx); // längre förskjutning när etiketten hamnar åt sidan (etiketten är bred)
    L.tooltip({ permanent: true, direction: 'center', className: 'leg-label', interactive: false, offset: [nx * k, ny * k] })
      .setLatLng([mid.lat, mid.lon]).setContent(`${fmtDeg(isFinite(l.mh) ? l.mh : l.mt)}° ${l.d.toFixed(1)}NM ${fmtHM(l.ete)}`).addTo(labelLayer);
  }
}

let editing = false;
export function setEditing(v) { editing = v; draw(); }

// ---------- rutt-flik ----------
export function renderRouteTab(el, { activeLeg = -1 } = {}) {
  const T = totals();
  const dep = depDate();
  const depLocal = new Date(dep.getTime() - dep.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const saved = lib.list('route').sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  let h = `<div class="field"><span>Namn</span><input type="text" id="rName" value="${esc(route.name)}"></div>
    <div class="field"><span>Avgång <small>lokal tid — styr vindprognosen</small></span><input type="datetime-local" id="rDep" value="${depLocal}"></div>`;
  h += `<h3>Brytpunkter</h3>`;
  if (!route.wps.length) h += `<div class="empty">${ic('route', 34)}<b>Ingen rutt ännu</b><span>Tryck på <b>Rutt</b> till höger och sedan på kartan, eller lägg till fält från fliken <b>Fält</b>. Tryck nära ett fält eller en rapportpunkt för att fästa vid den.</span></div>`;
  h += '<ul class="wplist">' + route.wps.map((w, i) => `<li class="${i === activeLeg + 1 ? 'active' : ''}"><span class="num">${i + 1}</span>
    <span class="nm"><input data-name="${i}" value="${esc(w.name)}"></span>
    ${i > 0 ? `<input class="alt" type="number" inputmode="numeric" step="100" data-alt="${i}" value="${w.alt}" title="Höjd ft MSL på sträckan hit">` : '<span style="width:76px" class="muted">start</span>'}
    <button class="ib" data-up="${i}" aria-label="Flytta upp">${ic('arrowUp')}</button><button class="ib" data-dn="${i}" aria-label="Flytta ner">${ic('arrowDown')}</button><button class="ib" data-del="${i}" aria-label="Ta bort">${ic('close')}</button></li>`).join('') + '</ul>';
  if (route.wps.length > 1) h += `<div class="muted" style="margin-top:4px">Höjdfältet = planerad höjd (ft MSL) på sträckan <i>till</i> punkten.</div>`;

  if (legs.length) {
    const u = spdUnit();
    h += `<h3>Navlogg <span class="muted">(TAS ${Math.round(spdOut(settings.tas))} ${u}, var ${settings.variation >= 0 ? settings.variation + '°E' : -settings.variation + '°W'})</span></h3>
      <table class="navlog"><tr><th>Till</th><th>Höjd</th><th>MT</th><th>Vind</th><th>MH</th><th>NM</th><th>GS</th><th>Tid</th><th>ETA</th></tr>`;
    for (const l of legs) {
      h += `<tr class="${l.i === activeLeg ? 'active' : ''}"><td>${esc(l.to.name)}</td><td>${l.to.alt}${l.lowClear ? ' <span class="warnmark">' + ic('alert', 14) + '</span>' : ''}</td><td>${fmtDeg(l.mt)}</td>
        <td>${l.wind ? fmtDeg(l.wind.dir) + '/' + Math.round(l.wind.spd) : '—'}</td><td><b>${fmtDeg(l.mh)}</b></td><td>${l.d.toFixed(1)}</td>
        <td>${isFinite(l.gs) ? Math.round(spdOut(l.gs)) : '—'}</td><td>${fmtHM(l.ete)}</td><td>${fmtUTC(l.eta)}</td></tr>`;
    }
    h += `<tr class="tot"><td>Totalt</td><td></td><td></td><td></td><td></td><td>${T.d.toFixed(1)}</td><td></td><td>${fmtHM(T.t)}</td><td>${fmtUTC(T.eta)}Z</td></tr></table>`;
    h += `<div class="muted">Vind: Open-Meteo, interpolerad till sträckans höjd vid mitten av sträckan, beräknad tid. ${fc ? '' : '<b>Ingen vind hämtad — räknar utan vind.</b>'}</div>`;

    h += `<h3>Bränsle (liter)</h3><div class="kv">
      <span>Färd</span><b>${T.trip.toFixed(1)} l</b>
      <span>Taxi</span><b>${settings.taxiFuel.toFixed(1)} l</b>
      <span>Reserv ${settings.reserveMin} min</span><b>${T.reserve.toFixed(1)} l</b>
      <span>Minst ombord</span><b>${T.need.toFixed(1)} l</b>
      <span>Användbart</span><b>${settings.fuelUsable} l (uthållighet ${fmtHM(T.endurance)})</b></div>`;
    h += T.extra < 0 ? note('bad', `Bränslet räcker inte. Det saknas ${(-T.extra).toFixed(1)} l — planera tankstopp.`, 'fuel') : '';

    if (T.sun) {
      const s = T.sun;
      const late = T.eta && s.sunset && T.eta > s.sunset;
      h += `<h3>Ljus vid destination</h3><div class="kv"><span>Solnedgång</span><b>${fmtUTC(s.sunset)}Z (${fmtLocal(s.sunset)} lokal)</b>
        <span>Civil skymning</span><b>${fmtUTC(s.civilDusk)}Z (${fmtLocal(s.civilDusk)} lokal)</b><span>Soluppgång</span><b>${fmtUTC(s.sunrise)}Z</b></div>
        ${late ? note('bad', 'Beräknad ankomst efter solnedgång.', 'moon') : ''}`;
    }
    const low = legs.filter((l) => l.lowClear);
    if (low.length) h += note('warn', `Under ${settings.minClearance} ft terrängmarginal på: ${low.map((l) => `${esc(l.to.name)} (terräng ${Math.round(l.terr)} ft)`).join(', ')}. Höjddata saknar master och byggnader.`);

    h += `<h3>Luftrum längs rutten</h3>`;
    if (!oaipKey()) h += '<div class="muted">Ange OpenAIP-nyckel under Inställningar för luftrumskontroll.</div>';
    else if (!crossings.length) h += '<div class="muted">Inga luftrum funna längs rutten i OpenAIP-data (eller ännu ej inläst).</div>';
    else h += crossings.map((c) => {
      const cls = c.inside && [1, 3, 4, 7, 13, 26, 36, 2].includes(c.as.type) ? 'asp-bad' : c.inside ? 'asp-warn' : '';
      return `<div class="asp ${cls}" style="border-left:5px solid ${asStyle(c.as).color};padding:6px 8px;margin:6px 0">
        <b>${esc(c.as.name)}</b> — ${esc(asLabel(c.as))}<br>${esc(fmtLimit(c.as.lowerLimit))} – ${esc(fmtLimit(c.as.upperLimit))}
        · NM ${c.from.toFixed(0)}–${c.to.toFixed(0)} · ${c.inside ? '<b>du är inne vid ' + c.alt + ' ft</b>' : c.below ? 'du passerar under' : c.mixed ? 'du passerar under/över' : 'du passerar över'}
        ${c.as.frequencies?.length ? '<br>' + c.as.frequencies.map((f) => esc(f.value) + ' ' + esc(f.name || '')).join(', ') : ''}</div>`;
    }).join('');
  }

  h += `<h3>Rutthantering</h3><div class="btnrow">
    <button class="btn" id="rRev">${ic('swap')}Vänd</button><button class="btn" id="rSave">${ic('save')}Spara</button>
    <button class="btn" id="rGpx">${ic('download')}Exportera GPX</button><label class="btn">${ic('upload')}Importera GPX<input type="file" id="rImp" accept=".gpx,application/gpx+xml,text/xml" hidden></label>
    <button class="btn danger" id="rClr">${ic('trash')}Rensa</button></div>`;
  if (saved.length) h += '<h3>Sparade rutter</h3><ul class="aplist">' + saved.map((r) => `<li><div class="info"><b>${esc(r.name)}</b><span>${r.data.wps.length} punkter${r.share ? ' · delad' : ''}</span></div>
    <button class="btn small" data-load="${r.id}">Öppna</button>
    <button class="btn small icon" data-share="${r.id}" aria-label="Dela">${ic('share')}</button>
    <button class="btn small icon danger" data-rm="${r.id}" aria-label="Ta bort">${ic('trash')}</button></li>`).join('') + '</ul>';
  el.innerHTML = h;

  $('#rName', el).onchange = (e) => { route.name = e.target.value; persist(); };
  $('#rDep', el).onchange = (e) => { route.depTime = e.target.value ? new Date(e.target.value).toISOString() : null; changed(); };
  el.querySelectorAll('[data-name]').forEach((i) => i.onchange = () => { route.wps[+i.dataset.name].name = i.value; changed(false); });
  el.querySelectorAll('[data-alt]').forEach((i) => i.onchange = () => { route.wps[+i.dataset.alt].alt = Math.max(0, +i.value || 0); changed(); });
  el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => moveWp(+b.dataset.up, -1));
  el.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => moveWp(+b.dataset.dn, 1));
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => removeWp(+b.dataset.del));
  $('#rRev', el).onclick = reverseRoute;
  $('#rClr', el).onclick = () => { if (confirm('Rensa rutten?')) clearRoute(); };
  $('#rSave', el).onclick = () => {
    const n = prompt('Spara rutt som:', route.name); if (!n) return;
    const same = lib.list('route').find((r) => r.name === n);
    if (same && !confirm(`Det finns redan en sparad rutt som heter "${n}". Ersätta den?`)) return;
    lib.put('route', { id: same?.id || lib.newId(), name: n, data: JSON.parse(JSON.stringify({ wps: route.wps, depTime: route.depTime })) });
    route.name = n; persist(); emit(); toast('Rutten sparad');
  };
  $('#rGpx', el).onclick = () => download(`${route.name.replace(/[^\wåäöÅÄÖ-]+/g, '_')}.gpx`, toGPX());
  $('#rImp', el).onchange = async (e) => { const f = e.target.files[0]; if (f) { importGPX(await f.text()); } };
  el.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => { const r = lib.get('route', b.dataset.load); if (r) { setRoute({ name: r.name, ...r.data }); fitRoute(); } });
  el.querySelectorAll('[data-share]').forEach((b) => b.onclick = () => window.ulnav.share('route', b.dataset.share));
  el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { if (!confirm('Ta bort sparad rutt?')) return; lib.remove('route', b.dataset.rm); emit(); });
}

export function fitRoute() { if (route.wps.length) map.fitBounds(route.wps.map((w) => [w.lat, w.lon]), { padding: [60, 100] }); }

// ---------- GPX ----------
const x = (s) => esc(s);
export function toGPX() {
  const pts = route.wps.map((w) => `    <rtept lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><ele>${(w.alt / 3.28084).toFixed(0)}</ele><name>${x(w.name)}</name></rtept>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Ultranav" xmlns="http://www.topografix.com/GPX/1/1">\n  <rte><name>${x(route.name)}</name>\n${pts}\n  </rte>\n</gpx>\n`;
}
export function importGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  let pts = [...doc.getElementsByTagName('rtept')];
  if (!pts.length) pts = [...doc.getElementsByTagName('wpt')];
  if (!pts.length) { // spår → förenkla till max 20 punkter
    const trk = [...doc.getElementsByTagName('trkpt')];
    const step = Math.max(1, Math.floor(trk.length / 20));
    pts = trk.filter((_, i) => i % step === 0 || i === trk.length - 1);
  }
  if (!pts.length) { toast('Hittade inga punkter i GPX-filen'); return; }
  const wps = pts.map((p, i) => {
    const ele = p.getElementsByTagName('ele')[0]?.textContent;
    return { lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), name: p.getElementsByTagName('name')[0]?.textContent || `WP${i + 1}`,
      alt: ele ? Math.round(+ele * 3.28084 / 100) * 100 || settings.cruiseAlt : settings.cruiseAlt };
  });
  setRoute({ name: doc.getElementsByTagName('name')[0]?.textContent || 'Importerad rutt', wps });
  fitRoute(); toast(`${wps.length} punkter importerade`);
}
