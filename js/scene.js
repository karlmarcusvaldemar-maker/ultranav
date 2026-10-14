// Inloggningssidans bakgrund: utzoomat, stiliserat landskap med rörelse.
// Bergskedjor i lager, skogsåsar, sjö med å, åkrar, by, gräsfält — och flygfarkoster som rör sig.
// All rörelse görs med CSS-animationer (stängs av vid "minska rörelse").

// ---------- siluetter (fyllda, nos åt höger, ca 64 enheter långa) ----------
const BUSH = `<g class="ac">
  <path class="ac-body" d="M0 13 L5 1 L12 1 L17 9 L51 8 Q60 9 63 14 L60 19 L17 20 L3 18 Z"/>
  <path class="ac-body" d="M17 4 H52 V7.5 H17 Z"/>
  <path class="ac-line" d="M26 19 L36 7.5 M44 19 L48 7.5 M44 10.5 H54 L57 14 H44 Z"/>
  <path class="ac-line" d="M64 6 V22"/>
  <path class="ac-line" d="M34 20 L37 25 M44 20 L41 25"/>
  <circle class="ac-wheel" cx="39" cy="27" r="5"/><circle class="ac-hub" cx="39" cy="27" r="1.6"/>
  <circle class="ac-wheel" cx="4" cy="20.5" r="1.8"/>
</g>`;
const SEA = `<g class="ac">
  <path class="ac-body" d="M0 13 L5 1 L12 1 L17 9 L51 8 Q60 9 63 14 L60 19 L17 20 L3 18 Z"/>
  <path class="ac-body" d="M17 4 H52 V7.5 H17 Z"/>
  <path class="ac-line" d="M44 10.5 H54 L57 14 H44 Z M64 7 V21"/>
  <path class="ac-line" d="M24 20 L22 27 M48 20 L50 27"/>
  <path class="ac-body" d="M8 27 H58 Q65 27 66 31 H12 Q7 31 8 27 Z"/>
</g>`;
const HELI = `<g class="ac">
  <path class="ac-body" d="M24 14 Q24 2 40 2 L48 2 Q62 2 64 15 Q63 22 50 22 L32 22 Q24 22 24 14 Z"/>
  <path class="ac-line" d="M50 4 Q60 5 61 13 H50 Z"/>
  <path class="ac-body" d="M26 10 L-6 9 L-6 12 L26 16 Z"/>
  <circle class="ac-body" cx="-7" cy="10" r="4.5"/>
  <path class="ac-line" d="M30 22 L28 28 M56 22 L58 28 M22 28 H66"/>
  <path class="ac-line" d="M44 2 V-3"/>
  <path class="ac-rotor" d="M6 -4 H82"/>
</g>`;

