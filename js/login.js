// Inloggningssida: visas tills användaren är inloggad. Den som har loggat in på enheten tidigare
// släpps in utan nät, så att appen aldrig låser ute en pilot i luften.
import { SCENE_SVG, fitScene } from './scene.js';
import { renderAuthForm, TERMS_VERSION } from './account.js';
import { cloudConfigured, onCloud, cloudStatus } from './cloud.js';
import { store, $, modal } from './util.js';
import { ic } from './icons.js';

let built = false, gateNote = '';
/** Visa ett meddelande på inloggningssidan (t.ex. om delat innehåll) */
export function setGateNote(html) { gateNote = html; const n = document.getElementById('gateNote'); if (n) n.innerHTML = html; }
function build() {
  if (built) return;
  built = true;
  const g = $('#gate');
  g.innerHTML = `${SCENE_SVG}
    <div class="gatecard" role="dialog" aria-labelledby="gateTitle">
      <div class="brand"><img src="icons/icon.svg" alt="" width="52" height="52"><div><h1 id="gateTitle">Ultranav</h1><p>VFR-navigering för ultralätt flyg</p></div></div>
      <div id="gateNote"></div>
      <div id="gateBody"><div class="muted">Startar…</div></div>
      <div class="gatefoot"><a href="integritet.html" target="_blank" rel="noopener">Integritetspolicy och villkor</a></div>
    </div>`;
  fitScene(g.querySelector('svg'));
  if (gateNote) setGateNote(gateNote);
  dayCycle(g.querySelector('svg'));
}

/** Dygnet i landskapet: solen går upp efter 8 s (gubben dyker upp i båten, ror ut och fiskar, brasan slocknar),
 *  efter 16 s blir det natt (han ror hem och försvinner, brasan tänds). Upprepas.
 *  Årstider i fyra dagar: dag 1 sommar (sjöflygplanet lyfter före solnedgången), dag 2 blir det vinter
 *  (samma plan med skidor landar på isen, och en älg kliver fram), dag 3 lyfter skidplanet,
 *  dag 4 blir det sommar igen och sjöflygplanet landar. */
function dayCycle(svg) {
  if (!svg || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = svg.classList, at = (ms, fn) => setTimeout(fn, ms);
  const row = () => { c.add('rowing'); at(5400, () => c.remove('rowing')); };
  // p = 'fl' (flottörer) eller 'sk' (skidor), kind = 'dep' (lyfter) eller 'arr' (landar)
  const fly = (p, kind, delay) => at(delay, () => {
    if (kind === 'arr') c.remove(p + '-away');
    c.add(p + '-' + kind);
    at(kind === 'dep' ? 5100 : 6100, () => { c.remove(p + '-' + kind); if (kind === 'dep') c.add(p + '-away'); });
  });
  c.add('sk-away');
  let days = 0;
  const run = () => {
    at(8000, () => {
      const ph = days++ % 4;
      if (ph === 1) c.add('winter');
      if (ph === 3) c.remove('winter');
      c.toggle('arrday', ph === 1 || ph === 3);
      c.add('day'); row(); at(5600, () => { if (c.contains('day')) c.add('fishing'); });
      if (days === 2) c.add('egg');
      if (ph === 0) fly('fl', 'dep', 1800);
      if (ph === 1) fly('sk', 'arr', 500);
      if (ph === 2) fly('sk', 'dep', 1800);
      if (ph === 3) fly('fl', 'arr', 500);
    });
    at(16000, () => {
      c.remove('day', 'fishing'); row();
      if (c.contains('egg')) { c.add('eggout'); at(3000, () => c.remove('egg', 'eggout')); }
      run();
    });
  };
  run();
}

const offlineAllowed = () => !navigator.onLine && store.get('ulnav.everLoggedIn', false);

function update() {
  const st = cloudStatus(), g = $('#gate');
  if (!cloudConfigured()) { g.classList.add('hidden'); return; }
  if (st.user || offlineAllowed()) { g.classList.add('hidden'); document.body.classList.remove('gated'); if (st.user) askTerms(); return; }
  build();
  g.classList.remove('hidden'); document.body.classList.add('gated');
  const body = $('#gateBody');
  if (!st.ready) { body.innerHTML = '<div class="muted">Startar…</div>'; return; }
  if (!navigator.onLine) { body.innerHTML = '<div class="warnbox">Ingen internetanslutning. Anslut till nätet för att logga in första gången.</div>'; return; }
  if (!body.querySelector('form')) renderAuthForm(body);
}

/** Inloggade som inte har godkänt villkoren (t.ex. konton från före villkoren) får göra det en gång */
let asked = false;
function askTerms() {
  if (asked || store.get('ulnav.terms', 0) >= TERMS_VERSION) return;
  asked = true;
  modal(`<h3>Innan du flyger med Ultranav</h3>
    <p>Ultranav är ett hjälpmedel för planering och lägesuppfattning. Appen ersätter inte officiell AIP, ICAO-karta, NOTAM, briefing eller godkänd navigationsutrustning.
    Data från öppna källor kan vara ofullständiga eller inaktuella. Befälhavaren ansvarar alltid för flygningen.</p>
    <p class="muted">Läs hur dina uppgifter hanteras i <a href="integritet.html" target="_blank" rel="noopener">integritetspolicyn</a>.</p>
    <div class="btnrow"><button class="btn primary" id="termsOk">${ic('check')}Jag förstår</button></div>`);
  $('#termsOk').onclick = () => { store.set('ulnav.terms', TERMS_VERSION); $('#modal').classList.add('hidden'); };
}

export function initLogin() {
  if (!cloudConfigured()) return;
  build(); update();
  onCloud(update);
  addEventListener('online', update); addEventListener('offline', update);
}
