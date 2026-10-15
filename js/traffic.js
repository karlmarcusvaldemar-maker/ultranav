// Trafik: se andra Ultranav-piloter i realtid (Supabase Realtime, privat kanal för inloggade).
// Positionsdelning är frivillig och avstängd som standard. Positioner skickas direkt mellan
// användarna och sparas inte. Simulerade flygningar delas aldrig.
import { map, registerOverlay } from './map.js';
import { settings, saveSettings } from './settings.js';
import { supa, onCloud, cloudStatus } from './cloud.js';
import { nav, onNav } from './nav.js';
import { esc, toast, modal, $, distNM, bearing, fmtDeg } from './util.js';
import { ic } from './icons.js';

const SEND_MS = 5000, STALE_MS = 25000, DROP_MS = 90000;
const others = new Map();   // id → senaste position
const markers = new Map();  // id → Leaflet-markör
let channel = null, subscribed = false, viewOn = false, lastSent = 0, joinedAs = null;
const stat = { status: 'ej ansluten', err: '', sent: 0, recv: 0 }; // för statusraden i dialogen
const layer = L.layerGroup();
const listeners = new Set();
export const onTraffic = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

/** Delar jag position just nu (inställningen på, GPS på, inte simulering)? */
export const sharingWanted = () => !!settings.shareTraffic;
export const sharingActive = () => sharingWanted() && nav.tracking && !nav.simulating && !!nav.pos && subscribed;

export function initTraffic() {
  registerOverlay('traffic', 'Andra Ultranav-piloter', '', (v) => { viewOn = v; if (v) layer.addTo(map); else map.removeLayer(layer); ensureChannel(); draw(); });
  onCloud(() => ensureChannel());
  onNav(() => { maybeSend(); renderChip(); });
  setInterval(() => { prune(); draw(); renderChip(); }, 5000);
  ensureChannel();
  renderChip();
}

// ---------- kanal ----------
async function ensureChannel() {
  const client = supa(), user = cloudStatus().user;
  const need = !!(client && user && (viewOn || sharingWanted()));
  if (need && joinedAs !== user.id) {
    leave();
    joinedAs = user.id;
    stat.status = 'ansluter'; stat.err = '';
    // Privata kanaler kräver inloggningsbeviset i realtidsanslutningen
    try { const { data } = await client.auth.getSession(); if (data.session) await client.realtime.setAuth(data.session.access_token); }
    catch (e) { stat.err = 'setAuth: ' + (e?.message || e); }
    if (joinedAs !== user.id) return;
    channel = client.channel('traffic', { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'pos' }, ({ payload: p }) => {
        if (!p || p.id === user.id || typeof p.lat !== 'number') return;
        stat.recv++;
        others.set(p.id, { ...p, rx: Date.now() });
        draw(); emit();
      })
      .on('broadcast', { event: 'bye' }, ({ payload: p }) => { if (p?.id) { others.delete(p.id); draw(); emit(); } })
      .subscribe((status, err) => {
        subscribed = status === 'SUBSCRIBED';
        stat.status = { SUBSCRIBED: 'ansluten', CHANNEL_ERROR: 'fel', TIMED_OUT: 'tidsgräns', CLOSED: 'stängd' }[status] || status;
        if (err) stat.err = err.message || String(err);
        if (status === 'CHANNEL_ERROR') toast('Trafik: kunde inte ansluta (är realtidsreglerna installerade? se README)', 6000);
        if (subscribed) { lastSent = 0; maybeSend(); }
        renderChip();
      });
  } else if (!need && channel) leave();
}
function leave() {
  if (channel) { try { channel.send({ type: 'broadcast', event: 'bye', payload: { id: joinedAs } }); } catch { /* ignorera */ } supa()?.removeChannel(channel); }
  channel = null; joinedAs = null; subscribed = false; stat.status = 'ej ansluten';
}

