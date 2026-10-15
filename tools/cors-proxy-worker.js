// CORS-proxy för Ultranav — klistra in i en Cloudflare Worker (gratis).
// Användning i appen (Inställningar › CORS-proxy):  https://<ditt-namn>.workers.dev/?url={url}
//
// NOTAM: SkyLink NOTAM API via RapidAPI. Lägg in RapidAPI-nyckeln som hemlighet i workern
// (Settings › Variables and Secrets): SKYLINK_KEY. Den syns aldrig i appen.
// Svaren sparas i en timme och delas mellan alla användare, så att gratiskvoten räcker.
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
  'skylink-api.p.rapidapi.com',     // NOTAM (SkyLink, nyckeln läggs på här i proxyn)
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
    if (new URL(request.url).searchParams.has('ping')) return new Response(`ultranav-proxy 5\nOrigin: ${origin || '(saknas)'}\nTillåten: ${allowOrigin ? 'ja' : 'nej'}\nNOTAM-nyckel: ${env.SKYLINK_KEY ? 'ja' : 'nej'}`, { headers: open });
    if (!allowOrigin) return new Response(`Otillåten webbplats: ${origin || '(ingen Origin)'}`, { status: 403, headers: open });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Ange ?url=…', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Otillåten adress', { status: 403, headers: cors });
    }
    if (request.method !== 'GET') return new Response('Endast GET', { status: 405, headers: cors });

    const headers0 = { 'User-Agent': 'Ultranav/1.0 (+https://www.ultranav.se)', Accept: 'application/json, text/plain, */*' };
    let ttl = 120; // METAR m.m.: högst 2 min gamla
    if (url.hostname === 'skylink-api.p.rapidapi.com') {
      if (!/^\/v3\/notams\/[A-Z0-9]{3,4}$/.test(url.pathname)) return new Response('Otillåten adress', { status: 403, headers: cors });
      if (!env.SKYLINK_KEY) return new Response('NOTAM-nyckel saknas i proxyn (SKYLINK_KEY)', { status: 501, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
      headers0['x-rapidapi-key'] = env.SKYLINK_KEY;
      headers0['x-rapidapi-host'] = url.hostname;
      ttl = 3600; // NOTAM: en timme, delas mellan alla användare (sparar kvot)
    }
    let upstream;
    try {
      upstream = await fetch(url.toString(), { headers: headers0, cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '400-599': 0 } } });
    } catch (e) {
      // Svara med CORS-huvuden även vid fel, så att appen kan visa orsaken
      return new Response('Proxyn nådde inte källan: ' + (e?.message || e), { status: 502, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Ultranav-Proxy', '5');
    headers.set('Access-Control-Expose-Headers', 'X-Ultranav-Proxy');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
