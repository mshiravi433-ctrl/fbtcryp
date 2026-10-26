import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import CoinLogo from './CoinLogo';
import { useStill } from './AnimatedIcon';
import { lockBodyScroll } from '../lib/scrollLock';
import { tickerLogo } from '../lib/coinImage';
import { fmtCompact, fmtPct, fmtUsd } from '../lib/format';
import { fetchAvantisEquities } from '../lib/avantisEquities';
import { createStoryAmbientController } from '../lib/storyAudio';
import { getCalm } from '../lib/audio';
import { useRadioStore } from '../store/useRadioStore';
import { openUrl } from '../lib/browser';
import { APARAT_CHANNEL_URL } from '../lib/aparat';
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternal,
  IconPlay,
  IconSparkle,
  IconVideo,
  IconVolume,
  IconX
} from './Icons';

/**
 * 1-MINUTE CINEMATIC MARKET STORIES
 * ---------------------------------------------------------------------------
 * Sits directly beneath the Bitcoin hero card on the Market page. Tapping a
 * bubble opens a FULL-SCREEN story: a progress ring row, a headline block, an
 * animated cinematic stage, live market data, and a CTA bar that navigates
 * straight into that part of the app.
 *
 * ─── THE FOUR RULES THIS FILE OBEYS ────────────────────────────────────────
 * 1. NO TRANSPORT UI. «موسیقی خودکار پلی بشه بدون دکمه توقف یا پخش» — the
 *    score starts on the tap that opens the story (a real user gesture, so
 *    every autoplay policy allows it) and stops when the story closes. There
 *    is deliberately no play/pause/mute button to render, so there is no
 *    button that can disagree with the audio state. A small, non-interactive
 *    play glyph is the only visible cue while audio is actually playing.
 * 2. ONE SVG PER PROGRESS CHIP. The chip is a circle that fills as the story
 *    runs (`--p`, painted as a conic ring) with the story's own glyph inside.
 *    `test/market-stories-and-aparat.test.jsx` counts exactly eight `svg`
 *    elements inside `.market-story-progress-seg`, so the "seen" tick is drawn
 *    in CSS, not with a second icon.
 * 3. RADIO IS THE APP'S RADIO. The Crypto Radio story reads the SAME
 *    `getCalm()` catalogue the News screen reads (one 5-minute client cache,
 *    so both lists are literally the same array) and writes to the SAME
 *    `useRadioStore`. `RadioDock` is mounted above the router in App.jsx, so a
 *    track chosen inside a story keeps playing after the story closes and
 *    after you navigate away — «در پس‌زمینه هم فعال بشه انگار موسیقی را فعال
 *    کردی». The synthesized score steps aside the moment a real track starts.
 * 4. FULL SCREEN, GPU-CHEAP. The dialog is `100dvh` with no border radius.
 *    Ambient light animates `transform`/`opacity` only, never `filter`, and
 *    collapses to a still frame under `prefers-reduced-motion` and on native.
 */
export const STORY_DURATION_MS = 60_000;

/*
 * Optional REAL promo film. «اگر فیلمی میشود پخش شود تبلیغاتی» — when a video
 * source is configured, the video story plays it as a sponsored clip instead
 * of the animated stage. It is opt-in by environment because the app ships no
 * video asset of its own (a 1 MB file in the APK for one story is not a trade
 * worth making), and because a promotional clip is a business decision that
 * changes without a release. `muted` + `playsInline` are mandatory: an
 * unmuted autoplaying video is blocked by every mobile browser, and a blocked
 * video shows as a black rectangle.
 */
const STORY_PROMO_VIDEO = String(import.meta.env?.VITE_STORY_PROMO_VIDEO ?? '').trim();

export const MARKET_STORY_ITEMS = [
  {
    id: 'stocks',
    badge: 'RWA',
    route: '/stocks',
    secondaryRoutes: [
      { to: '/stocks', labelKey: 'stories.quick.xstocks' },
      { to: '/swap', labelKey: 'stories.quick.swapRwa' }
    ],
    accent: '#3ddc97',
    accent2: '#a3e635',
    ink: '#04150e'
  },
  {
    id: 'aparat',
    badge: 'FILM',
    route: '/aparat',
    film: true,
    secondaryRoutes: [
      { to: '/learn', labelKey: 'stories.quick.learnHub' }
    ],
    accent: '#ff7ab8',
    accent2: '#ffb86b',
    ink: '#1a0511'
  },
  {
    id: 'swap',
    badge: 'DEX',
    route: '/swap',
    secondaryRoutes: [
      { to: '/solana', labelKey: 'stories.quick.solana' },
      { to: '/bridge', labelKey: 'stories.quick.bridge' }
    ],
    accent: '#38bdf8',
    accent2: '#22d3ee',
    ink: '#04141f'
  },
  {
    id: 'intent',
    badge: 'AI',
    route: '/intent',
    secondaryRoutes: [
      { to: '/signals', labelKey: 'stories.quick.signals' },
      { to: '/smart-money', labelKey: 'stories.quick.smartMoney' }
    ],
    accent: '#a78bfa',
    accent2: '#f472b6',
    ink: '#120a24'
  },
  {
    id: 'defi',
    badge: 'APY',
    route: '/farm',
    secondaryRoutes: [
      { to: '/loan', labelKey: 'stories.quick.loan' },
      { to: '/rewards', labelKey: 'stories.quick.rewards' }
    ],
    accent: '#2dd4bf',
    accent2: '#60a5fa',
    ink: '#03191a'
  },
  {
    id: 'radio',
    badge: 'RADIO',
    route: '/news',
    secondaryRoutes: [
      { to: '/global', labelKey: 'stories.quick.global' }
    ],
    accent: '#fbbf24',
    accent2: '#fb7185',
    ink: '#1d1204'
  },
  {
    id: 'orders',
    badge: 'AUTO',
    route: '/orders',
    secondaryRoutes: [
      { to: '/compare', labelKey: 'stories.quick.compare' }
    ],
    accent: '#f59e0b',
    accent2: '#c084fc',
    ink: '#1c1103'
  },
  {
    id: 'ecosystem',
    badge: 'WEB3',
    route: '/wallet',
    secondaryRoutes: [
      { to: '/shop', labelKey: 'stories.quick.shop' },
      { to: '/launch', labelKey: 'stories.quick.launch' },
      { to: '/insurance', labelKey: 'stories.quick.insurance' }
    ],
    accent: '#60a5fa',
    accent2: '#34d399',
    ink: '#061225'
  }
];

