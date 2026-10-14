// Ultranav — huvudmodul
import { settings, saveSettings, spdOut, spdIn, spdUnit, DEFAULT_TILES, onSettings } from './settings.js';
import * as lib from './library.js';
import { initCloud, onCloud, cloudConfigured, cloudStatus, shareItem, unshareItem, fetchShared, copyText } from './cloud.js';
import { renderAccountTab, askNewPassword } from './account.js';
import { initCustomLayers, addSharedLayer } from './customlayers.js';
import { renderLogbook, showFlight } from './logbook.js';
import { $, $$, esc, toast, modal, note, fmtDeg, fmtHM, fmtUTC, distNM, bearing, debounce, store } from './util.js';
import { initMap, map, renderLayerPanel, testCurrentBase } from './map.js';
import { initAero, actions, airportHtml, mapInfoPopup, openAirport, airportNear } from './aero.js';
import { initDraw, drawActive, drawTap, renderDrawTab, drawActions, onDrawings, openDrawBar, closeDrawBar, drawBarOpen, syncBar, readout } from './draw.js';
import { loadOurAirports, nearestAirports, searchAirports, oaInfo, longestRwy, onAirports } from './airports.js';
import { initRoute, route, addWaypoint, removeWp, handleEditTap, setEditing, renderRouteTab, onRouteChange, getLegs, fitRoute, depDate, recompute, setRoute } from './route.js';
import { initNav, nav, startGps, stopGps, directTo, cancelDto, setFollow, setTrackUp, instrumentData, onNav, renderLogTab, setActiveLeg } from './nav.js';
import { drawProfile } from './profile.js';
import { initWxOverlay, fetchMetarTaf, metarHtml, fetchForecast, hourIndex, surfaceWx, windAt, searchStations, loadStationList } from './wx.js';
import { elevationFt } from './terrain.js';
import { downloadRoute, cacheInfo, clearTiles } from './offline.js';
import { sunInfo } from './sun.js';
import { testOpenAip, testProxy, testWeather } from './diag.js';
import { oaipStatus, resetOpenAip } from './openaip.js';
import { applyIcons, icon, ic } from './icons.js';

let editing = false;
let currentTab = 'route';

// ---------- tema ----------
function applyTheme() {
  document.body.classList.remove('day', 'night', 'dark');
  document.body.classList.add(settings.theme);
  document.querySelector('meta[name=theme-color]').content = settings.theme === 'day' ? '#ffffff' : settings.theme === 'night' ? '#050505' : '#16212d';
}
applyTheme();
applyIcons();

// ---------- start ----------
await lib.initLibrary(); // lokalt bibliotek (rutter, ritningar, kartmaterial, loggbok) före övriga moduler
initMap();
initAero();
initCustomLayers();
initWxOverlay();
initRoute();
initNav();
initDraw();
loadOurAirports();

Object.assign(actions, {
  editMode: () => editing,
  addWaypoint: (p) => { addWaypoint(p); toast(`+ ${p.name || 'punkt'}`, 1500); },
  directTo: (p) => directTo(p),
  showWx: (icao) => showWx(icao),
  ownPos: () => nav.pos,
  drawActive: () => drawActive(),
  drawTap: (ll) => drawTap(ll),
});
Object.assign(drawActions, {
  addWaypoint: (p) => addWaypoint(p),
  directTo: (p) => directTo(p),
  setRoute: (r) => { setRoute(r); fitRoute(); },
  ownPos: () => nav.pos,
  closeSide: () => toggleSide(false),
  onModeChange: (m) => {
    if (m && editing) setEdit(false);
    if (m) { map.closePopup(); setFollow(false); }
    syncFab();
  },
  toggleProfile: () => { $('#profilePanel').classList.toggle('hidden'); drawProfile(); },
  profileOn: () => !$('#profilePanel').classList.contains('hidden'),
  routeUndo: () => { if (route.wps.length) removeWp(route.wps.length - 1); },
  routeSummary: () => {
    if (route.wps.length < 2) return '';
    const legs = getLegs(), d = legs.reduce((s, l) => s + l.d, 0), t = legs.reduce((s, l) => s + l.ete, 0);
    return `<b>${route.wps.length} punkter · ${d.toFixed(1)} NM · ${fmtHM(t)}</b> — tryck för fler punkter, dra för att flytta`;
  },
});
onDrawings(() => { if (currentTab === 'draw') renderTab(); });
// globalt för knappar i popup-fönster
window.ulnav = { directTo, removeWp: (i) => { map.closePopup(); removeWp(i); }, showWx: (i) => showWx(i), setActiveLeg };

// ---------- kartinteraktion ----------
map.on('click', async (e) => {
  if (drawActive()) { drawTap(e.latlng); return; }
  if (editing) { handleEditTap(e.latlng); return; }
  // Tryck nära ett flygfält öppnar fältinfo även om pricken missades
  const ap = airportNear(e.latlng);
  if (ap) { openAirport(ap); return; }
  const el = await elevationFt(e.latlng.lat, e.latlng.lng).catch(() => null);
  mapInfoPopup(e.latlng, el);
});

