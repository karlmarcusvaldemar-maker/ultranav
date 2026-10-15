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
    <linearGradient id="scDawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f6f9e"/><stop offset=".5" stop-color="#9fb6cf"/><stop offset=".78" stop-color="#f1b78a"/><stop offset="1" stop-color="#f7d6a0"/></linearGradient>
    <radialGradient id="scSunGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff1c4" stop-opacity=".7"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="scFire" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset=".5" stop-color="#f2b632" stop-opacity=".18"/><stop offset="1" stop-color="#f2b632" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="-800" width="3200" height="900" fill="url(#scSky)"/>
  <rect x="-800" width="3200" height="900" fill="url(#scDawn)" class="dawnsky"/>
  <g class="stars">${stars}</g>
  <g class="moonset"><circle cx="1180" cy="330" r="120" fill="url(#scGlow)"/><circle cx="1180" cy="330" r="30" class="moon"/></g>
  <g class="sunrise"><circle cx="560" cy="300" r="150" fill="url(#scSunGlow)"/><circle cx="560" cy="300" r="34" class="sun"/></g>
  <g class="birds"><g class="birdsi"><path class="bird" d="M0 0 q6 -6 12 0 q6 -6 12 0"/><path class="bird" d="M30 14 q5 -5 10 0 q5 -5 10 0"/><path class="bird" d="M-26 18 q5 -5 10 0 q5 -5 10 0"/></g></g>

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

  <!-- dal -->
  <path class="vale" d="M-800 640 L0 630 C200 610 400 616 620 626 C860 636 1100 612 1600 622 L2400 630 V900 H-800 Z"/>

  <!-- sjö och å -->
  <path class="lake" d="M360 700 C420 664 600 654 760 668 C880 678 900 712 800 730 C640 758 450 756 380 736 C340 724 336 712 360 700 Z"/>
  <path class="river" d="M800 726 C860 744 880 770 860 800 C840 830 880 860 960 900"/>
  <path class="moonpath shimmer" d="M700 690 h70 M716 704 h44 M690 716 h60"/>
  <path class="ripple-static" d="M420 712 h40 M700 700 h50 M470 740 h60"/>

  <!-- gräsfält, hangar, vindstrut -->
  <path class="strip" d="M930 772 L1120 760"/>
  <path class="stripmk" d="M956 770 l16 -1 M1006 767 l16 -1 M1056 764 l16 -1"/>
  <g transform="translate(1128 756)"><path class="hs" d="M0 0 V-16 Q16 -30 32 -16 V0 Z"/><path class="door" d="M8 0 V-10 H24 V0"/></g>
  <!-- klubbstuga vid fältet -->
  <g transform="translate(964 824)">
    <path class="cab-roof" d="M-5 -26 L42 -40 L89 -26 Z"/>
    <path class="hs club" d="M0 0 V-26 H84 V0 Z"/>
    <rect class="clubsign" x="5" y="-24" width="74" height="10" rx="1.5"/>
    <text class="clubtxt" x="42" y="-16.6" text-anchor="middle">ÅSELE FLYGKLUBB</text>
    <rect class="win" x="9" y="-11" width="8" height="6"/><rect class="win" x="22" y="-11" width="8" height="6"/><rect class="win" x="44" y="-11" width="8" height="6"/>
    <path class="cab-door" d="M64 0 V-13 H74 V0"/>
  </g>
  <g class="tko"><g transform="translate(1102 752) scale(-.3 .3)">${BUSH}</g></g>
  <g transform="translate(918 768)"><path class="pole" d="M0 0 V-26"/><g class="sock"><path class="sockp" d="M0 -26 L18 -23 L17 -17 L0 -20 Z"/></g></g>

  <!-- by med tända fönster -->
  ${house(1250, 652, 1)}${house(1272, 658, .9)}${house(1294, 650, 1.1, false)}${house(1318, 660, .85)}${house(1230, 664, .8, false)}

  <!-- helikopterplatta och helikopter som lyfter -->
  <ellipse cx="1196" cy="760" rx="22" ry="6" class="pad"/>
  <path class="padh" d="M1191 757 v6 M1201 757 v6 M1191 760 h10"/>
  <g class="heli"><g transform="translate(1174 730) scale(.62)">${HELI}</g></g>

  <!-- stuga vid sjön med rök, lägereld och förtöjt sjöflygplan -->
  <g transform="translate(486 786)">
    <path class="cab-roof" d="M-4 -18 L18 -34 L40 -18 Z"/>
    <path class="cab" d="M0 0 V-18 H36 V0 Z"/>
    <path class="cab-log" d="M0 -6 H36 M0 -12 H36"/>
    <rect class="cab-chim" x="26" y="-34" width="5" height="10"/>
    <rect class="win glow-win" x="6" y="-14" width="7" height="6"/>
    <path class="cab-door" d="M22 0 V-12 H30 V0"/>
    <path class="smoke" d="M28.5 -36 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -14"/>
  </g>
  <g class="fireup"><ellipse class="fireglow" cx="546" cy="786" rx="46" ry="16" fill="url(#scFire)"/></g>
  <g transform="translate(546 787) scale(.8)">
    <path class="logs" d="M-8 2 L8 -2 M-8 -2 L8 2"/>
    <g class="fireup">
    <g class="flame f1"><path d="M0 -1 C-6 -6 -3 -12 0 -18 C3 -12 6 -6 0 -1 Z"/></g>
    <g class="flame f2"><path d="M-3 -1 C-7 -5 -5 -9 -3 -12 C-1 -9 1 -5 -3 -1 Z M3 -1 C-1 -5 1 -9 3 -12 C5 -9 7 -5 3 -1 Z"/></g>
    <circle class="spark k1" cx="0" cy="-16" r="1"/><circle class="spark k2" cx="2" cy="-18" r=".9"/><circle class="spark k3" cx="-2" cy="-17" r=".8"/>
    </g>
    <path class="smoke ember" d="M0 -3 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -14"/>
  </g>

  <!-- roddbåt: ror ut och fiskar när solen gått upp, ror hem när det blir natt -->
  <g class="rower"><g transform="translate(560 752)"><g class="bob">
    <path class="boat" d="M-13 -1 H13 L9 4 H-9 Z"/>
    <g class="crew">
    <path class="oar" d="M-10 7 L1 -3"/>
    <path class="person" d="M-3 -1 V-8 Q0 -10 3 -8 V-1 Z"/>
    <circle class="head" cx="0" cy="-11.5" r="2.6"/>
    <path class="hat" d="M-3 -12.5 H3 L2 -15 H-2 Z"/>
    <g class="rod"><path class="rodp" d="M2 -6 L18 -19"/><path class="fline" d="M18 -19 L21 1"/><circle class="bobber" cx="21" cy="1" r="1.3"/>
      <ellipse class="fring" cx="21" cy="2" rx="5" ry="1"/></g>
    </g>
  </g></g></g>
  <path class="pier" d="M560 778 L572 778 L592 750 L582 750 Z"/>
  <path class="pier-post" d="M562 778 v5 M571 778 v5 M584 750 v4 M591 750 v4"/>
  <g class="bob"><g transform="translate(578 718) scale(.72)">${SEA}</g></g>
  <ellipse class="ring r1" cx="602" cy="742" rx="26" ry="3.5"/>
  <ellipse class="ring r2" cx="602" cy="742" rx="26" ry="3.5"/>

  <!-- förgrund -->
  <path class="fg" d="M-800 900 L-800 780 C-200 800 0 770 160 790 C320 810 420 860 560 900 Z M1080 900 C1180 830 1340 790 1600 800 L2400 790 V900 Z"/>
  ${forest(-60, 300, (x) => 812 + 18 * Math.sin(x / 60), 16, 1.3, 'tr near')}
  ${forest(1240, 1660, (x) => 820 - 10 * Math.sin(x / 70), 18, 1.3, 'tr near')}

  <!-- bushflygplanet flyger förbi -->
  <g class="fly near"><g class="bobsky"><g transform="translate(0 300) scale(1.05) rotate(-3)">${BUSH}</g></g></g>
</svg>`;

/** Behåll fyllt motiv i alla format (förankrat i nederkant) */
export function fitScene(svg) { svg.setAttribute('preserveAspectRatio', 'xMidYMax slice'); }
