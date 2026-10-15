import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { useStill } from '../components/AnimatedIcon';
import { openUrl } from '../lib/browser';
import { createStoryAmbientController } from '../lib/storyAudio';
import { useAppStore } from '../store/useAppStore';
import {
  IconCheck,
  IconCopy,
  IconExternal,
  IconSearch,
  IconVideo,
  IconVolume
} from '../components/Icons';
import '../styles/market-modern.css';

export const APARAT_CHANNEL_URL = 'https://www.aparat.com/Fbtcompany';
export const APARAT_HANDLE = '@Fbtcompany';

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

export default function AparatVideos({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const notify = useAppStore((s) => s.notify);

  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('stocks');
  const [playingPreview, setPlayingPreview] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [audioOn, setAudioOn] = useState(false);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef(null);
  if (!audioRef.current) {
    audioRef.current = createStoryAmbientController();
  }

  useEffect(() => {
    const ctrl = audioRef.current;
    return () => ctrl?.destroy();
  }, []);

  const selectedCourse = useMemo(
    () => APARAT_COURSES.find((c) => c.id === selectedId) || APARAT_COURSES[0],
    [selectedId]
  );

  // Step auto-advance when preview player is playing
  useEffect(() => {
    if (!playingPreview || still) return undefined;
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % selectedCourse.stepsCount);
    }, 4000);
    return () => clearInterval(timer);
  }, [playingPreview, still, selectedCourse]);

  const toggleAudio = () => {
    const ctrl = audioRef.current;
    if (!ctrl) return;
    if (audioOn) {
      ctrl.stop();
      setAudioOn(false);
    } else {
      ctrl.start('cinema');
      setAudioOn(true);
    }
  };

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

  return (
    <PageTransition embedded={embedded}>
      <div className="aparat-page" data-testid="aparat-videos-page">
        {/* ─── OFFICIAL APARAT CHANNEL HERO ─────────────────────────────── */}
        <section className="card market-glass-surface aparat-hero-card">
          <div className="market-glass-orb market-glass-orb--cyan" aria-hidden="true" />
          <div className="market-glass-orb market-glass-orb--violet" aria-hidden="true" />

          <div className="aparat-hero-top">
            <div className="aparat-hero-badge-row">
              <span className="aparat-live-pill">
                <span className="market-live-dot" aria-hidden="true" />
                {t('aparat.hero.kicker')}
              </span>
              <span className="aparat-handle-pill mono" dir="ltr">
                {APARAT_HANDLE}
              </span>
            </div>

            <div className="aparat-hero-main">
              <div className="aparat-hero-copy">
                <h1 className="aparat-hero-title">{t('aparat.hero.title')}</h1>
                <p className="aparat-hero-sub">{t('aparat.hero.subtitle')}</p>
                <div className="aparat-url-box" dir="ltr">
                  <IconVideo width={16} height={16} />
                  <span className="mono aparat-url-text">{APARAT_CHANNEL_URL}</span>
                  <button
                    type="button"
                    className="aparat-copy-btn"
                    onClick={copyChannelUrl}
                    aria-label={t('aparat.hero.copyLink')}
                  >
                    {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
                  </button>
                </div>
              </div>

              <div className="aparat-hero-emblem" aria-hidden="true">
                <svg viewBox="0 0 120 120" fill="none" className="aparat-emblem-svg">
                  <defs>
                    <linearGradient id="aparat-hero-ring" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#ff2d95" />
                      <stop offset="50%" stopColor="#ffb300" />
                      <stop offset="100%" stopColor="#00e5ff" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="52" stroke="url(#aparat-hero-ring)" strokeWidth="2.5" strokeDasharray="8 6" />
                  <circle cx="60" cy="60" r="40" fill="rgba(255,45,149,0.14)" stroke="url(#aparat-hero-ring)" strokeWidth="1.8" />
                  <circle cx="44" cy="44" r="6" fill="#ff2d95" />
                  <circle cx="76" cy="44" r="6" fill="#ffb300" />
                  <circle cx="44" cy="76" r="6" fill="#00e5ff" />
                  <circle cx="76" cy="76" r="6" fill="#00ff9d" />
                  <polygon points="54,48 74,60 54,72" fill="#ffffff" />
                </svg>
              </div>
            </div>

            <div className="aparat-stats-row">
              <div className="aparat-stat-chip">
                <span className="aparat-stat-val mono">{APARAT_COURSES.length}+</span>
                <span className="aparat-stat-lbl">{t('aparat.stats.courses')}</span>
              </div>
              <div className="aparat-stat-chip">
                <span className="aparat-stat-val mono">HD</span>
                <span className="aparat-stat-lbl">{t('aparat.stats.quality')}</span>
              </div>
              <div className="aparat-stat-chip">
                <span className="aparat-stat-val mono">100%</span>
                <span className="aparat-stat-lbl">{t('aparat.stats.free')}</span>
              </div>
            </div>

            <div className="aparat-hero-actions">
              <button
                type="button"
                className="btn btn-primary aparat-primary-cta"
                onClick={openOfficialChannel}
                data-testid="aparat-open-channel-btn"
              >
                <IconVideo width={18} height={18} />
                <span>{t('aparat.hero.watchOnAparat')}</span>
                <IconExternal width={15} height={15} />
              </button>
              <button
                type="button"
                className={`btn btn-ghost aparat-audio-cta ${audioOn ? 'is-active' : ''}`}
                onClick={toggleAudio}
              >
                <IconVolume width={16} height={16} />
                <span>{audioOn ? t('aparat.player.muteMusic') : t('aparat.player.playMusic')}</span>
              </button>
            </div>
          </div>
        </section>

        {/* ─── INTERACTIVE COURSE STUDIO STAGE ──────────────────────────── */}
        <section className="card market-glass-surface aparat-stage-card" data-testid="aparat-interactive-stage">
          <div className="row-between aparat-stage-header">
            <div className="row" style={{ gap: 8 }}>
              <span className="aparat-stage-dot" style={{ background: selectedCourse.accent }} />
              <span className="section-label" style={{ margin: 0 }}>
                {t('aparat.player.stageLabel')}
              </span>
            </div>
            <span className="mono aparat-duration-pill">{selectedCourse.duration}</span>
          </div>

          <div className="aparat-stage-grid">
            <div className="aparat-stage-visual">
              <CourseIllustration
                id={selectedCourse.id}
                accent={selectedCourse.accent}
                accent2={selectedCourse.accent2}
              />
              <div className="aparat-stage-controls">
                <button
                  type="button"
                  className="aparat-play-toggle"
                  onClick={() => setPlayingPreview((p) => !p)}
                >
                  {playingPreview ? t('aparat.player.pauseWalkthrough') : t('aparat.player.startWalkthrough')}
                </button>
                <span className="faint" style={{ fontSize: 11 }}>
                  {t(`aparat.level.${selectedCourse.level}`)}
                </span>
              </div>
            </div>

            <div className="aparat-stage-info">
              <h2 className="aparat-stage-title">
                {t(`aparat.courses.${selectedCourse.id}.title`)}
              </h2>
              <p className="aparat-stage-desc">
                {t(`aparat.courses.${selectedCourse.id}.desc`)}
              </p>

              <div className="aparat-steps-list">
                {[1, 2, 3].map((stepNum, idx) => (
                  <button
                    key={stepNum}
                    type="button"
                    className={`aparat-step-item ${activeStep === idx ? 'is-active' : ''}`}
                    onClick={() => setActiveStep(idx)}
                  >
                    <span className="aparat-step-num mono">{stepNum}</span>
                    <span className="aparat-step-text">
                      {t(`aparat.courses.${selectedCourse.id}.step${stepNum}`)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="aparat-stage-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1.2, minHeight: 42, borderRadius: 12 }}
                  onClick={openOfficialChannel}
                >
                  <IconVideo width={16} height={16} />
                  <span>{t('aparat.player.watchEpisode')}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1, minHeight: 42, borderRadius: 12 }}
                  onClick={() => navigate(selectedCourse.appRoute)}
                >
                  <span>{t('aparat.player.openSection')}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ─── SEARCH & CATEGORY TABS ───────────────────────────────────── */}
        <section className="aparat-catalog-section">
          <div className="row-between" style={{ alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>{t('aparat.catalog.title')}</p>
            <span className="faint mono" style={{ fontSize: 11.5 }}>
              {filteredCourses.length} / {APARAT_COURSES.length}
            </span>
          </div>

          <div className="aparat-search-wrap">
            <IconSearch width={16} height={16} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('aparat.catalog.searchPlaceholder')}
              className="aparat-search-input"
            />
          </div>

          <div className="tag-scroll" style={{ marginBottom: 14 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`tag ${category === cat ? 'active' : ''}`}
                onClick={() => setCategory(cat)}
              >
                {t(`aparat.categories.${cat}`)}
              </button>
            ))}
          </div>

          <div className="aparat-video-grid">
            {filteredCourses.map((course) => {
              const isSelected = course.id === selectedCourse.id;
              return (
                <article
                  key={course.id}
                  className={`card market-glass-surface aparat-course-card ${isSelected ? 'is-selected' : ''}`}
                  data-testid={`aparat-course-${course.id}`}
                >
                  <div
                    className="aparat-course-thumb"
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
                    <span className="aparat-thumb-duration mono">{course.duration}</span>
                    <span className={`aparat-thumb-level aparat-level-${course.level}`}>
                      {t(`aparat.level.${course.level}`)}
                    </span>
                  </div>

                  <div className="aparat-course-body">
                    <h3 className="aparat-course-title">
                      {t(`aparat.courses.${course.id}.title`)}
                    </h3>
                    <p className="aparat-course-desc">
                      {t(`aparat.courses.${course.id}.desc`)}
                    </p>

                    <div className="aparat-course-footer">
                      <button
                        type="button"
                        className="tag aparat-btn-watch"
                        onClick={openOfficialChannel}
                      >
                        <IconVideo width={14} height={14} />
                        <span>{t('aparat.player.watchEpisode')}</span>
                      </button>
                      <button
                        type="button"
                        className="tag aparat-btn-try"
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
        </section>
      </div>
    </PageTransition>
  );
}
