// Inställningar för molntjänsten (Supabase). Fyll i från Supabase: Project Settings › API.
// Båda värdena är avsedda att ligga i webbappen — "anon/publishable key" ger bara de rättigheter
// som databasens säkerhetsregler (Row Level Security i supabase/schema.sql) tillåter.
export const SUPABASE_URL = 'https://qdjyaulcqpqsvhziegdf.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_j39AtGC8ZDxr6REPeSlzkQ_De01iIvW'; // publishable key — avsedd för webbappen
