import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../../context/TelegramContext.jsx';
import CoinLogo from '../CoinLogo.jsx';
import { GlyphDeck, GlyphFlame, GlyphPulse, GlyphTrendDown, GlyphTrendUp } from './MarketGlyphs.jsx';
import { fmtCompact, fmtNum, fmtPct } from '../../lib/format.js';
import { finiteOrNull, positiveOrNull } from '../../lib/marketPresentation.js';

const SCENE_DWELL_MS = 8500;

export const HERO_SCENES = [
  {
    id: 'pulse',
    artwork: '/images/market-banner/prism.webp',
    primaryRoute: '/signals',
    secondaryAction: 'tokens'
  },
  {
    id: 'swap',
    artwork: '/images/market-banner/vault.webp',
    primaryRoute: '/swap',
    secondaryRoute: '/solana'
  },
  {
    id: 'wealth',
    artwork: '/images/market-banner/globe.webp',
    primaryRoute: '/smart-money',
    secondaryRoute: '/stocks'
  }
];

/* ── BESPOKE DRAWN SVG MARKS (zero typed arrows, zero platform emojis) ──── */

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

function CrownPrismSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M12 2.8 20.2 9.2 12 21.2 3.8 9.2 12 2.8Z" />
      <path d="M3.8 9.2h16.4M12 2.8 8.6 9.2 12 21.2M12 2.8l3.4 6.4L12 21.2" opacity="0.72" />
      <circle cx="19.2" cy="4.8" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ScenePulseSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <circle cx="12" cy="12" r="8.8" strokeDasharray="3.2 2.6" opacity="0.72" />
      <path d="M4.8 12.4h3.1l1.9-4.6 3.1 8.4 2.1-5.2 1.3 1.4h2.9" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" opacity="0.45" />
    </svg>
  );
}

function SceneSwapSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <ellipse cx="12" cy="12" rx="9.2" ry="4.4" transform="rotate(-28 12 12)" />
      <ellipse cx="12" cy="12" rx="9.2" ry="4.4" transform="rotate(28 12 12)" opacity="0.72" />
      <path d="M12 8.6 15.2 12 12 15.4 8.8 12 12 8.6Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SceneWealthSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <circle cx="11.5" cy="12.5" r="7.8" />
      <ellipse cx="11.5" cy="12.5" rx="3.4" ry="7.8" opacity="0.72" />
      <path d="M4.1 12.5h14.8" opacity="0.68" />
      <path d="m18.8 3.2.75 1.85 1.85.75-1.85.75-.75 1.85-.75-1.85-1.85-.75 1.85-.75.75-1.85Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChipSparkSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="m12 3.2 1.9 5.3 5.3 1.9-5.3 1.9L12 17.6l-1.9-5.3-5.3-1.9 5.3-1.9L12 3.2Z" />
      <circle cx="18.6" cy="18.2" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChipShieldSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M12 3.2 19 6.1v5.5c0 4.5-3 7.9-7 9.4-4-1.5-7-4.9-7-9.4V6.1l7-2.9Z" />
      <path d="m9.2 12.1 2 2 3.8-4" />
    </svg>
  );
}

function ChipOrbitSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M4.2 14.8c-1-3.4 2.1-7.4 7-8.9s9.6-.1 10.6 3.3-2.1 7.4-7 8.9" />
      <circle cx="18.6" cy="6.6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ForwardArrowSvg(props) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

const SCENE_GLYPHS = {
  pulse: ScenePulseSvg,
  swap: SceneSwapSvg,
  wealth: SceneWealthSvg
};

/**
 * Normalises the live 7-day market-cap trend into a smooth SVG polyline inside
 * a 220×52 stage ribbon. Falls back to a calm harmonic horizon while the feed
 * is warming so the vector layer is never blank or NaN.
 */
