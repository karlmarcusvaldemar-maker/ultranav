// Inställningar för molntjänsten (Supabase). Fyll i från Supabase: Project Settings › API.
// Båda värdena är avsedda att ligga i webbappen — "anon/publishable key" ger bara de rättigheter
// som databasens säkerhetsregler (Row Level Security i supabase/schema.sql) tillåter.
export const SUPABASE_URL = 'https://qdjyaulcqpqsvhziegdf.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_j39AtGC8ZDxr6REPeSlzkQ_De01iIvW'; // publishable key — avsedd för webbappen

// Inbyggd OpenAIP-nyckel och CORS-proxy, så att användarna inte behöver ställa in något själva.
// Används när användaren inte har angett egna värden under Inställningar. OpenAIP-nyckeln syns i
// webbläsaren (precis som i kartadresserna) — den kan bytas på openaip.net om den skulle missbrukas.
export const OPENAIP_KEY = 'e2b106c5e86ce13a21248a63367d5234';
export const DEFAULT_PROXY = 'https://ultranav-proxy.karlmarcusvaldemar.workers.dev';
