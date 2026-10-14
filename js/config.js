// Inställningar för molntjänsten (Supabase). Fyll i från Supabase: Project Settings › API.
// Båda värdena är avsedda att ligga i webbappen — "anon/publishable key" ger bara de rättigheter
// som databasens säkerhetsregler (Row Level Security i supabase/schema.sql) tillåter.
export const SUPABASE_URL = '';       // t.ex. 'https://abcdefgh.supabase.co'
export const SUPABASE_ANON_KEY = '';  // "anon public" eller "publishable" key