function buildCurveGeometry(trend) {
  const raw = Array.isArray(trend?.points) ? trend.points : [];
  const ys = raw
    .map((pt) => (typeof pt === 'number' ? pt : finiteOrNull(pt?.y ?? pt?.v)))
    .filter((v) => v != null && Number.isFinite(v));

  if (ys.length < 3) {
    const line = 'M 8 36 C 46 34, 72 22, 110 25 S 172 14, 212 12';
    return {
      line,
      area: `${line} L 212 52 L 8 52 Z`,
      endX: 212,
      endY: 12
    };
  }

  // Sample up to 24 evenly spaced points so the SVG path stays feather-light.
  const step = Math.max(1, Math.floor(ys.length / 24));
  const sampled = [];
  for (let i = 0; i < ys.length; i += step) sampled.push(ys[i]);
  if (sampled[sampled.length - 1] !== ys[ys.length - 1]) {
    sampled.push(ys[ys.length - 1]);
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of sampled) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const x0 = 8;
  const x1 = 212;
  const yTop = 10;
  const yBot = 40;

  const coords = sampled.map((v, idx) => {
    const x = x0 + ((x1 - x0) * idx) / Math.max(1, sampled.length - 1);
    const norm = (v - min) / span;
    const y = yBot - norm * (yBot - yTop);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });

  const line = coords
    .map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const [endX, endY] = coords[coords.length - 1];

  return {
    line,
    area: `${line} L ${endX} 52 L ${x0} 52 Z`,
    endX,
    endY
  };
}

/**
 * Viewport observer so every ambient animation inside the hero banner pauses
 * the instant the user scrolls down into the token list — zero GPU/compositor
 * cost during list scrolling.
 */