const CURATED_TOP_STOCKS = [
  { symbol: 'NVDA', name: 'NVIDIA xStock', price: 138.4, change24h: 6.45, tag: 'AI Chip Leader' },
  { symbol: 'TSLA', name: 'Tesla xStock', price: 258.9, change24h: 5.18, tag: 'EV & Robotics' },
  { symbol: 'AAPL', name: 'Apple xStock', price: 231.5, change24h: 3.92, tag: 'Consumer Tech' },
  { symbol: 'META', name: 'Meta Platforms', price: 592.1, change24h: 3.64, tag: 'AI & Social' },
  { symbol: 'MSFT', name: 'Microsoft xStock', price: 428.75, change24h: 2.85, tag: 'Cloud & AI' }
];

const DEFI_HIGHLIGHTS = [
  { id: 'kamino', protocol: 'Kamino / Solana', asset: 'USDC · SOL', apy: '14.8%', badge: 'Non-Custodial' },
  { id: 'aave', protocol: 'Aave V3 · Base & Arb', asset: 'USDC · WETH', apy: '9.4%', badge: 'Blue-Chip' },
  { id: 'morpho', protocol: 'Morpho Vaults', asset: 'USDT · wstETH', apy: '12.2%', badge: 'Curated' },
  { id: 'lido', protocol: 'Lido Liquid Staking', asset: 'stETH · wstETH', apy: '3.6%', badge: 'Liquid' }
];

/**
 * THE GLYPH SET.
 *
 * «از ایکون های خیلی مدرن استفاده بشود» — these replaced an earlier set that
 * mixed filled blobs, 2.4px strokes and hard-cornered rectangles at three
 * different optical sizes, which is why the rail read as eight unrelated
 * icons rather than one family.
 *
 * One system now, applied to all eight:
 *   · 32×32 viewBox, 1.7 stroke, round caps and joins (the same numbers as
 *     `components/Icons.jsx`, so a story glyph and a nav glyph are cousins).
 *   · ~3u of padding inside the box on every side, so a circle story and a
 *     rectangle story occupy the same visual weight.
 *   · Duotone: the structural lines take the gradient, one accent detail takes
 *     `accent2` solid. Two colours, never more — three is where duotone stops
 *     looking designed.
 *   · `id` is namespaced per instance (`useId`) because several copies of the
 *     same glyph are on screen at once (rail + progress chip + headline), and
 *     duplicate gradient ids make the browser resolve every one of them to the
 *     first, which paints the wrong colours.
 */
/*
 * MEMOISED, because the rail is inside the market screen's render tree.
 *
 * Every keystroke in the market search box, every sort change and every
 * 30-second poll re-renders Market — and therefore this component — so eight
 * story bubbles were rebuilding their gradient defs and glyph paths on each of
 * those keystrokes. The props here are literals from a module-level catalogue,
 * so the comparison is a reference check that always hits after the first
 * paint. This is the concrete half of «لود باکس استوری هوشمند خیلی کند شده»:
 * the box now costs one paint, not one per interaction.
 */
const StoryGlyph = memo(function StoryGlyph({ id, accent, accent2, gid, className = '' }) {
  const g = `${gid}-g`;
  const soft = `${gid}-s`;
  const stroke = { strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg viewBox="0 0 32 32" fill="none" className={`market-story-glyph ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="5" y1="4" x2="27" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={accent2} />
        </linearGradient>
        <linearGradient id={soft} x1="6" y1="6" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} stopOpacity="0.34" />
          <stop offset="100%" stopColor={accent2} stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {/* 1 · Stocks & RWA — candlesticks under a rising line. */}
      {id === 'stocks' && (
        <g {...stroke}>
          <path d="M6 26.5h20" stroke={`url(#${g})`} opacity="0.55" />
          <path d="M10 22.5v-6M10 13.2v-1.6" stroke={`url(#${g})`} />
          <rect x="7.9" y="16.5" width="4.2" height="6" rx="1.4" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M16.6 19.5v-8M16.6 8.2V6.4" stroke={`url(#${g})`} />
          <rect x="14.5" y="11.5" width="4.2" height="8" rx="1.4" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M23.2 15.5v-5M23.2 7.4V5.6" stroke={accent2} />
          <rect x="21.1" y="10.5" width="4.2" height="5" rx="1.4" fill={accent2} fillOpacity="0.28" stroke={accent2} />
        </g>
      )}

      {/* 2 · Film academy — a screen with a play glyph and a strip of frames. */}
      {id === 'aparat' && (
        <g {...stroke}>
          <rect x="4.5" y="7.5" width="23" height="17" rx="4.5" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M13.6 12.6l5.6 3.4-5.6 3.4z" fill={accent2} stroke={accent2} strokeWidth="1.4" />
          <path d="M9 11.4v9.2M23 11.4v9.2" stroke={`url(#${g})`} opacity="0.5" />
          <path d="M11.4 27.5h9.2" stroke={accent2} opacity="0.85" />
        </g>
      )}

      {/* 3 · Smart swap — two assets trading places on a closed loop. */}
      {id === 'swap' && (
        <g {...stroke}>
          <path d="M9.6 12.4h13.8l-3.2-3.3M22.4 19.6H8.6l3.2 3.3" stroke={`url(#${g})`} />
          <circle cx="7.6" cy="12.4" r="3.1" fill={accent2} fillOpacity="0.26" stroke={accent2} />
          <circle cx="24.4" cy="19.6" r="3.1" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M16 6.2v3.1M16 22.7v3.1" stroke={`url(#${g})`} opacity="0.55" />
        </g>
      )}

      {/* 4 · Intent AI — a neural chip with a spark in its core. */}
      {id === 'intent' && (
        <g {...stroke}>
          <rect x="8.6" y="8.6" width="14.8" height="14.8" rx="4.6" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M16 12.4l1.5 2.6 2.6 1.5-2.6 1.5-1.5 2.6-1.5-2.6-2.6-1.5 2.6-1.5z" fill={accent2} stroke={accent2} strokeWidth="1.2" />
          <path d="M12.6 8.6V5.4M19.4 8.6V5.4M12.6 26.6v-3.2M19.4 26.6v-3.2M8.6 12.6H5.4M8.6 19.4H5.4M26.6 12.6h-3.2M26.6 19.4h-3.2" stroke={`url(#${g})`} opacity="0.8" />
        </g>
      )}

      {/* 5 · DeFi yield — three stacked vault layers with yield rising. */}
      {id === 'defi' && (
        <g {...stroke}>
          <path d="M16 5.4l9.4 4.6-9.4 4.6L6.6 10z" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M6.6 16l9.4 4.6L25.4 16" stroke={`url(#${g})`} opacity="0.75" />
          <path d="M6.6 21.6l9.4 4.6 9.4-4.6" stroke={accent2} opacity="0.9" />
        </g>
      )}

      {/* 6 · Crypto radio — an equalizer inside a broadcast arc. */}
      {id === 'radio' && (
        <g {...stroke}>
          <path d="M7.4 14.2a11.4 11.4 0 0 1 17.2 0" stroke={`url(#${g})`} opacity="0.7" />
          <path d="M11 24.6v-5.2M16 26.4v-9.4M21 24.6v-5.2" stroke={`url(#${g})`} />
          <circle cx="16" cy="9.6" r="2.2" fill={accent2} stroke={accent2} strokeWidth="1.2" />
        </g>
      )}

      {/* 7 · Auto orders — a clock on a self-driving loop. */}
      {id === 'orders' && (
        <g {...stroke}>
          <path d="M25.6 16a9.6 9.6 0 1 1-3.1-7.1" stroke={`url(#${g})`} />
          <path d="M23.2 4.6v4.6h-4.6" stroke={accent2} />
          <path d="M16 11.2V16l3.4 2.1" stroke={`url(#${g})`} />
          <circle cx="16" cy="16" r="1.3" fill={accent2} stroke="none" />
        </g>
      )}

      {/* 8 · Ecosystem — a verified globe: the whole app, non-custodial. */}
      {id === 'ecosystem' && (
        <g {...stroke}>
          <circle cx="15" cy="15" r="9.6" fill={`url(#${soft})`} stroke={`url(#${g})`} />
          <path d="M5.4 15h19.2M15 5.4c2.7 2.8 4 6 4 9.6s-1.3 6.8-4 9.6c-2.7-2.8-4-6-4-9.6s1.3-6.8 4-9.6z" stroke={`url(#${g})`} opacity="0.75" />
          <circle cx="23.4" cy="23.4" r="4.6" fill="#0a1020" stroke={accent2} />
          <path d="M21.5 23.4l1.5 1.5 2.6-2.9" stroke={accent2} />
        </g>
      )}
    </svg>
  );
});

