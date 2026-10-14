// Felsökning av anslutningar: visar varför ett anrop misslyckas (inloggning, behörighet, CORS, nätverk)
import { settings, saveSettings } from './settings.js';
import { esc, note } from './util.js';

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

const box = (cls, html) => note(cls.replace('box', ''), html, cls === 'okbox' ? 'ok' : cls === 'badbox' ? 'fail' : 'alert');

// ---------- OpenAIP ----------
/** Testar nyckel OCH områdessökning: hämtar fält runt Stockholm och kontrollerar att de faktiskt ligger där. */
export async function testOpenAip() {
  const key = settings.openaipKey;
  if (!key) return box('warnbox', 'Ange en API-nyckel först.');
  const { oaipUrl, resetOpenAip } = await import('./openaip.js');
  const H = { 'x-openaip-api-key': key };
  // 1) nyckel: i adressen eller i huvud
  const base = 'https://api.core.openaip.net/api/airports?limit=1&page=1';
  let auth = null, r = await probe(`${base}&apiKey=${encodeURIComponent(key)}`);
  if (r.ok) auth = 'query';
  else { const h = await probe(base, H); if (h.ok) auth = 'header'; else r = [r, h].find((x) => x.kind === 'auth' || x.kind === 'forbidden') || r; }
  if (!auth) {
    const hint = { auth: 'Nyckeln godtas inte. Kontrollera att hela nyckeln är kopierad utan mellanslag och att API-klienten är aktiv på openaip.net.',
      forbidden: 'Nyckeln saknar behörighet. Kontrollera API-klienten på openaip.net.', cors: 'OpenAIP blockerar anrop från den här webbadressen.',
      network: 'Kontrollera nätverket.' }[r.kind] || '';
    return box('badbox', `Nyckeln fungerar inte: ${esc(r.msg)}<br>${hint}`);
  }
  saveSettings({ openaipAuth: auth });
  // 2) områdessökning: vilket filter ger fält nära Stockholm (59,33 N 18,06 E)?
  const ref = { lat: 59.33, lon: 18.06 };
  const near = (j, maxNM) => {
    const pts = (j?.items || []).map((i) => i.geometry?.coordinates).filter(Boolean);
    return pts.length > 0 && pts.every(([lon, lat]) => Math.hypot((lat - ref.lat) * 60, (lon - ref.lon) * 60 * Math.cos(ref.lat * Math.PI / 180)) <= maxNM);
  };
  const tries = [
    ['pos', 'pos=59.33,18.06&dist=40000'],      // dist i meter
    ['poskm', 'pos=59.33,18.06&dist=40'],       // dist i km
    ['bbox', 'bbox=17.4,59.0,18.7,59.7'],
  ];
  const tried = [];
  for (const [mode, q] of tries) {
    const t = await probe(oaipUrl('airports', `${q}&limit=50&page=1`), auth === 'header' ? H : undefined);
    let j = null; try { j = JSON.parse(t.text || 'null'); } catch { /* ej JSON */ }
    tried.push(`${mode}: ${t.ok ? (j?.items?.length ?? 0) + ' fält' : 'HTTP ' + (t.status || t.kind)}`);
    if (t.ok && near(j, mode === 'bbox' ? 40 : 30)) {
      const changed = settings.openaipQuery !== mode;
      saveSettings({ openaipQuery: mode });
      if (changed) resetOpenAip();
      return box('okbox', `OpenAIP fungerar: ${j.items.length} fält hittade runt Stockholm (områdesfilter: ${mode}).<br>Slå på Luftrum, Flygfält och Rapportpunkter under Kartor och zooma in till minst zoomnivå 7.`);
    }
  }
  return box('warnbox', `Nyckeln fungerar, men ingen områdessökning gav fält på rätt plats (${esc(tried.join(' · '))}). Skicka gärna den här texten till utvecklaren.`);
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
    if (ok) return box('okbox', `${esc(name)} fungerar.`);
  }
  const r = await probe(url);
  if (r.ok) return box('okbox', `${esc(name)} fungerar.`);
  const hint = r.status === 403 || r.status === 429
    ? 'Servern nekar just nu — troligen tillfällig spärr eller överbelastning (t.ex. efter många nedladdningar). Vänta en stund eller välj en annan karta.'
    : r.kind === 'cors' ? 'Servern svarar men bilden kunde inte visas.' : r.kind === 'network' ? 'Servern går inte att nå — den kan vara nere.' : '';
  return box('badbox', `${esc(name)}: ${esc(r.msg)}<br>${hint}`);
}
