// Loggbok: sparade flygningar (från spårloggen). Lagras i biblioteket och synkas med kontot.
import { map } from './map.js';
import * as lib from './library.js';
import { nav, logStats } from './nav.js';
import { nearestAirports } from './airports.js';
import { esc, fmtHM, toast, download, FT_PER_M, modal, $ } from './util.js';
import { ic } from './icons.js';

const trackLayer = L.layerGroup();
const fieldName = (p) => { const n = nearestAirports(p, 1)[0]; return n && n.d < 3 ? (n.a.icao || n.a.name) : `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`; };

/** Spara aktuell spårlogg som en flygning */
export async function saveFlightFromLog() {
  const log = nav.log, s = logStats();
  if (!s || log.length < 2) { toast('Spårloggen är tom — starta GPS och flyg först'); return null; }
  const step = Math.max(1, Math.ceil(log.length / 3000)); // högst ≈ 3000 punkter
  const track = log.filter((_, i) => i % step === 0 || i === log.length - 1).map((p) => [p.lat, p.lon, p.alt, p.t]);
  const from = fieldName(log[0]), to = fieldName(log[log.length - 1]);
  const item = await lib.put('flight', { id: lib.newId(), name: `${from} – ${to}`, data: {
    start: log[0].t, end: log[log.length - 1].t, durH: s.h, distNM: s.d, maxAlt: s.maxAlt, maxGs: s.maxGs, from, to, note: '', track } });
  toast('Flygningen är sparad i loggboken');
  return item;
}

export function renderLogbook(el) {
  const flights = lib.list('flight').sort((a, b) => b.data.start - a.data.start);
  const totH = flights.reduce((s, f) => s + (f.data.durH || 0), 0);
  el.innerHTML = `<h3>Loggbok</h3>
    <div class="btnrow"><button class="btn primary" id="lbSave">${ic('book')}Spara spårloggen som flygning</button></div>
    ${flights.length ? `<div class="kv" style="margin:4px 0 8px"><span>Flygningar</span><b>${flights.length}</b><span>Total tid</span><b>${fmtHM(totH)}</b></div>
    <ul class="aplist">${flights.map((f) => {
      const d = new Date(f.data.start);
      return `<li><div class="info"><b>${esc(f.name)}</b><span>${d.toLocaleDateString('sv-SE')} ${d.toTimeString().slice(0, 5)} · ${fmtHM(f.data.durH)} · ${(f.data.distNM || 0).toFixed(0)} NM${f.data.maxAlt != null ? ` · max ${f.data.maxAlt} ft` : ''}${f.share ? ' · delad' : ''}</span></div>
        <button class="btn small icon" data-show="${f.id}" aria-label="Visa på kartan">${ic('search')}</button>
        <button class="btn small icon" data-more="${f.id}" aria-label="Mer">${ic('dots', 18)}</button></li>`;
    }).join('')}</ul>`
    : `<div class="empty">${ic('book', 34)}<b>Loggboken är tom</b><span>Starta GPS före flygningen. Efter landning trycker du på knappen ovan för att spara flygningen här.</span></div>`}`;
  $('#lbSave', el).onclick = async () => { if (await saveFlightFromLog()) renderLogbook(el); };
  el.querySelectorAll('[data-show]').forEach((b) => b.onclick = () => showFlight(b.dataset.show));
  el.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => more(b.dataset.more, el));
}

let shownId = null;
export function showFlight(id) {
  const f = lib.get('flight', id); if (!f) return;
  trackLayer.clearLayers(); trackLayer.addTo(map);
  if (shownId === id) { shownId = null; return; } // andra trycket döljer
  shownId = id;
  const ll = f.data.track.map(([lat, lon]) => [lat, lon]);
  L.polyline(ll, { pane: 'route', color: '#1c7ed6', weight: 4, interactive: false }).addTo(trackLayer);
  L.circleMarker(ll[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2f9e44', fillOpacity: 1 }).bindTooltip('Start').addTo(trackLayer);
  L.circleMarker(ll[ll.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#e03131', fillOpacity: 1 }).bindTooltip('Landning').addTo(trackLayer);
  map.fitBounds(ll, { padding: [60, 100] });
  toast(`${f.name} visas på kartan — tryck på flygningen igen för att dölja`);
}

function toGPX(f) {
  const pts = f.data.track.map(([lat, lon, alt, t]) => `      <trkpt lat="${lat}" lon="${lon}">${alt != null ? `<ele>${(alt / FT_PER_M).toFixed(1)}</ele>` : ''}${t ? `<time>${new Date(t).toISOString()}</time>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Ultranav" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${esc(f.name)}</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>\n`;
}

function more(id, el) {
  const f = lib.get('flight', id); if (!f) return;
  modal(`<h3>${esc(f.name)}</h3>
    <div class="kv"><span>Datum</span><b>${new Date(f.data.start).toLocaleString('sv-SE')}</b><span>Tid</span><b>${fmtHM(f.data.durH)}</b>
      <span>Sträcka</span><b>${(f.data.distNM || 0).toFixed(1)} NM</b><span>Max höjd</span><b>${f.data.maxAlt != null ? f.data.maxAlt + ' ft' : '—'}</b></div>
    <div class="field" style="flex-direction:column;align-items:stretch;margin-top:8px"><span>Anteckning</span><textarea id="lbNote" rows="3" style="width:100%;font-size:16px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg);color:var(--text);padding:8px">${esc(f.data.note || '')}</textarea></div>
    <div class="btnrow">
      <button class="btn" id="lbGpx">${ic('download')}Exportera GPX</button>
      <button class="btn" id="lbShare">${ic('share')}Dela</button>
      <button class="btn" id="lbRename">${ic('edit')}Byt namn</button>
      <button class="btn danger" id="lbDel">${ic('trash')}Ta bort</button>
    </div>`);
  const close = () => { $('#modal').classList.add('hidden'); renderLogbook(el); };
  $('#lbNote').onchange = (e) => lib.put('flight', { ...f, data: { ...f.data, note: e.target.value } });
  $('#lbGpx').onclick = () => download(`${f.name.replace(/[^\wåäöÅÄÖ-]+/g, '_')}.gpx`, toGPX(f));
  $('#lbShare').onclick = () => { $('#modal').classList.add('hidden'); window.ulnav.share('flight', id); };
  $('#lbRename').onclick = () => { const v = prompt('Nytt namn:', f.name); if (v) { lib.put('flight', { ...f, name: v }); close(); } };
  $('#lbDel').onclick = () => { if (confirm(`Ta bort "${f.name}" ur loggboken?`)) { lib.remove('flight', id); trackLayer.clearLayers(); close(); } };
}