// ---------- snabbknappar ----------
const fab = (id, fn) => $(id).addEventListener('click', fn);
fab('#btnGps', () => (nav.tracking && !nav.simulating ? stopGps() : startGps()));
fab('#btnFollow', () => setFollow(!nav.follow));
fab('#btnOrient', () => {
  if (!map.setBearing) return toast('Rotation stöds inte');
  setTrackUp(!nav.trackUp);
  if (nav.trackUp && !nav.pos) toast('Kurs-upp aktiveras när GPS har position');
});
fab('#btnDraw', () => (drawBarOpen() ? closeDrawBar() : openDrawBar('measure')));
fab('#btnEdit', () => setEdit(!editing));
fab('#btnProfile', () => { $('#profilePanel').classList.toggle('hidden'); drawProfile(); syncFab(); });
fab('#btnEditUndo', () => { if (route.wps.length) removeWp(route.wps.length - 1); });
fab('#btnEditDone', () => setEdit(false));
fab('#btnNearest', showNearest);
fab('#btnLayers', () => { const p = $('#layerPanel'); p.classList.toggle('hidden'); if (!p.classList.contains('hidden')) renderLayerPanel(); syncFab(); });
fab('#btnZoomIn', () => map.zoomIn());
fab('#btnZoomOut', () => map.zoomOut());
fab('#btnMenu', () => toggleSide());
fab('#btnCloseSide', () => toggleSide(false));
fab('#modalClose', () => $('#modal').classList.add('hidden'));
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
map.on('click', () => { $('#layerPanel').classList.add('hidden'); syncFab(); });

function setEdit(v) {
  if (v && drawBarOpen()) closeDrawBar();
  editing = v; setEditing(v);
  $('#editBanner').classList.toggle('hidden', !v);
  if (v) updateEditInfo();
  if (v) { map.closePopup(); setFollow(false); }
  syncFab();
}
function syncFab() {
  $('#btnGps').classList.toggle('on', nav.tracking);
  $('#btnGps small').textContent = nav.simulating ? 'SIM' : 'GPS';
  $('#btnFollow').classList.toggle('on', nav.follow && nav.tracking);
  $('#btnOrient').innerHTML = nav.trackUp ? icon('heading') + '<small>Kurs</small>' : icon('north') + '<small>Norr</small>';
  $('#btnOrient').classList.toggle('on', nav.trackUp);
  $('#btnDraw').classList.toggle('on', drawBarOpen());
  $('#btnEdit').classList.toggle('on', editing);
  $('#btnProfile').classList.toggle('on', !$('#profilePanel').classList.contains('hidden'));
  $('#btnLayers').classList.toggle('on', !$('#layerPanel').classList.contains('hidden'));
}
onNav(() => { syncFab(); updateInstruments(); });

// ---------- sidopanel ----------
function toggleSide(force) {
  const s = $('#side');
  const show = force ?? s.classList.contains('hidden');
  s.classList.toggle('hidden', !show);
  document.body.classList.toggle('side-open', show);
  setTimeout(drawProfile, 50);
  if (show) renderTab();
}
$$('.tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => {
  currentTab = b.dataset.tab;
  $$('.tabs button[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tabbody').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + currentTab));
  renderTab();
}));
function renderTab() {
  if ($('#side').classList.contains('hidden')) return;
  const el = $('#tab-' + currentTab);
  if (currentTab === 'route') renderRouteTab(el, { activeLeg: nav.tracking ? nav.activeLeg : -1 });
  if (currentTab === 'wx') renderWxTab(el);
  if (currentTab === 'fields') renderFieldsTab(el);
  if (currentTab === 'track') { renderLogTab(el); const lb = document.createElement('div'); el.appendChild(lb); renderLogbook(lb); }
  if (currentTab === 'account') renderAccountTab(el);
  if (currentTab === 'draw') renderDrawTab(el);
  if (currentTab === 'settings') renderSettingsTab(el);
}
function updateEditInfo() {
  $('#editInfo').innerHTML = drawActions.routeSummary() || 'Tryck på kartan för att lägga till brytpunkter. Tryck nära ett fält för att fästa vid det.';
}
onRouteChange(() => {
  if (editing) updateEditInfo();
  if (currentTab === 'route' && !document.activeElement?.closest?.('#tab-route')) renderTab();
  drawProfile();
});
onAirports(() => { if (currentTab === 'fields') renderTab(); });

