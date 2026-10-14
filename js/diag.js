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

// ---------- Lantmäteriet ----------
const LM_CAPS = 'https://maps.lantmateriet.se/open/topowebb-ccby/v1/wmts?request=GetCapabilities&version=1.0.0&service=wmts';

/** Läs ResourceURL-mallen för lagret topowebb ur GetCapabilities och gör om den till {z}/{x}/{y} */
function parseCaps(xml, layer = 'topowebb') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const layers = [...doc.getElementsByTagNameNS('*', 'Layer')];
  const L0 = layers.find((l) => [...l.children].some((c) => c.localName === 'Identifier' && c.textContent.trim() === layer)) || layers[0];
  if (!L0) return null;
  const res = [...L0.getElementsByTagNameNS('*', 'ResourceURL')].find((r) => /png/i.test(r.getAttribute('format') || '')) || L0.getElementsByTagNameNS('*', 'ResourceURL')[0];
  const sets = [...L0.getElementsByTagNameNS('*', 'TileMatrixSet')].map((t) => t.textContent.trim());
  const set = sets.find((s) => /3857|GoogleMaps|WebMercator/i.test(s));
  if (!res || !set) return { sets };
  const tpl = res.getAttribute('template')
    .replace('{TileMatrixSet}', set).replace('{Style}', 'default').replace('{style}', 'default')
    .replace('{TileMatrix}', '{z}').replace('{TileRow}', '{y}').replace('{TileCol}', '{x}');
  return { tpl, set, sets };
}

export async function testLantmateriet() {
  const { lmUser, lmPass, lmKey } = settings;
  if (!lmUser && !lmKey) return box('warnbox', 'Ange användarnamn och lösenord från Geotorget (eller en äldre API-nyckel).');
  let caps, how;
  if (lmUser) {
    caps = await probe(LM_CAPS, { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${lmUser}:${lmPass}`))) });
    how = 'Geotorget-inloggning';
  } else {
    caps = await probe(`https://api.lantmateriet.se/open/topowebb-ccby/v1/wmts/token/${encodeURIComponent(lmKey)}/?request=GetCapabilities&version=1.0.0&service=wmts`);
    how = 'API-nyckel';
  }
  if (!caps.ok) {
    const hint = {
      auth: 'Fel användarnamn eller lösenord. Använd inloggningen för API-åtkomsten på Geotorget.',
      forbidden: 'Inloggningen fungerar men kontot saknar behörighet. Beställ åtkomst till "Topografisk webbkarta Visning, översiktlig" på Geotorget och vänta tills behörigheten syns under ditt konto.',
      cors: 'Lantmäteriets server tillåter inte inloggade anrop direkt från en webbapp. Det går inte att lösa i appen — det kräver en liten mellanserver (proxy) som lägger till inloggningen. Använd OpenTopoMap eller vektorkartan så länge.',
      notfound: 'Åtkomstpunkten finns inte (längre).',
    }[caps.kind] || '';
    return box('badbox', `✗ ${how}: ${esc(caps.msg)}<br>${hint}`);
  }
  const p = parseCaps(caps.text);
  if (!p?.tpl) return box('warnbox', `Inloggningen fungerar, men hittade ingen Web Mercator-uppsättning i svaret (finns: ${esc((p?.sets || []).join(', '))}).`);
  saveSettings({ tiles: { ...settings.tiles, ...(lmUser ? { lmBasic: p.tpl } : { lm: p.tpl.replace(encodeURIComponent(lmKey), '{key}').replace(lmKey, '{key}') }) } });
  return box('okbox', `✓ Lantmäteriet fungerar (${how}). Kartadress hämtad från tjänsten. Välj "Lantmäteriet Topowebb" under ▤ Lager.`);
}