function useBannerInView(ref) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(Boolean(entry.isIntersecting));
      },
      { threshold: 0.04, rootMargin: '80px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

function MarketHeroBanner({
  global,
  breadth,
  coins,
  trend,
  vs = 'usd',
  onSelectTab,
  onOpenCoin
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const hostRef = useRef(null);
  const touchStartRef = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inView = useBannerInView(hostRef);

  const [sceneIndex, setSceneIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  const dir = i18n?.dir?.();
  const isRtl = dir
    ? dir === 'rtl'
    : typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mqReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const mqHover = window.matchMedia?.('(hover: hover)');
    const readPrefs = () => {
      const rootDataset = typeof document !== 'undefined' ? document.documentElement?.dataset : null;
      const docStill = Boolean(
        rootDataset?.reduceMotion === 'true'
        || rootDataset?.lite === 'true'
        || rootDataset?.native === 'true'
      );
      setReducedMotion(Boolean(mqReduce?.matches) || docStill);
      setCanHover(Boolean(mqHover?.matches));
    };
    readPrefs();
    const onVis = () => setPageHidden(document.visibilityState === 'hidden');
    mqReduce?.addEventListener?.('change', readPrefs);
    mqHover?.addEventListener?.('change', readPrefs);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mqReduce?.removeEventListener?.('change', readPrefs);
      mqHover?.removeEventListener?.('change', readPrefs);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const autoplay = inView && !hovered && !focused && !pageHidden && !reducedMotion;

  useEffect(() => {
    if (!autoplay) return undefined;
    const timer = window.setTimeout(() => {
      setSceneIndex((prev) => (prev + 1) % HERO_SCENES.length);
    }, SCENE_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [autoplay, sceneIndex]);

  /* Pointer 3D parallax — writes two custom properties directly on the host
     element via rAF so switching cursor position never re-renders React. */
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !inView || !canHover || reducedMotion) return undefined;
    let raf = 0;
    let px = 0;
    let py = 0;

    const flush = () => {
      raf = 0;
      el.style.setProperty('--mhb-px', px.toFixed(3));
      el.style.setProperty('--mhb-py', py.toFixed(3));
    };

    const onPointerMove = (e) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      px = Math.max(-1, Math.min(1, ((e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2))));
      py = Math.max(-1, Math.min(1, ((e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2))));
      if (!raf) raf = window.requestAnimationFrame(flush);
    };

    const onPointerLeave = () => {
      px = 0;
      py = 0;
      if (!raf) raf = window.requestAnimationFrame(flush);
    };

    el.addEventListener('pointermove', onPointerMove, { passive: true });
    el.addEventListener('pointerleave', onPointerLeave, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [inView, canHover, reducedMotion]);

  const selectScene = useCallback((idx) => {
    const next = ((idx % HERO_SCENES.length) + HERO_SCENES.length) % HERO_SCENES.length;
    haptic?.('select');
    setSceneIndex(next);
  }, [haptic]);

  const onKeyDown = useCallback((event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // Only intercept Left/Right when focus is inside the scene switcher group
    if (!event.target?.closest?.('.mhb-scenes')) return;
    event.preventDefault();
    const step = isRtl
      ? (event.key === 'ArrowLeft' ? 1 : -1)
      : (event.key === 'ArrowRight' ? 1 : -1);
    const next = (sceneIndex + step + HERO_SCENES.length) % HERO_SCENES.length;
    selectScene(next);
    window.requestAnimationFrame(() => {
      hostRef.current?.querySelector(`[data-scene-btn="${HERO_SCENES[next].id}"]`)?.focus();
    });
  }, [isRtl, sceneIndex, selectScene]);

  const onTouchStart = useCallback((e) => {
    const touch = e.touches?.[0];
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const onTouchEnd = useCallback((e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const end = e.changedTouches?.[0];
    if (!start || !end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < 38 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    const forward = isRtl ? dx > 0 : dx < 0;
    selectScene(sceneIndex + (forward ? 1 : -1));
  }, [isRtl, sceneIndex, selectScene]);

  const pulseStageOnTap = useCallback(() => {
    if (reducedMotion) return;
    setPressed(true);
    window.setTimeout(() => setPressed(false), 620);
  }, [reducedMotion]);

  const activeScene = HERO_SCENES[sceneIndex] || HERO_SCENES[0];
  const ActiveGlyph = SCENE_GLYPHS[activeScene.id] || ScenePulseSvg;

  const handlePrimaryCta = useCallback(() => {
    haptic?.('light');
    navigate(activeScene.primaryRoute);
  }, [activeScene.primaryRoute, haptic, navigate]);

  const handleSecondaryCta = useCallback(() => {
    haptic?.('light');
    if (activeScene.secondaryAction === 'tokens') {
      onSelectTab?.('tokens');
      window.requestAnimationFrame(() => {
        const target = typeof document !== 'undefined'
          ? (document.getElementById('market-search') || document.getElementById('market-panel-tokens'))
          : null;
        target?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      });
      return;
    }
    if (activeScene.secondaryRoute) {
      navigate(activeScene.secondaryRoute);
    }
  }, [activeScene, haptic, navigate, onSelectTab, reducedMotion]);

  /* ── LIVE TELEMETRY DERIVATIONS (honest feed readings, zero extra calls) ── */
  const rawMcap = positiveOrNull(global?.mcap ?? global?.totalMcap);
  const hasMcap = rawMcap != null && !global?.offline;
  const mcapText = hasMcap ? fmtCompact(rawMcap, vs) : '—';
  const mcapChange = hasMcap ? finiteOrNull(global?.mcapChange) : null;

  const hasBreadth = Number(breadth?.counted ?? breadth?.total) > 0;
  const upPct = hasBreadth ? Math.round((breadth.upShare || 0) * 100) : null;

  const topLeader = useMemo(() => {
    if (!Array.isArray(coins) || !coins.length) return null;
    let best = null;
    for (const coin of coins) {
      if (!coin || coin.offline) continue;
      const chg = finiteOrNull(coin.change24h);
      if (chg == null || chg <= 0) continue;
      if (!best || chg > best.change24h) {
        best = {
          id: coin.id,
          symbol: String(coin.symbol || '').toUpperCase(),
          name: coin.name,
          image: coin.image,
          change24h: chg
        };
      }
    }
    return best;
  }, [coins]);

  const curve = useMemo(() => buildCurveGeometry(trend), [trend]);
  const hudGradId = `mhb-hud-grad-${uid}`;
  const curveLineId = `mhb-curve-line-${uid}`;
  const curveFillId = `mhb-curve-fill-${uid}`;

  return (
    <section
      ref={hostRef}
      className={`mhb${pressed ? ' is-touched' : ''}`}
      data-scene={activeScene.id}
      data-inview={inView ? 'true' : 'false'}
      data-autoplay={autoplay ? 'true' : 'false'}
      data-still={reducedMotion ? 'true' : undefined}
      aria-label={t('marketHero.ariaLabel')}
      aria-roledescription={t('marketHero.roleDesc')}
      data-testid="market-hero-banner"
      onMouseEnter={() => { if (canHover) setHovered(true); }}
      onMouseLeave={() => { if (canHover) setHovered(false); }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onPointerDown={pulseStageOnTap}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
    >
      {/* ── AMBIENT PAINTED PLANES (strictly aria-hidden, compositor-only) ── */}
      <span className="mhb-rim" aria-hidden="true" />
      <span className="mhb-ambient" aria-hidden="true">
        <i className="mhb-aurora mhb-aurora--pulse" />
        <i className="mhb-aurora mhb-aurora--swap" />
        <i className="mhb-aurora mhb-aurora--wealth" />
        <i className="mhb-mesh" />
        <i className="mhb-blade" />
        <i className="mhb-sheen" />
      </span>

      {/* ── 1 · TOP COMMAND BAR: CREST + SCENE SWITCHER PILLS ─────────────── */}
      <div className="mhb-top">
        <div className="mhb-kicker">
          <span className="mhb-kicker-gem" aria-hidden="true">
            <CrownPrismSvg width={15} height={15} />
          </span>
          <span className="mhb-kicker-text">{t('marketHero.kicker')}</span>
          <span className="mhb-live-pill">
            <i className="mhb-live-dot" aria-hidden="true" />
            <span>{t('marketHero.liveBadge')}</span>
          </span>
        </div>

        <div className="mhb-scenes" role="group" aria-label={t('marketHero.scenesAria')}>
          {HERO_SCENES.map((scene, idx) => {
            const Glyph = SCENE_GLYPHS[scene.id] || ScenePulseSvg;
            const active = idx === sceneIndex;
            return (
              <button
                key={scene.id}
                type="button"
                className="mhb-scene-btn"
                data-scene-btn={scene.id}
                data-active={active ? 'true' : undefined}
                aria-pressed={active}
                onClick={() => selectScene(idx)}
              >
                <Glyph className="mhb-scene-icon" width={14} height={14} />
                <span className="mhb-scene-label">{t(`marketHero.scenes.${scene.id}.pill`)}</span>
                {active && (
                  <span className="mhb-scene-progress" aria-hidden="true">
                    <i
                      key={`${scene.id}-${autoplay ? 'run' : 'hold'}`}
                      className="mhb-scene-fill"
                      style={{ animationDuration: `${SCENE_DWELL_MS}ms` }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 2 · CINEMA STAGE: EDITORIAL COPY + 3D ARTWORK & VECTOR HUD ────── */}
      <div className="mhb-body">
        <div className="mhb-copy">
          <span className="mhb-tag">
            <ActiveGlyph width={13} height={13} />
            <span>{t(`marketHero.scenes.${activeScene.id}.tag`)}</span>
          </span>

          <h2 className="mhb-title" data-testid="market-hero-title">
            <span>{t(`marketHero.scenes.${activeScene.id}.titleLead`)} </span>
            <span className="mhb-title-accent">
              {t(`marketHero.scenes.${activeScene.id}.titleAccent`)}
            </span>
          </h2>

          <p className="mhb-desc">
            {t(`marketHero.scenes.${activeScene.id}.desc`)}
          </p>

          <div className="mhb-chips" aria-hidden="true">
            <span className="mhb-chip">
              <ChipSparkSvg width={12} height={12} />
              <span>{t(`marketHero.scenes.${activeScene.id}.chip1`)}</span>
            </span>
            <span className="mhb-chip">
              <ChipOrbitSvg width={12} height={12} />
              <span>{t(`marketHero.scenes.${activeScene.id}.chip2`)}</span>
            </span>
            <span className="mhb-chip">
              <ChipShieldSvg width={12} height={12} />
              <span>{t(`marketHero.scenes.${activeScene.id}.chip3`)}</span>
            </span>
          </div>
        </div>

        {/* 3D Refractive Sculpture Portal + Precision SVG HUD */}
        <div className="mhb-stage" aria-hidden="true" data-testid="market-hero-stage">
          <span className="mhb-stage-halo" />

          {/* Vector Orbital Gyroscope HUD */}
          <svg className="mhb-hud-svg" viewBox="0 0 220 220" fill="none">
            <defs>
              <linearGradient id={hudGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: 'var(--mhb-acc)' }} stopOpacity="0.95" />
                <stop offset="55%" style={{ stopColor: 'var(--mhb-acc-2)' }} stopOpacity="0.75" />
                <stop offset="100%" style={{ stopColor: 'var(--mhb-acc)' }} stopOpacity="0.12" />
              </linearGradient>
            </defs>
            <circle
              className="mhb-hud-ring mhb-hud-ring--outer"
              cx="110"
              cy="110"
              r="103"
              stroke={`url(#${hudGradId})`}
              strokeWidth="1.15"
              strokeDasharray="2 7"
            />
            <g className="mhb-hud-orbit">
              <circle
                cx="110"
                cy="110"
                r="92"
                stroke={`url(#${hudGradId})`}
                strokeWidth="1.8"
                strokeDasharray="54 196"
                strokeLinecap="round"
              />
              <circle cx="110" cy="18" r="3.1" style={{ fill: 'var(--mhb-acc)' }} />
              <circle cx="110" cy="202" r="2.2" style={{ fill: 'var(--mhb-acc-2)' }} opacity="0.85" />
            </g>
            <path
              className="mhb-hud-ticks"
              d="M110 3v6M110 211v6M3 110h6M211 110h6"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              opacity="0.42"
            />
          </svg>

          {/* Sculpted Obsidian Lens holding the bespoke 3D WebP artworks */}
          <div className="mhb-portal">
            <span className="mhb-portal-core" />
            {HERO_SCENES.map((scene, idx) => {
              const isCurrent = idx === sceneIndex;
              return (
                <img
                  key={scene.id}
                  src={scene.artwork}
                  alt=""
                  width="280"
                  height="280"
                  decoding="async"
                  loading={idx === 0 ? 'eager' : 'lazy'}
                  fetchpriority={idx === 0 ? 'high' : 'low'}
                  className={`mhb-art${isCurrent ? ' is-active' : ''}`}
                  data-scene-art={scene.id}
                />
              );
            })}
            <span className="mhb-portal-vignette" />
            <span className="mhb-portal-glaze" />
          </div>

          {/* Live 7-Day Market Horizon SVG Ribbon */}
          <div className="mhb-wave">
            <svg viewBox="0 0 220 52" preserveAspectRatio="none">
              <defs>
                <linearGradient id={curveLineId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style={{ stopColor: 'var(--mhb-acc-2)' }} stopOpacity="0.25" />
                  <stop offset="55%" style={{ stopColor: 'var(--mhb-acc)' }} stopOpacity="0.95" />
                  <stop offset="100%" style={{ stopColor: '#ffffff' }} stopOpacity="0.98" />
                </linearGradient>
                <linearGradient id={curveFillId} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" style={{ stopColor: 'var(--mhb-acc)' }} stopOpacity="0.30" />
                  <stop offset="100%" style={{ stopColor: 'var(--mhb-acc)' }} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={curve.area} fill={`url(#${curveFillId})`} />
              <path
                d={curve.line}
                fill="none"
                stroke={`url(#${curveLineId})`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={curve.endX} cy={curve.endY} r="5.5" style={{ fill: 'var(--mhb-acc)' }} opacity="0.28" />
              <circle cx={curve.endX} cy={curve.endY} r="2.6" fill="#ffffff" />
            </svg>
          </div>

          {/* Floating Specular Stage Crest */}
          <span className="mhb-stage-badge">
            <ChipSparkSvg width={11} height={11} />
            <span>{t(`marketHero.scenes.${activeScene.id}.stageBadge`)}</span>
          </span>
        </div>
      </div>

      {/* ── 3 · INTERACTIVE ACTION BAR ────────────────────────────────────── */}
      <div className="mhb-actions">
        <button
          type="button"
          className="mhb-cta mhb-cta--primary"
          onClick={handlePrimaryCta}
          data-testid="market-hero-primary-cta"
        >
          <ActiveGlyph width={15} height={15} />
          <span>{t(`marketHero.scenes.${activeScene.id}.ctaPrimary`)}</span>
          <ForwardArrowSvg className="mhb-arrow" width={14} height={14} />
        </button>

        <button
          type="button"
          className="mhb-cta mhb-cta--secondary"
          onClick={handleSecondaryCta}
          data-testid="market-hero-secondary-cta"
        >
          <span>{t(`marketHero.scenes.${activeScene.id}.ctaSecondary`)}</span>
          <ForwardArrowSvg className="mhb-arrow" width={13} height={13} />
        </button>
      </div>

      {/* ── 4 · LIVE MARKET TELEMETRY RIBBON (real feed values, tappable) ─── */}
      <div className="mhb-telemetry" role="group" aria-label={t('marketHero.telemetry.aria')} data-testid="market-hero-telemetry">
        <button
          type="button"
          className="mhb-pod"
          aria-label={t('marketHero.telemetry.mcapAria')}
          onClick={() => {
            haptic?.('select');
            onSelectTab?.('overview');
          }}
        >
          <span className="mhb-pod-icon" aria-hidden="true">
            <GlyphDeck width={13} height={13} />
          </span>
          <span className="mhb-pod-meta">
            <span className="mhb-pod-label">{t('marketHero.telemetry.mcap')}</span>
            <span className="mhb-pod-val mono">
              <span>{mcapText}</span>
              {mcapChange != null && (
                <em className="mhb-pod-delta" data-tone={mcapChange >= 0 ? 'up' : 'down'}>
                  {mcapChange >= 0 ? <GlyphTrendUp width={10} height={10} /> : <GlyphTrendDown width={10} height={10} />}
                  {fmtPct(mcapChange, 1)}
                </em>
              )}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="mhb-pod"
          aria-label={t('marketHero.telemetry.breadthAria')}
          onClick={() => {
            haptic?.('select');
            onSelectTab?.('tokens');
          }}
        >
          <span className="mhb-pod-icon" aria-hidden="true">
            <GlyphPulse width={13} height={13} />
          </span>
          <span className="mhb-pod-meta">
            <span className="mhb-pod-label">{t('marketHero.telemetry.breadth')}</span>
            <span className="mhb-pod-val mono">
              {upPct != null ? (
                <>
                  <span data-tone={upPct >= 50 ? 'up' : 'down'}>{fmtNum(upPct)}%</span>
                  <span className="mhb-mini-bar" aria-hidden="true">
                    <i className="is-up" style={{ width: `${Math.max(6, Math.min(94, upPct))}%` }} />
                  </span>
                </>
              ) : (
                <span>—</span>
              )}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="mhb-pod mhb-pod--leader"
          aria-label={
            topLeader
              ? t('marketHero.telemetry.topMoverAria', { symbol: topLeader.symbol })
              : t('marketHero.telemetry.breadthAria')
          }
          data-testid="market-hero-leader"
          onClick={() => {
            haptic?.('light');
            if (topLeader?.id && onOpenCoin) {
              onOpenCoin(topLeader.id);
            } else {
              onSelectTab?.('tokens');
            }
          }}
        >
          <span className="mhb-pod-icon is-warm" aria-hidden="true">
            {topLeader ? (
              <CoinLogo coin={topLeader} size="thumb" px={18} className="mhb-leader-logo coin-logo" />
            ) : (
              <GlyphFlame width={13} height={13} />
            )}
          </span>
          <span className="mhb-pod-meta">
            <span className="mhb-pod-label">{t('marketHero.telemetry.topMover')}</span>
            <span className="mhb-pod-val mono">
              {topLeader ? (
                <>
                  <span className="mhb-leader-sym">{topLeader.symbol}</span>
                  <em className="mhb-pod-delta" data-tone="up">
                    <GlyphTrendUp width={10} height={10} />
                    {fmtPct(topLeader.change24h, 1)}
                  </em>
                </>
              ) : (
                <span className="mhb-pod-sync">{t('marketHero.telemetry.awaiting')}</span>
              )}
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}

export default memo(MarketHeroBanner);
