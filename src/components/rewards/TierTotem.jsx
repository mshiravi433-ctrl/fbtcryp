import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TIERS } from '../../lib/ranks';

/**
 * TIER TOTEMS — the six ranks as medallions with sculpted animal artwork.
 * ---------------------------------------------------------------------------
 * This is the single most-seen object in the rewards hub: it sits in the hero
 * banner, on every badge card, on the perk medals and inside the shareable
 * profile card. It therefore has to look like a *medal*, not like a sticker.
 *
 * THE DESIGN (why it looks the way it does)
 *   · ONE FRAME FOR ALL SIX — a tier-coloured rim, a glass plate, a slow
 *     dashed orbit and a fixed top-left glint. The frame never changes size or
 *     geometry between tiers, only its colour, so the ladder scans in a glance
 *     and every medal lines up in a row at 16 px or 160 px.
 *   · NORMALISED ARTWORK — every illustration is a transparent 400×400 WebP
 *     whose figure occupies 86–94 % of the canvas (see ARTWORK and
 *     public/images/rewards). That is what makes a turtle and a lion read as
 *     the same weight inside the circle instead of one floating in empty space.
 *   · NO SKEW — the previous build rotated the animal (rotateZ/rotateY inside
 *     the idle keyframes), which read as a crooked sticker rather than a
 *     badge. The idle is a pure vertical float plus a breathing rim; the
 *     animal's geometry is never rotated. Only the dashed orbit ring turns.
 *   · LOCKED IS A FILTER — a locked rank greys the artwork out rather than
 *     swapping in a different picture, so the silhouette you are working
 *     towards stays recognisable.
 *
 * WHY NOT three.js / Lottie
 *   · three.js is ~600 kB before the first model; these are 15–50 kB WebPs on
 *     a shared frame. On the mid-range Android this app ships to, a WebGL
 *     context per medal is the wrong trade.
 *   · The colour comes from TIERS, not a hard-coded palette, so a tier colour
 *     change propagates everywhere at once.
 *
 * `prefers-reduced-motion` switches every idle off.
 */

/** Which animal belongs to which rank — also the i18n key suffix. */
export const TIER_ANIMALS = Object.freeze({
  bronze: 'turtle',
  silver: 'wolf',
  gold: 'lion',
  platinum: 'eagle',
  diamond: 'dragon',
  legend: 'phoenix'
});

/**
 * The transparent artwork. Every file is 400×400 with the figure already
 * optically sized inside it, so `object-fit: contain` in a shared square is
 * all the alignment needed — no per-tier scale hacks at render time.
 * Platinum keeps the hand-built SVG eagle because no artwork was supplied for
 * it; the shared frame still makes it sit correctly in the row.
 */
export const ARTWORK = Object.freeze({
  turtle: '/images/rewards/turtle.webp',
  wolf: '/images/rewards/wolf.webp',
  lion: '/images/rewards/lion.webp',
  dragon: '/images/rewards/dragon.webp',
  phoenix: '/images/rewards/phoenix.webp'
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

/* ========================================================================== *
 *  PLATINUM — THE EAGLE: vision from above. (SVG, the only non-WebP tier)
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
  const artwork = ARTWORK[animal] || null;
  const c = palette(meta.color);
  const compact = size <= 70;

  const g = {
    body: `${rawId}-body`,
    deep: `${rawId}-deep`,
    aura: `${rawId}-aura`,
    rim: `${rawId}-rim`,
    glass: `${rawId}-glass`
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
              <linearGradient id={g.rim} x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0" stopColor={c.light} />
                <stop offset=".42" stopColor={meta.color} />
                <stop offset="1" stopColor={c.darker} />
              </linearGradient>
              <radialGradient id={g.glass} cx="50%" cy="34%" r="72%">
                <stop offset="0" stopColor="#ffffff" stopOpacity=".18" />
                <stop offset=".55" stopColor={c.light} stopOpacity=".06" />
                <stop offset="1" stopColor={c.deep} stopOpacity=".22" />
              </radialGradient>
            </defs>
            {/* glass plate + tier rim: the same geometry for every rank */}
            <circle cx="60" cy="60" r="55.5" fill={`url(#${g.glass})`} />
            <circle cx="60" cy="60" r="55.5" fill="none" stroke={`url(#${g.rim})`} strokeWidth="2.6" />
            <circle cx="60" cy="60" r="51.4" fill="none" stroke="#ffffff" strokeOpacity=".13" strokeWidth="1" />
            {/* fixed top-left glint — reads as a polished metal edge */}
            <path
              d="M18.6 42.8 A46 46 0 0 1 38.5 18.9"
              fill="none"
              stroke="#ffffff"
              strokeOpacity=".55"
              strokeWidth="2.1"
              strokeLinecap="round"
            />
            <circle className="rwd-totem-orbit" cx="60" cy="60" r="49" fill="none" stroke={c.light} strokeOpacity=".55" strokeWidth="1.1" strokeDasharray="2 7" strokeLinecap="round" />
          </svg>
        )}

        <span className="rwd-totem-float">
          {artwork ? (
            <img
              className="rwd-totem-artwork"
              src={artwork}
              alt={label}
              width={400}
              height={400}
              loading={compact ? 'lazy' : 'eager'}
              decoding="async"
              draggable={false}
            />
          ) : (
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
              </defs>
              <circle cx="60" cy="60" r="52" fill={`url(#${g.aura})`} />
              <Eagle c={c} g={g} />
            </svg>
          )}
        </span>
      </span>

      <span className="rwd-totem-shadow" aria-hidden="true" />
    </span>
  );
}
