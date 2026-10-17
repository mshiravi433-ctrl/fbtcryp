import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TIERS } from '../../lib/ranks';

/**
 * TIER TOTEMS — the six ranks as animated, colour-matched animals.
 * ---------------------------------------------------------------------------
 * The brief asked for a real replacement for the tier emoji/text: a 3D-looking
 * animal per tier, in the exact tier colour from lib/ranks.js, idling with a
 * float + counter-rotation and banking slightly toward the pointer.
 *
 * Why hand-built SVG instead of three.js / Lottie:
 *   · three.js is ~600 kB before the first model; this is ~6 kB of paths and
 *     reuses the tab's existing framer-motion. On the mid-range Android this
 *     app ships to, a WebGL context per medal is the wrong trade.
 *   · Lottie needs six JSON files and a runtime; SVG scales to 18px in a stat
 *     row and 120px in the hero from the same source.
 *   · The colour comes from TIERS, not a hard-coded palette, so a tier colour
 *     change propagates everywhere at once.
 *
 * The animals are built as faceted, shaded vector sculptures (gradient body +
 * darker underlayers + specular highlight), not flat emoji, and the wrapper
 * performs the idle animation with compositor-friendly transform/opacity only.
 * `prefers-reduced-motion` switches the idle off.
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
    light: mix(base, 255, 0.42),
    glow: mix(base, 255, 0.2),
    dark: mix(base, 0, 0.28),
    darker: mix(base, 0, 0.55),
    deep: mix(base, 0, 0.72)
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

const LION_MANE = starPath(60, 64, 16, 51, 42);
const LION_MANE_INNER = starPath(60, 64, 16, 45, 37.5);

function Turtle({ c, g }) {
  return (
    <g>
      <ellipse cx="24" cy="54" rx="12" ry="6" transform="rotate(-30 24 54)" fill={c.dark} stroke={c.darker} strokeWidth="1" />
      <ellipse cx="96" cy="54" rx="12" ry="6" transform="rotate(30 96 54)" fill={c.dark} stroke={c.darker} strokeWidth="1" />
      <ellipse cx="60" cy="67" rx="38" ry="28" fill={c.darker} />
      <ellipse cx="60" cy="63" rx="38" ry="28" fill={`url(#${g.body})`} />
      <path d="M60 39 L81 50 L81 74 L60 89 L39 74 L39 50 Z" fill={c.dark} opacity=".62" stroke={c.darker} strokeWidth="1.2" />
      <path d="M60 39 L60 89 M39 50 L81 74 M81 50 L39 74" stroke={c.light} strokeOpacity=".36" strokeWidth="1" />
      <ellipse cx="60" cy="63" rx="38" ry="28" fill="none" stroke={c.darker} strokeWidth="2.4" />
      <ellipse cx="60" cy="63" rx="30" ry="21" fill="none" stroke={c.light} strokeOpacity=".3" strokeWidth="1.2" strokeDasharray="2 4" />
      <path d="M92 58 C104 54 112 62 109 70 C106 79 95 80 89 72 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.6" />
      <circle cx="101" cy="64" r="2" fill="#081018" />
      <circle cx="101.8" cy="63.2" r=".7" fill="#fff" />
      <path d="M29 78 C16 84 12 95 20 98 C30 101 39 91 41 84 Z" fill={c.dark} stroke={c.darker} strokeWidth="1.2" />
      <path d="M91 78 C104 84 108 95 100 98 C90 101 81 91 79 84 Z" fill={c.dark} stroke={c.darker} strokeWidth="1.2" />
      <path d="M45 91 L54 99 L60 94 L66 99 L75 91" fill="none" stroke={c.darker} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="46" cy="52" rx="13" ry="6" transform="rotate(-25 46 52)" fill={`url(#${g.shine})`} opacity=".5" />
      <circle cx="94" cy="34" r="1.6" fill={c.light} opacity=".85" />
      <circle cx="22" cy="76" r="1.2" fill={c.light} opacity=".6" />
    </g>
  );
}

function Wolf({ c, g }) {
  return (
    <g>
      <path d="M34 54 L24 94 L44 84 L50 101 L60 87 L70 101 L76 84 L96 94 L86 54 Z" fill={c.darker} />
      <path d="M34 35 L29 11 L51 30 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.5" />
      <path d="M86 35 L91 11 L69 30 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.5" />
      <path d="M37 31 L35 19 L45 29 Z" fill={c.deep} />
      <path d="M83 31 L85 19 L75 29 Z" fill={c.deep} />
      <path d="M34 38 L60 31 L86 38 L82 64 L74 83 L60 97 L46 83 L38 64 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.7" />
      <path d="M39 43 L60 39 L81 43 L77 60 L60 69 L43 60 Z" fill={c.light} opacity=".24" />
      <path d="M43 54 L55 58 L45 64 Z" fill="#eaffff" />
      <path d="M77 54 L65 58 L75 64 Z" fill="#eaffff" />
      <circle cx="50" cy="58.5" r="1.7" fill="#061016" />
      <circle cx="70" cy="58.5" r="1.7" fill="#061016" />
      <circle cx="50.5" cy="58" r=".6" fill="#fff" />
      <circle cx="70.5" cy="58" r=".6" fill="#fff" />
      <path d="M46 67 L60 61 L74 67 L67 83 L60 91 L53 83 Z" fill={c.light} opacity=".5" />
      <path d="M55 70 L65 70 L60 77 Z" fill="#080b12" />
      <path d="M60 77 L60 83 M60 83 L53 87 M60 83 L67 87" stroke={c.darker} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M40 39 L60 33 L64 38 L46 44 Z" fill="#fff" opacity=".22" />
      <path d="M52 88 L60 96 L68 88" fill="none" stroke={c.light} strokeOpacity=".35" strokeWidth="1.2" />
      <circle cx="30" cy="42" r="1.3" fill={c.light} opacity=".7" />
      <circle cx="92" cy="46" r="1.8" fill={c.light} opacity=".55" />
    </g>
  );
}

function Lion({ c, g }) {
  return (
    <g>
      <path d={LION_MANE} fill={c.deep} />
      <path d={LION_MANE_INNER} fill={`url(#${g.deep})`} />
      <circle cx="36" cy="44" r="9" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.2" />
      <circle cx="84" cy="44" r="9" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.2" />
      <circle cx="36" cy="44" r="4" fill={c.deep} />
      <circle cx="84" cy="44" r="4" fill={c.deep} />
      <ellipse cx="60" cy="66" rx="28" ry="27" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.5" />
      <ellipse cx="60" cy="73" rx="19" ry="15" fill={c.light} opacity=".28" />
      <path d="M44 62 Q51 56 58 62 Q51 68 44 62 Z" fill="#241503" />
      <path d="M76 62 Q69 56 62 62 Q69 68 76 62 Z" fill="#241503" />
      <circle cx="51" cy="62" r="2" fill="#ffe9ad" />
      <circle cx="69" cy="62" r="2" fill="#ffe9ad" />
      <circle cx="51.5" cy="61.4" r=".7" fill="#fff" />
      <circle cx="69.5" cy="61.4" r=".7" fill="#fff" />
      <path d="M53 75 Q60 71 67 75 Q67 82 60 84 Q53 82 53 75 Z" fill={c.light} opacity=".55" />
      <path d="M55 77 L65 77 L60 83 Z" fill="#241503" />
      <path d="M60 83 L60 87 M60 87 Q56 91 52 88 M60 87 Q64 91 68 88" stroke="#3a2408" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="44" cy="79" r=".9" fill={c.deep} opacity=".8" />
      <circle cx="76" cy="79" r=".9" fill={c.deep} opacity=".8" />
      <path d="M38 36 C46 31 54 30 60 31 L54 38 L44 40 Z" fill="#fff" opacity=".22" />
      <circle cx="94" cy="30" r="1.5" fill={c.light} opacity=".8" />
      <circle cx="24" cy="92" r="1.2" fill={c.light} opacity=".6" />
    </g>
  );
}

function Eagle({ c, g }) {
  return (
    <g>
      {/* fanned tail */}
      <path d="M60 86 L72 108 L64 104 L60 110 L56 104 L48 108 Z" fill={c.dark} stroke={c.darker} strokeWidth="1" />
      <path d="M60 88 L60 106 M54 89 L50 103 M66 89 L70 103" stroke={c.lighter || c.light} strokeOpacity=".4" strokeWidth="1" />

      {/* wings — high and swept back, three feather planes each */}
      <path d="M53 57 C43 43 30 31 13 22 C18 31 16 39 9 46 C20 45 27 50 30 58 C36 53 44 53 53 57 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M67 57 C77 43 90 31 107 22 C102 31 104 39 111 46 C100 45 93 50 90 58 C84 53 76 53 67 57 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M46 50 C36 40 26 32 15 26 M40 55 C31 47 23 41 14 36 M35 60 C28 55 21 51 13 48" stroke={c.light} strokeOpacity=".42" strokeWidth="1.1" fill="none" />
      <path d="M74 50 C84 40 94 32 105 26 M80 55 C89 47 97 41 106 36 M85 60 C92 55 99 51 107 48" stroke={c.light} strokeOpacity=".42" strokeWidth="1.1" fill="none" />

      {/* neck + chest */}
      <path d="M60 52 C70 52 76 62 76 74 L74 88 C70 94 64 97 60 97 C56 97 50 94 46 88 L44 74 C44 62 50 52 60 52 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.3" />
      <path d="M54 60 C52 71 53 80 56 88 M66 60 C68 71 67 80 64 88" stroke={c.light} strokeOpacity=".3" strokeWidth="1.2" fill="none" />

      {/* head — broad white crown, tapered cheeks */}
      <path d="M60 17 C75 17 85 27 85 40 C85 49 78 55 69 57 L60 59 L51 57 C42 55 35 49 35 40 C35 27 45 17 60 17 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.4" />
      <path d="M60 17 C46 17 36 25 35 36 L50 30 L60 33 L70 30 L85 36 C84 25 74 17 60 17 Z" fill="#ffffff" opacity=".82" />

      {/* angry brow: outer ends high, inner ends low */}
      <path d="M36 37 L53 31 L54 37 L38 42 Z" fill={c.deep} opacity=".85" />
      <path d="M84 37 L67 31 L66 37 L82 42 Z" fill={c.deep} opacity=".85" />

      {/* wide-set amber eyes with small pupils — reads as a raptor */}
      <circle cx="48" cy="45" r="6.4" fill="#ffd84d" />
      <circle cx="72" cy="45" r="6.4" fill="#ffd84d" />
      <circle cx="49" cy="45.4" r="2.5" fill="#0a1118" />
      <circle cx="71" cy="45.4" r="2.5" fill="#0a1118" />
      <circle cx="49.9" cy="44.4" r=".9" fill="#fff" />
      <circle cx="71.9" cy="44.4" r=".9" fill="#fff" />

      {/* short hooked beak: cere band, wedge, downturned tip */}
      <path d="M52 50 L68 50 L71 55 L65 59 L60 62 L55 59 L49 55 Z" fill="#ffc93c" stroke="#6f5003" strokeWidth="1.3" />
      <path d="M52 50 L68 50 L68 53 L52 53 Z" fill="#ffe27a" stroke="#6f5003" strokeWidth=".9" />
      <path d="M55 56 L60 55 L65 56 L63 61 L60 64 L57 61 Z" fill="#e0a800" />
      <circle cx="56" cy="51.7" r=".9" fill="#6f5003" />
      <circle cx="64" cy="51.7" r=".9" fill="#6f5003" />
      <path d="M60 53 L60 63" stroke="#6f5003" strokeWidth="1" opacity=".6" />

      {/* cheek feather marks */}
      <path d="M41 50 C44 53 46 55 49 56 M79 50 C76 53 74 55 71 56" stroke={c.light} strokeOpacity=".5" strokeWidth="1.2" fill="none" strokeLinecap="round" />

      {/* crest feathers */}
      <path d="M46 26 C42 18 44 12 48 7 C50 14 52 19 55 23 Z" fill={c.light} stroke={c.darker} strokeWidth=".8" />
      <path d="M60 21 C60 13 64 7 68 3 C68 11 66 17 64 21 Z" fill={c.base} stroke={c.darker} strokeWidth=".8" />
      <path d="M74 26 C78 18 76 12 72 7 C70 14 68 19 65 23 Z" fill={c.light} stroke={c.darker} strokeWidth=".8" />

      {/* talons + sparkles */}
      <path d="M51 94 L47 101 L51 100 M60 96 L60 103 M69 94 L73 101 L69 100" stroke={c.dark} strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="26" cy="34" r="1.4" fill={c.light} opacity=".8" />
      <circle cx="94" cy="70" r="1.6" fill={c.light} opacity=".6" />
    </g>
  );
}

