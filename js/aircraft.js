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
};
export const DEFAULT_SYMBOL = 'experimental';
export const symbolOf = (id) => SYMBOLS[id] || SYMBOLS[DEFAULT_SYMBOL];
/** SVG för en symbol. fill/stroke ger färg, size i pixlar. */
export function symbolSvg(id, { fill = '#f2b632', stroke = '#000', size = 40, rot = 0, opacity = 1 } = {}) {
  const s = symbolOf(id);
  return `<svg width="${size}" height="${size}" viewBox="${s.vb}" style="transform:rotate(${s.rotate === false ? 0 : rot}deg);opacity:${opacity}">
    <g fill="${fill}" stroke="${stroke}" stroke-width="${s.vb.endsWith('56') ? 1.5 : 1.3}" stroke-linejoin="round">${s.body}</g></svg>`;
}