// ---------- instrumentlist ----------
function setI(id, v, alert = false) { const e = $(id); e.textContent = v; e.parentElement.classList.toggle('alert', alert); }
function updateInstruments() {
  const o = instrumentData();
  setI('#iGS', o.gs != null ? Math.round(spdOut(o.gs)) : '--');
  $('#iGSu').textContent = spdUnit();
  setI('#iTRK', o.trk != null ? fmtDeg(o.trk - settings.variation) : '---');
  setI('#iALT', o.alt != null ? Math.round(o.alt) : '----');
  setI('#iAGL', o.agl != null ? Math.round(o.agl) : '----', o.agl != null && o.agl < 300 && (o.gs || 0) > 30);
  setI('#iWP', o.wp ? (nav.dto ? 'D→ ' : '') + o.wp : '—');
  setI('#iBRG', o.brg != null ? fmtDeg(o.brg) : '---');
  setI('#iDIST', o.dist != null ? (o.dist < 10 ? o.dist.toFixed(1) : Math.round(o.dist)) : '--');
  setI('#iETE', fmtHM(o.ete));
  setI('#iETA', fmtUTC(o.eta));
}
setInterval(() => { $('#iUTC').textContent = fmtUTC(new Date()); }, 1000);
$('#iUTC').textContent = fmtUTC(new Date());
updateInstruments();
syncFab();
// Tryck på NÄSTA = avbryt direkt-till / välj sträcka
$('#iWP').parentElement.addEventListener('click', () => {
  if (nav.dto) { if (confirm('Avbryt Direkt till?')) cancelDto(); return; }
  if (route.wps.length < 2) return;
  modal(`<h3>Välj aktiv sträcka</h3><ul class="aplist">${route.wps.slice(1).map((w, i) => `<li><div class="info"><b>${i + 1}–${i + 2} ${esc(w.name)}</b></div>
    <button class="btn small ${i === nav.activeLeg ? 'primary' : ''}" onclick="window.ulnav.setActiveLeg(${i});document.getElementById('modal').classList.add('hidden')">Aktivera</button></li>`).join('')}</ul>`);
});

// ---------- närmaste fält (nödläge) ----------
function showNearest() {
  const ref = nav.pos || { lat: map.getCenter().lat, lon: map.getCenter().lng };
  const list = nearestAirports(ref, 12);
  window.ulnav._near = list.map((x) => x.a);
  modal(`<h3>Närmaste fält ${nav.pos ? 'från din position' : '<span class="muted">(från kartans mitt — GPS av)</span>'}</h3>
    ${nav.pos && nav.aglFt ? note('ok', `Glidräckvidd ≈ <b>${(nav.aglFt * settings.glideRatio / 6076).toFixed(1)} NM</b> (1:${settings.glideRatio}, ${Math.round(nav.aglFt)} ft AGL)`, 'triangle') : ''}
    ${list.length ? `<ul class="aplist">${list.map(({ a, d }, i) => apRow(a, d, bearing(ref, a), i, true)).join('')}</ul>` : '<div class="muted">Inga fält inlästa ännu.</div>'}`);
}
function apRow(a, d, brg, i, big) {
  const r = longestRwy(a);
  return `<li><div class="info"><b>${a.ul ? '<span class="tag ul">UL</span>' : ''}${esc(a.name)}</b>
    <span>${esc(a.icao || '')} ${esc(a.type)}${r ? ` · ${esc(r.des)} ${r.lenM ? r.lenM + ' m' : ''} ${esc(r.surf)}` : ''}${a.freqs[0] ? ' · ' + esc(a.freqs[0].mhz) : ''}</span></div>
    <div class="dist">${d.toFixed(1)}<small>NM · ${fmtDeg(brg - settings.variation)}°M</small></div>
    <button class="btn small ${big ? 'primary' : ''}" onclick="window.ulnav.dtoNear(${i})" aria-label="Direkt till">${ic('arrowRight', 20)}</button>
    <button class="btn small" onclick="window.ulnav.showNear(${i})" aria-label="Info">${ic('info', 20)}</button></li>`;
}
window.ulnav.dtoNear = (i) => { const a = window.ulnav._near[i]; $('#modal').classList.add('hidden'); directTo({ lat: a.lat, lon: a.lon, name: a.icao || a.name }); };
window.ulnav.showNear = (i) => {
  const a = window.ulnav._near[i]; $('#modal').classList.add('hidden');
  if (window.innerWidth < 1000) toggleSide(false);
  map.setView([a.lat, a.lon], Math.max(map.getZoom(), 11));
  openAirport(a);
};
window.ulnav.addNear = (i) => { const a = window.ulnav._near[i]; addWaypoint({ lat: a.lat, lon: a.lon, name: a.icao || a.name, elevFt: a.elevFt }); toast('+ ' + (a.icao || a.name)); };

