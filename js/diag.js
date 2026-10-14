// Felsökning av anslutningar: visar varför ett anrop misslyckas (inloggning, behörighet, CORS, nätverk)
import { settings, saveSettings } from './settings.js';
import { esc } from './util.js';

/** Gör ett anrop och klassificera resultatet */
export async function probe(url, headers) {
  if (!navigator.onLine) return { ok: false, kind: 'offline', msg: 'Ingen internetanslutning.' };
  try {
    const r = await fetch(url, { headers, cache: 'no-store' });
    const text = await r.text().catch(() => '');
    if (r.ok) return { ok: true, status: r.status, text, type: r.headers.get('content-type') || '' };
    const kind = r.status === 401 ? 'auth' : r.status === 403 ? 'forbidden' : r.status === 404 ? 'notfound' : 'http';
    return { ok: false, status: r.status, kind, text, msg: `Servern svarade HTTP ${r.status}. ${text.slice(0, 160)}` };
  } catch (e) {
    // Nådde vi servern alls? Ett "no-cors"-anrop lyckas om servern finns men inte tillåter webbappar (CORS).
    const reachable = await fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(() => true).catch(() => false);
    return reachable
      ? { ok: false, kind: 'cors', msg: 'Servern svarar, men webbläsaren blockerar anropet eftersom servern inte tillåter anrop från webbappar (CORS).' }
      : { ok: false, kind: 'network', msg: `Kunde inte nå servern (${e.message}).` };
  }
}

const box = (cls, html) => `<div class="${cls}">${html}</div>`;

// ---------- OpenAIP ----------
export async function testOpenAip() {
  const key = settings.openaipKey;
  if (!key) return box('warnbox', 'Ange en API-nyckel först.');
  const base = 'https://api.core.openaip.net/api/airports?limit=1&page=1';
  const q = await probe(`${base}&apiKey=${encodeURIComponent(key)}`);
  if (q.ok) { saveSettings({ openaipAuth: 'query' }); return box('okbox', '✓ OpenAIP fungerar (nyckel i adressen).'); }
  const h = await probe(base, { 'x-openaip-api-key': key });
  if (h.ok) { saveSettings({ openaipAuth: 'header' }); return box('okbox', '✓ OpenAIP fungerar (nyckel i huvud).'); }
  const r = [q, h].find((x) => x.kind === 'auth' || x.kind === 'forbidden') || q;
  const hint = { auth: 'Nyckeln godtas inte. Kontrollera att du kopierat hela nyckeln utan mellanslag, och att API-klienten är aktiv på openaip.net.',
    forbidden: 'Nyckeln saknar behörighet. Kontrollera API-klienten på openaip.net.',
    cors: 'OpenAIP blockerar anrop från den här webbadressen.', offline: '', network: 'Kontrollera nätverket.', notfound: 'Adressen hittades inte.' }[r.kind] || '';
  return box('badbox', `✗ ${esc(r.msg)}<br>${hint}`);
}


/** Testa att en kartbild (eller stil) går att hämta och visa. Bilder testas som <img> (kräver inte CORS). */
export async function testTile(url, name, isJson = false) {
  if (!navigator.onLine) return box('badbox', 'Ingen internetanslutning.');
  if (!isJson) {
    const ok = await new Promise((res) => {
      const img = new Image(); const t = setTimeout(() => res(false), 12000);
      img.onload = () => { clearTimeout(t); res(true); }; img.onerror = () => { clearTimeout(t); res(false); };
      img.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    });
    if (ok) return box('okbox', `✓ ${esc(name)} fungerar.`);
  }
  const r = await probe(url);
  if (r.ok) return box('okbox', `✓ ${esc(name)} fungerar.`);
  const hint = r.status === 403 || r.status === 429
    ? 'Servern nekar just nu — troligen tillfällig spärr eller överbelastning (t.ex. efter många nedladdningar). Vänta en stund eller välj en annan karta.'
    : r.kind === 'cors' ? 'Servern svarar men bilden kunde inte visas.' : r.kind === 'network' ? 'Servern går inte att nå — den kan vara nere.' : '';
  return box('badbox', `✗ ${esc(name)}: ${esc(r.msg)}<br>${hint}`);
}
