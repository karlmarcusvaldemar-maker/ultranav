// Vindruta på kartan: prognosvind (Open-Meteo) på din höjd där du är — eller på standardhöjden vid kartans mitt utan GPS.
// Pilen visar vart vinden blåser och vrids med kartan. Under flygning visas mot- eller medvind längs din kurs.
import { settings, spdOut, spdUnit, fmtAlt } from './settings.js';
import { map, registerOverlay } from './map.js';
import { nav, onNav } from './nav.js';
import { fetchForecast, hourIndex, windAt, surfaceWx } from './wx.js';
import { distNM, fmtDeg, fmtUTC, fmtLocal, idb, modal, note, debounce } from './util.js';

let on = false, el = null, data = null, busy = false; // data: { fc, at, lat, lon }
const REFRESH_MS = 60 * 60 * 1000, MOVE_NM = 25;

export async function initWindBadge() {
  data = (await idb.get('wind:fc').catch(() => null)) || null;
  registerOverlay('windarrow', 'Vind (prognos)', '', (v) => { on = v; render(); if (v) refresh(); });
  onNav(() => { render(); refresh(); });
  map.on('rotate', render);
  map.on('moveend', debounce(() => { if (!nav.tracking) { render(); refresh(); } }, 1500));
  window.addEventListener('online', refresh);
  setInterval(() => { render(); refresh(); }, 60000);
}

const here = () => {
  if (nav.tracking && nav.pos) return { lat: nav.pos.lat, lon: nav.pos.lon, gps: true };
  const c = map.getCenter(); return { lat: c.lat, lon: c.lng, gps: false };
};

async function refresh() {
  if (!on || busy || !navigator.onLine) return;
  const p = here();
  if (data && Date.now() - data.at < REFRESH_MS && distNM(p, data) < MOVE_NM) return;
  busy = true;
  try {
    const [fc] = await fetchForecast([p]);
    if (fc?.hourly) { data = { fc, at: Date.now(), lat: p.lat, lon: p.lon }; idb.set('wind:fc', data); render(); }
  } catch { /* försök igen vid nästa uppdatering */ }
  finally { busy = false; }
}

function wind() {
  if (!data) return null;
  const i = hourIndex(data.fc, new Date());
  const gps = nav.tracking && nav.pos;
  const altFt = gps && nav.pos.altFt != null ? nav.pos.altFt : settings.cruiseAlt;
  const w = windAt(data.fc, i, altFt);
  if (w.dir == null || w.spd == null) return null;
  let comp = null;
  if (gps && nav.pos.trk != null && nav.pos.gsKt > 20) comp = w.spd * Math.cos((w.dir - nav.pos.trk) * Math.PI / 180);
  return { ...w, altFt, i, comp };
}

// Under rutan för positionsdelning, som skapas senare och byter höjd med sin text
let watched = null;
function place() {
  const chip = document.getElementById('shareChip');
  if (chip && chip !== watched && window.ResizeObserver) { watched = chip; new ResizeObserver(place).observe(chip); }
  if (!chip) setTimeout(place, 1000);
  if (el) el.style.top = chip && !chip.hidden ? `${chip.offsetTop + chip.offsetHeight + 10}px` : '12px';
}

function render() {
  if (!el) {
    el = document.createElement('button');
    el.id = 'windBadge'; el.type = 'button';
    el.onclick = details;
    document.getElementById('map').parentElement.appendChild(el);
  }
  el.hidden = !on;
  if (!on) return;
  place();
  const w = wind();
  if (!w) {
    el.className = 'empty';
    el.innerHTML = `<span class="wbDial"></span><span class="wbTxt"><small>VIND</small><b>—</b></span>`;
    el.setAttribute('aria-label', 'Vind: ingen prognos ännu');
    return;
  }
  const mb = map.getBearing ? map.getBearing() : 0;
  const spd = `${Math.round(spdOut(w.spd))} ${spdUnit()}`;
  const comp = w.comp == null || Math.abs(w.comp) < 1 ? ''
    : `<em class="${w.comp > 0 ? 'head' : 'tail'}">${w.comp > 0 ? 'Motvind' : 'Medvind'} ${Math.round(spdOut(Math.abs(w.comp)))} ${spdUnit()}</em>`;
  el.className = '';
  el.innerHTML = `<span class="wbDial"><svg viewBox="0 0 24 24" width="30" height="30" style="transform:rotate(${(w.dir + 180 + mb).toFixed(1)}deg)" aria-hidden="true">
    <path d="M12 3l5 8h-3.2v10h-3.6V11H7z" fill="currentColor"/></svg></span>
    <span class="wbTxt"><small>VIND ${fmtAlt(w.altFt, true)}</small><b>${fmtDeg(w.dir)}° · ${spd}</b>${comp}</span>`;
  el.setAttribute('aria-label', `Vind från ${fmtDeg(w.dir)} grader, ${spd}`);
}

function details() {
  const w = wind();
  if (!w) {
    modal(`<h3>Vind (prognos)</h3><p class="muted">${navigator.onLine ? 'Hämtar vindprognos…' : 'Ingen vindprognos ännu. Den hämtas automatiskt när du har nät.'}</p>`);
    refresh(); return;
  }
  const s = surfaceWx(data.fc, w.i);
  const t = new Date(data.fc.hourly.time[w.i] + 'Z');
  const gps = nav.tracking && nav.pos;
  modal(`<h3>Vind (prognos)</h3>
    <div class="kv">
      <span>På ${fmtAlt(w.altFt, true)}</span><b>${fmtDeg(w.dir)}° / ${Math.round(spdOut(w.spd))} ${spdUnit()}</b>
      <span>Vid marken (10 m)</span><b>${fmtDeg(s.wdir)}° / ${Math.round(spdOut(s.wspd))} ${spdUnit()}${s.gust > s.wspd + 5 ? ` (byar ${Math.round(spdOut(s.gust))})` : ''}</b>
      ${w.comp != null ? `<span>Längs din kurs</span><b>${w.comp >= 0 ? 'Motvind' : 'Medvind'} ${Math.round(spdOut(Math.abs(w.comp)))} ${spdUnit()}</b>` : ''}
      <span>Prognos för</span><b>${fmtUTC(t)}Z (${fmtLocal(t)})</b>
      <span>Plats</span><b>${gps ? 'Din GPS-position' : 'Kartans mitt'}${gps && nav.pos.altFt != null ? ', din höjd' : ', standardhöjden'}</b>
      <span>Hämtad</span><b>${fmtLocal(new Date(data.at))}${navigator.onLine ? '' : ' (offline)'}</b>
    </div>
    ${note('warn', 'Prognos från Open-Meteo — inte uppmätt vind. Kontrollera METAR och officiell briefing.')}`);
}
