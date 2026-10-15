// CORS-proxy för Ultranav — klistra in i en Cloudflare Worker (gratis).
// Användning i appen (Inställningar › CORS-proxy):  https://<ditt-namn>.workers.dev/?url={url}
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
  'geodata.naturvardsverket.se',    // skyddade områden (lagerlista)
];

export default {
  async fetch(request) {
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
    if (new URL(request.url).searchParams.has('ping')) return new Response(`ultranav-proxy 7\nOrigin: ${origin || '(saknas)'}\nTillåten: ${allowOrigin ? 'ja' : 'nej'}`, { headers: open });
    if (!allowOrigin) return new Response(`Otillåten webbplats: ${origin || '(ingen Origin)'}`, { status: 403, headers: open });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Ange ?url=…', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Otillåten adress', { status: 403, headers: cors });
    }
    if (request.method !== 'GET') return new Response('Endast GET', { status: 405, headers: cors });

    const headers0 = { 'User-Agent': 'Ultranav/1.0 (+https://www.ultranav.se)', Accept: 'application/json, text/plain, */*' };
    const ttl = 120; // METAR m.m.: högst 2 min gamla
    let upstream;
    try {
      upstream = await fetch(url.toString(), { headers: headers0, cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '400-599': 0 } } });
    } catch (e) {
      // Svara med CORS-huvuden även vid fel, så att appen kan visa orsaken
      return new Response('Proxyn nådde inte källan: ' + (e?.message || e), { status: 502, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Ultranav-Proxy', '7');
    headers.set('Access-Control-Expose-Headers', 'X-Ultranav-Proxy');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