/**
 * THE CINEMATIC STAGE.
 *
 * «تصاویر خیره‌کننده» and «اگر فیلمی میشود پخش شود تبلیغاتی».
 *
 * Two implementations of one slot:
 *   · If a promo film is configured, it plays — muted, looped, inline — inside
 *     a glass frame with a SPONSORED label, because an unlabeled promotional
 *     clip inside a finance app is the thing the AdBanner header comment warns
 *     about.
 *   · Otherwise the stage is an animated vector scene. It is built to be
 *     WATCHED: a horizon glow, drifting light, a line that draws itself, and
 *     particles that rise. All of it is `transform`/`opacity`/`stroke-dashoffset`
 *     on the compositor, and all of it stops under reduced motion.
 */
function StoryStage({ item, gid, still, t, promo }) {
  const { id, accent, accent2 } = item;
  const g = `${gid}-st`;
  const glow = `${gid}-gl`;

  if (promo && item.film) {
    return (
      <div className="market-story-stage-wrap is-film" data-testid="story-stage-film">
        <video
          className="market-story-promo-video"
          src={promo}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-label={t('stories.promo.label')}
        />
        <span className="market-story-promo-flag mono">{t('stories.promo.label')}</span>
      </div>
    );
  }

  return (
    <div className="market-story-stage-wrap" data-testid="story-stage">
      <svg viewBox="0 0 360 150" fill="none" className="market-story-stage-svg" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={g} x1="0" y1="0" x2="360" y2="150" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={accent} stopOpacity="0.36" />
            <stop offset="52%" stopColor={accent2} stopOpacity="0.2" />
            <stop offset="100%" stopColor="#070c18" stopOpacity="0.05" />
          </linearGradient>
          <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={accent} stopOpacity="0.5" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${gid}-ln`} x1="0" y1="0" x2="360" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={accent2} />
            <stop offset="100%" stopColor={accent} />
          </linearGradient>
        </defs>

        <rect x="1" y="1" width="358" height="148" rx="26" fill={`url(#${g})`} />
        {/* horizon light + two drifting blooms — the "film grade" of the frame */}
        <ellipse className="st-bloom" cx="292" cy="34" rx="72" ry="52" fill={`url(#${glow})`} />
        <ellipse className="st-bloom st-bloom--b" cx="62" cy="122" rx="66" ry="46" fill={`url(#${glow})`} opacity="0.7" />
        <path d="M1 118h358" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        {/* perspective floor: cheap depth, no 3D engine */}
        <g stroke="rgba(255,255,255,0.07)" strokeWidth="1">
          <path d="M40 148L120 118M120 148L160 118M200 148L200 118M280 148L240 118M340 148L280 118" />
        </g>

        {id === 'stocks' && (
          <g>
            <rect x="46" y="72" width="22" height="46" rx="7" fill={accent} fillOpacity="0.34" className="st-bar" />
            <rect x="84" y="56" width="22" height="62" rx="7" fill={accent} fillOpacity="0.5" className="st-bar st-d1" />
            <rect x="122" y="40" width="22" height="78" rx="7" fill={accent2} fillOpacity="0.62" className="st-bar st-d2" />
            <rect x="160" y="24" width="22" height="94" rx="7" fill={accent2} fillOpacity="0.85" className="st-bar st-d3" />
            <path className="st-draw" d="M34 96C86 84 128 56 182 32l74-10" stroke={`url(#${gid}-ln)`} strokeWidth="3" strokeLinecap="round" />
            <circle className="st-pulse" cx="256" cy="22" r="6" fill={accent} />
            <g className="st-float">
              <rect x="212" y="56" width="128" height="62" rx="18" fill="rgba(6,11,24,0.72)" stroke={accent} strokeOpacity="0.5" />
              <text x="276" y="82" textAnchor="middle" fill={accent} fontSize="13" fontWeight="800" fontFamily="monospace">xSTOCKS · RWA</text>
              <text x="276" y="102" textAnchor="middle" fill="rgba(255,255,255,0.86)" fontSize="10.5" fontFamily="monospace">NVDA · AAPL · TSLA</text>
            </g>
          </g>
        )}

        {id === 'aparat' && (
          <g>
            <g className="st-float">
              <rect x="34" y="24" width="180" height="102" rx="20" fill="rgba(8,13,26,0.78)" stroke={accent} strokeOpacity="0.55" />
              <circle className="st-pulse" cx="124" cy="75" r="26" fill={accent} fillOpacity="0.22" />
              <path d="M115 62l24 13-24 13z" fill="#fff" />
              <path d="M52 40h24M52 110h40" stroke={accent2} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
            </g>
            <g className="st-float-b">
              <rect x="232" y="42" width="104" height="66" rx="18" fill="rgba(6,11,24,0.74)" stroke={accent2} strokeOpacity="0.5" />
              <text x="284" y="70" textAnchor="middle" fill="#fff" fontSize="12.5" fontWeight="800" fontFamily="monospace">APARAT</text>
              <text x="284" y="90" textAnchor="middle" fill={accent2} fontSize="10" fontFamily="monospace">@Fbtcompany</text>
            </g>
          </g>
        )}

        {id === 'swap' && (
          <g>
            <circle cx="88" cy="75" r="38" fill={accent} fillOpacity="0.16" stroke={accent} strokeOpacity="0.6" strokeWidth="1.8" />
            <circle cx="272" cy="75" r="38" fill={accent2} fillOpacity="0.16" stroke={accent2} strokeOpacity="0.6" strokeWidth="1.8" />
            <path className="st-draw" d="M132 60h96l-13-13M228 90h-96l13 13" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="88" y="80" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="800" fontFamily="monospace">EVM</text>
            <text x="272" y="80" textAnchor="middle" fill={accent2} fontSize="13" fontWeight="800" fontFamily="monospace">SOL</text>
            <circle className="st-orbit" cx="180" cy="75" r="4.5" fill="#fff" />
          </g>
        )}

        {id === 'intent' && (
          <g>
            <circle cx="180" cy="75" r="42" fill={accent} fillOpacity="0.16" stroke={accent} strokeOpacity="0.6" strokeWidth="1.8" />
            <circle className="st-spin" cx="180" cy="75" r="26" stroke={accent2} strokeWidth="1.4" strokeDasharray="5 6" opacity="0.9" />
            <circle className="st-pulse" cx="180" cy="75" r="9" fill="#fff" fillOpacity="0.92" />
            <g stroke={accent2} strokeWidth="1.8" opacity="0.85">
              <path d="M138 75L70 44M138 75L70 106M222 75l68-31M222 75l68 31" />
            </g>
            <circle cx="70" cy="44" r="7" fill={accent2} className="st-blink" />
            <circle cx="70" cy="106" r="7" fill={accent} className="st-blink st-d2" />
            <circle cx="290" cy="44" r="7" fill={accent} className="st-blink st-d1" />
            <circle cx="290" cy="106" r="7" fill={accent2} className="st-blink st-d3" />
          </g>
        )}

        {id === 'defi' && (
          <g>
            <g className="st-float">
              <path d="M104 22l52 26-52 26-52-26z" fill={accent} fillOpacity="0.24" stroke={accent} strokeWidth="1.8" />
              <path d="M52 70l52 26 52-26" stroke={accent2} strokeWidth="1.8" opacity="0.85" />
              <path d="M52 92l52 26 52-26" stroke={accent} strokeWidth="1.8" opacity="0.55" />
            </g>
            <g className="st-float-b">
              <rect x="176" y="38" width="158" height="74" rx="20" fill="rgba(6,11,24,0.74)" stroke={accent2} strokeOpacity="0.5" />
              <text x="255" y="70" textAnchor="middle" fill={accent} fontSize="14" fontWeight="800" fontFamily="monospace">DEFI YIELD</text>
              <text x="255" y="92" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="10.5" fontFamily="monospace">AAVE · MORPHO · KAMINO</text>
            </g>
          </g>
        )}

        {id === 'radio' && (
          <g>
            {[36, 58, 80, 102, 124, 146, 168, 190, 212, 234, 256, 278, 300, 322].map((x, i) => {
              const h = 20 + ((i * 23) % 74);
              return (
                <rect
                  key={x}
                  className={`st-eq st-e${i % 5}`}
                  x={x - 5}
                  y={75 - h / 2}
                  width="10"
                  height={h}
                  rx="5"
                  fill={i % 2 === 0 ? accent : accent2}
                  fillOpacity="0.9"
                />
              );
            })}
          </g>
        )}

        {id === 'orders' && (
          <g>
            <circle cx="88" cy="75" r="38" fill={accent} fillOpacity="0.16" stroke={accent} strokeOpacity="0.6" strokeWidth="1.8" />
            <path className="st-spin-slow" d="M88 47a28 28 0 1 1-19.8 8.2" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
            <path d="M88 58v17l12 8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <g className="st-float-b">
              <rect x="150" y="38" width="180" height="74" rx="20" fill="rgba(6,11,24,0.74)" stroke={accent2} strokeOpacity="0.5" />
              <text x="240" y="70" textAnchor="middle" fill={accent2} fontSize="13" fontWeight="800" fontFamily="monospace">DCA · LIMIT · TWAP</text>
              <text x="240" y="92" textAnchor="middle" fill={accent} fontSize="10.5" fontFamily="monospace">24/7 AUTO EXECUTION</text>
            </g>
          </g>
        )}

        {id === 'ecosystem' && (
          <g>
            <g className="st-float">
              <path d="M92 20l40 16v26c0 25-17 43-40 50-23-7-40-25-40-50V36z" fill={accent} fillOpacity="0.2" stroke={accent} strokeWidth="2" />
              <path className="st-draw" d="M76 62l11 11 22-23" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <g className="st-float-b">
              <rect x="156" y="38" width="176" height="74" rx="20" fill="rgba(6,11,24,0.74)" stroke={accent2} strokeOpacity="0.5" />
              <text x="244" y="70" textAnchor="middle" fill="#fff" fontSize="12.5" fontWeight="800" fontFamily="monospace">WALLET · SHOP · INSURE</text>
              <text x="244" y="92" textAnchor="middle" fill={accent} fontSize="10.5" fontFamily="monospace">NON-CUSTODIAL SUPERAPP</text>
            </g>
          </g>
        )}

        {/* rising particles — the last layer of "this is a film, not a diagram" */}
        {!still && (
          <g className="st-motes" aria-hidden="true">
            {[
              { x: 48, d: 0 }, { x: 112, d: 1.4 }, { x: 176, d: 2.6 },
              { x: 244, d: 0.8 }, { x: 308, d: 3.2 }
            ].map((m) => (
              <circle key={m.x} className="st-mote" cx={m.x} cy="140" r="2.4" fill="#fff" fillOpacity="0.5" style={{ animationDelay: `${m.d}s` }} />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

export default function MarketStories({ coins = [], global = null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const lang = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0].toLowerCase();
  const isRtl = lang === 'fa' || lang === 'ar' || lang === 'ur';
  const isPersian = lang === 'fa';
  const storyItems = useMemo(
    () => MARKET_STORY_ITEMS.filter((item) => item.id !== 'aparat' || isPersian),
    [isPersian]
  );

  /* Store the active story by identity, not by its position in the rail. When
     Aparat is filtered out after a language change, the remaining stories keep
     their identity and sequence instead of silently shifting under the modal. */
  const [activeStoryId, setActiveStoryId] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  /*
   * The story runs itself; nothing can pause it. Kept as a constant rather
   * than deleted so the timer effect below stays readable and so a future
   * "hold to peek" gesture has somewhere to write.
   */
  const paused = false;
  const [scoreOn, setScoreOn] = useState(false);
  const [radioItems, setRadioItems] = useState([]);
  const [radioFailed, setRadioFailed] = useState(false);
  const radioTrack = useRadioStore((s) => s.track);
  const radioPlaying = useRadioStore((s) => s.playing);
  const [seenIds, setSeenIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem('fbt-seen-stories-v1');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [liveEquities, setLiveEquities] = useState([]);

  const dialogRef = useRef(null);
  const audioRef = useRef(null);
  if (!audioRef.current) {
    audioRef.current = createStoryAmbientController();
  }

  useEffect(() => {
    const ctrl = audioRef.current;
    return () => ctrl?.destroy();
  }, []);

  /* A real track taking over always wins over the synthesized score. */
  useEffect(() => {
    if (radioPlaying) { audioRef.current?.stop(); setScoreOn(false); }
  }, [radioPlaying]);

  const activeIndex = activeStoryId == null
    ? -1
    : storyItems.findIndex((item) => item.id === activeStoryId);
  const openIndex = activeIndex >= 0 ? activeIndex : null;
  const activeStory = openIndex == null ? null : storyItems[openIndex];

  /*
   * ─── THE RADIO CATALOGUE IS FETCHED WHEN A STORY OPENS, NOT ON MOUNT ─────
   * Reported: «لود باکس استوری هوشمند خیلی کند شده».
   *
   * The rail is static artwork — it needs no network. The Calm catalogue is
   * consumed INSIDE the full-screen story (the radio section), so fetching it
   * on mount bought nothing and cost something real: one more request racing
   * the market feed on first paint, on the screen where the feed matters most.
   * It now starts on the tap that opens a story (or on mount if a story is
   * already open, e.g. hydrated state), and only once.
   *
   * The catalogue is still the SAME one the News screen reads — `getCalm()`
   * caches for five minutes client-side — so nothing about the sync changed,
   * only WHEN it is asked for.
   */
  const radioRequested = useRef(false);
  useEffect(() => {
    if (openIndex == null || radioRequested.current) return undefined;
    radioRequested.current = true;
    let alive = true;
    getCalm()
      .then((data) => { if (alive) setRadioItems(data?.items || []); })
      .catch(() => { if (alive) setRadioFailed(true); });
    return () => { alive = false; };
  }, [openIndex]);

  /* If a Persian Aparat story is open when the user switches languages, close
     it cleanly rather than leaving an invisible modal or showing another
     story in its old position. */
  useEffect(() => {
    if (activeStoryId != null && openIndex == null) {
      setActiveStoryId(null);
      setElapsedMs(0);
      audioRef.current?.stop();
      setScoreOn(false);
    }
  }, [activeStoryId, openIndex]);

  const markSeen = (id) => {
    setSeenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        sessionStorage.setItem('fbt-seen-stories-v1', JSON.stringify([...next]));
      } catch {
        /* storage full or blocked — the badge simply stays lit */
      }
      return next;
    });
  };

  const openStoryAt = (idx) => {
    const item = storyItems[idx];
    if (!item) return;
    setActiveStoryId(item.id);
    setElapsedMs(0);
    markSeen(item.id);
    /*
     * Autoplay, no button. This runs inside the tap that opened the story, so
     * it is a user gesture and every browser allows it. If the app's own radio
     * is already playing we do NOT start the score on top of it — two sound
     * sources at once is the single worst thing an audio UI can do.
     */
    if (!useRadioStore.getState().playing) {
      setScoreOn(audioRef.current.start('cinema'));
    }
  };

  const closeModal = () => {
    setActiveStoryId(null);
    setElapsedMs(0);
    /* The score belongs to the story; the RADIO does not. Closing a story
       stops the synthesized soundtrack and deliberately leaves a chosen track
       playing in `RadioDock`, above the router, so it survives navigation. */
    if (audioRef.current?.isPlaying()) {
      audioRef.current.stop();
    }
    setScoreOn(false);
  };

  const goNextStory = () => {
    if (openIndex == null) return;
    if (openIndex + 1 < storyItems.length) openStoryAt(openIndex + 1);
    else closeModal();
  };

  const goPrevStory = () => {
    if (openIndex == null) return;
    if (openIndex > 0) openStoryAt(openIndex - 1);
    else setElapsedMs(0);
  };

  // Live equities are fetched only once a story is actually open.
  useEffect(() => {
    if (openIndex == null || liveEquities.length > 0) return undefined;
    let alive = true;
    fetchAvantisEquities()
      .then((res) => {
        if (alive && Array.isArray(res?.rows) && res.rows.length > 0) setLiveEquities(res.rows);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [openIndex, liveEquities.length]);

  // Body scroll lock + keyboard navigation while open.
  useEffect(() => {
    if (openIndex == null) return undefined;
    const unlock = lockBodyScroll();
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Tab') {
        const buttons = [...(dialogRef.current?.querySelectorAll('button, a[href], [tabindex="0"]') || [])];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'ArrowRight') (isRtl ? goPrevStory() : goNextStory());
      else if (e.key === 'ArrowLeft') (isRtl ? goNextStory() : goPrevStory());
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndex, isRtl]);

  // The 60-second story clock.
  useEffect(() => {
    if (openIndex == null || paused) return undefined;
    const stepMs = 200;
    const id = setInterval(() => {
      setElapsedMs((prev) => Math.min(STORY_DURATION_MS, prev + stepMs));
    }, stepMs);
    return () => clearInterval(id);
  }, [openIndex, paused]);

  useEffect(() => {
    if (openIndex != null && elapsedMs >= STORY_DURATION_MS) goNextStory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, openIndex]);

  const topStocks = useMemo(() => {
    if (liveEquities.length >= 3) {
      return [...liveEquities]
        .filter((r) => Number.isFinite(Number(r.price)) && Number(r.price) > 0)
        .sort((a, b) => (Number(b.change24h) || 0) - (Number(a.change24h) || 0))
        .slice(0, 4)
        .map((r) => ({
          symbol: String(r.symbol || '').toUpperCase(),
          name: r.name || `${r.symbol} Equity`,
          price: Number(r.price),
          change24h: Number.isFinite(Number(r.change24h)) ? Number(r.change24h) : 2.4,
          tag: 'Live Feed'
        }));
    }
    return CURATED_TOP_STOCKS.slice(0, 4);
  }, [liveEquities]);

  const topGainerCoins = useMemo(() => {
    if (!Array.isArray(coins) || !coins.length) return [];
    return [...coins]
      .filter((c) => Number.isFinite(Number(c.change24h)))
      .sort((a, b) => (b.change24h || 0) - (a.change24h || 0))
      .slice(0, 4);
  }, [coins]);

  const topVolumeCoins = useMemo(() => {
    if (!Array.isArray(coins) || !coins.length) return [];
    return [...coins].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 4);
  }, [coins]);

  const playRadioTrack = (track) => {
    /* Hand over to the app's real player: stop the score, then write the track
       into the store `RadioDock` is already watching. Because the dock lives
       above the router, this keeps playing after the story closes AND after
       the user navigates to Swap, Wallet or anywhere else. */
    audioRef.current?.stop();
    setScoreOn(false);
    useRadioStore.getState().play(track, radioItems);
  };

  const handlePrimaryNavigate = (route) => {
    closeModal();
    requestAnimationFrame(() => navigate(route));
  };

  const remainingSeconds = Math.max(0, Math.ceil((STORY_DURATION_MS - elapsedMs) / 1000));
  const progressPct = Math.min(100, (elapsedMs / STORY_DURATION_MS) * 100);
  /* Any real audio — the app's radio — outranks the synthesized score in the
     headline cue, because that is the sound the user actually hears. */
  const soundLive = radioPlaying || scoreOn;

  return (
    <section
      className="market-stories-section"
      aria-label={t('stories.railTitle')}
      data-testid="market-stories-rail"
    >
      <span className="market-stories-aurora" aria-hidden="true" />

      <div className="row-between market-stories-head">
        <div className="row market-stories-heading" style={{ gap: 9, minWidth: 0 }}>
          <span className="market-stories-mark" aria-hidden="true">
            <IconSparkle width={14} height={14} />
          </span>
          <span className="section-label market-stories-title" style={{ margin: 0 }}>
            {t('stories.railTitle')}
          </span>
        </div>
        <span className="market-stories-badge mono">{t('stories.railBadge')}</span>
      </div>

      <div className="market-stories-rail" role="list">
        {storyItems.map((item, idx) => {
          const isSeen = seenIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`market-story-Bubble ${isSeen ? 'is-seen' : ''}`}
              style={{ '--story-accent': item.accent, '--story-accent2': item.accent2, '--story-ink': item.ink }}
              onClick={() => openStoryAt(idx)}
              data-testid={`market-story-item-${item.id}`}
            >
              <span className="market-story-ring">
                <span className="market-story-avatar-inner">
                  <StoryGlyph id={item.id} accent={item.accent} accent2={item.accent2} gid={`rail-${item.id}`} />
                </span>
              </span>
              <span className="market-story-chip mono">{item.badge}</span>
              <span className="market-story-label">{t(`stories.items.${item.id}.short`)}</span>
            </button>
          );
        })}
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activeStory && (
              <div className="market-story-overlay" data-testid="market-story-popup">
                <motion.div
                  className="market-story-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: still ? 0 : 0.18 }}
                  onClick={closeModal}
                />

                <motion.div
                  ref={dialogRef}
                  className="market-story-dialog market-glass-surface"
                  style={{ '--story-accent': activeStory.accent, '--story-accent2': activeStory.accent2, '--story-ink': activeStory.ink }}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t(`stories.items.${activeStory.id}.title`)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 14 }}
                  transition={{ duration: still ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span className="market-story-aurora" aria-hidden="true">
                    <i className="market-story-aurora-a" />
                    <i className="market-story-aurora-b" />
                    <i className="market-story-aurora-grid" />
                  </span>

                  {/* ─── PROGRESS: eight circles that fill as each story runs ── */}
                  <div
                    className="market-story-progress-row"
                    data-testid="story-progress-bars"
                    role="group"
                    aria-label={t('stories.progressAria')}
                  >
                    {storyItems.map((st, idx) => {
                      const pct = idx < openIndex ? 100 : idx === openIndex ? progressPct : 0;
                      const state = idx < openIndex ? 'is-done' : idx === openIndex ? 'is-live' : '';
                      return (
                        <button
                          key={st.id}
                          type="button"
                          className={`market-story-progress-seg ${state}`}
                          style={{
                            '--story-accent': st.accent,
                            '--story-accent2': st.accent2,
                            '--story-ink': st.ink,
                            '--p': pct.toFixed(2)
                          }}
                          onClick={() => openStoryAt(idx)}
                          aria-label={t(`stories.items.${st.id}.short`)}
                          aria-current={idx === openIndex ? 'true' : undefined}
                        >
                          <span className="market-story-progress-fill" aria-hidden="true" />
                          <span className="market-story-progress-disc" aria-hidden="true">
                            <StoryGlyph id={st.id} accent={st.accent} accent2={st.accent2} gid={`seg-${st.id}`} />
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* ─── HEADLINE: full title, kicker, badge, countdown ─────── */}
                  <div className="market-story-top-bar">
                    <div className="market-story-head-id">
                      <span className="market-story-head-kicker">
                        <IconSparkle width={12} height={12} />
                        <span>{t(`stories.items.${activeStory.id}.kicker`)}</span>
                      </span>
                      <h2 className="market-story-head-title">
                        {t(`stories.items.${activeStory.id}.title`)}
                      </h2>
                      <div className="market-story-head-sub">
                        <span className="market-story-head-badge mono">{activeStory.badge}</span>
                        {soundLive && (
                          <span
                            className="market-story-playing-indicator"
                            role="img"
                            aria-label={t('stories.score.cue')}
                          >
                            <IconPlay width={13} height={13} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="market-story-top-actions">
                      <span className="market-story-count-pill mono" aria-live="off">
                        {remainingSeconds}s
                      </span>
                      <button
                        type="button"
                        className="market-story-close-btn"
                        onClick={closeModal}
                        aria-label={t('common.close')}
                        data-testid="story-close-btn"
                      >
                        <IconX width={16} height={16} />
                      </button>
                    </div>
                  </div>

                  {/* ─── CINEMATIC STAGE (or the promo film, when configured) ── */}
                  <StoryStage
                    item={activeStory}
                    gid={`stage-${activeStory.id}`}
                    still={still}
                    t={t}
                    promo={STORY_PROMO_VIDEO}
                  />

                  {/* ─── BODY ─────────────────────────────────────────────────── */}
                  <div className="market-story-body">
                    <p className="market-story-lead">
                      {t(`stories.items.${activeStory.id}.subtitle`)}
                    </p>

                    <div className="market-story-facts">
                      {[1, 2, 3].map((n) => (
                        <span key={n} className="market-story-fact">
                          {t(`stories.items.${activeStory.id}.hl${n}`)}
                        </span>
                      ))}
                    </div>

                    {/* 1 · STOCKS & RWA */}
                    {activeStory.id === 'stocks' && (
                      <div className="market-story-panel" data-testid="story-panel-stocks">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">
                            {t('stories.stocks.topGainersTitle')}
                          </span>
                          <span className="mono market-story-tag-accent">
                            {t('stories.stocks.liveTag')}
                          </span>
                        </div>

                        <div className="market-story-stock-list">
                          {topStocks.map((stk, i) => {
                            const up = (stk.change24h ?? 0) >= 0;
                            const barW = Math.min(100, Math.max(18, Math.abs(stk.change24h || 2) * 14));
                            return (
                              <button
                                key={stk.symbol}
                                type="button"
                                className="market-story-stock-row"
                                onClick={() => handlePrimaryNavigate('/stocks')}
                              >
                                <span className="market-story-rank mono">{i + 1}</span>
                                <img
                                  src={tickerLogo(stk.symbol)}
                                  alt=""
                                  className="market-story-stock-logo"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                                <span className="market-story-stock-meta">
                                  <span className="market-story-stock-line">
                                    <span className="market-story-stock-sym mono">{stk.symbol}</span>
                                    <span className="market-story-stock-tag">{stk.tag}</span>
                                  </span>
                                  <span className="market-story-stock-name">{stk.name}</span>
                                  <span className="market-story-return-bar">
                                    <span style={{ width: `${barW}%`, background: up ? 'var(--up)' : 'var(--down)' }} />
                                  </span>
                                </span>
                                <span className="market-story-stock-quote">
                                  <span className="mono market-story-stock-price">{fmtUsd(stk.price)}</span>
                                  <span className={`pill ${up ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 10.5 }}>
                                    {fmtPct(stk.change24h)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 2 · FILM ACADEMY (Aparat) */}
                    {activeStory.id === 'aparat' && (
                      <div className="market-story-panel" data-testid="story-panel-aparat">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">
                            {t('stories.aparat.featuredTitle')}
                          </span>
                          <span className="mono market-story-tag-accent" dir="ltr">
                            aparat.com/Fbtcompany
                          </span>
                        </div>

                        <div className="market-story-feature-grid">
                          {['wallet', 'swap', 'stocks', 'ai'].map((cid, i) => (
                            <button
                              key={cid}
                              type="button"
                              className="market-story-feature-card"
                              onClick={() => handlePrimaryNavigate('/aparat')}
                            >
                              <span className="market-story-feature-top">
                                <span className="mono market-story-feature-idx">0{i + 1}</span>
                                <IconVideo width={15} height={15} />
                              </span>
                              <span className="market-story-feature-name">
                                {t(`aparat.courses.${cid}.title`)}
                              </span>
                              <span className="market-story-feature-desc">
                                {t(`aparat.courses.${cid}.step1`)}
                              </span>
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          className="btn btn-ghost market-story-ext-btn"
                          onClick={() => openUrl(APARAT_CHANNEL_URL)}
                        >
                          <IconVideo width={15} height={15} />
                          <span>{t('aparat.hero.watchOnAparat')}</span>
                          <IconExternal width={14} height={14} />
                        </button>
                      </div>
                    )}

                    {/* 3 · SMART SWAP & SOLANA */}
                    {activeStory.id === 'swap' && (
                      <div className="market-story-panel" data-testid="story-panel-swap">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">
                            {t('stories.swap.topMoversTitle')}
                          </span>
                          <span className="mono market-story-tag-accent">EVM + SOLANA</span>
                        </div>

                        <div className="market-story-stock-list">
                          {topGainerCoins.map((c, i) => (
                            <button
                              key={c.id}
                              type="button"
                              className="market-story-stock-row"
                              onClick={() => handlePrimaryNavigate(`/coin/${c.id}`)}
                            >
                              <span className="market-story-rank mono">{i + 1}</span>
                              <CoinLogo coin={c} size="thumb" px={30} />
                              <span className="market-story-stock-meta">
                                <span className="market-story-stock-sym mono">{c.symbol}</span>
                                <span className="market-story-stock-name">{c.name}</span>
                              </span>
                              <span className="market-story-stock-quote">
                                <span className="mono market-story-stock-price">{fmtUsd(c.price)}</span>
                                <span className={`pill ${(c.change24h ?? 0) >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 10.5 }}>
                                  {fmtPct(c.change24h ?? 0)}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 4 · INTENT AI & SMART MONEY */}
                    {activeStory.id === 'intent' && (
                      <div className="market-story-panel" data-testid="story-panel-intent">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">{t('stories.intent.panelTitle')}</span>
                          <span className="mono market-story-tag-accent">NEURAL OS</span>
                        </div>
                        <div className="market-story-feature-grid">
                          {[
                            { tag: 'NEURAL OS', to: '/intent', title: 'cmd1Title', desc: 'cmd1Desc' },
                            { tag: 'WHALE RADAR', to: '/smart-money', title: 'cmd2Title', desc: 'cmd2Desc' },
                            { tag: 'SIGNALS', to: '/signals', title: 'cmd3Title', desc: 'cmd3Desc' },
                            { tag: 'MACRO AI', to: '/global', title: 'cmd4Title', desc: 'cmd4Desc' }
                          ].map((f) => (
                            <button
                              key={f.to}
                              type="button"
                              className="market-story-feature-card"
                              onClick={() => handlePrimaryNavigate(f.to)}
                            >
                              <span className="mono market-story-tag-accent">{f.tag}</span>
                              <span className="market-story-feature-name">{t(`stories.intent.${f.title}`)}</span>
                              <span className="market-story-feature-desc">{t(`stories.intent.${f.desc}`)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 5 · DEFI FARM & LENDING */}
                    {activeStory.id === 'defi' && (
                      <div className="market-story-panel" data-testid="story-panel-defi">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">{t('stories.defi.panelTitle')}</span>
                          <span className="mono market-story-tag-accent">{t('stories.defi.liveTag')}</span>
                        </div>
                        <div className="market-story-stock-list">
                          {DEFI_HIGHLIGHTS.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              className="market-story-stock-row"
                              onClick={() => handlePrimaryNavigate('/farm')}
                            >
                              <span className="market-story-stock-meta">
                                <span className="market-story-stock-sym">{d.protocol}</span>
                                <span className="market-story-stock-name mono">{d.asset}</span>
                              </span>
                              <span className="market-story-stock-tag">{d.badge}</span>
                              <span className="pill pill-up mono" style={{ fontSize: 11.5 }}>APY {d.apy}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 6 · CRYPTO RADIO — the app's own player, in the background */}
                    {activeStory.id === 'radio' && (
                      <div className="market-story-panel" data-testid="story-panel-radio">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">{t('stories.radio.studioTitle')}</span>
                          <span className="mono market-story-tag-accent">CRYPTO RADIO</span>
                        </div>

                        <div className="market-story-radio-tracks">
                          {radioItems.slice(0, 5).map((track) => {
                            const active = radioTrack?.id === track.id;
                            return (
                              <button
                                key={track.id}
                                type="button"
                                className={`market-story-radio-track ${active ? 'is-active' : ''}`}
                                onClick={() => playRadioTrack(track)}
                              >
                                <span className="market-story-radio-icon" aria-hidden="true">
                                  <IconVolume width={18} height={18} />
                                </span>
                                <span className="market-story-radio-meta">
                                  <span className="market-story-radio-title">{track.title}</span>
                                  <span className="market-story-radio-sub">
                                    {active && radioPlaying
                                      ? t('stories.radio.backgroundHint')
                                      : t('stories.radio.tapHint')}
                                  </span>
                                </span>
                                <span className={`market-story-radio-eq ${active && radioPlaying ? 'is-live' : ''}`} aria-hidden="true">
                                  <i /><i /><i />
                                </span>
                              </button>
                            );
                          })}
                          {!radioItems.length && (
                            <p className="market-story-radio-empty" role="status">
                              {t(radioFailed ? 'common.error' : 'common.loading')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 7 · AUTO ORDERS */}
                    {activeStory.id === 'orders' && (
                      <div className="market-story-panel" data-testid="story-panel-orders">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">{t('stories.orders.panelTitle')}</span>
                          <span className="mono market-story-tag-accent">{t('market.volume24h')}</span>
                        </div>
                        <div className="market-story-stock-list">
                          {topVolumeCoins.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              className="market-story-stock-row"
                              onClick={() => handlePrimaryNavigate('/orders')}
                            >
                              <CoinLogo coin={c} size="thumb" px={30} />
                              <span className="market-story-stock-meta">
                                <span className="market-story-stock-sym mono">{c.symbol}</span>
                                <span className="market-story-stock-name">
                                  {t('market.volume24h')}: {fmtCompact(c.volume || 0)}
                                </span>
                              </span>
                              <span className="mono market-story-stock-price">{fmtUsd(c.price)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 8 · WALLET, SHOP, LAUNCHPAD & INSURANCE */}
                    {activeStory.id === 'ecosystem' && (
                      <div className="market-story-panel" data-testid="story-panel-ecosystem">
                        <div className="market-story-panel-head">
                          <span className="market-story-panel-title">{t('stories.ecosystem.panelTitle')}</span>
                          <span className="mono market-story-tag-accent">SUPERAPP</span>
                        </div>
                        <div className="market-story-feature-grid">
                          {[
                            { tag: 'WALLET', to: '/wallet', title: 'walletTitle', desc: global?.coins ? `${global.coins.toLocaleString()}+ Assets` : 'EVM · Solana · BTC' },
                            { tag: 'SHOP', to: '/shop', title: 'shopTitle', descKey: 'shopDesc' },
                            { tag: 'LAUNCH', to: '/launch', title: 'launchTitle', descKey: 'launchDesc' },
                            { tag: 'SHIELD', to: '/insurance', title: 'insureTitle', descKey: 'insureDesc' }
                          ].map((f) => (
                            <button
                              key={f.to}
                              type="button"
                              className="market-story-feature-card"
                              onClick={() => handlePrimaryNavigate(f.to)}
                            >
                              <span className="mono market-story-tag-accent">{f.tag}</span>
                              <span className="market-story-feature-name">{t(`stories.ecosystem.${f.title}`)}</span>
                              <span className="market-story-feature-desc">
                                {f.desc ?? t(`stories.ecosystem.${f.descKey}`)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── FOOTER: quick links + prev / primary CTA / next ────── */}
                  <div className="market-story-footer">
                    {activeStory.secondaryRoutes?.length > 0 && (
                      <div className="market-story-quick-links">
                        {activeStory.secondaryRoutes.map((sr) => (
                          <button
                            key={sr.to + sr.labelKey}
                            type="button"
                            className="market-story-quick-chip"
                            onClick={() => handlePrimaryNavigate(sr.to)}
                          >
                            {t(sr.labelKey)}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="market-story-cta-row">
                      <button
                        type="button"
                        className="market-story-nav-btn"
                        onClick={goPrevStory}
                        aria-label={t('stories.controls.prev')}
                      >
                        {isRtl ? <IconChevronRight width={18} height={18} /> : <IconChevronLeft width={18} height={18} />}
                      </button>

                      <button
                        type="button"
                        className="market-story-primary-cta"
                        onClick={() => handlePrimaryNavigate(activeStory.route)}
                        data-testid={`story-cta-${activeStory.id}`}
                      >
                        <span>{t(`stories.items.${activeStory.id}.cta`)}</span>
                        <span className="market-story-cta-arrow" aria-hidden="true">
                          {isRtl ? <IconChevronLeft width={15} height={15} /> : <IconChevronRight width={15} height={15} />}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="market-story-nav-btn"
                        onClick={goNextStory}
                        aria-label={t('stories.controls.next')}
                      >
                        {isRtl ? <IconChevronLeft width={18} height={18} /> : <IconChevronRight width={18} height={18} />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </section>
  );
}
