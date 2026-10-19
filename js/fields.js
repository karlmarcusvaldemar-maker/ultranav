// Användarfält: små privata fält som piloter lägger till via Rita & mät. Fälten sparas i
// Supabase-tabellen "fields" och syns för alla inloggade Ultranav-användare. Bara den som
// lagt till ett fält (eller en administratör) kan ta bort det.
import { map, registerOverlay, showOverlay } from './map.js';
import { supa, cloudStatus, onCloud } from './cloud.js';
import { allAirports } from './airports.js';
import { actions, placeBtns, relPos } from './aero.js';
import { settings, fmtDist } from './settings.js';
import { esc, toast, modal, note, $, distNM, store, fmtLatLon } from './util.js';
import { ic } from './icons.js';

const NEAR_KM = 2;
const REFRESH_MS = 10 * 60 * 1000;
const layer = L.layerGroup();
let fields = store.get('ulnav.userfields', []); // senast hämtade, så att lagret fungerar offline
let on = false, loadedFor = null;

const isAdmin = () => cloudStatus().user?.app_metadata?.role === 'admin';
const mine = (f) => f.user_id === cloudStatus().user?.id;
const closeModal = () => $('#modal').classList.add('hidden');

export function initFields() {
  registerOverlay('userfields', 'Fält från Ultranav-piloter', '', (v) => { on = v; if (v) { layer.addTo(map); load(); } else map.removeLayer(layer); draw(); });
  map.on('zoomend', draw);
  onCloud(() => { const u = cloudStatus().user?.id || null; if (u !== loadedFor) load(); });
  setInterval(() => { if (on) load(); }, REFRESH_MS);
}

async function load() {
  const client = supa(), user = cloudStatus().user;
  if (!client || !user || !navigator.onLine) return;
  loadedFor = user.id;
  const { data, error } = await client.from('fields').select('id,user_id,name,lat,lon,rwy_len_m,contact,info,added_by,created_at').limit(5000);
  if (error) { console.warn('fields', error); return; }
  fields = data;
  store.set('ulnav.userfields', fields);
  draw();
}

// ---------- karta ----------
// Romben är liten men träffytan 44 × 44 px, så att den är lätt att träffa med fingret
const fIcon = L.divIcon({ className: 'ufield-ic', iconSize: [44, 44], iconAnchor: [22, 22], html: '<div class="ufield"></div>' });
const moveIcon = L.divIcon({ className: 'ufield-ic moving', iconSize: [56, 56], iconAnchor: [28, 28], html: '<div class="ufield"></div>' });
function draw() {
  layer.clearLayers();
  if (!on) return;
  const z = map.getZoom();
  if (z < 6) return;
  for (const f of fields) {
    if (moving?.f.id === f.id) continue; // visas som flyttbar markör medan den flyttas
    const m = L.marker([f.lat, f.lon], { icon: fIcon, bubblingMouseEvents: false, keyboard: false }).addTo(layer);
    if (z >= 10) m.bindTooltip(esc(f.name), { permanent: true, direction: 'right', className: 'ap-label uf-label', offset: [8, 0] });
    m.on('click', () => {
      if (actions.drawActive()) actions.drawTap({ lat: f.lat, lng: f.lon });
      else if (actions.editMode()) actions.addWaypoint({ lat: f.lat, lon: f.lon, name: f.name });
      else openField(f);
    });
  }
}

function openField(f) {
  const box = document.createElement('div');
  const date = f.created_at ? new Date(f.created_at).toLocaleDateString('sv-SE') : '';
  box.innerHTML = `<h4><span class="tag uf">Pilotfält</span>${esc(f.name)}</h4>
    <div>Banlängd <b>${f.rwy_len_m} m</b></div>
    <div>Kontakt: ${f.contact ? `<b>${esc(f.contact)}</b>` : '<span class="muted">okänd</span>'}</div>
    ${f.info ? `<div class="uf-info">${esc(f.info)}</div>` : ''}
    ${relPos(f)}
    <div class="muted" style="margin-top:4px">Tillagt av ${esc(f.added_by || 'en Ultranav-pilot')}${date ? ' · ' + date : ''}. Kontakta ägaren före landning.</div>
    ${placeBtns({ lat: f.lat, lon: f.lon, name: f.name })}
    <div class="ufc"><div class="ufc-head">Kommentarer</div><div class="ufc-list muted">Hämtar kommentarer…</div></div>
    ${mine(f) || isAdmin() ? `<div class="pbtns"><button class="sec uf-move">${ic('crosshair')}Flytta${mine(f) ? '' : ' (admin)'}</button>
      <button class="sec uf-del">${ic('trash')}${mine(f) ? 'Ta bort mitt fält' : 'Ta bort (admin)'}</button></div>` : ''}`;
  box.querySelector('.uf-move')?.addEventListener('click', () => startMove(f));
  box.querySelector('.uf-del')?.addEventListener('click', () => removeField(f));
  const popup = L.popup({ maxWidth: 340, autoPanPaddingTopLeft: [10, 10], autoPanPaddingBottomRight: [90, 10] }).setLatLng([f.lat, f.lon]).setContent(box).openOn(map);
  loadComments(f, box, popup);
}

