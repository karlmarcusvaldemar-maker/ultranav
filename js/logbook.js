// Loggbok: sparade flygningar (sparas efter landning, se flight.js). Lagras i biblioteket och synkas med kontot.
import { map } from './map.js';
import * as lib from './library.js';
import { esc, fmtHM, fmtUTC, toast, download, FT_PER_M, modal, note, $ } from './util.js';
import { ic } from './icons.js';
import { settings, fmtDist, fmtAlt, spdOut, spdUnit } from './settings.js';

const trackLayer = L.layerGroup();
export function renderLogbook(el) {
  const flights = lib.list('flight').sort((a, b) => b.data.start - a.data.start);
  const totH = flights.filter((f) => !f.data.imported).reduce((s, f) => s + (f.data.durH || 0), 0); // delade flygningar från andra räknas inte
  el.innerHTML = `<h3>Loggbok</h3>
    <div class="btnrow"><button class="btn" id="lbAdd">${ic('plus')}Lägg till flygning</button></div>
    ${flights.length ? `<div class="kv" style="margin:4px 0 8px"><span>Flygningar</span><b>${flights.length}</b><span>Total flygtid</span><b>${fmtHM(totH)}</b></div>
    <ul class="aplist">${flights.map((f) => {
      const d = new Date(f.data.start);
      const hasTrack = !!f.data.track?.length;
      return `<li><div class="info"><b>${esc(f.name)}</b><span>${d.toLocaleDateString('sv-SE')} ${d.toTimeString().slice(0, 5)} · ${fmtHM(f.data.durH)}${f.data.aircraft ? ' · ' + esc(f.data.aircraft) : ''}${f.data.distNM ? ' · ' + fmtDist(f.data.distNM, 0) : ''}${f.data.maxAlt != null ? ` · max ${fmtAlt(f.data.maxAlt)}` : ''}${f.share ? ' · delad' : ''}${f.data.imported ? ' · från annan pilot' : ''}</span></div>
        ${hasTrack ? `<button class="btn small icon" data-show="${f.id}" aria-label="Visa på kartan">${ic('search')}</button>` : ''}
        <button class="btn small icon" data-more="${f.id}" aria-label="Mer">${ic('dots', 18)}</button></li>`;
    }).join('')}</ul>`
    : `<div class="empty">${ic('book', 34)}<b>Loggboken är tom</b><span>Flygningar sparas här efter landning.</span></div>`}`;
  $('#lbAdd', el).onclick = () => addManual(el);
  el.querySelectorAll('[data-show]').forEach((b) => b.onclick = () => showFlight(b.dataset.show));
  el.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => more(b.dataset.more, el));
}

