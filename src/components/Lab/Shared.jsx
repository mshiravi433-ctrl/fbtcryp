/**
 * Shared building blocks for the Lab v2 screens.
 *
 * ─── WHY A BARREL ────────────────────────────────────────────────────────────
 * Nine screens and every one of them needs a back button, a result card, a
 * coach box, a slider, a chart and a percentage stat row. Without this file the
 * `import` block at the top of each screen would be a dozen lines long and the
 * markup would be visually identical — but inlined, with one screen's `.lab2-back`
 * having a 2px padding and another's a 4px, which is how visual drift creeps in.
 *
 * ─── WHAT CHANGED IN THE REDESIGN ────────────────────────────────────────────
 *   · Emoji are gone. Every glyph is now an SVG from ./LabIcons, so it can be
 *     recoloured by the accent token, gradient-painted, and animated.
 *   · Motion lives here, not in the screens: counters spring to their value,
 *     charts draw themselves, the coach breathes, results pop. Each one checks
 *     `useStill()` first and renders the finished state when the user has asked
 *     for reduced motion (or the system has).
 *   · New primitives the child screens share: `LabChips` (a sliding-pill chip
 *     strip), `LabSlider` (a range input that can show its own filled track),
 *     `Donut`, `Meter`, `AnimatedNumber`, `StatChip`, `PriceBlock`, `LivePill`.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform
} from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLabStore } from '../../store/useLabStore';
import { useStill } from '../AnimatedIcon';
import {
  applyPercentInput,
  clampToRange,
  formatPercent,
  parsePercentText,
  sliderPaintPercent,
  stepDirection
} from '../../lib/lab/percent';
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconChevronLeft,
  IconCoins,
  IconFlat,
  IconRobot,
  IconSearch,
  IconShield,
  LabIcon
} from './LabIcons';

/* Standard easing for everything in the Lab: fast out, long settle. */
export const LAB_EASE = [0.22, 1, 0.36, 1];

/** Stagger parents/children for grid reveals. Import, don't re-declare. */
export const labStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } }
};

export const labRise = {
  hidden: { opacity: 0, y: 16, scale: 0.975 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.46, ease: LAB_EASE } }
};

export const labFade = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.34, ease: LAB_EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: 'easeIn' } }
};

const clampPct = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

/**
 * IS THE DOCUMENT RIGHT-TO-LEFT, LIVE?
 *
 * `document.documentElement.dir` is the single source of truth for direction in
 * this app (see i18n/index.js `applyDirection`) and it is set OUTSIDE React, so
 * a component cannot read it during render and expect to be re-rendered when
 * the reader switches language. A slider that painted its filled track from the
 * wrong edge after a language switch is exactly that failure: correct on mount,
 * wrong until the next navigation.
 *
 * So: read it on mount, then observe the attribute. The observer is per
 * component and cheap — direction changes a handful of times per session.
 */
export function useIsRtl() {
  const read = () =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('dir') === 'rtl';
  const [rtl, setRtl] = useState(read);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined;
    const obs = new MutationObserver(() => setRtl(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    return () => obs.disconnect();
  }, []);
  return rtl;
}

/**
 * Level name with a real fallback.
 *
 * The Lab store stores a `nameKey` (beginner/trader/…). If a locale does not
 * contain that key yet, react-i18next would otherwise paint the raw key (for
 * example `lab2.levelNames.level2`) next to a Persian sentence. This helper
 * prefers the translated string, then the store's display name, then a plain
 * human string — never a key.
 */
export function labLevelName(t, level) {
  const key = `lab2.levelNames.${level?.nameKey || 'beginner'}`;
  const translated = t(key, { defaultValue: '' });
  if (translated && translated !== '' && !translated.startsWith('lab2.')) return translated;
  return level?.name || t('lab2.levelNames.beginner', 'Beginner');
}

/* ══════════════════════════════════════════════════════════════════════════
   ANIMATED NUMBER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A number that springs to its value instead of snapping.
 *
 * The balance and every stat on this page changes while the user is looking at
 * it (a tick lands, a round settles). A snap makes it impossible to tell that
 * anything happened; a count makes the change legible without a toast.
 */