// ---------- flik: fält ----------
let fieldQuery = '';
function renderFieldsTab(el) {
  const ref = nav.pos || { lat: map.getCenter().lat, lon: map.getCenter().lng };
  const info = oaInfo();
  el.innerHTML = `<input class="search" type="search" id="fq" placeholder="Sök namn eller ICAO (t.ex. ESSB, Långtora)…" value="${esc(fieldQuery)}" autocomplete="off">
    <div id="fres"></div>
    <div class="muted" style="margin-top:10px">${info ? `OurAirports: ${info.n} fält (${esc(settings.oaCountries)}), hämtat ${info.t.toLocaleDateString('sv-SE')}` : 'OurAirports ej inläst'}${settings.openaipKey ? ' · OpenAIP: fält laddas för kartvyn' : ' · Ange OpenAIP-nyckel för UL-fält och frekvenser'}</div>`;
  const draw = () => {
    const q = $('#fq', el).value;
    fieldQuery = q;
    const list = q.trim() ? searchAirports(q).map((a) => ({ a, d: distNM(ref, a) })) : nearestAirports(ref, 30);
    window.ulnav._near = list.map((x) => x.a);
    $('#fres', el).innerHTML = `<h3>${q.trim() ? 'Sökresultat' : 'Närmast ' + (nav.pos ? 'din position' : 'kartans mitt')}</h3>
      <ul class="aplist">${list.map(({ a, d }, i) => apRow(a, d, bearing(ref, a), i, false).replace('</li>', `<button class="btn small" onclick="window.ulnav.addNear(${i})">+</button></li>`)).join('') || '<li class="muted">Inga träffar</li>'}</ul>`;
  };
  $('#fq', el).addEventListener('input', debounce(draw, 200));
  draw();
}

// ---------- flik: väder ----------
async function showWx(icao) {
  toggleSide(true);
  $$('.tabs button[data-tab]').find((b) => b.dataset.tab === 'wx').click();
  if (icao) $('#tab-wx')._wxAdd?.(icao.toUpperCase());
}
function routeIcaos() { return [...new Set(route.wps.map((w) => w.name).filter((n) => /^[A-Z]{4}$/.test(n)))]; }
// Valda väderstationer sparas som lista; äldre versioner sparade en sträng
function wxIds() {
  const v = store.get('ulnav.wxids', null);
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : routeIcaos();
  return [...new Set(list.map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{3,4}$/.test(x)))];
}
const setWxIds = (ids) => store.set('ulnav.wxids', [...new Set(ids)]);

