// Terrängprofil (vertikal vy) längs rutten
import { profile, crossings, getLegs, route } from './route.js';
import { settings } from './settings.js';
import { asStyle, AS_TYPE } from './openaip.js';
import { $ } from './util.js';

let own = null; // { d, altFt }
export function setProfileOwn(o) { own = o; drawProfile(); }

export function drawProfile() {
  const panel = $('#profilePanel');
  if (panel.classList.contains('hidden')) return;
  const cv = $('#profileCanvas'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.body);
  const text = css.getPropertyValue('--text').trim(), muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim();
  g.clearRect(0, 0, W, H);
  g.font = '12px -apple-system, sans-serif';
  const legs = getLegs();
  if (!legs.length || !profile.length) {
    g.fillStyle = muted; g.fillText(route.wps.length < 2 ? 'Lägg till minst två brytpunkter för att se terrängprofilen.' : 'Hämtar terrängdata…', 16, 28);
    return;
  }
  const total = legs[legs.length - 1].cum;
  const maxT = Math.max(...profile.map((s) => s.ft ?? 0));
  const maxA = Math.max(...route.wps.slice(1).map((w) => w.alt), own?.altFt || 0);
  const top = Math.ceil((Math.max(maxT, maxA) + 1000) / 500) * 500;
  const L = 48, Rm = 12, T = 18, B = 22;
  const x = (d) => L + (d / total) * (W - L - Rm);
  const y = (ft) => H - B - (Math.min(ft, top) / top) * (H - T - B);

  // rutnät
  g.strokeStyle = line; g.fillStyle = muted; g.lineWidth = 1;
  const step = top > 6000 ? 2000 : top > 3000 ? 1000 : 500;
  for (let f = 0; f <= top; f += step) { g.beginPath(); g.moveTo(L, y(f)); g.lineTo(W - Rm, y(f)); g.stroke(); g.fillText(f + '', 4, y(f) + 4); }
  g.fillText('ft', 4, 12);

  // luftrum
  for (const c of crossings) {
    if (c.lowFt >= top) continue;
    const st = asStyle(c.as);
    g.fillStyle = st.color + '33'; g.strokeStyle = st.color; g.lineWidth = 1.5;
    const x0 = x(c.from), x1 = Math.max(x(c.to), x0 + 3), y0 = y(Math.min(c.upFt, top)), y1 = y(c.lowFt);
    g.fillRect(x0, y0, x1 - x0, y1 - y0); g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (x1 - x0 > 40) { g.fillStyle = st.color; g.fillText((AS_TYPE[c.as.type] || '') + ' ' + c.as.name.slice(0, 22), x0 + 3, Math.max(y0 + 12, T + 10)); }
  }

  // terräng
  g.beginPath(); g.moveTo(x(0), y(0));
  for (const s of profile) g.lineTo(x(s.d), y(s.ft ?? 0));
  g.lineTo(x(total), y(0)); g.closePath();
  const grad = g.createLinearGradient(0, y(maxT || 1), 0, y(0));
  grad.addColorStop(0, '#8a6a3b'); grad.addColorStop(1, '#4f7a3a');
  g.fillStyle = grad; g.fill();

  // terrängmarginal-varningar
  g.fillStyle = 'rgba(255,60,50,.85)';
  for (const s of profile) {
    const alt = route.wps[s.leg + 1]?.alt;
    if (alt == null) continue;
    if (s.ft != null && alt - s.ft < settings.minClearance) g.fillRect(x(s.d) - 1.5, y(alt) - 2, 3, 4);
  }

  // planerad höjd
  g.strokeStyle = css.getPropertyValue('--route').trim() || '#d63bd6'; g.lineWidth = 3; g.beginPath();
  for (const l of legs) { const d0 = l.cum - l.d; g.moveTo(x(d0), y(l.to.alt)); g.lineTo(x(l.cum), y(l.to.alt)); }
  g.stroke();

  // brytpunkter
  g.fillStyle = text; g.strokeStyle = muted; g.lineWidth = 1; g.setLineDash([3, 3]);
  const pts = [{ d: 0, n: route.wps[0].name }, ...legs.map((l) => ({ d: l.cum, n: l.to.name }))];
  pts.forEach((p, i) => {
    g.beginPath(); g.moveTo(x(p.d), T); g.lineTo(x(p.d), H - B); g.stroke();
    const tw = g.measureText(p.n).width;
    g.fillText(p.n, Math.min(Math.max(x(p.d) - tw / 2, L), W - Rm - tw), H - 6);
  });
  g.setLineDash([]);

  // egen position
  if (own && own.d >= 0 && own.d <= total) {
    g.strokeStyle = '#f2b632'; g.lineWidth = 2; g.beginPath(); g.moveTo(x(own.d), T); g.lineTo(x(own.d), H - B); g.stroke();
    if (own.altFt != null) { g.fillStyle = '#f2b632'; g.beginPath(); g.arc(x(own.d), y(own.altFt), 6, 0, 7); g.fill(); }
  }
  $('#profileLegend').textContent = `Högsta terräng ${Math.round(maxT)} ft · marginal ${settings.minClearance} ft · ${total.toFixed(0)} NM`;
}
