import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TIERS } from '../../lib/ranks';

/**
 * TIER TOTEMS — the six ranks as sculpted, colour-matched animals.
 * ---------------------------------------------------------------------------
 * This is the single most-seen object in the rewards hub: it sits in the hero
 * banner, on every badge card, on the perk medals and inside the shareable
 * profile card. It therefore has to look like a *medal*, not like a sticker.
 *
 * THE DESIGN (why it looks the way it does)
 *   · MEDALLION FIRST — a tier-coloured rim, a glass inner plate and a slow
 *     dashed orbit frame the animal. The rim carries the tier colour, so the
 *     rank reads even in a 38 px achievement row.
 *   · NO SKEW — the previous build rotated the animal (rotateZ/rotateY inside
 *     the idle keyframes), which read as a crooked sticker rather than a
 *     badge. The idle is now a pure vertical float plus a breathing rim; the
 *     animal's geometry is never rotated.
 *   · SCULPTED, NOT FLAT — every animal is built from four layers: a base
 *     gradient body, a darker under-layer for occlusion, a rim light along
 *     the top-left edge and a specular highlight. That is what separates a
 *     "3D-looking" animal from a flat icon, and it costs nothing at runtime.
 *   · ONE SOURCE, EVERY SIZE — the same SVG renders at 38 px in an
 *     achievement row and at 160 px in the hero banner.
 *
 * WHY HAND-BUILT SVG AND NOT three.js / Lottie
 *   · three.js is ~600 kB before the first model; this is a few kB of paths
 *     and reuses the tab's existing framer-motion. On the mid-range Android
 *     this app ships to, a WebGL context per medal is the wrong trade.
 *   · Lottie needs six JSON files plus a runtime; SVG scales from 18 px in a
 *     stat row to 160 px in the hero from one source.
 *   · The colour comes from TIERS, not a hard-coded palette, so a tier colour
 *     change propagates everywhere at once.
 *
 * `prefers-reduced-motion` switches every idle off.
 */

