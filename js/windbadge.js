// Vindruta på kartan: prognosvind (Open-Meteo) på din höjd där du är — eller på standardhöjden vid kartans mitt utan GPS.
// Pilen visar vart vinden blåser och vrids med kartan. Under flygning visas mot- eller medvind längs din kurs.
import { settings, onSettings, fmtAlt, fmtWind } from './settings.js';
import { map, registerOverlay } from './map.js';
import { nav, onNav, setGlideWind } from './nav.js';
import { fetchForecast, hourIndex, windAt, surfaceWx } from './wx.js';
import { distNM, fmtDeg, fmtUTC, fmtLocal, idb, modal, note, debounce, FT_PER_M } from './util.js';

let on = false, el = null, data = null, busy = false; // data: { fc, at, lat, lon }
const REFRESH_MS = 60 * 60 * 1000, MOVE_NM = 25;

export async function initWindBadge() {
  data = (await idb.get('wind:fc').catch(() => null)) || null;
  registerOverlay('windarrow', 'Vind (prognos)', '', (v) => { on = v; render(); if (v) refresh(); });
  onNav(() => { render(); refresh(); });
  setGlideWind(glideWind);
  map.on('rotate', render);
  onSettings((s, patch) => { if ('windUnit' in patch || 'altUnit' in patch) render(); });
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
  const i = hourIndex(data.fc, new Date(Date.now() + 30 * 60000)); // närmaste hela timme
  const gps = nav.tracking && nav.pos;
  const altFt = gps && nav.pos.altFt != null ? nav.pos.altFt : settings.cruiseAlt;
  const w = windAt(data.fc, i, altFt);
  if (w.dir == null || w.spd == null) return null;
  let comp = null;
  if (gps && nav.pos.trk != null && nav.pos.gsKt > 20) comp = w.spd * Math.cos((w.dir - nav.pos.trk) * Math.PI / 180);
  return { ...w, altFt, i, comp };
}

/** Medelvind (vektor) mellan din höjd och marken, för glidcirkeln. Bara en färsk prognos (högst 12 h gammal) används. */
function glideWind(altFt, terrFt) {
  if (!data || altFt == null || Date.now() - data.at > 12 * 3600e3) return null;
  const i = hourIndex(data.fc, new Date(Date.now() + 30 * 60000));
  const groundFt = terrFt ?? (typeof data.fc.elevation === 'number' ? data.fc.elevation * FT_PER_M : null);
  const top = windAt(data.fc, i, altFt), low = groundFt != null ? windAt(data.fc, i, groundFt + 33) : top;
  if (top.dir == null || low.dir == null) return null;
  const uv = (w) => [-w.spd * Math.sin(w.dir * Math.PI / 180), -w.spd * Math.cos(w.dir * Math.PI / 180)];
  const [u1, v1] = uv(top), [u2, v2] = uv(low), u = (u1 + u2) / 2, v = (v1 + v2) / 2;
  return { dir: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360, spd: Math.hypot(u, v) };
}

// Under rutan för positionsdelning, som skapas senare och byter höjd med sin text
let watched = null;
function place() {
  const chip = document.getElementById('shareChip');
  if (chip && chip !== watched && window.ResizeObserver) { watched = chip; new ResizeObserver(place).observe(chip); }
  if (!chip) setTimeout(place, 1000);
  if (!el) return;
  const shown = chip && !chip.hidden;
  // telefon: bredvid delningsikonen; annars under delningsrutan
  if (document.body.classList.contains('phone') && shown) { el.style.top = `${chip.offsetTop}px`; el.style.left = `${chip.offsetLeft + chip.offsetWidth + 8}px`; }
  else { el.style.top = shown ? `${chip.offsetTop + chip.offsetHeight + 10}px` : '12px'; el.style.left = ''; }
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
    el.className = 'wb-empty';
    el.innerHTML = `<span class="wbDial"></span><span class="wbTxt"><small>VIND</small><b>—</b></span>`;
    el.setAttribute('aria-label', 'Vind: ingen prognos ännu');
    return;
  }
  const mb = map.getBearing ? map.getBearing() : 0;
  const spd = fmtWind(w.spd);
  const comp = w.comp == null || Math.abs(w.comp) < 1 ? ''
    : `<em class="${w.comp > 0 ? 'head' : 'tail'}">${w.comp > 0 ? 'Motvind' : 'Medvind'} ${fmtWind(Math.abs(w.comp))}</em>`;
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
      <span>På ${fmtAlt(w.altFt, true)}</span><b>${fmtDeg(w.dir)}° / ${fmtWind(w.spd)}</b>
      <span>Vid marken (10 m)</span><b>${fmtDeg(s.wdir)}° / ${fmtWind(s.wspd)}${s.gust > s.wspd + 5 ? ` (byar ${fmtWind(s.gust)})` : ''}</b>
      ${w.comp != null ? `<span>Längs din kurs</span><b>${w.comp >= 0 ? 'Motvind' : 'Medvind'} ${fmtWind(Math.abs(w.comp))}</b>` : ''}
      <span>Prognos för</span><b>${fmtUTC(t)}Z (${fmtLocal(t)})</b>
      <span>Plats</span><b>${gps ? 'Din GPS-position' : 'Kartans mitt'}${gps && nav.pos.altFt != null ? ', din höjd' : ', standardhöjden'}</b>
      <span>Hämtad</span><b>${fmtLocal(new Date(data.at))}${navigator.onLine ? '' : ' (offline)'}</b>
    </div>
    ${note('warn', 'Prognos från Open-Meteo — inte uppmätt vind. Kontrollera METAR och officiell briefing.')}`);
}
