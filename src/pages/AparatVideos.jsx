import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import { useStill } from '../components/AnimatedIcon';
import { openUrl } from '../lib/browser';
import { useAppStore } from '../store/useAppStore';
import SubTabRail from '../components/learn/SubTabRail';
import { LearnTop } from '../components/learn/LearnHero';
import {
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternal,
  IconPause,
  IconPlay,
  IconRoute,
  IconSearch,
  IconSparkle,
  IconTrophy,
  IconVideo,
  IconX
} from '../components/Icons';
import '../styles/learn-hub.css';

/* Moved to lib/aparat.js so a component that only needs the URL (the Market
   stories rail) does not pull this page AND its stylesheet into its chunk.
   Imported for use here too — a bare `export … from` re-exports without
   creating a local binding, which made APARAT_HANDLE undefined below. */
import { APARAT_CHANNEL_URL, APARAT_HANDLE } from '../lib/aparat.js';
export { APARAT_CHANNEL_URL, APARAT_HANDLE };

const CATEGORIES = ['all', 'beginner', 'trading', 'stocks', 'ai', 'defi'];

export const APARAT_COURSES = [
  {
    id: 'wallet',
    category: 'beginner',
    level: 'beginner',
    duration: '07:40',
    appRoute: '/wallet',
    accent: '#00e5ff',
    accent2: '#7c4dff',
    stepsCount: 3
  },
  {
    id: 'swap',
    category: 'trading',
    level: 'beginner',
    duration: '09:15',
    appRoute: '/swap',
    accent: '#14f195',
    accent2: '#00e5ff',
    stepsCount: 3
  },
  {
    id: 'stocks',
    category: 'stocks',
    level: 'intermediate',
    duration: '11:30',
    appRoute: '/stocks',
    accent: '#ffb300',
    accent2: '#00ff9d',
    stepsCount: 3
  },
  {
    id: 'ai',
    category: 'ai',
    level: 'intermediate',
    duration: '10:20',
    appRoute: '/intent',
    accent: '#ff2d95',
    accent2: '#7c4dff',
    stepsCount: 3
  },
  {
    id: 'defi',
    category: 'defi',
    level: 'pro',
    duration: '13:45',
    appRoute: '/farm',
    accent: '#00ff9d',
    accent2: '#3b82f6',
    stepsCount: 3
  },
  {
    id: 'orders',
    category: 'trading',
    level: 'pro',
    duration: '08:50',
    appRoute: '/orders',
    accent: '#f59e0b',
    accent2: '#ec4899',
    stepsCount: 3
  }
];

