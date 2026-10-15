// Ultranavs ikonbibliotek — linjeikoner, 24×24, 1,75 px linje, rundade ändar. Ritas i currentColor.
const P = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  // navigation
  gps: '<circle cx="12" cy="12" r="1.8"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.8 5.8a8.8 8.8 0 0 0 0 12.4M18.2 5.8a8.8 8.8 0 0 1 0 12.4"/>',
  follow: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  north: '<circle cx="12" cy="12" r="9"/><path d="M12 5.5l3 6.5h-6z" fill="currentColor"/><path d="M9 12l3 6.5 3-6.5"/>',
  heading: '<path d="M12 3l6.5 17L12 16l-6.5 4z"/>',
  route: '<circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/><path d="M7.5 18.5h7a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6h7"/>',
  plane: '<path d="M10.2 20.5l1.6-6.3-4.7-.1-1.8 2.2H3.6l1-3.8-1-3.8h1.7l1.8 2.2 4.7-.1-1.6-6.3h2l3.8 6.3 4.2-.1c1.1 0 2.1.8 2.1 1.8s-1 1.8-2.1 1.8l-4.2-.1-3.8 6.3z"/>',
  nearest: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/><circle cx="12" cy="12" r="3.2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  ruler: '<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7.5 12.5l1.8 1.8M10.5 9.5l1.8 1.8M13.5 6.5l1.8 1.8"/>',
  mountain: '<path d="M2.5 20l6.5-11 4 6.5 2.5-3.5L21.5 20z"/><path d="M7.2 12.2l1.8 1.3 1.6-1.4"/>',
  // ritverktyg
  measure: '<path d="M4 19L20 5"/><path d="M4 15v4h4M20 9V5h-4"/>',
  polyline: '<circle cx="4.5" cy="17" r="1.6"/><circle cx="10" cy="9" r="1.6"/><circle cx="15" cy="15" r="1.6"/><circle cx="20" cy="6" r="1.6"/><path d="M5.5 15.7l3.6-5.4M11.2 10.2l2.7 3.6M15.8 13.5l3.4-6"/>',
  polygon: '<path d="M12 3.5l8.5 6.2-3.2 10.3H6.7L3.5 9.7z"/>',
  pin: '<path d="M12 21s-6.5-5.9-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  // allmänt
  road: '<path d="M9 3L5 21M15 3l4 18"/><path d="M12 4v2.5M12 10.5v3M12 17.5V20"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  // baskartor
  mapTopo: '<path d="M3 15c0-4.5 3.7-9 9-9 4.8 0 9 3 9 7.2 0 4.2-3.4 6.3-7.6 6.3-2.3 0-3.2-1-5.4-1C5.2 18.5 3 17.6 3 15z"/><path d="M7 14.2c0-2.7 2.3-5 5.3-5 2.7 0 5 1.7 5 4.1 0 2.3-1.9 3.4-4.2 3.4-1.4 0-2-.6-3.3-.6C8.1 16.1 7 15.5 7 14.2z"/><path d="M11 12.8c0-1 .9-1.7 2-1.7s1.8.6 1.8 1.4c0 .9-.8 1.3-1.6 1.3-.9 0-2.2.2-2.2-1z"/>',
  mapDetail: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/><path d="M5.5 13.5l2.4-1.6 2.6 1.4 2.8-2.4 2.4 1 2.3-1.6" stroke-dasharray="0"/>',
  mapLight: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20" stroke-dasharray="1.5 2.5"/>',
  mapRoad: '<path d="M8 21l2.6-18M16 21L13.4 3"/><path d="M12 18.5v-2.2M12 13v-2M12 8.2V6.8M12 4.6V4"/>',
  satellite: '<rect x="9" y="9" width="6" height="7.5" rx="1.5"/><rect x="2" y="10.25" width="5" height="5"/><rect x="17" y="10.25" width="5" height="5"/><path d="M7 12.75h2M15 12.75h2M4.5 10.25v5M19.5 10.25v5M12 9V6.5"/><path d="M9.8 5a3.2 3.2 0 0 1 4.4 0"/><path d="M10.5 19.5h3"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/>',
  logout: '<path d="M14.5 4.5h3a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3"/><path d="M10 16.5L5.5 12 10 7.5M5.5 12H15"/>',
  book: '<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5z"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18M9 8.5h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  sync: '<path d="M19.5 9A7.8 7.8 0 0 0 5.6 7.3L4.5 8.5M4.5 15a7.8 7.8 0 0 0 13.9 1.7l1.1-1.2"/><path d="M4.5 4.5v4h4M19.5 19.5v-4h-4"/>',
  file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  dots: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  swap: '<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v13.5h-14.5z"/><path d="M8 3.5V8h7V3.5M8 20.5V14h8v6.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15"/>',
  upload: '<path d="M12 15.5V4.5M7 9l5-5 5 5M4.5 19.5h15"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  drawMeasure: '<path d="M6 12.5L14.5 4 17 6.5 8.5 15H6z"/><path d="M12.8 5.7l2.5 2.5"/><path d="M3 15.5h18v4.5H3z"/><path d="M7 15.5v2M11 15.5v2.6M15 15.5v2M18.5 15.5v1.6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  // tillstånd och varningar
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
  fuel: '<path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15.5M3.5 20.5h12M5 10h9"/><path d="M14 8.5h1.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.5 9.3"/>',
  fail: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  // flikar
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.7 1A3.5 3.5 0 0 0 7 18.5z"/>',
  runway: '<path d="M8 21L10 3h4l2 18z"/><path d="M12 6v2.5M12 11v2.5M12 16v2.5"/>',
  log: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  triangle: '<path d="M12 5l7.5 13h-15z"/>',
};

/** SVG-sträng för en ikon */
export function icon(name, size = 22, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
/** Kort alias för mallsträngar: `${ic('save')} Spara` */
export const ic = (name, size = 18) => icon(name, size);

/** Ersätt <i data-icon="namn"></i> i DOM med SVG */
export function applyIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, +(el.dataset.size || 22), el.className);
  });
}
export const ICON_NAMES = Object.keys(P);