function renderWxTab(el) {
  el.innerHTML = `<h3>METAR / TAF</h3>
    <div class="wxsearch">
      <div class="chips" id="wxChips"></div>
      <input id="wxQ" type="search" placeholder="Sök flygplats – t.ex. ES, ESSA eller Arlanda" autocomplete="off" autocapitalize="characters" spellcheck="false">
    </div>
    <ul class="suggest hidden" id="wxSug"></ul>
    ${routeIcaos().length ? `<div class="btnrow"><button class="btn small" id="wxRoute">${ic('route')}Fält i rutten (${routeIcaos().join(', ')})</button></div>` : ''}
    <div id="wxRes"></div>
    <h3>Prognos för rutten <span class="muted">(Open-Meteo)</span></h3><div id="wxRoute2" class="muted">${route.wps.length < 2 ? 'Skapa en rutt för vindprognos.' : 'Hämtar…'}</div>
    <div class="muted" style="margin-top:12px">Lägg till <b>METAR-stationer</b> och <b>Nederbördsradar</b> som lager via <b>Kartor</b>. Officiell briefing (LFV/AIM) ska alltid användas före flygning.</div>`;
  const q = $('#wxQ', el), sug = $('#wxSug', el);
  const drawChips = () => {
    $('#wxChips', el).innerHTML = wxIds().map((id) => `<span class="chip">${esc(id)}<button data-rm="${esc(id)}" aria-label="Ta bort ${esc(id)}">${ic('close', 14)}</button></span>`).join('');
    $('#wxChips', el).querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { setWxIds(wxIds().filter((x) => x !== b.dataset.rm)); drawChips(); fetchWx(); });
  };
  const add = (id) => { setWxIds([...wxIds(), id]); q.value = ''; sug.classList.add('hidden'); drawChips(); fetchWx(); };
  const fetchWx = async () => {
    const ids = wxIds();
    if (!ids.length) { $('#wxRes', el).innerHTML = '<div class="muted">Sök och välj en eller flera flygplatser.</div>'; return; }
    $('#wxRes', el).innerHTML = '<div class="muted">Hämtar…</div>';
    try {
      const r = await fetchMetarTaf(ids);
      $('#wxRes', el).innerHTML = r.map(metarHtml).join('');
    } catch (e) {
      $('#wxRes', el).innerHTML = note('bad', `Kunde inte hämta väder: ${esc(e.message)}<br>Tryck Inställn. › Felsökning › Testa väder för att se orsaken.`);
    }
  };
  const suggest = debounce(async () => {
    const v = q.value.trim();
    if (!v) { sug.classList.add('hidden'); return; }
    const list = await searchStations(v);
    const exact = /^[A-Z0-9]{4}$/i.test(v) && !list.some((s) => s.id === v.toUpperCase());
    sug.innerHTML = list.map((s) => `<li><button data-id="${esc(s.id)}"><b>${esc(s.id)}</b><span>${esc(s.name)}</span>${s.known === false ? '<small>METAR okänt</small>' : s.taf ? '<small>METAR + TAF</small>' : '<small>METAR</small>'}</button></li>`).join('')
      + (exact ? `<li><button data-id="${esc(v.toUpperCase())}"><b>${esc(v.toUpperCase())}</b><span>Lägg till ändå</span></button></li>` : '')
      || '<li class="muted" style="padding:10px 12px">Inga flygplatser med väderrapporter matchar.</li>';
    sug.classList.remove('hidden');
    sug.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => add(b.dataset.id));
  }, 150);
  q.addEventListener('input', suggest);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = sug.querySelector('[data-id]'); if (first) add(first.dataset.id); } });
  $('#wxRoute', el)?.addEventListener('click', () => { setWxIds([...wxIds(), ...routeIcaos()]); drawChips(); fetchWx(); });
  el._wxAdd = add;
  drawChips(); fetchWx();
  loadStationList(); // förladda stationsregistret
  if (route.wps.length >= 2) routeForecast($('#wxRoute2', el));
}
async function routeForecast(box) {
  const w = route.wps, dep = depDate();
  const legs = getLegs();
  const eta = legs.length ? legs[legs.length - 1].eta : dep;
  try {
    const [a, b] = await fetchForecast([w[0], w[w.length - 1]]);
    const row = (name, fc, t) => {
      const i = hourIndex(fc, t), s = surfaceWx(fc, i);
      const wa = windAt(fc, i, settings.cruiseAlt);
      const sun = sunInfo(t, fc.latitude, fc.longitude);
      return `<div class="metar" style="font-family:inherit;font-size:14px;white-space:normal"><div class="st"><span>${esc(name)}</span><span class="muted">${fmtUTC(t)}Z</span></div>
        <div class="kv"><span>Vind 10 m</span><b>${fmtDeg(s.wdir)}° / ${Math.round(s.wspd)} kt${s.gust > s.wspd + 5 ? ' (byar ' + Math.round(s.gust) + ')' : ''}</b>
        <span>Vind ${settings.cruiseAlt} ft</span><b>${fmtDeg(wa.dir)}° / ${Math.round(wa.spd)} kt</b>
        <span>Temp / dagg</span><b>${s.temp?.toFixed(0)}° / ${s.dew?.toFixed(0)}°</b>
        <span>Molnbas (uppsk.)</span><b>${s.baseFt != null ? '≈ ' + s.baseFt + ' ft AGL' : '—'}</b>
        <span>Låga moln</span><b>${s.low ?? '—'} %</b>
        <span>Sikt</span><b>${s.visKm != null ? (s.visKm >= 10 ? '≥ 10 km' : s.visKm.toFixed(1) + ' km') : '—'}</b>
        <span>Nederbörd</span><b>${s.precip ?? 0} mm/h</b>
        <span>QNH (≈)</span><b>${s.qnh != null ? Math.round(s.qnh) + ' hPa' : '—'}</b>
        <span>Nollgradersgräns</span><b>${s.frzFt != null ? Math.round(s.frzFt / 100) * 100 + ' ft' : '—'}</b>
        <span>Solnedgång</span><b>${fmtUTC(sun.sunset)}Z</b></div></div>`;
    };
    box.classList.remove('muted');
    box.innerHTML = row('Avgång: ' + w[0].name, a, dep) + row('Ankomst: ' + w[w.length - 1].name, b, eta) +
      '<div class="muted">Molnbas uppskattad med (T−Td)×400 ft. Modellprognos — ej ersättning för GAFOR/TAF.</div>';
  } catch (e) { box.textContent = 'Kunde inte hämta prognos: ' + e.message; }
}