let shownId = null;
export function showFlight(id) {
  const f = lib.get('flight', id); if (!f) return;
  if (!f.data.track?.length) { toast('Flygningen har inget spår'); return; }
  trackLayer.clearLayers(); trackLayer.addTo(map);
  if (shownId === id) { shownId = null; return; } // andra trycket döljer
  shownId = id;
  const ll = f.data.track.map(([lat, lon]) => [lat, lon]);
  L.polyline(ll, { pane: 'route', color: '#1c7ed6', weight: 4, interactive: false }).addTo(trackLayer);
  L.circleMarker(ll[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2f9e44', fillOpacity: 1 }).bindTooltip('Start').addTo(trackLayer);
  L.circleMarker(ll[ll.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#e03131', fillOpacity: 1 }).bindTooltip('Landning').addTo(trackLayer);
  map.fitBounds(ll, { padding: [60, 100] });
  toast(`${f.name} visas på kartan`);
}

function toGPX(f) {
  const pts = f.data.track.map(([lat, lon, alt, t]) => `      <trkpt lat="${lat}" lon="${lon}">${alt != null ? `<ele>${(alt / FT_PER_M).toFixed(1)}</ele>` : ''}${t ? `<time>${new Date(t).toISOString()}</time>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Ultranav" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${esc(f.name)}</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>\n`;
}

const tUL = (t) => t ? `${fmtUTC(new Date(t))}Z (${new Date(t).toTimeString().slice(0, 5)})` : null;
function rows(d) {
  const r = [['Datum', new Date(d.start).toLocaleDateString('sv-SE')], ['Från – till', d.from && d.to ? `${esc(d.from)} – ${esc(d.to)}` : null],
    ['Flygplan', d.aircraft ? esc(d.aircraft) : null],
    ['Start', tUL(d.takeoff)], ['Landning', tUL(d.landing)], ['Flygtid', fmtHM(d.durH)], ['Total tid', d.blockH != null ? fmtHM(d.blockH) : null],
    ['Sträcka', d.distNM ? fmtDist(d.distNM) : null], ['Max höjd', d.maxAlt != null ? fmtAlt(d.maxAlt) : null],
    ['Fart', d.maxGs ? `${d.avgGs ? `snitt ${Math.round(spdOut(d.avgGs))} · ` : ''}max ${Math.round(spdOut(d.maxGs))} ${spdUnit()}` : null],
    ['Bränsle', Number.isFinite(+d.fuelUsed) && d.fuelUsed != null ? `≈ ${(+d.fuelUsed).toFixed(1)} l förbrukat${+d.fuelStart ? ` · ≈ ${(d.fuelStart - d.fuelUsed).toFixed(1)} l kvar` : ''}` : null],
    ['Landningar', Number.isFinite(+d.landings) && d.landings != null ? Math.round(+d.landings) : null]];
  return r.filter(([, v]) => v != null).map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
}

function more(id, el) {
  const f = lib.get('flight', id); if (!f) return;
  modal(`<h3>${esc(f.name)}</h3>
    <div class="kv">${rows(f.data)}</div>
    <div class="field" style="flex-direction:column;align-items:stretch;margin-top:8px"><span>Anteckning</span><textarea id="lbNote" rows="3" style="width:100%;font-size:16px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg);color:var(--text);padding:8px">${esc(f.data.note || '')}</textarea></div>
    <div class="btnrow">
      ${f.data.track?.length ? `<button class="btn" id="lbGpx">${ic('download')}Exportera GPX</button>` : ''}
      <button class="btn" id="lbShare">${ic('share')}Dela</button>
      <button class="btn" id="lbRename">${ic('edit')}Byt namn</button>
      <button class="btn danger" id="lbDel">${ic('trash')}Ta bort</button>
    </div>`);
  const close = () => { $('#modal').classList.add('hidden'); renderLogbook(el); };
  $('#lbNote').onchange = (e) => lib.put('flight', { ...f, data: { ...f.data, note: e.target.value } });
  if ($('#lbGpx')) $('#lbGpx').onclick = () => download(`${f.name.replace(/[^\wåäöÅÄÖ-]+/g, '_')}.gpx`, toGPX(f));
  $('#lbShare').onclick = () => { $('#modal').classList.add('hidden'); window.ulnav.share('flight', id); };
  $('#lbRename').onclick = () => { const v = prompt('Nytt namn:', f.name); if (v) { lib.put('flight', { ...f, name: v }); close(); } };
  $('#lbDel').onclick = () => { if (confirm(`Ta bort "${f.name}" ur loggboken?`)) { lib.remove('flight', id); trackLayer.clearLayers(); close(); } };
}

// ---------- lägg till flygning för hand (t.ex. om loggningen glömdes) ----------
function addManual(el) {
  const today = new Date(), iso = new Date(today - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  modal(`<h3>Lägg till flygning</h3>
    <div class="field"><span>Datum</span><input type="date" id="mfDate" value="${iso}"></div>
    <div class="field"><span>Från</span><input type="text" id="mfFrom" maxlength="40" placeholder="t.ex. ESUS"></div>
    <div class="field"><span>Till</span><input type="text" id="mfTo" maxlength="40" placeholder="t.ex. ESUS"></div>
    <div class="field"><span>Start<small>lokal tid</small></span><input type="time" id="mfOff"></div>
    <div class="field"><span>Landning<small>lokal tid</small></span><input type="time" id="mfOn"></div>
    <div class="field"><span>Flygplan</span><input type="text" id="mfAc" maxlength="12" autocapitalize="characters" value="${esc(settings.aircraftReg || '')}"></div>
    <div class="field"><span>Antal landningar</span><input type="number" id="mfLdg" inputmode="numeric" min="0" step="1" value="1"></div>
    <div class="field col"><span>Anteckning</span><textarea id="mfNote" rows="2"></textarea></div>
    <div id="mfErr"></div>
    <div class="btnrow"><button class="btn primary" id="mfSave">${ic('book')}Spara i loggboken</button><button class="btn" id="mfCancel">Avbryt</button></div>`);
  $('#mfCancel').onclick = () => $('#modal').classList.add('hidden');
  $('#mfSave').onclick = async () => {
    const date = $('#mfDate').value, off = $('#mfOff').value, on = $('#mfOn').value;
    const from = $('#mfFrom').value.trim(), to = $('#mfTo').value.trim() || from;
    if (!date || !off || !on || !from) { $('#mfErr').innerHTML = note('bad', 'Fyll i datum, från, start och landning.'); return; }
    const t0 = new Date(`${date}T${off}`).getTime();
    let t1 = new Date(`${date}T${on}`).getTime();
    if (t1 <= t0) t1 += 86400e3; // landning efter midnatt
    const durH = (t1 - t0) / 3600e3;
    await lib.put('flight', { id: lib.newId(), name: `${from} – ${to}`, data: {
      start: t0, end: t1, takeoff: t0, landing: t1, durH, blockH: durH, from, to, aircraft: $('#mfAc').value.trim().toUpperCase(),
      landings: Math.max(0, Math.round(+$('#mfLdg').value || 0)), note: $('#mfNote').value.trim(), manual: true, track: [] } });
    $('#modal').classList.add('hidden'); toast('Flygningen är sparad i loggboken'); renderLogbook(el);
  };
}