// ---------- kommentarer ----------
// Andra piloter kan kommentera ett fält, t.ex. om banans skick ("träd över banan").
// Den som skrev, fältets ägare och administratören kan ta bort en kommentar.
const when = (t) => new Date(t).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
async function loadComments(f, box, popup) {
  const sec = box.querySelector('.ufc');
  if (!navigator.onLine || !supa()) { sec.querySelector('.ufc-list').textContent = 'Kommentarer visas när du är uppkopplad.'; return; }
  const { data, error } = await supa().from('field_comments').select('id,user_id,body,added_by,created_at').eq('field_id', f.id).order('created_at', { ascending: false }).limit(50);
  if (error) { sec.remove(); if (popup.isOpen()) popup.update(); return; } // tabellen saknas ännu: visa fältet utan kommentarer
  const me = cloudStatus().user?.id;
  const canDel = (c) => c.user_id === me || mine(f) || isAdmin();
  sec.innerHTML = `<div class="ufc-head">Kommentarer${data.length ? ` (${data.length})` : ''}</div>
    <div class="ufc-list">${data.length ? data.map((c) => `<div class="ufc-item"><div class="ufc-body">${esc(c.body)}</div>
      <div class="ufc-meta">${esc(c.added_by || 'Ultranav-pilot')} · ${when(c.created_at)}${canDel(c) ? ` <button class="ufc-del" data-id="${c.id}" aria-label="Ta bort kommentaren">${ic('trash', 14)}</button>` : ''}</div></div>`).join('')
      : '<div class="muted">Inga kommentarer ännu.</div>'}</div>
    <textarea class="ufc-in" maxlength="500" rows="2" placeholder="Skriv en kommentar, t.ex. om banans skick"></textarea>
    <div class="ufc-row"><span class="muted">Syns för alla Ultranav-piloter</span><button class="ufc-send">${ic('check', 16)}Skicka</button></div>`;
  L.DomEvent.disableClickPropagation(sec); L.DomEvent.disableScrollPropagation(sec);
  sec.querySelectorAll('.ufc-del').forEach((b) => b.onclick = async () => {
    if (!confirm('Ta bort kommentaren?')) return;
    const { error: e } = await supa().from('field_comments').delete().eq('id', b.dataset.id);
    if (e) { toast('Kunde inte ta bort: ' + e.message, 5000); return; }
    loadComments(f, box, popup);
  });
  sec.querySelector('.ufc-send').onclick = async (ev) => {
    const ta = sec.querySelector('.ufc-in'), body = ta.value.trim();
    if (!body) { ta.focus(); return; }
    ev.currentTarget.disabled = true;
    const { error: e } = await supa().from('field_comments').insert({ field_id: f.id, body, added_by: (settings.shareCallsign || '').slice(0, 12) || null });
    if (e) { ev.currentTarget.disabled = false; toast('Kunde inte skicka: ' + e.message, 5000); return; }
    toast('Kommentaren är skickad');
    loadComments(f, box, popup);
  };
  if (popup.isOpen()) popup.update();
}

async function removeField(f) {
  if (!confirm(`Ta bort fältet "${f.name}" för alla Ultranav-användare?`)) return;
  const { error } = await supa().from('fields').delete().eq('id', f.id);
  if (error) { toast('Kunde inte ta bort: ' + error.message, 5000); return; }
  map.closePopup();
  fields = fields.filter((x) => x.id !== f.id); store.set('ulnav.userfields', fields); draw();
  toast(`${f.name} är borttaget`);
}

