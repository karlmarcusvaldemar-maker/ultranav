// Symboler för luftfarkoster sedda uppifrån, nos uppåt (roteras efter färdriktningen).
// Används för egen position och för andra Ultranav-piloter.
export const SYMBOLS = {
  experimental: { name: 'Experimental', vb: '0 0 40 40', body: `
    <path d="M20 12.2 L36.5 15.6 Q38 16 37.6 17.6 L37.2 19.4 L20 19.6 L2.8 19.4 L2.4 17.6 Q2 16 3.5 15.6 Z"/>
    <path d="M18.6 5.4 Q20 2.2 21.4 5.4 L22 27 L20.8 36 H19.2 L18 27 Z"/>
    <path d="M13.6 32 L26.4 32 Q27 32 27 32.8 L26.6 34.6 H13.4 L13 32.8 Q13 32 13.6 32 Z"/>
    <ellipse cx="20" cy="11" rx="1.4" ry="2.6" fill="#17212c" stroke="none"/>` },
  ul: { name: 'Ultralätt', vb: '0 0 40 40', body: `
    <rect x="2.5" y="12.5" width="35" height="5.5" rx="2.6"/>
    <path d="M18.4 6.5 Q20 2.8 21.6 6.5 L22.1 29 L21.2 35.5 H18.8 L17.9 29 Z"/>
    <rect x="12.5" y="31" width="15" height="3.6" rx="1.6"/><path d="M15.5 4.6 H24.5" stroke-width="1.6"/>` },
  bush: { name: 'Bushplan', vb: '0 0 40 40', body: `
    <ellipse cx="15.2" cy="10" rx="2.1" ry="2.8"/><ellipse cx="24.8" cy="10" rx="2.1" ry="2.8"/>
    <rect x="1.5" y="12.8" width="37" height="6.4" rx="2.8"/>
    <path d="M18.3 6 Q20 2.5 21.7 6 L22.2 30 L21.2 36 H18.8 L17.8 30 Z"/>
    <rect x="11.5" y="31" width="17" height="4" rx="1.8"/><path d="M15 4 H25" stroke-width="1.6"/>
    <path d="M18.2 19 L9.5 15.6 M21.8 19 L30.5 15.6" fill="none" stroke-width=".9"/>` },
  jet: { name: 'Jetplan', vb: '0 0 56 56', body: `
    <path d="M28 4 L31 22 L50 30 L50 34 L31 30 L30 44 L36 48 L36 51 L28 49 L20 51 L20 48 L26 44 L25 30 L6 34 L6 30 L25 22 Z"/>` },
  trike: { name: 'Trike', vb: '0 0 40 40', body: `
    <path d="M20 5 L38 23.5 Q29 20.5 20 21 Q11 20.5 2 23.5 Z"/>
    <path d="M18.6 15.5 Q20 11.5 21.4 15.5 L21.6 27 Q20 29.5 18.4 27 Z"/>
    <circle cx="20" cy="12.6" r="1.3"/><circle cx="16.2" cy="27.2" r="1.5"/><circle cx="23.8" cy="27.2" r="1.5"/>
    <path d="M16 30.6 H24" stroke-width="1.6"/>` },
  paraglider: { name: 'Skärmflyg', vb: '0 0 40 40', body: `
    <path d="M8.5 17.5 L20 27 L31.5 17.5 M14 14.6 L20 27 L26 14.6" fill="none" stroke-width=".8"/>
    <path d="M3 14.5 Q20 5.5 37 14.5 L35.8 19 Q20 11 4.2 19 Z"/>
    <path d="M9 11.6 L9.8 16.4 M14.5 9.9 L15 14.6 M20 9.3 V14 M25.5 9.9 L25 14.6 M31 11.6 L30.2 16.4" fill="none" stroke-width=".8"/>
    <circle cx="20" cy="27.6" r="2.7"/>` },
  balloon: { name: 'Luftballong', vb: '0 0 40 40', rotate: false, body: `
    <circle cx="20" cy="20" r="15"/>
    <path d="M20 5 V35 M5 20 H35 M9.4 9.4 L30.6 30.6 M30.6 9.4 L9.4 30.6" fill="none" stroke-width=".8"/>
    <circle cx="20" cy="20" r="3.4" fill="#17212c"/>` },
  wright: { name: 'Bröderna Wright', vb: '0 0 40 40', body: `
    <path d="M17 7.2 L18 15.2 M23 7.2 L22 15.2 M18.2 20.8 L18.4 29 M21.8 20.8 L21.6 29" fill="none" stroke-width="1"/>
    <rect x="13" y="4" width="14" height="3.2" rx=".8"/>
    <rect x="1" y="15" width="38" height="5.8" rx="1"/>
    <ellipse cx="11" cy="23" rx="3.4" ry="1.1"/><ellipse cx="29" cy="23" rx="3.4" ry="1.1"/>
    <rect x="17.4" y="28.6" width="1.6" height="5.4"/><rect x="21" y="28.6" width="1.6" height="5.4"/>
    <circle cx="17" cy="17.9" r="1.3" fill="#17212c" stroke="none"/>` },
  heli: { name: 'Helikopter', vb: '0 0 40 40', body: `
    <path d="M19.2 23 L19.6 35 H20.4 L20.8 23 Z"/><path d="M17 34.6 H23" stroke-width="1.5"/>
    <ellipse cx="20" cy="17.5" rx="4.6" ry="6.6"/>
    <path d="M4 9 L36 26 M36 9 L4 26" fill="none" stroke-width="1.8"/>
    <circle cx="20" cy="17.5" r="1.4" fill="#17212c" stroke="none"/>` },
  broom: { name: 'Kvast', vb: '0 0 40 40', body: `
    <rect x="18.8" y="1.6" width="2.4" height="21.4" rx="1.2" fill="#8b5a2b"/>
    <path d="M16.4 23 H23.6 L29.6 36.8 Q20 39.6 10.4 36.8 Z"/>
    <path d="M18.2 25 L14.6 36.8 M20 25 V37.8 M21.8 25 L25.4 36.8" fill="none" stroke-width=".7"/>
    <rect x="15.8" y="21.4" width="8.4" height="3.2" rx="1.2" fill="#5a3a1a"/>` },
  landrover: { name: 'Land Rover', vb: '0 0 40 40', profile: true, body: `
    <path d="M1.5 24.3 V12.3 H26.9 L27.7 17.4 L27.9 18 H37.9 V24.3 H36.4 V21.4 Q36.4 20.4 35.4 20.4 H29.6 Q28.6 20.4 28.6 21.4 V24.3 H13.4 V21.4 Q13.4 20.4 12.4 20.4 H6.6 Q5.6 20.4 5.6 21.4 V24.3 Z"/>
    <path d="M2 12.3 V11.4 H25.8 V12.3 Z" fill="#f4f0e6" stroke-width=".7"/>
    <path d="M3 13.8 H9.6 V17 H3 Z M10.4 13.8 H16.4 V17 H10.4 Z M17.4 13.8 H21.8 V17 H17.4 Z M22.6 13.8 H26.4 L26.9 17 H22.6 Z" fill="#17212c" stroke="none"/>
    <path d="M3.4 12.7 H8 M10 12.7 H15 M17 12.7 H22" stroke="#17212c" stroke-width=".6"/>
    <path d="M16.9 13.4 V23.8 M22.2 13.4 V23.8" fill="none" stroke-width=".6"/>
    <path d="M30.4 16.2 H35.8 V18 H30.4 Z" fill="#1b1b1b" stroke="none"/>
    <path d="M.5 15.2 H1.5 V21.4 H.5 Z" fill="#1b1b1b" stroke="none"/>
    <circle cx="37.6" cy="19.6" r=".8" fill="#ffe39a" stroke="none"/>
    <path d="M36.8 23.3 H39.3 V24.8 H36.8 Z M.9 23.5 H2.6 V24.6 H.9 Z" fill="#1b1b1b" stroke="none"/>
    <circle cx="9.5" cy="25.27" r="3.33" fill="#1b1b1b"/><circle cx="9.5" cy="25.27" r="1.8" fill="#e8e4d8" stroke="none"/><circle cx="9.5" cy="25.27" r=".6" fill="#555" stroke="none"/>
    <circle cx="32.5" cy="25.27" r="3.33" fill="#1b1b1b"/><circle cx="32.5" cy="25.27" r="1.8" fill="#e8e4d8" stroke="none"/><circle cx="32.5" cy="25.27" r=".6" fill="#555" stroke="none"/>` },
  saab900: { name: 'Saab 900', vb: '0 0 40 40', profile: true, body: `
    <path d="M2.6 22.9 V17.6 L3 17 Q3.4 16.6 4.2 16.5 Q8.6 14.2 12.6 13.4 Q17.4 13.1 21.8 13.3 Q23 13.4 23.6 14.2 Q24.6 15.8 25.8 17.4 Q30 17.5 32.6 17.9 Q36.2 18.4 37.6 19.6 Q38.4 20.3 38.4 21.2 V22.9 H33.9 A3.5 3.5 0 0 0 26.9 22.9 H14 A3.5 3.5 0 0 0 7 22.9 Z"/>
    <path d="M6.4 17.3 Q9.6 15.2 12.9 14.3 L14.6 14.15 V17.4 Z M15.4 14.1 H21.5 Q22.3 14.15 22.7 14.8 L24.6 17.4 H15.4 Z" fill="#17212c" stroke="none"/>
    <path d="M15 17.5 V22.4 M25 17.5 L25.6 22.4" fill="none" stroke-width=".5"/>
    <path d="M1.5 19.8 H4 V23.3 H1.9 Z M36.6 20 H39.1 V23 H36.6 Z" fill="#1b1b1b" stroke="none"/>
    <path d="M1.9 21 H3.8 M1.9 22 H3.8 M36.8 21.1 H38.9 M36.8 22 H38.9" stroke="#555" stroke-width=".3"/>
    <path d="M4 20.4 H36.6" fill="none" stroke="#1b1b1b" stroke-width=".8"/>
    <rect x="37.7" y="19.3" width=".8" height="1" fill="#ffe39a" stroke="none"/><rect x="2.6" y="17.6" width=".8" height="2" fill="#d9534f" stroke="none"/>
    <circle cx="10.5" cy="22.9" r="2.9" fill="#1b1b1b"/><circle cx="10.5" cy="22.9" r="1.8" fill="#c9c9c9" stroke="none"/><path d="M10.5 21.4 Q11.4 22.15 10.5 22.9 M11.8 23.65 Q10.65 23.75 10.5 22.9 M9.2 23.65 Q9.45 22.6 10.5 22.9" fill="none" stroke="#555" stroke-width=".45"/>
    <circle cx="30.4" cy="22.9" r="2.9" fill="#1b1b1b"/><circle cx="30.4" cy="22.9" r="1.8" fill="#c9c9c9" stroke="none"/><path d="M30.4 21.4 Q31.3 22.15 30.4 22.9 M31.7 23.65 Q30.55 23.75 30.4 22.9 M29.1 23.65 Q29.35 22.6 30.4 22.9" fill="none" stroke="#555" stroke-width=".45"/>` },
};
export const DEFAULT_SYMBOL = 'experimental';
export const symbolOf = (id) => SYMBOLS[id] || SYMBOLS[DEFAULT_SYMBOL];
/** SVG för en symbol. fill/stroke ger färg, size i pixlar. */
/** Hur symbolen ska vändas för en viss riktning: flygfarkoster roteras, bilar (profil) speglas åt rätt håll */
export function symbolTransform(id, rot = 0) {
  const s = symbolOf(id);
  if (s.profile) { const r = ((rot % 360) + 360) % 360; return r > 180 && r < 360 ? 'scaleX(-1)' : 'none'; }
  return s.rotate === false ? 'none' : `rotate(${rot}deg)`;
}
export function symbolSvg(id, { fill = '#f2b632', stroke = '#000', size = 40, rot = 0, opacity = 1 } = {}) {
  const s = symbolOf(id);
  return `<svg width="${size}" height="${size}" viewBox="${s.vb}" style="transform:${symbolTransform(id, rot)};opacity:${opacity}">
    <g fill="${fill}" stroke="${stroke}" stroke-width="${s.vb.endsWith('56') ? 1.5 : 1.3}" stroke-linejoin="round">${s.body}</g></svg>`;
}
