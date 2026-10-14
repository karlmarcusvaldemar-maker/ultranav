// Lokalt bibliotek för allt som kan synkas: rutter, ritningar, eget kartmaterial, flygningar, inställningar.
// Varje objekt: { id, kind, name, data, updated (ms), deleted? }. Borttagna objekt sparas som
// "gravstenar" så att borttagningen kan synkas till andra enheter.
import { store, idb } from './util.js';

const KINDS = ['route', 'drawing', 'layer', 'flight', 'settings'];
const BIG = new Set(['layer', 'flight']);           // kan vara stora → IndexedDB
const mem = Object.fromEntries(KINDS.map((k) => [k, []]));
const listeners = new Set();

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

async function persist(kind) {
  if (BIG.has(kind)) await idb.set('lib:' + kind, mem[kind]);
  else store.set('ulnav.lib.' + kind, mem[kind]);
}

/** Läs in allt (anropas en gång vid start) och flytta över data från äldre versioner */
export async function initLibrary() {
  for (const k of KINDS) mem[k] = (BIG.has(k) ? await idb.get('lib:' + k) : store.get('ulnav.lib.' + k, null)) || [];
  // Migrering: sparade rutter (namn → rutt) och ritningar från tidigare versioner
  const oldRoutes = store.get('ulnav.routes', null);
  if (oldRoutes && !mem.route.length) {
    mem.route = Object.values(oldRoutes).map((r) => ({ id: newId(), kind: 'route', name: r.name, data: { wps: r.wps, depTime: r.depTime || null }, updated: Date.now() }));
    await persist('route');
  }
  const oldDraw = store.get('ulnav.drawings', null);
  if (oldDraw && !mem.drawing.length) {
    mem.drawing = oldDraw.map((f) => ({ id: f.id, kind: 'drawing', name: f.name, data: { type: f.type, coords: f.coords, color: f.color }, updated: Date.now() }));
    await persist('drawing');
  }
}

/** Objekt av en typ (utan borttagna) */
export const list = (kind) => mem[kind].filter((i) => !i.deleted);
export const get = (kind, id) => mem[kind].find((i) => i.id === id && !i.deleted);
/** Alla objekt inklusive borttagna — för synk */
export const allItems = () => KINDS.flatMap((k) => mem[k]);
export const findAny = (id) => { for (const k of KINDS) { const i = mem[k].find((x) => x.id === id); if (i) return i; } return null; };

/** Spara (skapa eller ersätt). source 'local' = användaren ändrade → ny tidsstämpel och synk. */
export async function put(kind, item, { source = 'local', updated } = {}) {
  const i = mem[kind].findIndex((x) => x.id === item.id);
  const rec = { ...(i >= 0 ? mem[kind][i] : {}), ...item, kind, deleted: false, updated: updated ?? Date.now() };
  if (i >= 0) mem[kind][i] = rec; else mem[kind].push(rec);
  await persist(kind);
  emit(kind, source, rec);
  return rec;
}

/** Ta bort (gravsten behålls för synk) */
export async function remove(kind, id, { source = 'local', updated } = {}) {
  const i = mem[kind].findIndex((x) => x.id === id);
  if (i < 0) return;
  mem[kind][i] = { id, kind, name: mem[kind][i].name, data: null, deleted: true, updated: updated ?? Date.now() };
  await persist(kind);
  emit(kind, source, mem[kind][i]);
}

/** Uppdatera delningsinformation utan att ändra tidsstämpeln */
export async function setShare(kind, id, share) {
  const i = mem[kind].findIndex((x) => x.id === id);
  if (i < 0) return;
  mem[kind][i] = { ...mem[kind][i], share };
  await persist(kind);
  emit(kind, 'meta', mem[kind][i]);
}

/** Lyssna på ändringar: fn(kind, source, item). source: 'local' | 'remote' | 'meta' */
export const onLibrary = (fn) => listeners.add(fn);
function emit(kind, source, item) { listeners.forEach((f) => f(kind, source, item)); }