export function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0, className = '' }) {
  const still = useStill();
  const target = Number.isFinite(Number(value)) ? Number(value) : 0;
  const mv = useMotionValue(still ? target : 0);
  const spring = useSpring(mv, { stiffness: 110, damping: 22, mass: 0.5 });
  const text = useTransform(spring, (v) =>
    `${prefix}${v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}${suffix}`
  );

  useEffect(() => {
    mv.set(target);
  }, [target, mv]);

  if (still) {
    return (
      <span className={`lab2-num ${className}`.trim()}>
        {prefix}
        {target.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        {suffix}
      </span>
    );
  }

  return <motion.span className={`lab2-num ${className}`.trim()}>{text}</motion.span>;
}

/* ══════════════════════════════════════════════════════════════════════════
   HERO HEADER
   ══════════════════════════════════════════════════════════════════════════ */

export function LabHeader() {
  const { t } = useTranslation();
  const still = useStill();
  const uid = useId().replace(/:/g, '');
  const gid = `labRing-${uid}`;

  const balance = useLabStore((s) => s.balance);
  const xp = useLabStore((s) => s.xp);
  const levelFn = useLabStore((s) => s.level);
  const predictionsCount = useLabStore((s) => s.predictionsCount);
  const correctPredictions = useLabStore((s) => s.correctPredictions);
  const accuracy = predictionsCount > 0 ? Math.round((correctPredictions / predictionsCount) * 100) : 0;
  const rank = useLabStore((s) => {
    const lb = [...s.leaderboard].sort((a, b) => b.xp - a.xp);
    const idx = lb.findIndex((r) => r.isYou);
    return idx >= 0 ? idx + 1 : lb.length + 1;
  });

  const lvl = levelFn();

  /* Ring geometry: r=32 inside a 78-unit box leaves room for the 7u stroke. */
  const R = 32;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC - (CIRC * clampPct(lvl.pct)) / 100;

  return (
    <motion.header
      className="lab2-header"
      initial={still ? false : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: LAB_EASE }}
    >
      <div className="lab2-hero-bg" aria-hidden="true">
        <span className="lab2-hero-orb a" />
        <span className="lab2-hero-orb b" />
        <span className="lab2-hero-grid" />
        <span className="lab2-hero-sheen" />
      </div>

      <div className="lab2-balance-row">
        <div className="lab2-balance-block">
          <div className="lab2-balance-label">
            <IconCoins width={13} height={13} />
            {t('lab2.virtualBalance', 'Virtual Balance')}
          </div>
          <div className="lab2-balance">
            <AnimatedNumber value={balance} prefix="$" />
          </div>
          <div className="lab2-balance-sub">
            <IconShield width={13} height={13} />
            {t('lab2.practiceOnly', 'Practice only — not real money')}
          </div>
        </div>

        {/* Progress to the next level, as a ring rather than a bar: the bar
            below already says "how far", the ring says "where you are". */}
        <div
          className="lab2-ring"
          role="img"
          aria-label={`${t('lab2.level.level', 'Level')} ${lvl.lvl} — ${lvl.pct}%`}
        >
          <svg viewBox="0 0 78 78">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--rgb-1)" />
                <stop offset="52%" stopColor="var(--rgb-2)" />
                <stop offset="100%" stopColor="var(--rgb-3)" />
              </linearGradient>
            </defs>
            <circle className="lab2-ring-track" cx="39" cy="39" r={R} fill="none" strokeWidth="7" />
            <motion.circle
              className="lab2-ring-value"
              cx="39"
              cy="39"
              r={R}
              fill="none"
              strokeWidth="7"
              stroke={`url(#${gid})`}
              strokeDasharray={CIRC}
              initial={still ? false : { strokeDashoffset: CIRC }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1.15, ease: LAB_EASE }}
            />
          </svg>
          <div className="lab2-ring-core">
            <span className="lab2-ring-num">{lvl.lvl}</span>
            <span className="lab2-ring-cap">{t('lab2.level.level', 'Level')}</span>
          </div>
        </div>
      </div>

      <div className="lab2-stats">
        <StatChip accent="mint" icon="target" value={`${accuracy}%`} label={t('lab2.accuracy', 'Accuracy')} />
        <StatChip accent="magenta" icon="medal" value={`#${rank}`} label={t('lab2.rank', 'Rank')} />
        <StatChip
          accent="amber"
          icon="sparkles"
          value={<AnimatedNumber value={xp} />}
          label={t('lab2.level.xp', 'XP')}
        />
      </div>

      <div className="lab2-level">
        <div className="lab2-level-info">
          <div className="lab2-level-name">
            <strong>{labLevelName(t, lvl)}</strong>
            {/* `lab2.level` is an OBJECT namespace (currentLevel, xp, …); asking
                i18next for it painted the literal error string
                "key 'lab2.level (fa)' returned an object instead of string"
                in place of the word «سطح». The string lives one level deeper. */}
            <span>
              {t('lab2.xpRange', { cur: xp.toLocaleString(), next: lvl.nextXp.toLocaleString() })}
            </span>
          </div>
          <div
            className="lab2-bar"
            role="progressbar"
            aria-valuenow={lvl.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <motion.div
              className="lab2-bar-fill"
              initial={still ? false : { width: 0 }}
              animate={{ width: `${clampPct(lvl.pct)}%` }}
              transition={{ duration: 0.9, ease: LAB_EASE }}
            />
          </div>
        </div>
      </div>

    </motion.header>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SMALL PIECES
   ══════════════════════════════════════════════════════════════════════════ */

/** One glass pill: gradient icon tile + value + uppercase key. */
export function StatChip({ icon = 'sparkles', value, label, accent = 'cyan' }) {
  return (
    <div className={`lab2-stat acc-${accent}`}>
      <span className="lab2-stat-icon" aria-hidden="true">
        <LabIcon name={icon} width={16} height={16} />
      </span>
      <span className="lab2-stat-body">
        <span className="lab2-stat-val">{value}</span>
        <span className="lab2-stat-key">{label}</span>
      </span>
    </div>
  );
}

/** Blinking "live" pill — the price feeds on these screens really do tick. */
export function LivePill({ label = 'LIVE' }) {
  return (
    <span className="lab2-live">
      <span className="lab2-live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Big price + pair tag + live pill, the head of every trading screen. */
export function PriceBlock({ price, pair = 'USD', loading = false, live = true }) {
  const text =
    price == null
      ? null
      : `$${Number(price).toLocaleString('en-US', {
          maximumFractionDigits: price < 1 ? 5 : 2
        })}`;

  return (
    <div className="lab2-price-block">
      {loading || text == null ? (
        <span className="lab2-skeleton" style={{ height: 30, width: 140 }} aria-hidden="true" />
      ) : (
        <span className="lab2-price lab2-num">{text}</span>
      )}
      <span className="lab2-price-pair lab2-num">{pair}</span>
      {live && <LivePill />}
    </div>
  );
}

/** A thin gradient meter — XP bars, discipline scores, leaderboard rows. */
export function Meter({ value, max = 100, accent, animate = true }) {
  const still = useStill();
  const pct = clampPct(max > 0 ? (Number(value) / max) * 100 : 0);
  return (
    <div className={`lab2-meter ${accent ? `acc-${accent}` : ''}`}>
      <motion.div
        className="lab2-meter-fill"
        initial={still || !animate ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: LAB_EASE }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN HEAD · PANEL · ROW
   ══════════════════════════════════════════════════════════════════════════ */

export function LabBack({ onBack, title, sub, icon, accent = 'cyan' }) {
  const { t } = useTranslation();
  return (
    <motion.div
      className={`lab2-screen-head acc-${accent}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: LAB_EASE }}
    >
      <button className="lab2-back" onClick={onBack} aria-label={t('common.back', 'Back')} type="button">
        <span className="lab2-back-glyph">
          <IconChevronLeft width={19} height={19} />
        </span>
      </button>
      <div className="lab2-screen-head-text">
        <div className="lab2-screen-title">{title}</div>
        {sub && <div className="lab2-screen-sub">{sub}</div>}
      </div>
      {icon && (
        <div className="lab2-screen-badge" aria-hidden="true">
          <LabIcon name={icon} width={23} height={23} />
        </div>
      )}
    </motion.div>
  );
}

export function Panel({ title, icon, action, accent, className = '', children }) {
  return (
    <section className={`lab2-panel ${accent ? `acc-${accent}` : ''} ${className}`.trim()}>
      {title && (
        <div className={`lab2-panel-title ${icon ? 'with-icon' : ''}`.trim()}>
          {icon && <LabIcon name={icon} width={16} height={16} aria-hidden="true" />}
          <span>{title}</span>
          {action && <span className="lab2-panel-action">{action}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ label, value, valueClass, icon }) {
  return (
    <div className="lab2-row">
      <span>
        {icon && <LabIcon name={icon} width={14} height={14} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />}
        {label}
      </span>
      <strong className={valueClass || ''}>{value}</strong>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   AI COACH
   ══════════════════════════════════════════════════════════════════════════ */

const COACH_ICON = {
  neutral: 'robot',
  good: 'checkCircle',
  warn: 'alert'
};

/**
 * THE COACH, STREAMING.
 *
 * «مربی هوش مصنوعی واقعا خوب کار بده» — a static line under a trading card
 * reads as decoration, and the report was right: an AI that never visibly does
 * anything is a label, not a coach. Three changes make it read as a coach
 * that is working:
 *
 *  · THE MESSAGE STREAMS. It types out character by character with a caret,
 *    the way every assistant the reader has ever used behaves — so a changed
 *    verdict is visibly NEW, not a line that silently swapped. Reduced motion
 *    gets the complete sentence instantly.
 *  · TONE NOW REACHES THE BOX ITSELF. A warning looks like a warning (amber
 *    rim) and a green-light looks like one (mint rim), so the verdict lands
 *    before the first word is read. `data-tone` is the hook; CSS owns it.
 *  · `chips` SHOW THE NUMBERS THE VERDICT IS ABOUT. A coach that says "cut
 *    the size" without saying what the size IS makes the reader go hunting;
 *    the chips print the measured R:R, size % and $ risk under the sentence.
 */
export function AICoach({ name, message, emoji, icon, tone = 'neutral', chips }) {
  const { t } = useTranslation();
  const still = useStill();
  const [typed, setTyped] = useState(() => (still || !message ? String(message ?? '') : ''));

  useEffect(() => {
    const full = String(message ?? '');
    if (still || !full) {
      setTyped(full);
      return undefined;
    }
    /* ~2 characters per frame ≈ 120/s: a 90-character verdict lands in under
       a second — readable speed, not a gimmick. requestAnimationFrame idles
       automatically when the tab hides. */
    let i = 0;
    let raf = 0;
    setTyped('');
    const step = () => {
      i = Math.min(full.length, i + 2);
      setTyped(full.slice(0, i));
      if (i < full.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [message, still]);

  if (!message) return null;
  const coachName = name ?? t('lab2.aiCoach');
  const glyph = emoji ?? <LabIcon name={icon || COACH_ICON[tone] || 'robot'} width={21} height={21} />;
  const typing = !still && typed.length < String(message).length;

  return (
    <motion.div
      className="lab2-coach"
      data-tone={tone}
      initial={still ? false : { opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: LAB_EASE }}
    >
      <div className="lab2-coach-avatar" data-tone={tone} aria-hidden="true">
        {glyph}
      </div>
      <div className="lab2-coach-body">
        <div className="lab2-coach-name" data-tone={tone}>
          <IconRobot width={13} height={13} />
          {coachName}
          <span className="lab2-coach-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="lab2-coach-msg">
          {typed}
          {typing && <span className="lab2-coach-caret" aria-hidden="true" />}
        </div>
        {Array.isArray(chips) && chips.length > 0 && (
          <div className="lab2-coach-chips">
            {chips.map((c, i) => (
              <span key={`${c.label}-${i}`} className={`lab2-coach-chip ${c.tone ? `is-${c.tone}` : ''}`}>
                <span className="lab2-coach-chip-k">{c.label}</span>
                <b className="lab2-num">{c.value}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   RESULT CARD
   ══════════════════════════════════════════════════════════════════════════ */

const RESULT_ICON = { win: 'trophy', loss: 'trend', neutral: 'sparkles' };

export function ResultCard({ kind = 'neutral', emoji, icon, title, sub, figure, children }) {
  const still = useStill();
  const glyph = emoji ?? <LabIcon name={icon || RESULT_ICON[kind] || 'sparkles'} width={30} height={30} />;

  return (
    <motion.div
      className={`lab2-result ${kind}`}
      initial={still ? false : { opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: LAB_EASE }}
    >
      <div className="lab2-result-icon" aria-hidden="true">
        {glyph}
      </div>
      {figure != null && <div className="lab2-result-figure lab2-num">{figure}</div>}
      {title && <div className="lab2-result-title">{title}</div>}
      {sub && <div className="lab2-result-sub">{sub}</div>}
      {children}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   NOTICES
   ══════════════════════════════════════════════════════════════════════════ */

const NOTICE_ICON = {
  tip: 'bulb',
  info: 'info',
  warn: 'alert',
  danger: 'alert',
  success: 'checkCircle',
  coach: 'robot'
};

/* Icon names accepted by `Notice icon="…"`. Anything not in this list is
   treated as literal text, so an emoji still renders during a migration
   instead of silently painting nothing. */
const NOTICE_ICON_GLYPHS = new Set([
  'bulb', 'info', 'alert', 'checkCircle', 'xCircle', 'robot', 'shield', 'target',
  'star', 'trophy', 'medal', 'scale', 'gauge', 'brain', 'book', 'pie', 'flask',
  'bank', 'atom', 'puzzle', 'wallet', 'trend', 'coins', 'lock', 'crown', 'flame',
  'activity', 'layers', 'clock', 'hourglass', 'play', 'plus', 'refresh', 'search',
  'sparkles', 'banknote', 'card', 'droplet', 'sprout', 'cap', 'rocket', 'bolt',
  'toolbox', 'up', 'down', 'flat', 'check', 'close', 'next', 'back'
]);

/**
 * An alert box.
 *
 * `variant` picks the accent AND the default glyph, so a screen says
 * `<Notice variant="warn">` and gets the orange rail, the triangle and the
 * breathing icon. Passing `icon="shield"` swaps the glyph; passing a raw emoji
 * still works (it is rendered as text) so nothing breaks mid-migration.
 */
export function Notice({ children, icon, variant = 'tip', title }) {
  const still = useStill();
  const isName = typeof icon === 'string' && NOTICE_ICON_GLYPHS.has(icon);
  const glyph = icon
    ? isName
      ? <LabIcon name={icon} width={16} height={16} />
      : <span aria-hidden="true">{icon}</span>
    : <LabIcon name={NOTICE_ICON[variant] || 'bulb'} width={16} height={16} />;

  return (
    <motion.div
      className={`lab2-notice ${variant}`}
      role={variant === 'danger' || variant === 'warn' ? 'alert' : 'note'}
      initial={still ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: LAB_EASE }}
    >
      <span className="lab2-notice-icon" aria-hidden="true">
        {glyph}
      </span>
      <span className="lab2-notice-body">
        {title && <span className="lab2-notice-title">{title}</span>}
        {children}
      </span>
    </motion.div>
  );
}

export function Empty({ children, icon = 'layers' }) {
  return (
    <div className="lab2-empty">
      <div className="lab2-empty-icon" aria-hidden="true">
        <LabIcon name={icon} width={24} height={24} />
      </div>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   THE DOORWAY BOX
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A short intro card with one way out: a real button that opens a guide.
 *
 * ─── WHY A COMPONENT AND NOT INLINE MARKUP ──────────────────────────────────
 * The Advanced tab's chart-lesson box and any future one ("read the fee page
 * first") must look identical: same glass, same accent wash, same 46px button
 * as every other Lab call to action. Inline markup is how the second copy ends
 * up 2px taller with a 15px title.
 *
 * ─── WHY A `<Link>` AND NOT A `navigate()` HANDLER ──────────────────────────
 * A button with an onClick is a fake link: it cannot be opened in a new tab,
 * it has no URL on hover, and a screen reader announces "button" for something
 * that navigates. `<Link>` renders a real `<a href>` — middle-click, long-press
 * → open in new tab, and the browser's own focus ring all work — while the
 * click handler still tells the router to do a client-side transition and the
 * Telegram haptic fires once.
 *
 * The hit area is the whole card (`::after` spreads the link over it) but the
 * LABEL is the button, so the accessible name stays specific: "Open the chart
 * guide", not "box".
 */
export function GuideDoor({
  to,
  kicker,
  title,
  body,
  cta,
  icon = 'cap',
  accent = 'magenta',
  art = null,
  onClick,
  testId
}) {
  const still = useStill();
  return (
    <motion.aside
      className={`lab2-door acc-${accent}`}
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: LAB_EASE }}
      data-testid={testId}
    >
      <span className="lab2-door-glow" aria-hidden="true" />
      {art ? (
        <span className="lab2-door-art" aria-hidden="true">{art}</span>
      ) : (
        <span className="lab2-door-icon" aria-hidden="true">
          <LabIcon name={icon} width={22} height={22} />
        </span>
      )}
      <div className="lab2-door-copy">
        {kicker && <span className="lab2-door-kicker">{kicker}</span>}
        <span className="lab2-door-title">{title}</span>
        {body && <p className="lab2-door-body">{body}</p>}
        <Link
          to={to}
          className="lab2-btn primary lab2-door-cta"
          onClick={onClick}
          data-testid={testId ? `${testId}-cta` : undefined}
        >
          <LabIcon name="cap" width={15} height={15} />
          <span>{cta}</span>
          <span className="lab2-arrow" aria-hidden="true">
            <IconArrowRight width={13} height={13} />
          </span>
        </Link>
      </div>
    </motion.aside>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   THE CARD
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One simulator card — the 3×3-ish grid on the Lab home.
 *
 * Everything that makes it feel alive is CSS (the pointer spotlight reads
 * `--mx`/`--my`, written here; the glow, the rim and the icon tilt are all
 * transitions). framer-motion only handles the entrance, via `labRise`, so a
 * grid of nine cards cascades in instead of appearing at once.
 *
 * Hover/press are deliberately NOT motion props: a CSS `:hover` transform and a
 * framer `whileHover` transform fight over the same inline style, and the loser
 * is whichever mounted last.
 */
export function LabCard({ title, sub, icon = 'sparkles', accent = 'cyan', onClick, index = 0 }) {
  const still = useStill();

  const track = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    el.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
  };

  return (
    <motion.button
      type="button"
      className={`lab2-card acc-${accent}`}
      onClick={onClick}
      aria-label={title}
      variants={still ? undefined : labRise}
      initial={still ? false : 'hidden'}
      animate={still ? undefined : 'show'}
      transition={still ? undefined : { delay: Math.min(index * 0.05, 0.4) }}
      onPointerMove={still ? undefined : track}
    >
      <span className="lab2-card-spot" aria-hidden="true" />
      <span className="lab2-card-glow" aria-hidden="true" />
      <span className="lab2-card-icon" aria-hidden="true">
        <LabIcon name={icon} width={24} height={24} />
      </span>
      <span className="lab2-card-title">{title}</span>
      <span className="lab2-card-sub">{sub}</span>
      <span className="lab2-card-arrow" aria-hidden="true">
        <IconArrowRight width={12} height={12} />
      </span>
    </motion.button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TOGGLE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A real switch.
 *
 * Strategy Lab's "only above the moving average" rule used to be a
 * `.lab2-btn.primary` / `.lab2-btn.ghost` pair — a 46px-tall button whose label
 * changed between "on" and "off". That is a button pretending to be state. A
 * switch says "this is a setting" at a glance, takes a third of the height, and
 * the knob travel is the animation.
 */
export function LabToggle({ checked, onChange, label, onLabel, offLabel }) {
  const { t } = useTranslation();
  return (
    <div className="lab2-field-head">
      <span className="lab2-field-label">{label}</span>
      <span className={`lab2-switch-wrap ${checked ? 'on' : ''}`}>
        <span className="lab2-switch-text">{checked ? onLabel ?? t('lab2.on', 'On') : offLabel ?? t('lab2.off', 'Off')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(checked)}
          aria-label={typeof label === 'string' ? label : undefined}
          className={`lab2-switch ${checked ? 'on' : ''}`}
          onClick={() => onChange?.(!checked)}
        >
          {/* The knob travels with `inset-inline-start` in CSS: a logical
              property mirrors itself in RTL, which a translateX cannot. */}
          <span className="lab2-switch-knob" />
        </button>
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CHIPS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A wrapping chip strip with a pill that slides between selections.
 *
 * `items`: [{ id, label, icon?, color?, initials?, tick? }]
 * The sliding pill is framer's `layoutId`; every strip on a screen needs its
 * own id or two unrelated chips will fight over one element.
 */
export function LabChips({ items = [], value, onChange, layoutId, accent = 'cyan', size }) {
  const still = useStill();
  return (
    <div className={`lab2-chips acc-${accent}`} role="group">
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            className={`lab2-chip ${active ? 'active' : ''} ${size === 'sm' ? 'sm' : ''}`}
            onClick={() => onChange?.(it.id, it)}
            aria-pressed={active}
          >
            {active && !still && layoutId && (
              <motion.span
                className="lab2-chip-pill"
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
              />
            )}
            {it.color && (
              <span className="lab2-coin-dot" style={{ '--coin': it.color }} aria-hidden="true">
                {it.initials ?? String(it.label || '').slice(0, 3)}
              </span>
            )}
            {!it.color && it.icon && <LabIcon name={it.icon} width={15} height={15} aria-hidden="true" />}
            <span>{it.label}</span>
            {it.tick && (
              <span className="lab2-chip-tick" aria-hidden="true">
                <IconCheck width={10} height={10} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SLIDER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Range input with a gradient-filled track.
 *
 * A stock `<input type=range>` cannot paint the portion left of the thumb, so
 * the filled length is passed down as `--fill` and the track is a two-layer
 * background sized to it. The label row above shows the live value in a pill,
 * which is what makes a slider usable on a phone: you see the number move
 * while your thumb is still covering the handle.
 *
 * ─── THE THREE THINGS A RANGE INPUT DOES NOT GIVE YOU ──────────────────────
 *   1. `onChange` is the INPUT event in React, so it fires on every pixel of a
 *      drag — that part is fine. What is not fine is `onChange` on a slider
 *      whose `value` is not clamped: the browser clamps for us, our state does
 *      not, and a value handed in from a text field (say 140) leaves the thumb
 *      parked at the end while the state says 140. Everything is snapped and
 *      clamped on the way in here.
 *   2. RTL. In an RTL document the track is mirrored — `min` sits on the right
 *      — but a `background-position: left` fill does not mirror with it, so the
 *      lit portion was drawn against the wrong end. `--fill-side` lets the CSS
 *      anchor the paint to the correct edge; the control itself keeps its
 *      native mapping, so ArrowRight still walks toward `max` exactly as the
 *      thumb visibly does (see `lib/lab/percent.js`).
 *   3. Touch. `touch-action: none` on the track stops the page from scrolling
 *      out from under a horizontal drag, and the 8px track is padded to a 44px
 *      hit area by the CSS — WCAG's minimum touch target.
 */
export function LabSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  display,
  accent,
  disabled = false,
  ariaLabel,
  testId
}) {
  const range = { min, max, step };
  const v = clampToRange(value, range);
  const pct = sliderPaintPercent(v, min, max);
  const rtl = useIsRtl();
  return (
    <div className={`lab2-field ${accent ? `acc-${accent}` : ''}`}>
      {label && (
        <div className="lab2-field-head">
          <span className="lab2-field-label">{label}</span>
          <span className="lab2-field-value" dir="ltr">{display ?? formatPercent(v, step)}</span>
        </div>
      )}
      <input
        type="range"
        className="lab2-slider"
        min={min}
        max={max}
        step={step}
        value={v}
        disabled={disabled || undefined}
        style={{ '--fill': `${pct}%`, '--fill-side': rtl ? 'right' : 'left' }}
        onChange={(e) => onChange?.(clampToRange(e.target.value, range))}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
        aria-valuetext={formatPercent(v, step)}
        data-testid={testId}
      />
    </div>
  );
}

/**
 * PERCENT FIELD — a slider and a number box that cannot disagree.
 *
 * ─── WHY ONE COMPONENT INSTEAD OF TWO WIRED PERCENTAGES ────────────────────
 * Two sliders previously let their percent be edited through a number box lived
 * on different screens with different, subtly wrong rules. This one owns the
 * whole contract, and every rule in it comes from a way the old shape broke:
 *
 *   · While you type, the BOX is the thing being edited, so its text is kept
 *     verbatim and only a parseable number is committed to the slider. Typing
 *     "40" over "15" passes through "", "4", "40" — none of which may yank the
 *     thumb to 0 or to 100.
 *   · On blur (or Enter) the box is rewritten to the exact value the control
 *     holds, clamped and snapped. That is the moment "140" becomes "100" — the
 *     box never keeps a number the slider is not holding.
 *   · Persian digits are accepted, because a Persian keyboard produces them;
 *     the pill still renders Latin digits like the rest of the Lab's numbers.
 *   · Arrow keys work on BOTH controls: the box steps, the slider steps, and
 *     neither lets the value leave the range.
 *
 * `onChange` receives the normalised number — never a string, never NaN.
 */
export function LabPercentField({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  accent = 'cyan',
  hint,
  disabled = false,
  testId,
  sliderTestId,
  inputTestId
}) {
  const { t } = useTranslation();
  const range = { min, max, step };
  /* `testId` names the FIELD; the two controls inside it get predictable
     children so a test (and a future `document.querySelector` in a bug report)
     does not have to guess. Explicit overrides win, because a caller may
     already have a naming scheme. */
  const inputId = inputTestId ?? (testId ? `${testId}-input` : undefined);
  const sliderId = sliderTestId ?? (testId ? `${testId}-slider` : undefined);
  const committed = clampToRange(value, range);
  /* `draft === null` means "not being edited": show the committed value. Any
     string means the reader has typed something we must not overwrite. */
  const [draft, setDraft] = useState(null);
  const [clamped, setClamped] = useState(false);
  const rtl = useIsRtl();

  /* An external change (a preset, a reset, another control) must be reflected.
     `draft` is cleared only when the number really changed, so a commit that
     came from this very field does not wipe the caret. */
  const lastCommitted = useRef(committed);
  useEffect(() => {
    if (lastCommitted.current !== committed) {
      lastCommitted.current = committed;
      setDraft(null);
      setClamped(false);
    }
  }, [committed]);

  const commit = (n, { fromText = false } = {}) => {
    const next = clampToRange(n, range);
    setClamped(fromText && next !== Number(n));
    lastCommitted.current = next;
    onChange?.(next);
    return next;
  };

  const onText = (event) => {
    const typed = event.target.value;
    const next = applyPercentInput(typed, committed, range);
    setDraft(next.draft);
    setClamped(next.clamped);
    if (next.committed) {
      lastCommitted.current = next.value;
      onChange?.(next.value);
    }
  };

  const onTextKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(parsePercentText(draft ?? committed) ?? committed, { fromText: true });
      setDraft(null);
      event.currentTarget.blur();
      return;
    }
    const dir = stepDirection(event.key, rtl);
    if (!dir) return;
    event.preventDefault();
    /* Shift = one step, in both directions, on both controls: the amount is
       the step the caller declared, never an invented "+10". */
    const base = parsePercentText(draft ?? committed) ?? committed;
    const next = commit(base + dir * step, { fromText: true });
    setDraft(String(next));
    lastCommitted.current = next;
  };

  const onSlider = (next) => {
    setDraft(null);
    setClamped(false);
    lastCommitted.current = next;
    onChange?.(next);
  };

  const shown = draft ?? String(committed);
  const shownValue = clamped ? committed : draft != null ? draft : committed;

  return (
    <div className={`lab2-field lab2-percent ${accent ? `acc-${accent}` : ''}`} data-testid={testId}>
      <div className="lab2-field-head">
        <label className="lab2-field-label" htmlFor={inputId}>
          {label}
        </label>
        <div className="lab2-percent-value" dir="ltr">
          {/* −/+ exist for the same reason the slider does: on a phone the
              thumb covers the value it is dragging. Both walk the SAME step
              grid as the slider and the arrow keys, so no control can produce
              a number another control cannot represent. */}
          <button
            type="button"
            className="lab2-percent-step"
            onClick={() => {
              const next = commit(committed - step, { fromText: true });
              setDraft(null);
              lastCommitted.current = next;
            }}
            disabled={disabled || committed <= Math.min(min, max)}
            aria-label={t('lab2.percent.decrease', { defaultValue: 'Decrease' })}
            tabIndex={-1}
          >
            <span aria-hidden="true">−</span>
          </button>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="lab2-percent-input lab2-num"
            value={shown}
            disabled={disabled || undefined}
            onChange={onText}
            onKeyDown={onTextKey}
            onBlur={() => {
              const next = commit(parsePercentText(draft ?? committed) ?? committed, { fromText: true });
              lastCommitted.current = next;
              setDraft(null);
            }}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={committed}
            aria-invalid={clamped || undefined}
            data-testid={inputId}
          />
          <span className="lab2-percent-suffix" aria-hidden="true">%</span>
          <button
            type="button"
            className="lab2-percent-step"
            onClick={() => {
              const next = commit(committed + step, { fromText: true });
              setDraft(null);
              lastCommitted.current = next;
            }}
            disabled={disabled || committed >= Math.max(min, max)}
            aria-label={t('lab2.percent.increase', { defaultValue: 'Increase' })}
            tabIndex={-1}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
      <input
        type="range"
        className="lab2-slider"
        min={min}
        max={max}
        step={step}
        value={committed}
        disabled={disabled || undefined}
        style={{ '--fill': `${sliderPaintPercent(committed, min, max)}%`, '--fill-side': rtl ? 'right' : 'left' }}
        onChange={(e) => onSlider(clampToRange(e.target.value, range))}
        aria-label={label}
        aria-valuetext={formatPercent(committed, step)}
        data-testid={sliderId}
      />
      <div className="lab2-percent-foot">
        <span className="lab2-percent-range lab2-num" dir="ltr">
          {formatPercent(clampToRange(min, range), step)} – {formatPercent(clampToRange(max, range), step)}
        </span>
        {clamped ? (
          <span className="lab2-percent-note" role="status">
            {t('lab2.percent.clamped', {
              min: formatPercent(clampToRange(min, range), step),
              max: formatPercent(clampToRange(max, range), step),
              defaultValue: 'Clamped to {{min}}–{{max}}'
            })}
          </span>
        ) : hint ? (
          <span className="lab2-percent-note">{hint}</span>
        ) : null}
      </div>
      {/* Keep the committed value reachable for assistive tech even while the
          box holds half-typed text. */}
      <span className="lab2-sr-only" aria-live="polite">
        {`${label || ''} ${formatPercent(shownValue, step)}`}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CHARTS
   ══════════════════════════════════════════════════════════════════════════ */

/* Chart box in viewBox units. preserveAspectRatio="none" stretches it to the
   element, so padding has to be baked into the maths (and the live marker is
   HTML — an SVG circle would be stretched into an ellipse). */
const CW = 100;
const CH = 60;
const PAD_X = 1;
const PAD_Y = 6;

/**
 * Catmull-Rom → cubic Bézier.
 *
 * A polyline through 30 price ticks reads as a saw; the same data through a
 * smoothed curve reads as a trend, which is the thing the screen is teaching.
 * The tension (÷6) is the standard uniform Catmull-Rom one — enough to round
 * the corners without overshooting into a lie about the data.
 */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

/**
 * The Lab chart: smoothed line, gradient area, self-drawing stroke, live
 * marker and an optional last-value tag.
 *
 * `data` is a flat array of numbers, oldest first — the same shape every Lab
 * screen already had, so nothing downstream changed when this replaced the
 * polyline version.
 */
export function Sparkline({ data, compact = false, tag = null, accent }) {
  const still = useStill();
  const uid = useId().replace(/:/g, '');
  const gid = `labSpark-${uid}`;

  const model = useMemo(() => {
    const vals = (data || []).map(Number).filter((n) => Number.isFinite(n));
    if (vals.length < 2) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || Math.abs(max) || 1;
    const stepX = (CW - PAD_X * 2) / (vals.length - 1);
    const pts = vals.map((v, i) => [
      PAD_X + i * stepX,
      CH - PAD_Y - ((v - min) / range) * (CH - PAD_Y * 2)
    ]);
    const line = smoothPath(pts);
    const area = `${line} L${pts[pts.length - 1][0].toFixed(2)},${CH} L${pts[0][0].toFixed(2)},${CH} Z`;
    const last = pts[pts.length - 1];
    /* The marker is positioned in % of the element box, matching the viewBox. */
    const bottomPct = ((CH - last[1]) / CH) * 100;
    const up = vals[vals.length - 1] >= vals[0];
    return { line, area, up, bottomPct, count: vals.length };
  }, [data]);

  if (!model) return <div className={`lab2-spark ${compact ? 'compact' : ''}`} aria-hidden="true" />;

  const { line, area, up, bottomPct } = model;
  const stroke = up ? 'var(--up)' : 'var(--down)';

  return (
    <div
      className={`lab2-spark ${up ? 'up' : 'down'} ${compact ? 'compact' : ''} ${accent ? `acc-${accent}` : ''}`.trim()}
      role="img"
      aria-label={tag ? String(tag) : undefined}
    >
      <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.42" />
            <stop offset="55%" stopColor={stroke} stopOpacity="0.12" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={area}
          fill={`url(#${gid})`}
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
        <motion.path
          className="lab2-spark-line"
          d={line}
          stroke={stroke}
          vectorEffect="non-scaling-stroke"
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: still ? 0 : 1.05, ease: LAB_EASE }}
        />
      </svg>

      {!still && (
        <span className="lab2-spark-live" style={{ bottom: `${bottomPct}%` }} aria-hidden="true">
          <span className="lab2-spark-ping" />
          <span className="lab2-spark-dot" />
        </span>
      )}

      {tag != null && <span className="lab2-spark-tag">{tag}</span>}
    </div>
  );
}

/** Direction glyph for an up/down/flat call. */
export function DirGlyph({ dir, size = 15 }) {
  if (dir === 'up') return <IconArrowUp width={size} height={size} className="lab2-dir-glyph" />;
  if (dir === 'down') return <IconArrowDown width={size} height={size} className="lab2-dir-glyph" />;
  return <IconFlat width={size} height={size} className="lab2-dir-glyph" />;
}

/**
 * Allocation donut.
 *
 * `slices`: [{ label, value, color }]. Each arc draws itself in sequence, which
 * is what turns "a pie chart" into "watch your portfolio get built".
 */
export function Donut({ slices = [], thickness = 13, centerValue, centerLabel, animate = true }) {
  const still = useStill();
  const uid = useId().replace(/:/g, '');
  const total = slices.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const R = 50 - thickness / 2;
  const CIRC = 2 * Math.PI * R;

  if (total <= 0) {
    return (
      <div className="lab2-donut" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} />
        </svg>
        <div className="lab2-donut-core">
          <b className="lab2-num">0%</b>
          <span>{centerLabel}</span>
        </div>
      </div>
    );
  }

  let offset = 0;
  const arcs = slices
    .filter((s) => Number(s.value) > 0)
    .map((s, i) => {
      const frac = Number(s.value) / total;
      const len = frac * CIRC;
      /* A 1.5u gap between arcs — without it adjacent hues bleed together. */
      const gap = Math.min(1.6, len * 0.16);
      const arc = { ...s, len: Math.max(0, len - gap), dash: offset, key: `${uid}-${i}` };
      offset += len;
      return arc;
    });

  return (
    <div className="lab2-donut" role="img" aria-label={centerLabel || undefined}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <motion.circle
            key={a.key}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={a.color || 'var(--acc)'}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${a.len} ${CIRC - a.len}`}
            strokeDashoffset={-a.dash}
            initial={still || !animate ? false : { strokeDasharray: `0 ${CIRC}` }}
            animate={{ strokeDasharray: `${a.len} ${CIRC - a.len}` }}
            transition={{ duration: 0.7, ease: LAB_EASE, delay: still ? 0 : i * 0.08 }}
            style={{ filter: `drop-shadow(0 0 6px ${a.color || 'var(--acc)'})` }}
          />
        ))}
      </svg>
      <div className="lab2-donut-core">
        {centerValue != null && <b className="lab2-num">{centerValue}</b>}
        {centerLabel && <span>{centerLabel}</span>}
      </div>
    </div>
  );
}

/** Legend rows for a donut / allocation list. */
export function Legend({ items = [] }) {
  return (
    <div className="lab2-legend">
      {items.map((it) => (
        <div className="lab2-legend-item" key={it.label}>
          <span
            className="lab2-legend-dot"
            style={{ background: it.color, color: it.color }}
            aria-hidden="true"
          />
          <span className="lab2-legend-name">{it.label}</span>
          <span className="lab2-legend-val lab2-num">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Search field with the icon inside it (glossary). */
export function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="lab2-glossary-search">
      <span className="lab2-search-icon" aria-hidden="true">
        <IconSearch width={17} height={17} />
      </span>
      <input
        className="lab2-glossary-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        type="search"
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ALLOCATION ROW
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One line of a portfolio mix: colour tile, asset name, slider, percent.
 *
 * The percent used to be a read-only `<div>` — the only way to set a precise
 * mix was to park a 22px thumb on a 320px track and hope. On a 360px phone that
 * is 3.2 percentage points per pixel, so "30%" was a guess. Here the number is
 * the second control: the same value, editable, clamped, and always showing
 * exactly what the slider holds.
 *
 * The row keeps `--acc` from the asset colour, so the fill, the thumb ring and
 * the focus glow all take the slice's own hue — the same rule the rest of the
 * allocation panels follow.
 */
export function AllocRow({
  label,
  badge,
  value,
  onChange,
  accent = 'var(--acc)',
  max = 100,
  step = 1,
  rtl = false,
  testId,
  min = 0
}) {
  const range = { min, max, step };
  const v = clampToRange(value, range);
  const [draft, setDraft] = useState(null);

  const commit = (raw) => {
    const parsed = typeof raw === 'string' ? parsePercentText(raw) : Number(raw);
    const next = parsed == null ? v : clampToRange(parsed, range);
    onChange?.(next);
    return next;
  };

  return (
    <div
      className="lab2-alloc"
      style={{ '--acc': accent, '--acc-2': accent }}
      data-testid={testId}
    >
      <div
        className="lab2-alloc-icon"
        style={{ background: `linear-gradient(140deg, ${accent}, ${accent}bb)`, color: '#06121a' }}
        aria-hidden="true"
      >
        {badge}
      </div>
      <div className="lab2-alloc-name">{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          setDraft(null);
          onChange?.(clampToRange(e.target.value, range));
        }}
        className="lab2-slider"
        style={{ '--fill': `${sliderPaintPercent(v, min, max)}%`, '--fill-side': rtl ? 'right' : 'left' }}
        aria-label={label}
        aria-valuetext={formatPercent(v, step)}
        data-testid={testId ? `${testId}-slider` : undefined}
      />
      <div className="lab2-alloc-pct lab2-num">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="lab2-alloc-input"
          value={draft ?? String(v)}
          aria-label={label}
          onChange={(e) => {
            /* Typing commits only what already parses; the field keeps the
               raw keystrokes until blur, so clearing it to retype never sends
               0 through the donut. */
            const typed = e.target.value;
            setDraft(typed);
            const parsed = parsePercentText(typed);
            if (parsed != null) onChange?.(clampToRange(parsed, range));
          }}
          onBlur={() => {
            const next = commit(draft ?? String(v));
            setDraft(null);
            /* Re-render with the clamped number, so a "140" that became 100
               reads as 100 the moment focus leaves. */
            if (next !== v) onChange?.(next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft ?? String(v));
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <span aria-hidden="true">%</span>
      </div>
    </div>
  );
}
