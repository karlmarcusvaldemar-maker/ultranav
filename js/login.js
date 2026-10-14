// Inloggningssida: visas tills användaren är inloggad. Den som har loggat in på enheten tidigare
// släpps in utan nät, så att appen aldrig låser ute en pilot i luften.
import { SCENE_SVG, fitScene } from './scene.js';
import { renderAuthForm } from './account.js';
import { cloudConfigured, onCloud, cloudStatus } from './cloud.js';
import { store, $ } from './util.js';

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
    </div>`;
  fitScene(g.querySelector('svg'));
  if (gateNote) setGateNote(gateNote);
}

const offlineAllowed = () => !navigator.onLine && store.get('ulnav.everLoggedIn', false);

function update() {
  const st = cloudStatus(), g = $('#gate');
  if (!cloudConfigured()) { g.classList.add('hidden'); return; }
  if (st.user || offlineAllowed()) { g.classList.add('hidden'); document.body.classList.remove('gated'); return; }
  build();
  g.classList.remove('hidden'); document.body.classList.add('gated');
  const body = $('#gateBody');
  if (!st.ready) { body.innerHTML = '<div class="muted">Startar…</div>'; return; }
  if (!navigator.onLine) { body.innerHTML = '<div class="warnbox">Ingen internetanslutning. Anslut till nätet för att logga in första gången.</div>'; return; }
  if (!body.querySelector('form')) renderAuthForm(body);
}

export function initLogin() {
  if (!cloudConfigured()) return;
  build(); update();
  onCloud(update);
  addEventListener('online', update); addEventListener('offline', update);
}
