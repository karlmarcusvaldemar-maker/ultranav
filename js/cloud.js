// Moln: konto (Supabase Auth, e-post + lösenord), synk av biblioteket och delning med länk.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { allItems, findAny, put, remove, setShare, onLibrary, get } from './library.js';
import { toast, debounce, store } from './util.js';

let client = null;
export let user = null;
const status = { syncing: false, last: store.get('ulnav.lastSync', null), error: null };
const listeners = new Set();
export const onCloud = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f({ user, ...status }));
export const cloudStatus = () => ({ user, ...status });
export const cloudConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let libLoading;
function loadLib() {
  if (window.supabase) return Promise.resolve();
  if (!libLoading) libLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/supabase/supabase.js';
    s.onload = res; s.onerror = () => rej(new Error('kunde inte ladda inloggningsbiblioteket')); document.head.appendChild(s);
  });
  return libLoading;
}

/** Starta molndelen: återställ session, lyssna på inloggning och lokala ändringar */
export async function initCloud({ onPasswordRecovery } = {}) {
  if (!cloudConfigured()) return;
  try { await loadLib(); } catch (e) { status.error = e.message; emit(); return; }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ulnav.auth' },
  });
  client.auth.onAuthStateChange((event, session) => {
    const was = user?.id;
    user = session?.user || null;
    if (event === 'PASSWORD_RECOVERY') onPasswordRecovery?.();
    emit();
    if (user && user.id !== was) sync();
  });
  const { data } = await client.auth.getSession();
  user = data.session?.user || null;
  emit();
  if (user) sync();
  // Lokala ändringar → synka (fördröjt), samt när appen blir synlig igen och var femte minut
  onLibrary((kind, source) => { if (source === 'local') syncSoon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', () => sync());
  setInterval(() => sync(), 5 * 60e3);
}

const redirect = () => location.origin + location.pathname;
const sv = (e) => {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Fel e-post eller lösenord.';
  if (/Email not confirmed/i.test(m)) return 'E-postadressen är inte bekräftad ännu. Klicka på länken i bekräftelsemejlet.';
  if (/User already registered/i.test(m)) return 'Det finns redan ett konto med den e-postadressen. Logga in i stället.';
  if (/Password should be at least/i.test(m)) return 'Lösenordet är för kort (minst 8 tecken).';
  if (/rate limit|too many/i.test(m)) return 'För många försök. Vänta en stund och försök igen.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Ingen kontakt med servern. Kontrollera nätverket.';
  return m;
};

export async function signUp(email, password) {
  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
  if (error) throw new Error(sv(error));
  return { needsConfirm: !data.session };
}
export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(sv(error));
}
export async function signOut() { await client.auth.signOut(); user = null; emit(); }
export async function resetPassword(email) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
  if (error) throw new Error(sv(error));
}
export async function updatePassword(password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(sv(error));
}

// ---------- synk ----------
const syncSoon = debounce(() => sync(), 2500);
const ts = (iso) => Date.parse(iso) || 0;

/** Tvåvägssynk där senaste ändringen vinner, per objekt */
export async function sync() {
  if (!client || !user || status.syncing || !navigator.onLine) return;
  status.syncing = true; status.error = null; emit();
  try {
    // 1) metadata för allt i molnet
    const { data: rows, error } = await client.from('items').select('id,kind,name,updated_at,deleted,share_code,is_shared');
    if (error) throw error;
    const remote = new Map(rows.map((r) => [r.id, r]));
    // 2) hämta det som är nyare i molnet
    const need = [];
    for (const r of rows) {
      const l = findAny(r.id), rt = ts(r.updated_at);
      if (l && rt <= l.updated) continue;
      if (r.deleted) { if (l && !l.deleted) await remove(r.kind, r.id, { source: 'remote', updated: rt }); }
      else need.push(r.id);
    }
    for (let i = 0; i < need.length; i += 40) {
      const { data, error: e2 } = await client.from('items').select('id,kind,name,data,updated_at,share_code,is_shared').in('id', need.slice(i, i + 40));
      if (e2) throw e2;
      for (const r of data) {
        await put(r.kind, { id: r.id, name: r.name, data: r.data, share: r.is_shared ? r.share_code : null }, { source: 'remote', updated: ts(r.updated_at) });
      }
    }
    // 3) skicka det som är nyare lokalt
    const push = allItems().filter((l) => { if (l.data?.localOnly) return false; const r = remote.get(l.id); return !r ? !l.deleted : l.updated > ts(r.updated_at); });
    for (let i = 0; i < push.length; i += 20) {
      const batch = push.slice(i, i + 20).map((l) => ({ user_id: user.id, id: l.id, kind: l.kind, name: l.name || '', data: l.deleted ? {} : l.data,
        deleted: !!l.deleted, updated_at: new Date(l.updated).toISOString() }));
      const { error: e3 } = await client.from('items').upsert(batch, { onConflict: 'user_id,id' });
      if (e3) throw e3;
    }
    status.last = Date.now(); store.set('ulnav.lastSync', status.last);
  } catch (e) {
    status.error = sv(e);
    console.warn('sync', e);
  } finally {
    status.syncing = false; emit();
  }
}

// ---------- delning ----------
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
export const shareLink = (c) => `${redirect()}?share=${c}`;

/** Dela ett objekt: returnerar länk. Kräver inloggning. */
export async function shareItem(kind, id) {
  if (!user) throw new Error('Logga in för att dela.');
  const item = get(kind, id);
  if (!item) throw new Error('Objektet finns inte.');
  await sync(); // se till att objektet finns i molnet
  const c = item.share || code();
  const { error } = await client.from('items').update({ share_code: c, is_shared: true }).eq('user_id', user.id).eq('id', id);
  if (error) throw new Error(sv(error));
  await setShare(kind, id, c);
  return shareLink(c);
}
export async function unshareItem(kind, id) {
  const { error } = await client.from('items').update({ is_shared: false }).eq('user_id', user.id).eq('id', id);
  if (error) throw new Error(sv(error));
  await setShare(kind, id, null);
}
/** Hämta ett delat objekt med kod (fungerar utan inloggning) */
export async function fetchShared(c) {
  if (!client) { await loadLib().catch(() => {}); if (!window.supabase || !cloudConfigured()) throw new Error('Delning är inte konfigurerad.'); client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
  const { data, error } = await client.rpc('get_shared', { code: c });
  if (error) throw new Error(sv(error));
  return data?.[0] || null;
}

/** Kopiera text (länk) — med reserv om urklipp inte tillåts */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Länken är kopierad'); return true; }
  catch { prompt('Kopiera länken:', text); return false; }
}