function Dragon({ c, g }) {
  return (
    <g>
      {/* tail curling out from behind the body */}
      <path d="M62 88 C78 92 92 100 96 112 C88 108 80 107 72 108 C78 102 74 97 62 95 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M96 112 L104 118 L97 116 L98 123 L92 116 Z" fill={c.light} stroke={c.darker} strokeWidth=".8" />

      {/* wings — high shoulders, clawed tips, membrane ribs */}
      <path d="M45 62 C33 48 20 34 4 26 C9 36 7 45 1 53 C13 52 20 58 23 67 C30 61 38 60 45 62 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M75 62 C87 48 100 34 116 26 C111 36 113 45 119 53 C107 52 100 58 97 67 C90 61 82 60 75 62 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M38 57 C28 47 18 38 8 31 M31 63 C23 56 15 50 6 45 M16 51 C11 48 7 46 3 45" stroke={c.light} strokeOpacity=".5" strokeWidth="1.2" fill="none" />
      <path d="M82 57 C92 47 102 38 112 31 M89 63 C97 56 105 50 114 45 M104 51 C109 48 113 46 117 45" stroke={c.light} strokeOpacity=".5" strokeWidth="1.2" fill="none" />
      <path d="M4 26 L1 17 L10 22 M116 26 L119 17 L110 22" fill={c.light} stroke={c.darker} strokeWidth=".8" />

      {/* swept-back horns */}
      <path d="M46 34 C38 24 26 17 14 15 C21 24 26 31 28 39 Z" fill={c.light} stroke={c.darker} strokeWidth="1.3" />
      <path d="M74 34 C82 24 94 17 106 15 C99 24 94 31 92 39 Z" fill={c.light} stroke={c.darker} strokeWidth="1.3" />
      <path d="M50 31 C44 25 36 21 28 19 M46 35 C41 30 35 27 30 26" stroke={c.darker} strokeOpacity=".45" strokeWidth="1" fill="none" />
      <path d="M70 31 C76 25 84 21 92 19 M74 35 C79 30 85 27 90 26" stroke={c.darker} strokeOpacity=".45" strokeWidth="1" fill="none" />

      {/* long snouted head with brow ridges */}
      <path d="M60 30 C74 30 84 40 85 54 L83 72 C81 84 72 93 60 98 C48 93 39 84 37 72 L35 54 C36 40 46 30 60 30 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.6" />
      <path d="M60 30 C48 30 38 37 36 48 L52 42 L60 46 L68 42 L84 48 C82 37 72 30 60 30 Z" fill={c.light} opacity=".28" />
      <path d="M38 51 L54 45 L52 55 L40 58 Z" fill={c.deep} opacity=".35" />
      <path d="M82 51 L66 45 L68 55 L80 58 Z" fill={c.deep} opacity=".35" />

      {/* angular brow plates + slit eyes */}
      <path d="M39 52 L55 56 L54 63 L41 60 Z" fill={c.lighter || c.light} opacity=".55" />
      <path d="M81 52 L65 56 L66 63 L79 60 Z" fill={c.lighter || c.light} opacity=".55" />
      <ellipse cx="49" cy="61" rx="5.4" ry="3.2" fill="#f6ff6b" />
      <ellipse cx="71" cy="61" rx="5.4" ry="3.2" fill="#f6ff6b" />
      <ellipse cx="49" cy="61" rx="1.2" ry="3" fill="#12061a" />
      <ellipse cx="71" cy="61" rx="1.2" ry="3" fill="#12061a" />
      <circle cx="47.6" cy="59.6" r=".8" fill="#fff" opacity=".9" />
      <circle cx="69.6" cy="59.6" r=".8" fill="#fff" opacity=".9" />

      {/* protruding snout with nostrils + fanged mouth */}
      <path d="M50 72 C52 68 68 68 70 72 L68 84 C64 88 56 88 52 84 Z" fill={c.light} opacity=".45" stroke={c.darker} strokeWidth="1.1" />
      <circle cx="55" cy="74" r="1.2" fill="#1a0a20" />
      <circle cx="65" cy="74" r="1.2" fill="#1a0a20" />
      <path d="M47 84 C53 88 67 88 73 84" stroke={c.darker} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M52 85 L54 92 L57 86 M68 85 L66 92 L63 86" fill="#fff" stroke={c.darker} strokeWidth=".6" />

      {/* scales */}
      <path d="M50 62 C53 60 56 62 56 65 M64 62 C67 60 70 62 70 65 M56 70 C59 68 62 70 62 73" stroke={c.light} strokeOpacity=".38" strokeWidth="1" fill="none" />

      <circle cx="24" cy="32" r="1.4" fill={c.light} opacity=".85" />
      <circle cx="98" cy="30" r="1.7" fill={c.light} opacity=".65" />
      <circle cx="20" cy="86" r="1.2" fill={c.light} opacity=".5" />
    </g>
  );
}