/** Pilotfält inom px pixlar från en skärmpunkt (för tryck som missar romben) */
export function userFieldNear(latlng, px = 30) {
  if (!on || map.getZoom() < 6) return null;
  const pt = map.latLngToContainerPoint(latlng);
  let best = null, bd = px;
  for (const f of fields) {
    const d = pt.distanceTo(map.latLngToContainerPoint([f.lat, f.lon]));
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
export const openUserField = (f) => openField(f);

// ---------- flytta ----------
// Ägaren och administratören kan flytta ett fält: dra romben eller tryck på kartan, och spara.
let moving = null; // { f, m, bar }
export const fieldMoving = () => !!moving;
export function moveTap(latlng) { if (moving) { moving.m.setLatLng(latlng); moveInfo(); } }
function moveInfo() {
  const ll = moving.m.getLatLng(), d = distNM(moving.f, { lat: ll.lat, lon: ll.lng });
  $('#ufMoveInfo').textContent = d < 0.002 ? 'Dra romben dit fältet ligger, eller tryck på kartan.' : `Flyttas ${fmtDist(d, 2)} från nuvarande plats.`;
}
function startMove(f) {
  map.closePopup();
  stopMove();
  const m = L.marker([f.lat, f.lon], { icon: moveIcon, draggable: true, autoPan: true, zIndexOffset: 1000, keyboard: false }).addTo(map);
  const bar = document.createElement('div');
  bar.id = 'ufMoveBar';
  bar.innerHTML = `<div class="info"><b>Flytta ${esc(f.name)}</b><span id="ufMoveInfo"></span></div>
    <button class="btn" id="ufMoveCancel">Avbryt</button><button class="btn primary" id="ufMoveSave">${ic('check')}Spara</button>`;
  $('#mapwrap').appendChild(bar);
  L.DomEvent.disableClickPropagation(bar);
  moving = { f, m, bar };
  m.on('drag dragend', moveInfo);
  moveInfo(); draw();
  $('#ufMoveCancel').onclick = () => { stopMove(); draw(); };
  $('#ufMoveSave').onclick = async (e) => {
    const ll = m.getLatLng(), pos = { lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) };
    e.currentTarget.disabled = true;
    const { error } = await supa().from('fields').update(pos).eq('id', f.id);
    if (error) { e.currentTarget.disabled = false; toast('Kunde inte flytta: ' + error.message, 5000); return; }
    fields = fields.map((x) => (x.id === f.id ? { ...x, ...pos } : x)); store.set('ulnav.userfields', fields);
    stopMove(); draw();
    toast(`${f.name} är flyttat`);
  };
}
function stopMove() {
  if (!moving) return;
  map.removeLayer(moving.m); moving.bar.remove(); moving = null;
}

// ---------- lägg till ----------
/** Fält (officiella och pilotfält) inom 2 km från p, närmast först */
function nearby(p) {
  const all = [
    ...allAirports().map((a) => ({ name: a.icao ? `${a.name} (${a.icao})` : a.name, lat: a.lat, lon: a.lon })),
    ...fields.map((f) => ({ name: f.name, lat: f.lat, lon: f.lon })),
  ];
  return all.map((a) => ({ ...a, km: distNM(p, a) * 1.852 })).filter((a) => a.km < NEAR_KM).sort((a, b) => a.km - b.km);
}
const km = (v) => v.toFixed(1).replace('.', ',') + ' km';

/** Starta "lägg till fält" på en plats (från Rita & mät). onDone anropas när fältet sparats. */
export function addFieldAt(p, onDone) {
  if (!supa() || !cloudStatus().user) { toast('Logga in för att lägga till fält'); return; }
  if (!navigator.onLine) { toast('Du behöver vara uppkopplad för att dela ett fält'); return; }
  const near = nearby(p);
  if (!near.length) { formStep(p, {}, onDone); return; }
  const list = near.slice(0, 3).map((a) => `<b>${esc(a.name)}</b> — ${km(a.km)} härifrån`).join('<br>');
  modal(`<h3>Det finns redan ett fält i närheten</h3>
    ${note('warn', `${list}${near.length > 3 ? `<br>… och ${near.length - 3} till` : ''}`)}
    <p>Vill du verkligen lägga till ett nytt fält här?</p>
    <div class="btnrow"><button class="btn primary" id="ufNearYes">Ja, lägg till ändå</button><button class="btn" id="ufNearNo">Avbryt</button></div>`);
  $('#ufNearYes').onclick = () => formStep(p, {}, onDone);
  $('#ufNearNo').onclick = closeModal;
}

function formStep(p, v, onDone) {
  modal(`<h3>Lägg till fält</h3>
    <div class="muted">${ic('pin', 16)} ${fmtLatLon(p.lat, p.lon)}</div>
    <div class="field"><span>Namn på fältet</span><input type="text" id="ufName" maxlength="60" value="${esc(v.name || '')}" placeholder="t.ex. Norrbyns gärde"></div>
    <div class="field"><span>Banlängd<small>meter</small></span><input type="number" id="ufLen" min="50" max="5000" step="10" inputmode="numeric" value="${v.len || ''}"></div>
    <div class="field"><span>Kontaktperson<small>namn och telefon</small></span><input type="text" id="ufContact" maxlength="120" value="${esc(v.contact || '')}" ${v.unknown ? 'disabled' : ''}></div>
    <div class="field"><span>Kontaktperson okänd</span><input type="checkbox" id="ufUnknown" ${v.unknown ? 'checked' : ''}></div>
    <div class="field col"><span>Information<small>valfritt — underlag, hinder, inflygning, PPR…</small></span><textarea id="ufInfo" maxlength="1000" rows="3">${esc(v.info || '')}</textarea></div>
    <div id="ufErr"></div>
    <div class="btnrow"><button class="btn primary" id="ufNext">${ic('arrowRight')}Fortsätt</button><button class="btn" id="ufCancel">Avbryt</button></div>`);
  $('#ufUnknown').onchange = (e) => { $('#ufContact').disabled = e.target.checked; if (e.target.checked) $('#ufContact').value = ''; };
  $('#ufCancel').onclick = closeModal;
  $('#ufNext').onclick = () => {
    const val = { name: $('#ufName').value.trim(), len: Math.round(+$('#ufLen').value), contact: $('#ufContact').value.trim(),
      unknown: $('#ufUnknown').checked, info: $('#ufInfo').value.trim() };
    const err = !val.name ? ['#ufName', 'Skriv ett namn på fältet.']
      : !(val.len >= 50 && val.len <= 5000) ? ['#ufLen', 'Ange banlängden i meter (50–5000).']
      : !val.contact && !val.unknown ? ['#ufContact', 'Ange en kontaktperson, eller kryssa i att den är okänd.'] : null;
    if (err) { $('#ufErr').innerHTML = note('bad', err[1]); $(err[0]).focus(); return; }
    confirmStep(p, val, onDone);
  };
  $('#ufName').focus();
}

function confirmStep(p, v, onDone) {
  modal(`<h3>Lägga till och dela fältet publikt?</h3>
    <div class="ufsum"><b>${esc(v.name)}</b><br>Banlängd ${v.len} m · kontakt ${v.unknown ? 'okänd' : esc(v.contact)}${v.info ? `<br><span class="muted">${esc(v.info)}</span>` : ''}</div>
    ${note('warn', 'Fältet blir synligt för <b>alla som använder Ultranav</b>, med position, banlängd, kontaktperson och information. Ange bara kontaktuppgifter som personen har gått med på att dela.')}
    <div id="ufErr"></div>
    <div class="btnrow"><button class="btn primary" id="ufYes">${ic('share')}Ja, lägg till och dela</button><button class="btn" id="ufBack">Tillbaka</button></div>`);
  $('#ufBack').onclick = () => formStep(p, v, onDone);
  $('#ufYes').onclick = async (e) => {
    e.target.disabled = true;
    const row = { name: v.name, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), rwy_len_m: v.len, contact: v.unknown ? null : v.contact,
      info: v.info || null, added_by: (settings.shareCallsign || '').slice(0, 12) || null };
    const { data, error } = await supa().from('fields').insert(row).select().single();
    if (error) {
      e.target.disabled = false;
      $('#ufErr').innerHTML = note('bad', /relation|does not exist|schema cache/i.test(error.message)
        ? 'Fälttabellen finns inte i databasen ännu (administratören behöver köra supabase/schema.sql).' : 'Kunde inte spara: ' + esc(error.message));
      return;
    }
    closeModal();
    fields = [...fields, data]; store.set('ulnav.userfields', fields);
    showOverlay('userfields'); draw();
    toast(`${v.name} är tillagt och delat`);
    onDone?.();
  };
}