// ---------- flik: inställningar ----------
function renderSettingsTab(el) {
  const s = settings, u = spdUnit();
  const num = (k, label, sub, step = 1, conv = (v) => v) => `<div class="field"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>
    <input type="number" inputmode="decimal" step="${step}" data-k="${k}" value="${+conv(s[k]).toFixed(1)}"></div>`;
  el.innerHTML = `
  <h3>Visning</h3>
  <div class="field"><span>Tema</span><select data-k="theme">
    <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Mörkt</option><option value="day" ${s.theme === 'day' ? 'selected' : ''}>Ljust (sol)</option>
    <option value="night" ${s.theme === 'night' ? 'selected' : ''}>Natt (rött)</option></select></div>
  <div class="field"><span>Fartenhet</span><select data-k="speedUnit"><option value="kt" ${s.speedUnit === 'kt' ? 'selected' : ''}>knop (kt)</option>
    <option value="kmh" ${s.speedUnit === 'kmh' ? 'selected' : ''}>km/h</option></select></div>

  <div class="field"><span>Terrängskuggning i vektorkarta</span><input type="checkbox" data-k="vectorHillshade" ${s.vectorHillshade ? 'checked' : ''}></div>

  <h3>Flygplan</h3>
  ${num('tas', `Marschfart TAS (${u})`, '', 1, spdOut)}
  ${num('fuelBurn', 'Förbrukning (l/h)', '', 0.5)}
  ${num('fuelUsable', 'Användbart bränsle (l)', '', 1)}
  ${num('taxiFuel', 'Taxi/start (l)', '', 0.5)}
  ${num('reserveMin', 'Reserv (min)', '', 5)}
  ${num('glideRatio', 'Glidtal 1:x', 'för glidräckviddsring', 0.5)}

  <h3>Planering</h3>
  ${num('cruiseAlt', 'Standardhöjd (ft MSL)', 'för nya brytpunkter', 100)}
  ${num('minClearance', 'Terrängmarginal (ft)', 'varning i profil/navlogg', 100)}
  ${num('variation', 'Magnetisk variation (°)', 'ost = +, väst = −. Hämta från aktuell karta/AIP', 0.5)}
  ${num('arrivalRadius', 'Ankomstradie (NM)', 'byt till nästa punkt', 0.1)}

  <h3>Datakällor</h3>
  <div class="field"><span>OpenAIP API-nyckel<small>Gratis på <a href="https://www.openaip.net" target="_blank" rel="noopener">openaip.net</a> › konto › API-klienter</small></span>
    <input type="password" data-k="openaipKey" value="${esc(s.openaipKey)}" autocomplete="off"></div>

  <div class="field"><span>OurAirports länder<small>ISO-koder, t.ex. SE,NO,DK,FI</small></span><input type="text" data-k="oaCountries" value="${esc(s.oaCountries)}"></div>
  <div class="field"><span>Ta med helikopterplatser</span><input type="checkbox" data-k="oaIncludeHeli" ${s.oaIncludeHeli ? 'checked' : ''}></div>
  <div class="btnrow"><button class="btn" id="oaReload">${ic('refresh')}Ladda om OurAirports</button></div>
  <div class="field"><span>CORS-proxy (valfri)<small>Adressen till din Cloudflare Worker, t.ex. https://ultranav-proxy.namn.workers.dev</small></span>
    <input type="url" data-k="corsProxy" value="${esc(s.corsProxy)}" placeholder="https://…workers.dev" autocapitalize="off"></div>
  <div class="btnrow"><button class="btn" id="tProxy">${ic('search')}Testa CORS-proxy</button></div><div id="tProxyRes"></div>

  <h3>Offline</h3>
  <div class="muted">Spara kartbilder (zoom 7–12, ±8 NM) och terräng längs aktuell rutt för vald baskarta och aktiva flygkartlager. Data för luftrum och flygfält sparas automatiskt när de visas.</div>
  <div class="btnrow"><button class="btn primary" id="offDl">${ic('download')}Spara rutten offline</button><button class="btn danger" id="offClr">${ic('trash')}Töm kartcache</button></div>
  <div id="offInfo" class="muted"></div>

  <details style="margin-top:12px"><summary class="btn" style="display:inline-flex;align-items:center">Avancerat: kart-URL:er</summary>
    ${Object.keys(DEFAULT_TILES).map((k) => `<div class="field" style="flex-direction:column;align-items:stretch"><span><small>${k}</small></span>
      <input type="url" data-tile="${k}" value="${esc(s.tiles[k])}" style="width:100%;font-size:13px"></div>`).join('')}
    <div class="btnrow"><button class="btn" id="tilesReset">Återställ standard</button></div>
  </details>

  <h3>Felsökning</h3>
  <div class="muted" id="oaipStat"></div>
  <div class="btnrow"><button class="btn" id="tOaip">${ic('search')}Testa OpenAIP</button><button class="btn" id="tBase">${ic('search')}Testa vald baskarta</button>
  <button class="btn" id="tWx">${ic('cloud')}Testa väder</button></div>
  <div id="tOaipRes"></div><div id="tBaseRes"></div><div id="tWxRes"></div>

  <h3>Om & licenser</h3>
  <div class="field"><span>Version<small>Uppdateras automatiskt när du är online</small></span><b>${APP_VERSION}</b></div>
  <div class="btnrow"><button class="btn" id="forceUpd">${ic('refresh')}Tvinga uppdatering</button></div>
  <div class="muted" style="line-height:1.5">
  Kartdata © OpenStreetMap-bidragsgivare (ODbL) · OpenFreeMap/OpenMapTiles · MapLibre GL (BSD-3) · OpenTopoMap (CC-BY-SA) · Esri World Imagery ·
  open flightmaps · OpenAIP (CC BY-NC 4.0) · OurAirports (public domain) · Open-Meteo (CC-BY 4.0) · NOAA/AWC aviationweather.gov ·
  RainViewer · AWS Terrain Tiles (SRTM, GMTED, ETOPO m.fl.) · Leaflet (BSD-2).<br><br>
  <b>Viktigt:</b> Appen är ett hjälpmedel för planering och lägesuppfattning. Den ersätter inte officiell AIP, ICAO-karta, NOTAM,
  briefing eller godkänd navigationsutrustning. Data från öppna källor kan vara ofullständiga eller inaktuella. Befälhavaren ansvarar alltid.</div>`;

  el.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.k;
    let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value.trim();
    if (k === 'tas') v = spdIn(v);
    saveSettings({ [k]: v });
    if (k === 'theme') applyTheme();
    if (k === 'openaipKey') { resetOpenAip(); map.fire('moveend'); }
    if (['tas', 'fuelBurn', 'variation', 'speedUnit', 'minClearance'].includes(k)) recompute();
    if (k === 'speedUnit') renderSettingsTab(el);
    updateInstruments();
  }));
  el.querySelectorAll('[data-tile]').forEach((inp) => inp.addEventListener('change', () => saveSettings({ tiles: { ...settings.tiles, [inp.dataset.tile]: inp.value.trim() } })));
  $('#tilesReset', el).onclick = () => { saveSettings({ tiles: { ...DEFAULT_TILES } }); renderSettingsTab(el); };
  $('#oaReload', el).onclick = () => loadOurAirports(true);
  const runTest = (btn, res, fn) => { $(btn, el).onclick = async () => {
    el.querySelectorAll('[data-k=openaipKey],[data-k=corsProxy]').forEach((i) => i.dispatchEvent(new Event('change'))); // spara ev. osparade fält först
    $(res, el).innerHTML = '<div class="muted">Testar…</div>'; $(res, el).innerHTML = await fn(); }; };
  runTest('#tOaip', '#tOaipRes', async () => { const r = await testOpenAip(); map.fire('moveend'); setTimeout(showStat, 4000); showStat(); return r; });
  runTest('#tBase', '#tBaseRes', testCurrentBase);
  runTest('#tProxy', '#tProxyRes', testProxy);
  runTest('#tWx', '#tWxRes', testWeather);
  const showStat = () => { const st = oaipStatus(); $('#oaipStat', el).textContent = settings.openaipKey
    ? `OpenAIP inläst: ${st.airspaces} luftrum, ${st.airports} flygfält, ${st.rp} rapportpunkter (${st.cells} områden). Hämtning: ${settings.openaipQuery === 'country' ? 'per land' : 'per område (' + settings.openaipQuery + ')'}.`
    : 'OpenAIP: ingen nyckel angiven.'; };
  showStat();
  $('#forceUpd', el).onclick = async () => {
    // Töm appens programcache (inte kartor eller dina data) och ladda om från servern
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ulnav-app')).map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    location.reload();
  };
  const showInfo = async () => { const i = await cacheInfo(); if (i) $('#offInfo', el).textContent = `${i.n} kartbilder i cache${i.usedMB != null ? ` · ${i.usedMB.toFixed(0)} MB använt av ${(i.quotaMB / 1000).toFixed(1)} GB` : ''}`; };
  showInfo();
  $('#offDl', el).onclick = async () => {
    const b = $('#offDl', el); b.disabled = true;
    await downloadRoute((d, n) => { b.textContent = `Sparar ${d}/${n}…`; });
    b.disabled = false; b.innerHTML = ic('download') + 'Spara rutten offline'; showInfo();
  };
  $('#offClr', el).onclick = async () => { if (confirm('Töm kartcachen?')) { await clearTiles(); showInfo(); } };
}

