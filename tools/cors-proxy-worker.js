// CORS-proxy för Ultranav — klistra in i en Cloudflare Worker (gratis).
// Användning i appen (Inställningar › CORS-proxy):  https://<ditt-namn>.workers.dev/?url={url}
//
// NOTAM: FAA:s NOTAM-API kräver nyckel. Lägg in den som hemligheter i workern
// (Settings › Variables and Secrets): FAA_CLIENT_ID och FAA_CLIENT_SECRET. De syns aldrig i appen.
//
// Säkerhet: proxyn vidarebefordrar ENDAST till värdarna i ALLOWED_HOSTS och svarar bara
// webbsidor från ALLOWED_ORIGINS, så att den inte kan missbrukas som öppen proxy av andra.

const ALLOWED_ORIGINS = [
  'https://www.ultranav.se',
  'https://ultranav.se',
  'https://karlmarcusvaldemar-maker.github.io',
  'http://localhost:8000', // lokal testning
];
const ALLOWED_HOSTS = [
  'aviationweather.gov',            // METAR/TAF
  'api.open-meteo.com',             // vind/prognos
  'davidmegginson.github.io',       // OurAirports
  'api.rainviewer.com',             // radarlista
  'external-api.faa.gov',           // NOTAM (FAA NOTAM API, nyckel läggs på här i proxyn)
];

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin || 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Statuskontroll som alla kan läsa (för felsökning): https://<proxy>/?ping
    const open = { ...cors, 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' };
    if (new URL(request.url).searchParams.has('ping')) return new Response(`ultranav-proxy 4\nOrigin: ${origin || '(saknas)'}\nTillåten: ${allowOrigin ? 'ja' : 'nej'}\nFAA-nyckel: ${env.FAA_CLIENT_ID && env.FAA_CLIENT_SECRET ? 'ja' : 'nej'}`, { headers: open });
    if (!allowOrigin) return new Response(`Otillåten webbplats: ${origin || '(ingen Origin)'}`, { status: 403, headers: open });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Ange ?url=…', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Otillåten adress', { status: 403, headers: cors });
    }
    if (request.method !== 'GET') return new Response('Endast GET', { status: 405, headers: cors });

    const headers0 = { 'User-Agent': 'Ultranav/1.0 (+https://www.ultranav.se)', Accept: 'application/json, text/plain, */*' };
    if (url.hostname === 'external-api.faa.gov') {
      if (!env.FAA_CLIENT_ID || !env.FAA_CLIENT_SECRET) {
        return new Response('FAA-nyckel saknas i proxyn (FAA_CLIENT_ID och FAA_CLIENT_SECRET)', { status: 501, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      headers0.client_id = env.FAA_CLIENT_ID;
      headers0.client_secret = env.FAA_CLIENT_SECRET;
    }
    let upstream;
    try {
      upstream = await fetch(url.toString(), { headers: headers0, cf: { cacheTtl: 120, cacheEverything: true } }); // METAR/NOTAM: högst 2 min gamla
    } catch (e) {
      // Svara med CORS-huvuden även vid fel, så att appen kan visa orsaken
      return new Response('Proxyn nådde inte källan: ' + (e?.message || e), { status: 502, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Ultranav-Proxy', '4');
    headers.set('Access-Control-Expose-Headers', 'X-Ultranav-Proxy');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
