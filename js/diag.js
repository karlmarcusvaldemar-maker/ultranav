// Felsökning av anslutningar: visar varför ett anrop misslyckas (inloggning, behörighet, CORS, nätverk)
import { settings, saveSettings } from './settings.js';
import { esc, note, withProxy } from './util.js';

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
  // 2) Vilka frågor godtar servern? Varje parameter provas för sig så att felet kan lokaliseras.
  //    (Avvisade frågor saknar CORS-huvud och syns därför som "blockerad" i webbläsaren.)
  const ref = { lat: 59.33, lon: 18.06 };
  const coords = (j) => (j?.items || []).map((i) => i.geometry?.coordinates).filter(Boolean);
  const within = (j, test) => { const c = coords(j); return c.length > 0 && c.every(test); };
  const nearRef = (maxNM) => ([lon, lat]) => Math.hypot((lat - ref.lat) * 60, (lon - ref.lon) * 60 * Math.cos(ref.lat * Math.PI / 180)) <= maxNM;
  const inSweden = ([lon, lat]) => lat > 55 && lat < 69.5 && lon > 10.5 && lon < 24.5;
  const tests = [
    { mode: null, label: 'limit50', q: 'limit=50&page=1' },
    { mode: null, label: 'limit100', q: 'limit=100&page=1', after: (ok) => saveSettings({ openaipLimit: ok ? 100 : 50 }) },
    { mode: 'pos', label: 'pos+dist(m)', q: 'pos=59.33,18.06&dist=40000&limit=50&page=1', ok: (j) => within(j, nearRef(30)) },
    { mode: 'poskm', label: 'pos+dist(km)', q: 'pos=59.33,18.06&dist=40&limit=50&page=1', ok: (j) => within(j, nearRef(30)) },
    { mode: null, label: 'pos', q: 'pos=59.33,18.06&limit=50&page=1' },
    { mode: 'bbox', label: 'bbox', q: 'bbox=17.4,59.0,18.7,59.7&limit=50&page=1', ok: (j) => within(j, nearRef(40)) },
    { mode: 'country', label: 'country', q: 'country=SE&limit=50&page=1', ok: (j) => within(j, inSweden) },
  ];
  const lines = [];
  let chosen = null, chosenCount = 0;
  for (const t of tests) {
    const res = await probe(oaipUrl('airports', t.q), auth === 'header' ? H : undefined);
    let j = null; try { j = JSON.parse(res.text || 'null'); } catch { /* ej JSON */ }
    const good = res.ok && (!t.ok || t.ok(j));
    t.after?.(res.ok);
    lines.push(`${t.label}: ${res.ok ? `${j?.items?.length ?? 0} st${t.ok ? (good ? ' rätt plats' : ' fel plats') : ''}` : res.status ? 'HTTP ' + res.status : 'avvisad'}`);
    if (good && t.mode && !chosen) { chosen = t.mode; chosenCount = j.items.length; }
  }
  if (chosen) {
    const changed = settings.openaipQuery !== chosen;
    saveSettings({ openaipQuery: chosen });
    if (changed) resetOpenAip();
    const how = chosen === 'country' ? `per land (${esc(settings.oaCountries)})` : `per område (${chosen})`;
    return box('okbox', `OpenAIP fungerar. Data hämtas ${how}.<br><span class="muted">${esc(lines.join(' · '))}</span><br>Luftrum, flygfält och rapportpunkter visas från zoomnivå 7.`);
  }
  return box('warnbox', `Nyckeln fungerar, men ingen fråga gav data på rätt plats.<br><span class="muted">${esc(lines.join(' · '))}</span><br>Skicka gärna den här texten till utvecklaren.`);
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

// ---------- CORS-proxy ----------
export async function testProxy() {
  const proxy = settings.corsProxy?.trim();
  if (!proxy) return box('warnbox', 'Ingen proxy angiven. Fyll i adressen till din Worker i fältet CORS-proxy ovan.');
  if (!/^https:\/\//.test(proxy)) return box('badbox', 'Adressen måste börja med https://');
  const target = 'https://aviationweather.gov/api/data/metar?ids=ESSA&format=json';
  const r = await probe(withProxy(target, proxy));
  if (r.ok) {
    let n = 0; try { n = JSON.parse(r.text).length; } catch { /* inte JSON */ }
    if (/hello world/i.test(r.text)) return box('badbox', 'Workern svarar "Hello World" — koden är inte utbytt. Klistra in innehållet i tools/cors-proxy-worker.js i Cloudflare och tryck Deploy.');
    return box('okbox', `Proxyn fungerar. METAR för ESSA hämtades via proxyn${n ? '' : ' (tomt svar från NOAA, men proxyn svarar)'}.`);
  }
  const t = r.text || '';
  if (r.status === 403 && /Otillåten webbplats/.test(t)) return box('badbox', `Proxyn svarar men nekar den här webbplatsen. Lägg till <b>${esc(location.origin)}</b> i ALLOWED_ORIGINS i Worker-koden och tryck Deploy.`);
  if (r.status === 403 && /Otillåten adress/.test(t)) return box('badbox', 'Proxyn nekar väderadressen. Kontrollera att aviationweather.gov finns i ALLOWED_HOSTS i Worker-koden.');
  if (r.kind === 'cors') return box('badbox', 'Workern svarar men utan CORS-tillåtelse — troligen körs fortfarande standardkoden ("Hello World"). Klistra in koden från tools/cors-proxy-worker.js och tryck Deploy.');
  if (r.kind === 'network') return box('badbox', 'Adressen går inte att nå. Kontrollera stavningen — den ska se ut som https://namn.konto.workers.dev');
  return box('badbox', `Proxyn svarade med ett fel: ${esc(r.msg)}`);
}
