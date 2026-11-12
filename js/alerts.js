// Varningsremsa under instrumentlisten: viktiga varningar (luftrum, GPS) ligger kvar tills de kvitteras eller
// upphör, i stället för att försvinna i den vanliga meddelanderutan. Flera varningar köas; röda visas först.
import { esc } from './util.js';

const active = new Map(); // id → { text, level, at }
const acked = new Set();  // kvitterade: visas inte igen förrän villkoret har upphört (clear)
let el = null, audio = null;

/** Ljud kräver en användargest första gången (iOS) — anropas t.ex. när GPS:en slås på */
export function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* inget ljud */ }
}
function beep() {
  navigator.vibrate?.([200, 100, 200]);
  if (!audio) return;
  try {
    const t = audio.currentTime;
    for (const [f, s] of [[880, 0], [660, 0.2]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + s);
      g.gain.exponentialRampToValueAtTime(0.3, t + s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t + s); o.stop(t + s + 0.2);
    }
  } catch { /* inget ljud */ }
}

/** level: 'bad' (röd) | 'warn' (orange). sound: pip och vibration när varningen är ny. */
export function raise(id, text, { level = 'bad', sound = true } = {}) {
  if (acked.has(id)) return;
  const was = active.get(id);
  if (was && was.text === text && was.level === level) return;
  active.set(id, { text, level, at: was?.at ?? Date.now() });
  if (!was && sound) beep();
  render();
}
/** Villkoret har upphört: ta bort varningen och glöm att den var kvitterad */
export function clear(id) {
  acked.delete(id);
  if (active.delete(id)) render();
}
/** Ta bort alla varningar vars id börjar med prefix och som inte finns i keep */
export function clearExcept(prefix, keep) {
  for (const id of [...active.keys(), ...acked]) if (id.startsWith(prefix) && !keep.has(id)) clear(id);
}

function render() {
  if (!el) {
    el = document.createElement('div');
    el.id = 'alertBar'; el.setAttribute('role', 'alert');
    document.getElementById('mapwrap').appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ack]');
      if (!b) return;
      acked.add(b.dataset.ack); active.delete(b.dataset.ack); render();
    });
  }
  const list = [...active.entries()].sort((a, b) => (a[1].level === 'bad' ? 0 : 1) - (b[1].level === 'bad' ? 0 : 1) || b[1].at - a[1].at);
  el.hidden = !list.length;
  el.innerHTML = list.slice(0, 3).map(([id, a]) => `<div class="al ${a.level}"><span>${esc(a.text)}</span><button type="button" data-ack="${esc(id)}">OK</button></div>`).join('')
    + (list.length > 3 ? `<div class="al more">+${list.length - 3} varningar till</div>` : '');
  // meddelanderutan läggs under remsan
  document.documentElement.style.setProperty('--alertH', list.length ? `${el.offsetHeight + 8}px` : '0px');
}