function maybeSend() {
  if (!sharingActive()) return;
  const now = Date.now();
  if (now - lastSent < SEND_MS) return;
  lastSent = now;
  const p = nav.pos;
  stat.sent++;
  channel.send({ type: 'broadcast', event: 'pos', payload: {
    id: joinedAs, call: (settings.shareCallsign || '').slice(0, 12), lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5),
    alt: p.altFt != null ? Math.round(p.altFt) : null, gs: p.gsKt != null ? Math.round(p.gsKt) : null,
    trk: p.trk != null ? Math.round(p.trk) : null, t: now,
  } });
}

function prune() {
  const now = Date.now();
  for (const [id, o] of others) if (now - o.rx > DROP_MS) others.delete(id);
}

// ---------- ritning ----------
const planeSvg = (trk, stale) => `<svg width="34" height="34" viewBox="-17 -17 34 34" style="transform:rotate(${trk ?? 0}deg);opacity:${stale ? 0.45 : 1}">
  <path d="M0 -13 L2.2 -4 L12 1 L12 3.5 L2.2 1.5 L1.6 9 L5 11.5 L5 13 L0 12 L-5 13 L-5 11.5 L-1.6 9 L-2.2 1.5 L-12 3.5 L-12 1 L-2.2 -4 Z" fill="#e8590c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
function label(o) {
  const own = nav.pos?.altFt, d = o.alt != null && own != null ? Math.round((o.alt - own) / 100) * 100 : null;
  return `${esc(o.call || 'Okänd')}${d != null ? ` ${d >= 0 ? '+' : '−'}${Math.abs(d)} ft${d > 0 ? ' ↑' : d < 0 ? ' ↓' : ''}` : o.alt != null ? ` ${o.alt} ft` : ''}`;
}
function draw() {
  if (!viewOn) { layer.clearLayers(); markers.clear(); return; }
  const now = Date.now();
  for (const [id, m] of markers) if (!others.has(id)) { layer.removeLayer(m); markers.delete(id); }
  for (const [id, o] of others) {
    const stale = now - o.rx > STALE_MS;
    const icon = L.divIcon({ className: 'traffic-ic', iconSize: [34, 34], iconAnchor: [17, 17], html: planeSvg(o.trk, stale) });
    let m = markers.get(id);
    if (!m) {
      m = L.marker([o.lat, o.lon], { icon, pane: 'own', bubblingMouseEvents: false }).addTo(layer);
      m.bindTooltip('', { permanent: true, direction: 'right', offset: [14, 0], className: 'ap-label traffic-label' });
      m.on('click', () => popup(id));
      markers.set(id, m);
    } else { m.setLatLng([o.lat, o.lon]); m.setIcon(icon); }
    m.setTooltipContent(label(o) + (stale ? ' · ' + Math.round((now - o.rx) / 1000) + ' s' : ''));
  }
}
function popup(id) {
  const o = others.get(id); if (!o) return;
  const own = nav.pos, age = Math.round((Date.now() - o.rx) / 1000);
  L.popup().setLatLng([o.lat, o.lon]).setContent(`<h4 class="popinfo">${ic('plane', 18)} ${esc(o.call || 'Okänd pilot')}</h4>
    <div>${o.alt != null ? `${o.alt} ft MSL` : 'höjd okänd'}${o.gs != null ? ` · ${o.gs} kt` : ''}${o.trk != null ? ` · ${fmtDeg(o.trk)}°T` : ''}</div>
    ${own ? `<div>${distNM(own, o).toFixed(1)} NM · ${fmtDeg(bearing(own, o) - settings.variation)}°M från dig</div>` : ''}
    <div class="muted">Uppdaterad för ${age} s sedan · Ultranav-pilot som delar sin position</div>`).openOn(map);
}

// ---------- tydlig status och val ----------
function renderChip() {
  let el = document.getElementById('shareChip');
  if (!el) {
    el = document.createElement('button');
    el.id = 'shareChip'; el.type = 'button';
    el.onclick = openShareDialog;
    document.getElementById('map').parentElement.appendChild(el);
  }
  const user = cloudStatus().user;
  // Visas när GPS är på eller när delning är vald, så att läget alltid syns när det spelar roll
  const show = !!user && (nav.tracking || sharingWanted());
  el.hidden = !show;
  if (!show) return;
  const active = sharingActive();
  el.className = active ? 'on' : sharingWanted() ? 'wait' : '';
  el.innerHTML = active ? `<span class="dot"></span>Delar position${settings.shareCallsign ? ' · ' + esc(settings.shareCallsign) : ''}`
    : !sharingWanted() ? `${ic('eyeOff', 16)}Delar inte position`
    : nav.simulating ? `${ic('eyeOff', 16)}Simulering — delas inte`
    : !nav.tracking || !nav.pos ? `${ic('gps', 16)}Delning på — väntar på GPS`
    : stat.status === 'fel' || stat.status === 'tidsgräns' ? `${ic('alert', 16)}Delning på — kunde inte ansluta`
    : `${ic('sync', 16)}Delning på — ansluter…`;
}

export function openShareDialog() {
  const user = cloudStatus().user;
  if (!user) { toast('Logga in för att dela position'); return; }
  const on = sharingWanted();
  modal(`<h3>Dela min position</h3>
    <p>När delning är på och GPS:en är igång skickas din position var femte sekund till <b>andra inloggade Ultranav-piloter</b>, som ser dig på kartan med anropssignal, höjd, fart och riktning.</p>
    <ul class="benefits">
      <li>${ic('check', 18)}<span>Delas bara medan GPS:en är på och appen är öppen. Låser du skärmen slutar delningen.</span></li>
      <li>${ic('check', 18)}<span>Positionerna sparas inte — de skickas direkt och försvinner.</span></li>
      <li>${ic('check', 18)}<span>Simulerade flygningar delas aldrig.</span></li>
      <li>${ic('check', 18)}<span>Du kan stänga av när som helst.</span></li>
    </ul>
    <div class="field"><span>Anropssignal eller registrering<small>Visas för andra, t.ex. SE-VXA</small></span>
      <input type="text" id="shCall" maxlength="12" autocapitalize="characters" value="${esc(settings.shareCallsign || '')}"></div>
    <div class="muted">Hjälpmedel för lägesuppfattning — inte ett antikollisionssystem. Bara piloter som själva delar syns.</div>
    <div class="muted small" style="text-align:left;margin-top:6px">Status: ${esc(stat.status)} · skickade ${stat.sent} · mottagna ${stat.recv} · piloter på kartan ${others.size}${stat.err ? ' · fel: ' + esc(stat.err) : ''}${viewOn ? '' : ' · lagret Andra Ultranav-piloter är av'}</div>
    <div class="btnrow">${on
      ? `<button class="btn danger" id="shOff">${ic('close')}Sluta dela min position</button><button class="btn" id="shSave">${ic('check')}Spara</button>`
      : `<button class="btn primary" id="shOn">${ic('gps')}Ja, dela min position</button>`}</div>`);
  const call = () => $('#shCall').value.trim().toUpperCase();
  $('#shOn')?.addEventListener('click', () => {
    if (!call()) { $('#shCall').focus(); toast('Ange anropssignal eller registrering'); return; }
    saveSettings({ shareTraffic: true, shareCallsign: call() }); done('Positionsdelning på');
  });
  $('#shSave')?.addEventListener('click', () => { saveSettings({ shareCallsign: call() }); done('Sparat'); });
  $('#shOff')?.addEventListener('click', () => { saveSettings({ shareTraffic: false }); leave(); done('Positionsdelning av'); });
  function done(msg) { $('#modal').classList.add('hidden'); lastSent = 0; ensureChannel(); maybeSend(); renderChip(); toast(msg); }
}