// ---------- storlek/orientering ----------
window.addEventListener('resize', debounce(() => { map.invalidateSize(); drawProfile(); }, 150));
new ResizeObserver(debounce(() => map.invalidateSize(), 100)).observe($('#mapwrap'));
window.addEventListener('online', () => toast('Online igen'));
window.addEventListener('offline', () => toast('Offline — använder sparade data', 4000));

// ---------- konto, synk och delning ----------
// Inställningarna synkas (utom tema, som är en preferens per enhet)
const syncableSettings = () => { const { theme, ...rest } = settings; return JSON.parse(JSON.stringify(rest)); };
let applyingRemote = false;
if (!lib.get('settings', 'settings')) lib.put('settings', { id: 'settings', name: 'Inställningar', data: syncableSettings() }, { source: 'meta', updated: 1 });
onSettings(() => { if (!applyingRemote) lib.put('settings', { id: 'settings', name: 'Inställningar', data: syncableSettings() }); });
lib.onLibrary((kind, source, item) => {
  if (kind === 'settings' && source === 'remote' && item.data) {
    applyingRemote = true;
    const { theme, ...rest } = item.data;
    try { saveSettings(rest); } finally { applyingRemote = false; }
    recompute(); updateInstruments();
  }
  if (source !== 'local' && !$('#side').classList.contains('hidden')) renderTab();
});
onCloud(() => { if (currentTab === 'account' && !$('#side').classList.contains('hidden')) renderTab(); });
initCloud({ onPasswordRecovery: () => askNewPassword() });