function CourseIllustration({ id, accent, accent2 }) {
  const gradId = `aparat-grad-${id}`;
  const glowId = `aparat-glow-${id}`;
  return (
    <svg
      className="aparat-course-svg"
      viewBox="0 0 240 130"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="240" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} stopOpacity="0.36" />
          <stop offset="55%" stopColor={accent2} stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0b1020" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id={glowId} x1="20" y1="15" x2="210" y2="115" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={accent2} />
        </linearGradient>
      </defs>

      <rect x="4" y="4" width="232" height="122" rx="18" fill={`url(#${gradId})`} />
      <circle cx="195" cy="28" r="38" fill={accent} fillOpacity="0.12" />
      <circle cx="42" cy="104" r="32" fill={accent2} fillOpacity="0.12" />

      {id === 'wallet' && (
        <g>
          <rect x="34" y="32" width="88" height="64" rx="14" stroke={`url(#${glowId})`} strokeWidth="2.2" fill="rgba(10,16,32,0.55)" />
          <path d="M94 56h28v16H94a8 8 0 0 1 0-16z" stroke={accent} strokeWidth="2" fill="rgba(0,229,255,0.14)" />
          <circle cx="102" cy="64" r="2.8" fill={accent} />
          <path d="M158 34l32 12v20c0 19-13.5 34.5-32 40-18.5-5.5-32-21-32-40V46l32-12z" stroke={`url(#${glowId})`} strokeWidth="2.2" fill="rgba(124,77,255,0.16)" />
          <path d="m147 64 7.5 7.5L170 56" stroke="#00ff9d" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {id === 'swap' && (
        <g>
          <circle cx="68" cy="65" r="28" stroke={accent} strokeWidth="2.2" fill="rgba(20,241,149,0.12)" />
          <circle cx="172" cy="65" r="28" stroke={accent2} strokeWidth="2.2" fill="rgba(0,229,255,0.12)" />
          <path d="M98 52h44l-9-9M142 78H98l9 9" stroke={`url(#${glowId})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 65h16M68 57v16" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
          <polygon points="172,51 183,65 172,79 161,65" stroke={accent2} strokeWidth="2" fill="rgba(0,229,255,0.22)" />
        </g>
      )}

      {id === 'stocks' && (
        <g>
          <path d="M28 98h184" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          <rect x="44" y="64" width="16" height="34" rx="4" fill={accent} fillOpacity="0.45" />
          <rect x="74" y="50" width="16" height="48" rx="4" fill={accent} fillOpacity="0.65" />
          <rect x="104" y="38" width="16" height="60" rx="4" fill={accent2} fillOpacity="0.75" />
          <rect x="134" y="26" width="16" height="72" rx="4" fill="#00ff9d" fillOpacity="0.88" />
          <path d="M36 82 C70 72, 95 48, 144 30 L196 22" stroke={`url(#${glowId})`} strokeWidth="3" strokeLinecap="round" />
          <circle cx="196" cy="22" r="5" fill="#00ff9d" />
          <rect x="160" y="52" width="52" height="32" rx="9" stroke={accent} strokeWidth="1.8" fill="rgba(10,16,32,0.7)" />
          <text x="186" y="72" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="monospace">RWA+</text>
        </g>
      )}

      {id === 'ai' && (
        <g>
          <circle cx="120" cy="65" r="32" stroke={`url(#${glowId})`} strokeWidth="2.2" fill="rgba(255,45,149,0.12)" />
          <circle cx="120" cy="65" r="16" stroke={accent} strokeWidth="1.8" strokeDasharray="4 4" />
          <circle cx="120" cy="65" r="6" fill={accent} />
          <line x1="88" y1="65" x2="46" y2="42" stroke={accent2} strokeWidth="1.8" />
          <line x1="88" y1="65" x2="46" y2="88" stroke={accent} strokeWidth="1.8" />
          <line x1="152" y1="65" x2="194" y2="42" stroke={accent} strokeWidth="1.8" />
          <line x1="152" y1="65" x2="194" y2="88" stroke={accent2} strokeWidth="1.8" />
          <circle cx="46" cy="42" r="6" fill={accent2} />
          <circle cx="46" cy="88" r="6" fill={accent} />
          <circle cx="194" cy="42" r="6" fill={accent} />
          <circle cx="194" cy="88" r="6" fill={accent2} />
        </g>
      )}

      {id === 'defi' && (
        <g>
          <ellipse cx="86" cy="46" rx="34" ry="12" stroke={accent} strokeWidth="2" fill="rgba(0,255,157,0.16)" />
          <path d="M52 46v20c0 6.6 15.2 12 34 12s34-5.4 34-12V46" stroke={accent} strokeWidth="2" />
          <path d="M52 66v20c0 6.6 15.2 12 34 12s34-5.4 34-12V66" stroke={accent2} strokeWidth="2" />
          <polygon points="174,30 202,65 174,100 146,65" stroke={`url(#${glowId})`} strokeWidth="2.2" fill="rgba(59,130,246,0.18)" />
          <path d="M164 65h20M174 55v20" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}

      {id === 'orders' && (
        <g>
          <circle cx="76" cy="65" r="30" stroke={accent} strokeWidth="2.2" fill="rgba(245,158,11,0.12)" />
          <path d="M76 47v18l12 8" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="136" y1="34" x2="136" y2="96" stroke="#00ff9d" strokeWidth="2" />
          <rect x="130" y="48" width="12" height="28" rx="3" fill="#00ff9d" />
          <line x1="164" y1="28" x2="164" y2="90" stroke={accent2} strokeWidth="2" />
          <rect x="158" y="42" width="12" height="24" rx="3" fill={accent2} />
          <line x1="192" y1="32" x2="192" y2="98" stroke="#00ff9d" strokeWidth="2" />
          <rect x="186" y="44" width="12" height="34" rx="3" fill="#00ff9d" />
        </g>
      )}
    </svg>
  );
}
/**
 * APARAT VIDEOS — the «ویدیوها» tab of the Learn hub.
 * ---------------------------------------------------------------------------
 * The official Persian video academy, hosted on Aparat. Six courses, each with
 * its own illustration, duration, level and the section of the app it teaches.
 *
 * ─── THE 2026 REDESIGN: AN IDENTITY BLOCK + TWO SUB-TABS ───────────────────
 * What was here before was one long column: a hero with an emblem, an
 * interactive "stage", then a search box, six category chips and a grid — all
 * scrolling as one undifferentiated page, with the channel's address at the
 * very top and the actual lessons two screens down.
 *
 * The redesign separates the two questions a visitor asks:
 *
 *   · "Where does this come from?" — the identity block, always visible: the
 *     channel, its real address with a copy button, and the one button that
 *     opens it. That block never moves, so the address is findable from
 *     anywhere on the tab.
 *   · "What should I watch?" — the sub-tabs:
 *       درس‌ها        the interactive stage plus the searchable catalogue;
 *       مسیر یادگیری  the same six courses grouped by level, in the order they
 *                     should be watched, with a duration per lesson.
 *
 * ─── WHY THE ILLUSTRATIONS ARE SVG, NOT THUMBNAILS ─────────────────────────
 * A remote thumbnail would mean shipping every visitor's device fingerprint to
 * a third-party CDN and showing a broken box whenever it is blocked — which,
 * for an Iranian audience, is often. These are drawn from the course's own two
 * accent colours, so a course keeps its identity without a single request.
 */
const SUBTABS = [
  { id: 'lessons', Icon: IconPlay, a: '#ff2d95', b: '#7c4dff' },
  { id: 'paths', Icon: IconRoute, a: '#00ff9d', b: '#00e5ff' }
];

/** The three levels, in the order the academy is meant to be watched. */
const LEVEL_ORDER = ['beginner', 'intermediate', 'pro'];

export default function AparatVideos({ embedded = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const notify = useAppStore((s) => s.notify);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  const [sub, setSub] = useState('lessons');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('stocks');
  const [playingPreview, setPlayingPreview] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [copied, setCopied] = useState(false);

  const selectedCourse = useMemo(
    () => APARAT_COURSES.find((c) => c.id === selectedId) || APARAT_COURSES[0],
    [selectedId]
  );

  // Step auto-advance while the walkthrough is playing.
  useEffect(() => {
    if (!playingPreview || still) return undefined;
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % selectedCourse.stepsCount);
    }, 4000);
    return () => clearInterval(timer);
  }, [playingPreview, still, selectedCourse]);

  const openOfficialChannel = () => {
    openUrl(APARAT_CHANNEL_URL);
  };

  const copyChannelUrl = async () => {
    try {
      await navigator.clipboard?.writeText(APARAT_CHANNEL_URL);
      setCopied(true);
      notify?.('copied', 'success');
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const filteredCourses = useMemo(() => {
    return APARAT_COURSES.filter((c) => {
      if (category !== 'all' && c.category !== category) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const title = t(`aparat.courses.${c.id}.title`).toLowerCase();
      const desc = t(`aparat.courses.${c.id}.desc`).toLowerCase();
      return title.includes(q) || desc.includes(q) || c.id.includes(q);
    });
  }, [category, query, t]);

  const pickCourse = (id) => {
    setSelectedId(id);
    setActiveStep(0);
    setSub('lessons');
    setPlayingPreview(true);
  };

  const num = (n) => new Intl.NumberFormat(locale).format(n);
  /* Percent, not a typed "100%": in Persian that is ۱۰۰٪, and the percent
     sign is a different character (U+066A), not a Latin % next to a number. */
  const pct = (n) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(n);

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <LearnTop
            title={t('nav.aparat')}
            sub={t('learn.tabsSub.videos')}
            onBack={() => navigate(-1)}
            backLabel={t('common.back')}
          />
        </motion.div>
      )}

      <div className="lh-page lh-videos" data-testid="aparat-videos-page">
        {/* ─────────────────── IDENTITY BLOCK (always visible) ───────────── */}
        <motion.section className="lh-card lh-channel" variants={riseIn} initial="hidden" animate="show">
          <div className="lh-channel-top">
            <span className="lh-channel-mark">
              <IconVideo width={26} height={26} aria-hidden="true" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="lh-channel-name">{t('aparat.hero.title')}</p>
              <p className="lh-channel-handle" dir="ltr">{APARAT_HANDLE}</p>
            </div>
          </div>

          <p className="lh-hero-sub lh-channel-sub">{t('aparat.hero.subtitle')}</p>

          <div className="lh-url-box" dir="ltr">
            <IconVideo width={16} height={16} aria-hidden="true" />
            <span className="lh-url-text mono">{APARAT_CHANNEL_URL}</span>
            <button
              type="button"
              className={`lh-copy${copied ? ' is-copied' : ''}`}
              onClick={copyChannelUrl}
              aria-label={t('aparat.hero.copyLink')}
            >
              {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
            </button>
          </div>

          <div className="lh-btn-row">
            <button
              type="button"
              className="lh-btn lh-btn--primary lh-btn--full"
              style={{ '--a': '#ff2d95', '--b': '#7c4dff' }}
              onClick={openOfficialChannel}
              data-testid="aparat-open-channel-btn"
            >
              <IconPlay width={16} height={16} />
              <span>{t('aparat.hero.watchOnAparat')}</span>
              <IconExternal width={14} height={14} />
            </button>
          </div>

          {/*
           * Every figure here is formatted, never typed: this block's ancestor
           * painted a literal `6` and a literal `100%`, which stayed Latin on a
           * Persian screen right next to a count that WAS formatted. One
           * formatter, or the page argues with itself.
           */}
          <div className="lh-stats lh-stats--quad" style={{ marginTop: 11 }}>
            <span className="lh-stat" style={{ '--a': '#ff2d95', '--b': '#7c4dff' }}>
              <span className="lh-stat-val mono">{num(APARAT_COURSES.length)}</span>
              <span className="lh-stat-lbl">{t('aparat.stats.courses')}</span>
            </span>
            <span className="lh-stat" style={{ '--a': '#00e5ff', '--b': '#7c4dff' }}>
              <span className="lh-stat-val mono">HD</span>
              <span className="lh-stat-lbl">{t('aparat.stats.quality')}</span>
            </span>
            <span className="lh-stat" style={{ '--a': '#00ff9d', '--b': '#00e5ff' }}>
              <span className="lh-stat-val mono">{pct(1)}</span>
              <span className="lh-stat-lbl">{t('aparat.stats.free')}</span>
            </span>
            <span className="lh-stat" style={{ '--a': '#ffb300', '--b': '#ff5a3a' }}>
              <span className="lh-stat-val mono" dir="ltr">{APARAT_HANDLE}</span>
              <span className="lh-stat-lbl">{t('learn.videos.handle')}</span>
            </span>
          </div>
        </motion.section>

        {/* ─────────────────────────── SUB-TABS ──────────────────────────── */}
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <SubTabRail
            items={SUBTABS.map((s) => ({
              ...s,
              count: s.id === 'lessons' ? APARAT_COURSES.length : LEVEL_ORDER.length
            }))}
            value={sub}
            onChange={setSub}
            labelPrefix="learn.subtab"
            label={t('learn.subtabsTitle')}
            hint={t(`learn.hint.${sub === 'lessons' ? 'lessons' : 'paths'}`)}
            locale={locale}
          />
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={sub}
            className="lh-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {sub === 'lessons' ? (
              <>
                {/* ─────────── INTERACTIVE STAGE ─────────── */}
                <section
                  className="lh-card lh-stage"
                  data-testid="aparat-interactive-stage"
                  style={{ '--course-accent': selectedCourse.accent, '--course-accent2': selectedCourse.accent2 }}
                >
                  <div className="lh-stage-head">
                    <div className="lh-stage-head-left">
                      <span className="lh-stage-dot" aria-hidden="true" />
                      <span className="lh-stage-label">{t('aparat.player.stageLabel')}</span>
                    </div>
                    <span className="lh-duration mono">{selectedCourse.duration}</span>
                  </div>

                  <div className="lh-stage-visual">
                    <CourseIllustration
                      id={selectedCourse.id}
                      accent={selectedCourse.accent}
                      accent2={selectedCourse.accent2}
                    />
                  </div>

                  <div className="lh-stage-controls">
                    <button
                      type="button"
                      className="lh-play-toggle"
                      onClick={() => setPlayingPreview((p) => !p)}
                      aria-pressed={playingPreview}
                    >
                      <span className="lh-play-toggle-ico" aria-hidden="true">
                        {playingPreview
                          ? <IconPause width={14} height={14} />
                          : <IconPlay width={14} height={14} />}
                      </span>
                      <span>{playingPreview ? t('aparat.player.pauseWalkthrough') : t('aparat.player.startWalkthrough')}</span>
                    </button>
                    <span className="lh-stage-level">{t(`aparat.level.${selectedCourse.level}`)}</span>
                  </div>

                  <div className="lh-stage-info">
                    <h3 className="aparat-stage-title lh-stage-title">
                      {t(`aparat.courses.${selectedCourse.id}.title`)}
                    </h3>
                    <p className="lh-stage-desc">{t(`aparat.courses.${selectedCourse.id}.desc`)}</p>

                    <div className="lh-steps-list">
                      {[1, 2, 3].map((stepNum, idx) => (
                        <button
                          key={stepNum}
                          type="button"
                          className={`lh-step ${activeStep === idx ? 'is-active' : ''}`}
                          onClick={() => setActiveStep(idx)}
                          aria-pressed={activeStep === idx}
                          aria-current={activeStep === idx ? 'step' : undefined}
                        >
                          <span className="lh-step-num mono">{num(stepNum)}</span>
                          <span className="lh-step-text">
                            {t(`aparat.courses.${selectedCourse.id}.step${stepNum}`)}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="lh-stage-actions">
                      <button
                        type="button"
                        className="lh-btn lh-btn--primary"
                        style={{ '--a': selectedCourse.accent, '--b': selectedCourse.accent2 }}
                        onClick={openOfficialChannel}
                      >
                        <IconVideo width={16} height={16} />
                        <span>{t('aparat.player.watchEpisode')}</span>
                      </button>
                      <button
                        type="button"
                        className="lh-btn lh-btn--ghost"
                        onClick={() => navigate(selectedCourse.appRoute)}
                      >
                        <span>{t('aparat.player.openSection')}</span>
                      </button>
                    </div>
                  </div>
                </section>

                {/* ─────────── CATALOGUE ─────────── */}
                <section className="lh-catalog">
                  <div className="lh-catalog-head">
                    <div>
                      <span className="lh-catalog-kicker">{t('aparat.catalog.kicker')}</span>
                      <h3 className="lh-catalog-title">{t('aparat.catalog.title')}</h3>
                    </div>
                    <span className="lh-count mono" aria-live="polite">
                      <strong>{num(filteredCourses.length)}</strong>
                      <span> / {num(APARAT_COURSES.length)}</span>
                    </span>
                  </div>

                  <label className="lh-search">
                    <IconSearch width={16} height={16} aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('aparat.catalog.searchPlaceholder')}
                      aria-label={t('aparat.catalog.searchPlaceholder')}
                    />
                    {query ? (
                      <button
                        type="button"
                        className="lh-search-clear"
                        onClick={() => setQuery('')}
                        aria-label={t('learn.faq.clear')}
                      >
                        <IconX width={13} height={13} />
                      </button>
                    ) : null}
                  </label>

                  <div className="lh-chip-rail" role="group" aria-label={t('aparat.catalog.title')}>
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`lh-chip${category === cat ? ' is-active' : ''}`}
                        onClick={() => setCategory(cat)}
                        aria-pressed={category === cat}
                      >
                        {t(`aparat.categories.${cat}`)}
                      </button>
                    ))}
                  </div>

                  {filteredCourses.length > 0 ? (
                    <div className="lh-course-grid">
                      {filteredCourses.map((course) => {
                        const isSelected = course.id === selectedCourse.id;
                        const courseTitle = t(`aparat.courses.${course.id}.title`);
                        return (
                          <article
                            key={course.id}
                            className={`lh-course${isSelected ? ' is-selected' : ''}`}
                            data-testid={`aparat-course-${course.id}`}
                            style={{ '--course-accent': course.accent, '--course-accent2': course.accent2 }}
                          >
                            <button
                              type="button"
                              className="aparat-course-thumb lh-thumb"
                              aria-label={`${t('aparat.player.watchEpisode')}: ${courseTitle}`}
                              aria-pressed={isSelected}
                              onClick={() => {
                                setSelectedId(course.id);
                                setActiveStep(0);
                                setPlayingPreview(true);
                              }}
                            >
                              <CourseIllustration
                                id={course.id}
                                accent={course.accent}
                                accent2={course.accent2}
                              />
                              <span className="lh-thumb-play" aria-hidden="true">
                                <span className="lh-thumb-play-ico">
                                  <IconPlay width={17} height={17} />
                                </span>
                              </span>
                              <span className="lh-thumb-duration mono">{course.duration}</span>
                              <span className="lh-thumb-level">
                                {t(`aparat.level.${course.level}`)}
                              </span>
                            </button>

                            <div className="lh-course-body">
                              <h4 className="lh-course-title">{courseTitle}</h4>
                              <p className="lh-course-desc">{t(`aparat.courses.${course.id}.desc`)}</p>

                              <div className="lh-course-foot">
                                <button
                                  type="button"
                                  className="lh-mini lh-mini--accent"
                                  onClick={openOfficialChannel}
                                >
                                  <IconVideo width={13} height={13} />
                                  <span>{t('aparat.player.watchEpisode')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="lh-mini"
                                  onClick={() => navigate(course.appRoute)}
                                >
                                  <span>{t('aparat.player.openSection')}</span>
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="lh-empty" role="status">
                      <span className="lh-empty-icon" aria-hidden="true">
                        <IconSearch width={18} height={18} />
                      </span>
                      <p className="lh-empty-title">{t('aparat.catalog.noResults')}</p>
                      <p className="lh-empty-body">{t('learn.faq.emptyBody')}</p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              /* ─────────── LEARNING PATH ─────────── */
              <section className="lh-paths">
                <div className="lh-rowhead">
                  <p className="lh-label">{t('learn.videos.pathsTitle')}</p>
                </div>

                {LEVEL_ORDER.map((levelId) => {
                  const courses = APARAT_COURSES.filter((c) => c.level === levelId);
                  return (
                    <div
                      className="lh-card lh-path"
                      key={levelId}
                      style={{ '--a': courses[0]?.accent || '#00e5ff', '--b': courses[0]?.accent2 || '#7c4dff' }}
                    >
                      <div className="lh-path-head">
                        <span className="lh-path-mark" aria-hidden="true">
                          <IconTrophy width={20} height={20} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="lh-path-title">{t(`aparat.level.${levelId}`)}</div>
                          <p className="lh-path-sub">
                            {t('learn.videos.lessonsCount', { n: num(courses.length) })}
                          </p>
                        </div>
                        <span className="lh-subtab-count">{num(courses.length)}</span>
                      </div>

                      <div className="lh-path-list">
                        {courses.map((course, i) => (
                          <button
                            key={course.id}
                            type="button"
                            className="lh-path-row"
                            onClick={() => pickCourse(course.id)}
                            aria-pressed={selectedCourse.id === course.id}
                            style={{ '--dot': course.accent }}
                          >
                            <span className="lh-path-num" aria-hidden="true">{num(i + 1)}</span>
                            <span className="lh-path-row-text">
                              <span className="lh-path-row-title">
                                {t(`aparat.courses.${course.id}.title`)}
                              </span>
                              <span className="lh-path-row-meta">
                                {t(`aparat.categories.${course.category}`)} · {course.duration}
                              </span>
                            </span>
                            <span className="lh-flip lh-link-chev" aria-hidden="true">
                              <IconChevronRight width={15} height={15} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="lh-note">
                  <span className="lh-note-icon" aria-hidden="true">
                    <IconSparkle width={16} height={16} />
                  </span>
                  <p className="lh-note-text">{t('learn.videos.pathsNote')}</p>
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