function Phoenix({ c, g }) {
  return (
    <g>
      <path d="M52 78 C41 96 44 109 49 116 C53 105 58 100 60 94 C62 100 67 105 71 116 C76 109 79 96 68 78 Z" fill={`url(#${g.deep})`} stroke={c.darker} strokeWidth="1" />
      <path d="M56 82 C51 96 53 105 57 110 C58 101 60 98 60 92 C61 99 64 103 65 110 C68 103 68 94 64 82 Z" fill={c.light} opacity=".42" />
      <path d="M54 60 C38 45 21 37 3 39 C16 51 13 61 5 72 C22 70 34 76 42 91 C46 78 50 70 58 66 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M66 60 C82 45 99 37 117 39 C104 51 107 61 115 72 C98 70 86 76 78 91 C74 78 70 70 62 66 Z" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.2" />
      <path d="M20 48 C31 57 37 65 40 79 M29 46 C40 58 45 69 46 85 M15 67 C28 68 36 73 40 83" stroke={c.light} strokeOpacity=".55" strokeWidth="1.3" fill="none" />
      <path d="M100 48 C89 57 83 65 80 79 M91 46 C80 58 75 69 74 85 M105 67 C92 68 84 73 80 83" stroke={c.light} strokeOpacity=".55" strokeWidth="1.3" fill="none" />
      <ellipse cx="60" cy="67" rx="12" ry="23" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.3" />
      <circle cx="60" cy="40" r="11" fill={`url(#${g.body})`} stroke={c.darker} strokeWidth="1.4" />
      <path d="M51 34 C47 22 51 14 56 7 C58 18 60 24 60 31 Z" fill={c.light} stroke={c.darker} strokeWidth=".8" />
      <path d="M60 31 C62 18 68 13 73 9 C70 20 68 26 66 33 Z" fill={c.base} stroke={c.darker} strokeWidth=".8" />
      <path d="M66 33 C72 24 78 22 83 22 C76 30 72 34 70 39 Z" fill={c.light} stroke={c.darker} strokeWidth=".8" />
      <path d="M60 44 L68 50 L60 54 Z" fill="#ffc93c" stroke="#8a6400" strokeWidth="1" />
      <circle cx="64" cy="39" r="2" fill="#081018" />
      <circle cx="64.7" cy="38.2" r=".7" fill="#fff" />
      <path d="M52 50 C54 58 53 64 50 71 M68 50 C66 58 67 64 70 71" stroke={c.light} strokeOpacity=".45" strokeWidth="1.2" fill="none" />
      <circle cx="26" cy="30" r="1.6" fill={c.light} opacity=".85" />
      <circle cx="96" cy="32" r="1.2" fill={c.light} opacity=".7" />
      <circle cx="34" cy="94" r="1.4" fill={c.light} opacity=".6" />
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
  title
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
    aura: `${rawId}-aura`
  };

  const onMove = (event) => {
    if (!interactive || event.pointerType !== 'mouse' || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    ref.current.style.setProperty('--ry', `${(px * 16).toFixed(2)}deg`);
    ref.current.style.setProperty('--rx', `${(-py * 14).toFixed(2)}deg`);
  };

  const onLeave = () => {
    if (!ref.current) return;
    ref.current.style.setProperty('--ry', '0deg');
    ref.current.style.setProperty('--rx', '0deg');
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
      <span className="rwd-totem-tilt">
        <span className="rwd-totem-float">
          <svg viewBox="0 0 120 120" className="rwd-totem-svg" role="img" aria-label={label}>
            <defs>
              <radialGradient id={g.aura} cx="50%" cy="42%" r="58%">
                <stop offset="0" stopColor={c.light} stopOpacity=".55" />
                <stop offset=".55" stopColor={c.base} stopOpacity=".18" />
                <stop offset="1" stopColor={c.base} stopOpacity="0" />
              </radialGradient>
              <linearGradient id={g.body} x1="18%" y1="0%" x2="82%" y2="100%">
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
            <circle cx="60" cy="62" r="55" fill={`url(#${g.aura})`} />
            <circle cx="60" cy="62" r="49" fill="none" stroke={c.base} strokeOpacity=".28" strokeWidth="1" />
            <circle cx="60" cy="62" r="45" fill="none" stroke={c.light} strokeOpacity=".14" strokeWidth="1" strokeDasharray="1 5" />
            <ellipse cx="60" cy="109" rx="27" ry="4.5" fill="#000" opacity=".35" />
            <Animal c={c} g={g} />
            <circle className="rwd-totem-spark" cx="18" cy="26" r="1.5" fill={c.light} />
            <circle className="rwd-totem-spark" cx="103" cy="88" r="1.2" fill={c.light} style={{ animationDelay: '-1.8s' }} />
            <circle className="rwd-totem-spark" cx="98" cy="22" r="1" fill={c.light} style={{ animationDelay: '-3.2s' }} />
          </svg>
        </span>
      </span>
    </span>
  );
}