const KIND_SV = { route: 'rutten', drawing: 'ritningen', layer: 'kartlagret', flight: 'flygningen' };
window.ulnav.share = async (kind, id) => {
  if (!cloudConfigured()) { toast('Delning kräver att inloggning är konfigurerad'); return; }
  if (!cloudStatus().user) { toast('Logga in för att dela'); openTab('account'); return; }
  try {
    toast('Skapar delningslänk…', 2000);
    const link = await shareItem(kind, id);
    modal(`<h3>Dela ${KIND_SV[kind] || ''}</h3><div class="muted">Den som har länken kan öppna ${KIND_SV[kind] || 'objektet'} i Ultranav och spara en egen kopia.</div>
      <div class="field" style="flex-direction:column;align-items:stretch"><input type="url" readonly value="${esc(link)}" style="width:100%;font-size:14px" onclick="this.select()"></div>
      <div class="btnrow"><button class="btn primary" id="shCopy">${ic('share')}Kopiera länk</button>${navigator.share ? `<button class="btn" id="shNative">${ic('share')}Dela via…</button>` : ''}<button class="btn danger" id="shStop">Sluta dela</button></div>`);
    $('#shCopy').onclick = () => copyText(link);
    $('#shNative')?.addEventListener('click', () => navigator.share({ title: 'Ultranav', url: link }).catch(() => {}));
    $('#shStop').onclick = async () => { await unshareItem(kind, id); $('#modal').classList.add('hidden'); toast('Länken fungerar inte längre'); };
  } catch (e) { toast('Delning misslyckades: ' + e.message, 5000); }
};
function openTab(tab) {
  toggleSide(true);
  $$('.tabs button[data-tab]').find((b) => b.dataset.tab === tab)?.click();
}

// Öppna delat innehåll från länk (?share=kod)
(async () => {
  const code = new URLSearchParams(location.search).get('share');
  if (!code) return;
  history.replaceState(null, '', location.pathname);
  try {
    const it = await fetchShared(code);
    if (!it) { toast('Länken är ogiltig eller delningen har avslutats', 5000); return; }
    const what = { route: 'en rutt', drawing: 'en ritning', layer: 'kartmaterial', flight: 'en flygning' }[it.kind] || 'något';
    modal(`<h3>Delat med dig</h3><div>Någon har delat ${what}: <b>${esc(it.name)}</b></div>
      <div class="btnrow"><button class="btn primary" id="shImp">${ic('download')}Spara i min Ultranav</button></div>`);
    $('#shImp').onclick = async () => {
      const id = lib.newId();
      if (it.kind === 'route') { await lib.put('route', { id, name: it.name, data: it.data }); setRoute({ name: it.name, ...it.data }); fitRoute(); }
      else if (it.kind === 'drawing') { await lib.put('drawing', { id, name: it.name, data: it.data }); }
      else if (it.kind === 'layer') await addSharedLayer(it.name, it.data);
      else if (it.kind === 'flight') { await lib.put('flight', { id, name: it.name, data: it.data }); showFlight(id); }
      $('#modal').classList.add('hidden'); toast(`${it.name} är sparad`);
    };
  } catch (e) { toast('Kunde inte öppna delningen: ' + e.message, 5000); }
})();

// ---------- service worker ----------
export const APP_VERSION = '2026-10-15.1';
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache: 'none' → sw.js hämtas alltid färskt; leta efter uppdatering vid start och när appen visas igen
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  }).catch((e) => console.warn('SW', e));
  // När en ny version tagit över: ladda om en gång så att alla filer kommer från samma version
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller; // första besöket: ingen omladdning
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true; toast('Ny version installerad — laddar om…'); setTimeout(() => location.reload(), 600);
  });
}

// Första start: visa tips
if (!store.get('ulnav.welcomed', false)) {
  store.set('ulnav.welcomed', true);
  modal(`<h3>Välkommen till Ultranav</h3>
  <ol style="line-height:1.6;padding-left:20px">
   <li>Öppna <b>Meny › Inställningar</b> och ange din gratis <b>OpenAIP-nyckel</b> (luftrum, UL-fält, rapportpunkter), samt flygplanets fart och förbrukning.</li>
   <li>Tryck på <b>Rutt</b> och sedan på kartan för att lägga ut brytpunkter. Tryck nära ett fält för att fästa vid det.</li>
   <li>Navloggen med vindkorrektion, bränsle, solnedgång och luftrum längs rutten finns under <b>Meny › Rutt</b>. Terrängprofilen öppnas med <b>Profil</b>.</li>
   <li>Före start: <b>Spara rutten offline</b> under Inställningar. Lägg sedan till appen på hemskärmen via Safari › Dela › Lägg till på hemskärmen.</li>
   <li>I luften: <b>GPS</b>, sedan <b>Följ</b> och <b>Norr/Kurs</b> för norr upp eller kurs upp. <b>Närmast</b> visar närmaste fält för nödlandning.</li>
  </ol>
  ${note('warn', 'Hjälpmedel — ersätter inte officiell AIP, NOTAM eller briefing.')}`);
}