// ---------- landskapselement ----------
const tree = (x, y, s = 1, cls = 'tr') => `<path class="${cls}" d="M${x} ${y - 22 * s} l${-7 * s} ${12 * s} h${3 * s} l${-5 * s} ${9 * s} h${18 * s} l${-5 * s} ${-9 * s} h${3 * s} z"/>`;
/** Skog: många små träd längs en linje (deterministisk "slump") */
function forest(x0, x1, yFn, n, s = 1, cls = 'tr') {
  let out = '', seed = Math.abs(x0 * 7 + n);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (i + rnd() * 0.8) / n;
    out += tree(x.toFixed(1), (yFn(x) + rnd() * 6).toFixed(1), s * (0.75 + rnd() * 0.5), cls);
  }
  return out;
}
const house = (x, y, s = 1, lit = true) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="hs" d="M0 0 V-10 L8 -17 L16 -10 V0 Z"/>${lit ? '<rect class="win" x="5" y="-8" width="3" height="3"/>' : ''}</g>`;

const stars = Array.from({ length: 34 }, (_, i) => {
  const x = (i * 467) % 1600, y = 20 + ((i * 193) % 230), r = i % 5 === 0 ? 1.6 : 1;
  return `<circle class="star s${i % 3}" cx="${x}" cy="${y}" r="${r}"/>`;
}).join('');

export const SCENE_SVG = `<svg class="scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sk0"/><stop offset=".62" class="sk1"/><stop offset="1" class="sk2"/></linearGradient>
    <radialGradient id="scGlow" cx=".5" cy=".5" r=".5"><stop offset="0" class="gl0"/><stop offset="1" class="gl1"/></radialGradient>
  </defs>
  <rect x="-800" width="3200" height="900" fill="url(#scSky)"/>
  ${stars}
  <circle cx="1180" cy="330" r="120" fill="url(#scGlow)"/>
  <circle cx="1180" cy="330" r="30" class="moon"/>

  <!-- drivande moln -->
  <g class="drift d1"><path class="cl" d="M120 170 q20 -18 46 -8 q14 -20 40 -8 q26 -4 30 16 z"/></g>
  <g class="drift d2"><path class="cl" d="M760 120 q18 -16 40 -7 q12 -18 34 -7 q24 -3 26 14 z"/></g>
  <g class="drift d3"><path class="cl" d="M1320 210 q18 -16 40 -7 q12 -18 34 -7 q24 -3 26 14 z"/></g>

  <!-- litet flygplan långt borta -->
  <g class="fly far"><g transform="translate(0 205) scale(.32)">${BUSH}</g></g>

  <!-- bergskedjor i lager -->
  <path class="m1" d="M-800 470 L-300 440 L0 455 L110 400 L190 430 L300 350 L380 395 L470 340 L560 390 L660 320 L740 372 L850 300 L960 380 L1040 342 L1150 395 L1250 330 L1340 386 L1430 350 L1540 400 L1600 380 L2400 420 V900 H-800 Z"/>
  <path class="snow" d="M282 364 L300 350 L318 365 M452 354 L470 340 L486 352 M640 336 L660 320 L680 334 M830 316 L850 300 L870 316 M1232 344 L1250 330 L1268 344"/>
  <path class="m2" d="M-800 520 L0 510 L80 470 L170 500 L260 440 L360 490 L460 455 L580 500 L700 430 L800 480 L900 450 L1020 500 L1130 445 L1230 490 L1330 460 L1440 505 L1600 470 L2400 500 V900 H-800 Z"/>
  <path class="m3" d="M-800 580 L0 570 C120 540 220 530 330 556 S560 530 700 560 S960 520 1100 552 S1380 530 1600 556 L2400 560 V900 H-800 Z"/>
  ${forest(-40, 1640, (x) => 560 + 12 * Math.sin(x / 90), 120, 0.55, 'tr far')}

  <!-- dal: ängar och åkrar -->
  <path class="vale" d="M-800 640 L0 630 C200 610 400 616 620 626 C860 636 1100 612 1600 622 L2400 630 V900 H-800 Z"/>
  <path class="field f1" d="M1010 660 L1130 650 L1150 676 L1026 688 Z"/>
  <path class="field f2" d="M1140 648 L1250 640 L1276 664 L1160 674 Z"/>
  <path class="field f1" d="M1030 694 L1158 682 L1178 712 L1046 726 Z"/>
  <path class="furrow" d="M1020 668 L1138 657 M1024 678 L1142 667 M1150 656 L1258 648 M1156 666 L1266 657 M1040 704 L1166 692 M1044 716 L1172 704"/>

  <!-- sjö och å -->
  <path class="lake" d="M360 700 C420 664 600 654 760 668 C880 678 900 712 800 730 C640 758 450 756 380 736 C340 724 336 712 360 700 Z"/>
  <path class="river" d="M800 726 C860 744 880 770 860 800 C840 830 880 860 960 900"/>
  <path class="moonpath shimmer" d="M700 690 h70 M716 704 h44 M690 716 h60"/>
  <path class="ripple-static" d="M420 712 h40 M700 700 h50 M470 740 h60"/>

  <!-- gräsfält, hangar, vindstrut -->
  <path class="strip" d="M1180 760 L1470 742"/>
  <path class="stripmk" d="M1210 758 l18 -1.2 M1270 754 l18 -1.2 M1330 750 l18 -1.2 M1390 746 l18 -1.2"/>
  <g transform="translate(1480 734)"><path class="hs" d="M0 0 V-16 Q16 -30 32 -16 V0 Z"/><path class="door" d="M8 0 V-10 H24 V0"/></g>
  <g transform="translate(1168 752)"><path class="pole" d="M0 0 V-26"/><g class="sock"><path class="sockp" d="M0 -26 L18 -23 L17 -17 L0 -20 Z"/></g></g>

  <!-- by med tända fönster -->
  ${house(900, 652, 1)}${house(922, 658, .9)}${house(944, 650, 1.1, false)}${house(968, 660, .85)}${house(880, 664, .8, false)}
  <path class="road" d="M860 672 C900 678 950 680 980 694 C1000 716 1060 748 1180 760"/>

  <!-- helikopterplatta och helikopter som lyfter -->
  <ellipse cx="1000" cy="736" rx="22" ry="6" class="pad"/>
  <path class="padh" d="M995 733 v6 M1005 733 v6 M995 736 h10"/>
  <g class="heli"><g transform="translate(978 706) scale(.62)">${HELI}</g></g>

  <!-- sjöflygplan vid brygga -->
  <path class="dock" d="M648 752 L648 726"/>
  <g class="bob"><g transform="translate(560 694) scale(.8)">${SEA}</g></g>
  <ellipse class="ring r1" cx="588" cy="722" rx="30" ry="4"/>
  <ellipse class="ring r2" cx="588" cy="722" rx="30" ry="4"/>

  <!-- förgrund -->
  <path class="fg" d="M-800 900 L-800 780 C-200 800 0 770 160 790 C320 810 420 860 560 900 Z M1080 900 C1180 830 1340 790 1600 800 L2400 790 V900 Z"/>
  ${forest(-60, 300, (x) => 812 + 18 * Math.sin(x / 60), 16, 1.3, 'tr near')}
  ${forest(1240, 1660, (x) => 820 - 10 * Math.sin(x / 70), 18, 1.3, 'tr near')}

  <!-- bushflygplanet flyger förbi -->
  <g class="fly near"><g class="bobsky"><g transform="translate(0 300) scale(1.05) rotate(-3)">${BUSH}</g></g></g>
</svg>`;

/** Behåll fyllt motiv i alla format (förankrat i nederkant) */
export function fitScene(svg) { svg.setAttribute('preserveAspectRatio', 'xMidYMax slice'); }
