// CORS-proxy för Ultranav — klistra in i en Cloudflare Worker (gratis).
// Användning i appen (Inställningar › CORS-proxy):  https://<ditt-namn>.workers.dev/?url={url}
//
// Säkerhet: proxyn vidarebefordrar ENDAST till värdarna i ALLOWED_HOSTS och svarar bara
// webbsidor från ALLOWED_ORIGINS, så att den inte kan missbrukas som öppen proxy av andra.

const ALLOWED_ORIGINS = [
  'https://karlmarcusvaldemar-maker.github.io',
  'http://localhost:8000', // lokal testning
];
const ALLOWED_HOSTS = [
  'aviationweather.gov',            // METAR/TAF
  'api.open-meteo.com',             // vind/prognos
  'davidmegginson.github.io',       // OurAirports
  'api.rainviewer.com',             // radarlista
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
    if (request.method !== 'GET') return new Response('Endast GET', { status: 405, headers: cors });
    if (!allowOrigin) return new Response('Otillåten webbplats', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Ange ?url=…', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Otillåten adress', { status: 403, headers: cors });
    }

    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Ultranav (+https://github.com/karlmarcusvaldemar-maker/ultranav)' },
      cf: { cacheTtl: 120, cacheEverything: true }, // METAR uppdateras sällan oftare än så
    });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
