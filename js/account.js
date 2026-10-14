// Konto-fliken: logga in, skapa konto, glömt lösenord, synkstatus
import { cloudConfigured, cloudStatus, signIn, signUp, signOut, resetPassword, updatePassword, sync } from './cloud.js';
import * as lib from './library.js';
import { esc, $, note, modal, toast } from './util.js';
import { ic } from './icons.js';

let mode = 'login'; // 'login' | 'signup'

export function renderAccountTab(el) {
  if (!cloudConfigured()) {
    el.innerHTML = `<h3>Konto</h3>${note('warn', 'Inloggning är inte konfigurerad ännu. Fyll i Supabase-adressen och nyckeln i <b>js/config.js</b> enligt README, avsnittet <b>Konto och synk</b>.')}
      <div class="muted">Allt fungerar utan konto — rutter, ritningar, kartmaterial och loggbok sparas då bara på den här enheten.</div>`;
    return;
  }
  const st = cloudStatus();
  if (st.user) return renderLoggedIn(el, st);
  el.innerHTML = `<h3>Konto</h3>
    <div class="seg"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">Logga in</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Skapa konto</button></div>
    <form id="accForm" autocomplete="on">
      <div class="field"><span>E-post</span><input type="email" id="accEmail" autocomplete="username" autocapitalize="off" required></div>
      <div class="field"><span>Lösenord</span><input type="password" id="accPw" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" required></div>
      ${mode === 'signup' ? '<div class="field"><span>Upprepa lösenord</span><input type="password" id="accPw2" autocomplete="new-password" minlength="8" required></div>' : ''}
      <div class="btnrow"><button type="submit" class="btn primary">${ic(mode === 'signup' ? 'user' : 'lock')}${mode === 'signup' ? 'Skapa konto' : 'Logga in'}</button>
      ${mode === 'login' ? '<button type="button" class="btn" id="accForgot">Glömt lösenord?</button>' : ''}</div>
    </form>
    <div id="accMsg"></div>
    <h3>Med ett konto</h3>
    <ul class="benefits">
      <li>${ic('sync')}Rutter, ritningar, inställningar och loggbok synkas mellan dina enheter</li>
      <li>${ic('save')}Säkerhetskopia om iPaden byts eller webbläsardata rensas</li>
      <li>${ic('layers')}Eget kartmaterial (KML, shapefil, WMS) sparas på kontot</li>
      <li>${ic('share')}Dela rutter, ritningar, kartlager och flygningar med en länk</li>
    </ul>`;
  el.querySelectorAll('.seg [data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; renderAccountTab(el); });
  const msg = (kind, html) => { $('#accMsg', el).innerHTML = note(kind, html); };
  $('#accForm', el).onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#accEmail', el).value.trim(), pw = $('#accPw', el).value;
    const btn = e.submitter || el.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (mode === 'signup') {
        if (pw !== $('#accPw2', el).value) throw new Error('Lösenorden är inte lika.');
        const r = await signUp(email, pw);
        if (r.needsConfirm) msg('ok', `Kontot är skapat. Vi har skickat ett mejl till <b>${esc(email)}</b> — klicka på länken i mejlet och logga sedan in här.`);
      } else await signIn(email, pw);
    } catch (err) { msg('bad', esc(err.message)); }
    finally { btn.disabled = false; }
  };
  $('#accForgot', el)?.addEventListener('click', async () => {
    const email = $('#accEmail', el).value.trim();
    if (!email) { msg('warn', 'Skriv in din e-postadress först.'); return; }
    try { await resetPassword(email); msg('ok', `Om det finns ett konto för <b>${esc(email)}</b> har vi skickat en länk för att välja nytt lösenord.`); }
    catch (err) { msg('bad', esc(err.message)); }
  });
}

function renderLoggedIn(el, st) {
  const n = (k) => lib.list(k).length;
  const last = st.last ? new Date(st.last).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : 'aldrig';
  el.innerHTML = `<h3>Konto</h3>
    <div class="acct">${ic('user', 28)}<div><b>${esc(st.user.email)}</b><span>Inloggad</span></div></div>
    ${st.error ? note('bad', `Synken misslyckades: ${esc(st.error)}`) : note('ok', st.syncing ? 'Synkar…' : `Synkat ${esc(last)}`, 'sync')}
    <div class="kv"><span>Sparade rutter</span><b>${n('route')}</b><span>Ritningar</span><b>${n('drawing')}</b>
      <span>Eget kartmaterial</span><b>${n('layer')}</b><span>Flygningar</span><b>${n('flight')}</b></div>
    <div class="btnrow"><button class="btn" id="accSync">${ic('sync')}Synka nu</button><button class="btn" id="accPwBtn">${ic('lock')}Byt lösenord</button>
      <button class="btn danger" id="accOut">${ic('logout')}Logga ut</button></div>
    <div class="muted">Synken sker automatiskt när något ändras, när appen öppnas och var femte minut. Utan nät sparas ändringarna och skickas när nätet är tillbaka.</div>`;
  $('#accSync', el).onclick = () => sync();
  $('#accPwBtn', el).onclick = () => askNewPassword();
  $('#accOut', el).onclick = async () => {
    if (!confirm('Logga ut? Det som finns på den här enheten ligger kvar.')) return;
    await signOut(); toast('Utloggad');
  };
}

/** Välj nytt lösenord (efter återställningslänk eller från kontosidan) */
export function askNewPassword() {
  modal(`<h3>Välj nytt lösenord</h3>
    <div class="field"><span>Nytt lösenord</span><input type="password" id="npw1" autocomplete="new-password" minlength="8"></div>
    <div class="field"><span>Upprepa</span><input type="password" id="npw2" autocomplete="new-password" minlength="8"></div>
    <div class="btnrow"><button class="btn primary" id="npwSave">${ic('check')}Spara lösenord</button></div><div id="npwMsg"></div>`);
  $('#npwSave').onclick = async () => {
    const a = $('#npw1').value, b = $('#npw2').value;
    if (a.length < 8) { $('#npwMsg').innerHTML = note('warn', 'Minst 8 tecken.'); return; }
    if (a !== b) { $('#npwMsg').innerHTML = note('warn', 'Lösenorden är inte lika.'); return; }
    try { await updatePassword(a); $('#modal').classList.add('hidden'); toast('Lösenordet är bytt'); }
    catch (err) { $('#npwMsg').innerHTML = note('bad', esc(err.message)); }
  };
}