export const TIER_ANIMALS = Object.freeze({
  bronze: 'turtle',
  silver: 'wolf',
  gold: 'lion',
  platinum: 'eagle',
  diamond: 'dragon',
  legend: 'phoenix'
});

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function mix(hex, target, amount) {
  const source = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'cd7f32';
  const a = Math.max(0, Math.min(1, amount));
  const channels = [0, 2, 4].map((offset) => {
    const from = parseInt(source.slice(offset, offset + 2), 16);
    const to = target;
    return clampByte(from + (to - from) * a).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function palette(base) {
  return {
    base,
    light: mix(base, 255, 0.44),
    glow: mix(base, 255, 0.22),
    dark: mix(base, 0, 0.26),
    darker: mix(base, 0, 0.52),
    deep: mix(base, 0, 0.7)
  };
}

/** A closed, alternating-radius star — the lion's mane and generic bursts. */
function starPath(cx, cy, spikes, outer, inner, rotation = -90) {
  let d = '';
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = ((rotation + (i * 180) / spikes) * Math.PI) / 180;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

const LION_MANE = starPath(60, 64, 14, 51, 43);
const LION_MANE_INNER = starPath(60, 64, 14, 46, 39);

/* ========================================================================== *
 *  BRONZE — THE TURTLE: patient, self-custodial, slow and certain.
 * ========================================================================== */
function Turtle({ c, g }) {
  return (
    <g>
      {/* rear flippers, behind the shell */}
      <ellipse cx="26" cy="57" rx="12" ry="5.6" transform="rotate(-26 26 57)" fill={c.dark} stroke={c.darker} strokeWidth="0.9" />
      <ellipse cx="94" cy="57" rx="12" ry="5.6" transform="rotate(26 94 57)" fill={c.dark} stroke={c.darker} strokeWidth="0.9" />
      <ellipse cx="26" cy="57" rx="7" ry="3" transform="rotate(-26 26 57)" fill={c.darker} opacity=".7" />
      <ellipse cx="94" cy="57" rx="7" ry="3" transform="rotate(26 94 57)" fill={c.darker} opacity=".7" />

      {/* neck + head, right side */}
      <path d="M84 58 C90 54 95 52 99 54 L99 66 C93 66 88 64 84 62 Z" fill={c.dark} />
      <path
        d="M96 46 C106 46 113 52 113 60 C113 68 106 73 97 72 C89 71 84 65 84 57 C84 50 89 46 96 46 Z"
        fill={`url(#${g.body})`}
        stroke={c.darker}
        strokeWidth="1.4"
      />
      <path d="M96 47 C90 48 86 52 85 57 C88 52 92 49 97 48 Z" fill={c.light} opacity=".45" />
      <ellipse cx="105" cy="58" rx="4.4" ry="4.8" fill="#0b0f16" />
      <ellipse cx="106" cy="56.6" rx="1.7" ry="1.7" fill="#fff" opacity=".92" />
      <circle cx="104" cy="59.6" r=".7" fill={c.light} opacity=".7" />
      <path d="M110 64 C106 67 101 67 98 65" stroke={c.darker} strokeWidth="1.2" fill="none" strokeLinecap="round" />

      {/* shell — under-layer, then body, then plates */}
      <ellipse cx="58" cy="68" rx="37" ry="28" fill={c.darker} />
      <ellipse cx="58" cy="64" rx="37" ry="28" fill={`url(#${g.body})`} />
      <path d="M58 36 L78 46 L78 65 L58 79 L38 65 L38 46 Z" fill={c.dark} opacity=".5" />
      <path d="M58 36 L58 79 M38 46 L78 65 M78 46 L38 65" stroke={c.light} strokeOpacity=".32" strokeWidth="0.9" fill="none" />
      <path d="M23 54 L38 46 L38 65 L24 73 Z" fill={c.deep} opacity=".42" />
      <path d="M93 54 L78 46 L78 65 L92 73 Z" fill={c.deep} opacity=".42" />
      <path d="M30 50 C38 41 48 37 58 36" stroke={c.light} strokeOpacity=".55" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <ellipse cx="58" cy="64" rx="37" ry="28" fill="none" stroke={c.darker} strokeWidth="2.2" />
      <ellipse cx="58" cy="64" rx="29" ry="20" fill="none" stroke={c.light} strokeOpacity=".24" strokeWidth="1" strokeDasharray="2 4" />

      {/* front flippers */}
      <path d="M40 80 C30 82 22 90 24 95 C27 100 38 94 45 86 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M76 80 C86 82 94 90 92 95 C89 100 78 94 71 86 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M41 84 C34 87 29 91 27 94" stroke={c.light} strokeOpacity=".4" strokeWidth="1" fill="none" />
      <path d="M75 84 C82 87 87 91 89 94" stroke={c.light} strokeOpacity=".4" strokeWidth="1" fill="none" />

      {/* tail + ground glint */}
      <path d="M58 92 L58 99" stroke={c.darker} strokeWidth="3" strokeLinecap="round" />
      <circle cx="40" cy="26" r="1.5" fill={c.light} opacity=".8" />
      <circle cx="86" cy="34" r="1" fill={c.light} opacity=".5" />
    </g>
  );
}

/* ========================================================================== *
 *  SILVER — THE WOLF: sharp, alert, a pack hunter.
 * ========================================================================== */
function Wolf({ c, g }) {
  return (
    <g>
      {/* ruff */}
      <path d="M30 58 L18 76 L32 74 L26 92 L44 82 L38 101 L60 88 L82 101 L76 82 L94 92 L88 74 L102 76 L90 58 Z" fill={c.deep} opacity=".92" />

      {/* ears */}
      <path d="M32 44 L26 12 L52 32 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M88 44 L94 12 L68 32 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M35 41 L31 20 L46 32 Z" fill={c.deep} />
      <path d="M85 41 L89 20 L74 32 Z" fill={c.deep} />
      <path d="M33 40 L30 26" stroke={c.light} strokeOpacity=".5" strokeWidth="1" strokeLinecap="round" />

      {/* skull */}
      <path d="M60 28 C78 28 90 40 90 58 C90 74 78 92 60 100 C42 92 30 74 30 58 C30 40 42 28 60 28 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.6" />
      {/* brow ridge */}
      <path d="M60 29 C48 29 38 38 34 50 L50 44 L60 47 L70 44 L86 50 C82 38 72 29 60 29 Z" fill={c.light} opacity=".22" />
      {/* cheek planes */}
      <path d="M33 56 C36 74 46 88 58 97 L60 88 C48 78 41 66 39 54 Z" fill={c.light} opacity=".2" />
      <path d="M87 56 C84 74 74 88 62 97 L60 88 C72 78 79 66 81 54 Z" fill={c.deep} opacity=".3" />

      {/* eyes */}
      <path d="M40 54 L56 57 L42 63 Z" fill="#eafcff" />
      <path d="M80 54 L64 57 L78 63 Z" fill="#eafcff" />
      <circle cx="49" cy="58" r="2.4" fill="#06121a" />
      <circle cx="71" cy="58" r="2.4" fill="#06121a" />
      <circle cx="49.8" cy="57" r=".85" fill="#fff" />
      <circle cx="71.8" cy="57" r=".85" fill="#fff" />

      {/* muzzle */}
      <path d="M60 62 C69 62 75 68 75 76 C75 86 68 94 60 96 C52 94 45 86 45 76 C45 68 51 62 60 62 Z" fill={c.light} opacity=".52" />
      <path d="M52 72 C52 68 56 66 60 66 C64 66 68 68 68 72 C68 77 64 80 60 80 C56 80 52 77 52 72 Z" fill="#0a0f17" />
      <path d="M60 80 L60 87" stroke={c.darker} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M60 87 C56 91 50 90 47 87 M60 87 C64 91 70 90 73 87" stroke={c.darker} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* fangs */}
      <path d="M53 89 L55 95 L58 89 Z" fill="#f4fbff" />
      <path d="M67 89 L65 95 L62 89 Z" fill="#f4fbff" />

      {/* top light + whiskers */}
      <path d="M38 44 C46 33 54 30 60 30" stroke="#fff" strokeOpacity=".3" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M44 70 L30 67 M44 76 L30 76 M76 70 L90 67 M76 76 L90 76" stroke={c.light} strokeOpacity=".35" strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

/* ========================================================================== *
 *  GOLD — THE LION: the crown of the ladder.
 * ========================================================================== */
function Lion({ c, g }) {
  return (
    <g>
      {/* mane */}
      <path d={LION_MANE} fill={c.deep} />
      <path d={LION_MANE_INNER} fill={`url(#${g.deep})`} />
      <path d={starPath(60, 64, 14, 44, 39)} fill={c.dark} opacity=".55" />

      {/* ears */}
      <circle cx="35" cy="44" r="9" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.1" />
      <circle cx="85" cy="44" r="9" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.1" />
      <circle cx="35" cy="44" r="4.4" fill={c.deep} />
      <circle cx="85" cy="44" r="4.4" fill={c.deep} />

      {/* face */}
      <ellipse cx="60" cy="64" rx="27" ry="27" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.4" />
      <ellipse cx="60" cy="72" rx="18" ry="14" fill={c.light} opacity=".3" />
      <path d="M60 37 C48 37 38 45 35 56 L50 48 L60 52 L70 48 L85 56 C82 45 72 37 60 37 Z" fill={c.light} opacity=".3" />

      {/* eyes */}
      <path d="M42 58 C46 54 53 54 56 58 C52 63 46 63 42 58 Z" fill="#fff8e2" />
      <path d="M78 58 C74 54 67 54 64 58 C68 63 74 63 78 58 Z" fill="#fff8e2" />
      <circle cx="49" cy="58" r="2.9" fill="#2a1a03" />
      <circle cx="71" cy="58" r="2.9" fill="#2a1a03" />
      <circle cx="50" cy="56.8" r="1.1" fill="#fff" />
      <circle cx="72" cy="56.8" r="1.1" fill="#fff" />
      <path d="M41 52 C45 49 53 49 57 52" stroke={c.deep} strokeOpacity=".6" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M79 52 C75 49 67 49 63 52" stroke={c.deep} strokeOpacity=".6" strokeWidth="1.2" fill="none" strokeLinecap="round" />

      {/* muzzle + nose */}
      <ellipse cx="49" cy="71" rx="10" ry="8" fill={c.light} opacity=".4" />
      <ellipse cx="71" cy="71" rx="10" ry="8" fill={c.light} opacity=".4" />
      <path d="M50 64 Q60 58 70 64 Q69 73 60 75 Q51 73 50 64 Z" fill="#2b1a04" />
      <path d="M60 75 L60 81 M60 81 Q55 86 50 82 M60 81 Q65 86 70 82" stroke="#3a2408" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M55 66 L60 64 L65 66" stroke={c.light} strokeOpacity=".3" strokeWidth="1" fill="none" />

      {/* whiskers + mane rim light */}
      <path d="M44 68 L28 64 M44 73 L28 74 M76 68 L92 64 M76 73 L92 74" stroke={c.light} strokeOpacity=".4" strokeWidth="1" strokeLinecap="round" />
      <circle cx="44" cy="69" r=".9" fill={c.deep} opacity=".8" />
      <circle cx="76" cy="69" r=".9" fill={c.deep} opacity=".8" />
      <path d="M26 40 C32 26 46 14 60 13" stroke={c.light} strokeOpacity=".35" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="96" cy="30" r="1.4" fill={c.light} opacity=".75" />
      <circle cx="22" cy="88" r="1.1" fill={c.light} opacity=".5" />
    </g>
  );
}

/* ========================================================================== *
 *  PLATINUM — THE EAGLE: vision from above.
 * ========================================================================== */
function Eagle({ c, g }) {
  return (
    <g>
      {/* wings — swept crescents, three feather planes each */}
      <path d="M52 61 C41 47 27 32 9 22 C24 39 32 52 37 67 C42 62 47 60 52 61 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M68 61 C79 47 93 32 111 22 C96 39 88 52 83 67 C78 62 73 60 68 61 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M47 52 C38 43 30 34 20 27 M43 59 C35 52 27 44 18 38 M39 65 C33 59 26 53 18 48" stroke={c.light} strokeOpacity=".4" strokeWidth="1" fill="none" />
      <path d="M73 52 C82 43 90 34 100 27 M77 59 C85 52 93 44 102 38 M81 65 C87 59 94 53 102 48" stroke={c.light} strokeOpacity=".4" strokeWidth="1" fill="none" />

      {/* body */}
      <path d="M60 46 C70 46 76 56 76 68 L74 86 C70 93 65 96 60 96 C55 96 50 93 46 86 L44 68 C44 56 50 46 60 46 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M53 56 C51 68 52 78 55 86 M67 56 C69 68 68 78 65 86" stroke={c.light} strokeOpacity=".28" strokeWidth="1.1" fill="none" />

      {/* head */}
      <path d="M60 14 C76 14 87 25 87 39 C87 49 79 56 69 58 L60 60 L51 58 C41 56 33 49 33 39 C33 25 44 14 60 14 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.3" />
      <path d="M60 14 C45 14 34 23 33 36 L49 29 L60 33 L71 29 L87 36 C85 23 75 14 60 14 Z" fill="#ffffff" opacity=".88" />
      <path d="M60 15 C70 15 78 19 83 26" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" fill="none" strokeLinecap="round" />

      {/* angry brow */}
      <path d="M35 35 L54 30 L55 37 L37 43 Z" fill={c.deep} opacity=".9" />
      <path d="M85 35 L66 30 L65 37 L83 43 Z" fill={c.deep} opacity=".9" />

      {/* eyes */}
      <circle cx="48" cy="45" r="6.2" fill="#ffd84d" />
      <circle cx="72" cy="45" r="6.2" fill="#ffd84d" />
      <circle cx="48" cy="45.4" r="2.6" fill="#0a1118" />
      <circle cx="72" cy="45.4" r="2.6" fill="#0a1118" />
      <circle cx="49" cy="44" r="1" fill="#fff" />
      <circle cx="73" cy="44" r="1" fill="#fff" />
      <circle cx="48" cy="45" r="6.2" fill="none" stroke={c.deep} strokeOpacity=".5" strokeWidth=".8" />
      <circle cx="72" cy="45" r="6.2" fill="none" stroke={c.deep} strokeOpacity=".5" strokeWidth=".8" />

      {/* beak */}
      <path d="M51 50 L69 50 L72 56 L65 60 L60 64 L55 60 L48 56 Z" fill="#ffc93c" stroke="#6f5003" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M51 50 L69 50 L69 53 L51 53 Z" fill="#ffe27a" />
      <path d="M55 57 L60 56 L65 57 L63 62 L60 65 L57 62 Z" fill="#e0a800" />
      <circle cx="55" cy="51.4" r=".9" fill="#6f5003" />
      <circle cx="65" cy="51.4" r=".9" fill="#6f5003" />
      <path d="M60 53 L60 63" stroke="#6f5003" strokeWidth="1" opacity=".55" />

      {/* cheek marks + crest */}
      <path d="M40 50 C43 53 45 55 48 56 M80 50 C77 53 75 55 72 56" stroke={c.light} strokeOpacity=".45" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M45 24 C41 16 43 10 47 5 C49 12 51 17 54 21 Z" fill={c.light} stroke={c.darker} strokeWidth=".7" />
      <path d="M60 19 C60 11 64 5 68 1 C68 9 66 15 64 19 Z" fill={c.base} stroke={c.darker} strokeWidth=".7" />
      <path d="M75 24 C79 16 77 10 73 5 C71 12 69 17 66 21 Z" fill={c.light} stroke={c.darker} strokeWidth=".7" />

      {/* talons */}
      <path d="M50 94 L46 101 L50 100 M60 96 L60 103 M70 94 L74 101 L70 100" stroke={c.dark} strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="22" cy="32" r="1.3" fill={c.light} opacity=".75" />
      <circle cx="98" cy="70" r="1.5" fill={c.light} opacity=".55" />
    </g>
  );
}

/* ========================================================================== *
 *  DIAMOND — THE DRAGON: the vault.
 * ========================================================================== */
function Dragon({ c, g }) {
  return (
    <g>
      {/* wings */}
      <path d="M45 60 C32 45 18 30 2 20 C8 32 6 42 0 51 C13 49 21 56 24 66 C31 60 38 59 45 60 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M75 60 C88 45 102 30 118 20 C112 32 114 42 120 51 C107 49 99 56 96 66 C89 60 82 59 75 60 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M37 57 C27 47 17 38 7 31 M30 63 C22 56 14 50 5 45 M16 51 C11 48 7 46 3 45" stroke={c.light} strokeOpacity=".45" strokeWidth="1.1" fill="none" />
      <path d="M83 57 C93 47 103 38 113 31 M90 63 C98 56 106 50 115 45 M104 51 C109 48 113 46 117 45" stroke={c.light} strokeOpacity=".45" strokeWidth="1.1" fill="none" />
      <path d="M4 26 L1 16 L11 21 M116 26 L119 16 L109 21" fill={c.light} stroke={c.darker} strokeWidth=".7" />

      {/* horns */}
      <path d="M46 32 C39 22 28 14 15 11 C23 20 28 28 30 37 C35 33 40 31 46 32 Z" fill={c.light} stroke={c.darker} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M74 32 C81 22 92 14 105 11 C97 20 92 28 90 37 C85 33 80 31 74 32 Z" fill={c.light} stroke={c.darker} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M49 30 C43 24 35 20 27 18 M45 34 C40 29 34 25 29 24" stroke={c.darker} strokeOpacity=".4" strokeWidth=".9" fill="none" />
      <path d="M71 30 C77 24 85 20 93 18 M75 34 C80 29 86 25 91 24" stroke={c.darker} strokeOpacity=".4" strokeWidth=".9" fill="none" />

      {/* head */}
      <path d="M60 28 C75 28 85 39 86 53 L84 71 C82 84 72 94 60 99 C48 94 38 84 36 71 L34 53 C35 39 45 28 60 28 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.5" />
      <path d="M60 28 C47 28 37 36 35 48 L52 41 L60 45 L68 41 L85 48 C83 36 73 28 60 28 Z" fill={c.light} opacity=".26" />
      <path d="M37 50 L54 44 L52 54 L39 57 Z" fill={c.deep} opacity=".34" />
      <path d="M83 50 L66 44 L68 54 L81 57 Z" fill={c.deep} opacity=".34" />

      {/* brow plates */}
      <path d="M38 51 L55 55 L54 62 L40 59 Z" fill={c.light} opacity=".5" />
      <path d="M82 51 L65 55 L66 62 L80 59 Z" fill={c.light} opacity=".5" />

      {/* slit eyes */}
      <ellipse cx="48" cy="60" rx="5.6" ry="3.3" fill="#f6ff6b" />
      <ellipse cx="72" cy="60" rx="5.6" ry="3.3" fill="#f6ff6b" />
      <ellipse cx="48" cy="60" rx="1.3" ry="3.1" fill="#12061a" />
      <ellipse cx="72" cy="60" rx="1.3" ry="3.1" fill="#12061a" />
      <circle cx="46.6" cy="58.6" r=".85" fill="#fff" opacity=".9" />
      <circle cx="70.6" cy="58.6" r=".85" fill="#fff" opacity=".9" />

      {/* snout */}
      <path d="M50 72 C52 67 68 67 70 72 L68 84 C64 89 56 89 52 84 Z" fill={c.light} opacity=".42" stroke={c.darker} strokeWidth="1" />
      <circle cx="55" cy="74" r="1.2" fill="#1a0a20" />
      <circle cx="65" cy="74" r="1.2" fill="#1a0a20" />
      <path d="M47 84 C53 88 67 88 73 84" stroke={c.darker} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M52 85 L54 92 L57 86 M68 85 L66 92 L63 86" fill="#f7fbff" stroke={c.darker} strokeWidth=".5" />

      {/* barbels */}
      <path d="M50 84 C46 92 42 96 36 97" stroke={c.dark} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M70 84 C74 92 78 96 84 97" stroke={c.dark} strokeWidth="1.6" fill="none" strokeLinecap="round" />

      {/* scales */}
      <path d="M50 63 C53 61 56 63 56 66 M64 63 C67 61 70 63 70 66 M56 71 C59 69 62 71 62 74" stroke={c.light} strokeOpacity=".34" strokeWidth=".9" fill="none" />
      <circle cx="22" cy="30" r="1.3" fill={c.light} opacity=".8" />
      <circle cx="100" cy="28" r="1.6" fill={c.light} opacity=".6" />
    </g>
  );
}

/* ========================================================================== *
 *  LEGEND — THE PHOENIX: it rebuilds itself.
 * ========================================================================== */
function Phoenix({ c, g }) {
  return (
    <g>
      {/* wings — long, flowing feathers that sweep up and out */}
      <path d="M54 64 C45 51 32 37 12 27 C27 41 36 53 41 68 C45 61 50 61 54 64 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M66 64 C75 51 88 37 108 27 C93 41 84 53 79 68 C75 61 70 61 66 64 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.1" />
      <path d="M18 48 C30 58 37 70 40 84 M27 44 C39 57 45 70 46 90 M13 68 C26 69 35 75 40 86" stroke={c.light} strokeOpacity=".5" strokeWidth="1.2" fill="none" />
      <path d="M102 48 C90 58 83 70 80 84 M93 44 C81 57 75 70 74 90 M107 68 C94 69 85 75 80 86" stroke={c.light} strokeOpacity=".5" strokeWidth="1.2" fill="none" />
      {/* a second, lower feather layer */}
      <path d="M48 72 C38 62 26 54 12 50 C26 58 36 66 44 80 Z" fill={c.dark} stroke={c.darker} strokeWidth=".8" />
      <path d="M72 72 C82 62 94 54 108 50 C94 58 84 66 76 80 Z" fill={c.dark} stroke={c.darker} strokeWidth=".8" />

      {/* tail flames */}
      <path d="M52 78 C41 96 44 109 49 116 C53 105 58 100 60 94 C62 100 67 105 71 116 C76 109 79 96 68 78 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth=".9" />
      <path d="M56 82 C51 96 53 105 57 110 C58 101 60 98 60 92 C61 99 64 103 65 110 C68 103 68 94 64 82 Z" fill={c.light} opacity=".45" />

      {/* neck + chest */}
      <ellipse cx="60" cy="68" rx="13.5" ry="23" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M54 58 C55 66 54 74 57 80 M66 58 C65 66 66 74 63 80" stroke={c.light} strokeOpacity=".38" strokeWidth="1.1" fill="none" />

      {/* head */}
      <circle cx="60" cy="40" r="12.5" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.3" />
      <path d="M52 34 C49 25 52 16 57 8 C58 18 60 24 60 31 Z" fill={c.light} stroke={c.darker} strokeWidth=".7" />
      <path d="M60 30 C62 17 68 12 73 8 C70 19 68 25 66 32 Z" fill={c.base} stroke={c.darker} strokeWidth=".7" />
      <path d="M66 32 C72 23 78 21 83 21 C76 29 72 33 70 40 Z" fill={c.light} stroke={c.darker} strokeWidth=".7" />

      {/* beak + eye */}
      <path d="M60 43 L68 49 L60 53 Z" fill="#ffc93c" stroke="#8a6400" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M60 44 L66 48 L60 50 Z" fill="#ffe27a" />
      <circle cx="64" cy="38" r="2.3" fill="#12061a" />
      <circle cx="64.8" cy="37.2" r=".85" fill="#fff" />
      <path d="M51 50 C53 57 52 63 49 70 M69 50 C67 57 68 63 71 70" stroke={c.light} strokeOpacity=".4" strokeWidth="1.1" fill="none" />
      <circle cx="24" cy="30" r="1.5" fill={c.light} opacity=".8" />
      <circle cx="97" cy="31" r="1.2" fill={c.light} opacity=".65" />
    </g>
  );
}

const ANIMALS = {
  turtle: Turtle,
  wolf: Wolf,
  lion: Lion,
  eagle: Eagle,
  dragon: Dragon,
  phoenix: Phoenix
};

export default function TierTotem({
  tier = 'bronze',
  size = 64,
  idle = true,
  interactive = true,
  locked = false,
  className = '',
  title,
  medallion = true
}) {
  const { t } = useTranslation();
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef(null);
  const meta = TIERS.find((row) => row.id === tier) || TIERS[0];
  const animal = TIER_ANIMALS[meta.id] || 'turtle';
  const Animal = ANIMALS[animal];
  const c = palette(meta.color);

  const g = {
    body: `${rawId}-body`,
    deep: `${rawId}-deep`,
    shine: `${rawId}-shine`,
    aura: `${rawId}-aura`,
    rim: `${rawId}-rim`
  };

  /* A two-pixel NUDGE towards the cursor — translation only. The animal is
     never rotated or skewed: the previous build leaned it with rotateX/rotateY
     and it read as a crooked sticker. */
  const onMove = (event) => {
    if (!interactive || event.pointerType !== 'mouse' || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    ref.current.style.setProperty('--px', (px * 2).toFixed(3));
    ref.current.style.setProperty('--py', (py * 2).toFixed(3));
  };

  const onLeave = () => {
    if (!ref.current) return;
    ref.current.style.setProperty('--px', '0');
    ref.current.style.setProperty('--py', '0');
  };

  const label = title || t(`rewards.v2.animals.${animal}`);

  return (
    <span
      ref={ref}
      className={`rwd-totem${idle ? ' rwd-totem-idle' : ''}${locked ? ' rwd-totem-locked' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--totem-size': `${size}px`, '--totem-color': meta.color, '--totem-glow': c.glow }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      data-tier={meta.id}
      data-animal={animal}
    >
      <span className="rwd-totem-halo" aria-hidden="true" />

      <span className="rwd-totem-stage">
        {medallion && (
          <svg className="rwd-totem-medallion" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id={g.rim} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0" stopColor={c.light} />
                <stop offset=".42" stopColor={meta.color} />
                <stop offset="1" stopColor={c.darker} />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="57" fill={`url(#${g.rim})`} opacity=".28" />
            <circle cx="60" cy="60" r="55.5" fill="none" stroke={`url(#${g.rim})`} strokeWidth="2.4" />
            <circle cx="60" cy="60" r="51" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1" />
          </svg>
        )}

        <span className="rwd-totem-float">
          <svg viewBox="0 0 120 120" className="rwd-totem-svg" role="img" aria-label={label}>
            <defs>
              <radialGradient id={g.aura} cx="50%" cy="42%" r="58%">
                <stop offset="0" stopColor={c.light} stopOpacity=".5" />
                <stop offset=".55" stopColor={c.base} stopOpacity=".16" />
                <stop offset="1" stopColor={c.base} stopOpacity="0" />
              </radialGradient>
              <linearGradient id={g.body} x1="16%" y1="0%" x2="84%" y2="100%">
                <stop offset="0" stopColor={c.light} />
                <stop offset=".45" stopColor={c.base} />
                <stop offset="1" stopColor={c.darker} />
              </linearGradient>
              <linearGradient id={g.deep} x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0" stopColor={c.dark} />
                <stop offset="1" stopColor={c.deep} />
              </linearGradient>
              <linearGradient id={g.shine} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0" stopColor="#ffffff" stopOpacity=".9" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="52" fill={`url(#${g.aura})`} />
            <Animal c={c} g={g} />
            <circle className="rwd-totem-spark" cx="16" cy="24" r="1.5" fill={c.light} />
            <circle className="rwd-totem-spark" cx="104" cy="90" r="1.2" fill={c.light} style={{ animationDelay: '-1.8s' }} />
            <circle className="rwd-totem-spark" cx="99" cy="20" r="1" fill={c.light} style={{ animationDelay: '-3.2s' }} />
          </svg>
        </span>
      </span>

      <span className="rwd-totem-shadow" aria-hidden="true" />
    </span>
  );
}
