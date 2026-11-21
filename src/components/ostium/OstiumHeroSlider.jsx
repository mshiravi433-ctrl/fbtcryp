import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconChevronRight } from '../Icons';
import '../../styles/ostium-hero-slider.css';

const AUTO_INTERVAL = 6000;

function GoldOilArt() {
  return (
    <svg className="ost-vector" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGrad1" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id="goldGrad2" x1="10" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="60%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#78350f" />
        </linearGradient>
        <radialGradient id="oilDropGrad" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
          <stop offset="60%" stopColor="#b45309" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#451a03" stopOpacity="0.95" />
        </radialGradient>
        <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Background glow circle */}
      <circle cx="50" cy="50" r="38" fill="url(#goldGrad1)" opacity="0.12" />

      {/* Gold Ingot Base (bottom bar) */}
      <polygon points="20,68 34,56 76,56 64,68" fill="url(#goldGrad1)" />
      <polygon points="64,68 76,56 82,62 70,74" fill="url(#goldGrad2)" />
      <polygon points="20,68 64,68 70,74 26,74" fill="#d97706" />

      {/* Top Gold Ingot */}
      <polygon points="30,52 42,42 80,42 70,52" fill="url(#goldGrad1)" filter="url(#goldGlow)" />
      <polygon points="70,52 80,42 86,47 76,57" fill="url(#goldGrad2)" />
      <polygon points="30,52 70,52 76,57 36,57" fill="#b45309" />

      {/* Crude Oil / Energy Droplet Contour */}
      <path
        d="M32 20 C32 20 20 36 20 44 C20 51 25.5 56 32 56 C38.5 56 44 51 44 44 C44 36 32 20 32 20 Z"
        fill="url(#oilDropGrad)"
        stroke="#fbbf24"
        strokeWidth="1.2"
      />
      <circle cx="28" cy="38" r="3" fill="#fff" opacity="0.65" />

      {/* Sparkles & Star Points */}
      <path d="M78 22 L80 28 L86 30 L80 32 L78 38 L76 32 L70 30 L76 28 Z" fill="#fde047" opacity="0.85" />
      <circle cx="62" cy="24" r="1.5" fill="#fef08a" />
      <circle cx="86" cy="48" r="1.5" fill="#fbbf24" />
    </svg>
  );
}

function ForexArt() {
  return (
    <svg className="ost-vector" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fxGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="60%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>

      {/* Globe Outlines */}
      <circle cx="50" cy="50" r="36" stroke="url(#fxGrad)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
      <ellipse cx="50" cy="50" rx="36" ry="16" stroke="url(#fxGrad)" strokeWidth="1.2" opacity="0.45" />
      <ellipse cx="50" cy="50" rx="16" ry="36" stroke="url(#fxGrad)" strokeWidth="1.2" opacity="0.45" />
      <line x1="14" y1="50" x2="86" y2="50" stroke="url(#fxGrad)" strokeWidth="1.2" opacity="0.4" />

      {/* Central FX Energy Node */}
      <circle cx="50" cy="50" r="14" fill="url(#fxGrad)" opacity="0.2" />
      <circle cx="50" cy="50" r="8" fill="url(#fxGrad)" opacity="0.75" />
      <text x="50" y="54" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="sans-serif">FX</text>

      {/* Orbiting Currency Badges */}
      <g transform="translate(24, 22)">
        <circle cx="8" cy="8" r="9" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11.5" textAnchor="middle" fill="#34d399" fontSize="9" fontWeight="bold">$</text>
      </g>

      <g transform="translate(62, 20)">
        <circle cx="8" cy="8" r="9" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11.5" textAnchor="middle" fill="#67e8f9" fontSize="9" fontWeight="bold">€</text>
      </g>

      <g transform="translate(68, 60)">
        <circle cx="8" cy="8" r="9" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11.5" textAnchor="middle" fill="#34d399" fontSize="9" fontWeight="bold">£</text>
      </g>

      <g transform="translate(18, 62)">
        <circle cx="8" cy="8" r="9" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11.5" textAnchor="middle" fill="#67e8f9" fontSize="9" fontWeight="bold">¥</text>
      </g>

      {/* Dynamic Sine wave beam across */}
      <path d="M16 54 Q32 36 50 50 T84 46" stroke="#a7f3d0" strokeWidth="2" fill="none" opacity="0.9" />
    </svg>
  );
}

function EquitiesArt() {
  return (
    <svg className="ost-vector" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {/* Grid Lines */}
      <line x1="15" y1="80" x2="85" y2="80" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      <line x1="15" y1="55" x2="85" y2="55" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3 3" />
      <line x1="15" y1="30" x2="85" y2="30" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3 3" />

      {/* Candlestick 1 */}
      <line x1="28" y1="52" x2="28" y2="76" stroke="#8b5cf6" strokeWidth="1.5" />
      <rect x="24" y="58" width="8" height="14" rx="2" fill="#8b5cf6" />

      {/* Candlestick 2 */}
      <line x1="46" y1="38" x2="46" y2="68" stroke="#a855f7" strokeWidth="1.5" />
      <rect x="42" y="44" width="8" height="18" rx="2" fill="#a855f7" />

      {/* Candlestick 3 (highest) */}
      <line x1="64" y1="20" x2="64" y2="56" stroke="#c084fc" strokeWidth="1.5" />
      <rect x="60" y="26" width="8" height="22" rx="2" fill="url(#eqGrad)" />

      {/* Ascending Trend Arrow Path */}
      <path
        d="M20 72 L38 58 L54 52 L78 22"
        stroke="#38bdf8"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon points="78,16 84,24 73,25" fill="#38bdf8" />

      {/* Sparkle node on peak */}
      <circle cx="78" cy="22" r="4" fill="#fff" opacity="0.8" />
    </svg>
  );
}

function SecurityArt() {
  return (
    <svg className="ost-vector" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shieldGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="60%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>

      {/* Shield Silhouette */}
      <path
        d="M50 16 L78 28 C78 52 66 72 50 82 C34 72 22 52 22 28 Z"
        fill="url(#shieldGrad)"
        fillOpacity="0.25"
        stroke="#38bdf8"
        strokeWidth="2"
      />

      {/* Inner Lock Glyph */}
      <rect x="40" y="46" width="20" height="17" rx="4" fill="#38bdf8" />
      <path d="M44 46 V38 C44 34.7 46.7 32 50 32 C53.3 32 56 34.7 56 38 V46" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="50" cy="53" r="2.2" fill="#0f172a" />
      <line x1="50" y1="54" x2="50" y2="58" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />

      {/* Chain Nodes */}
      <circle cx="20" cy="48" r="3.5" fill="#38bdf8" opacity="0.6" />
      <circle cx="80" cy="48" r="3.5" fill="#38bdf8" opacity="0.6" />
      <line x1="23.5" y1="48" x2="35" y2="48" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6" />
      <line x1="65" y1="48" x2="76.5" y2="48" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6" />
    </svg>
  );
}

export default function OstiumHeroSlider({ feedLive, onSelectCategory }) {
  const { t, i18n } = useTranslation();
  const isFa = i18n.language === 'fa';
  const [slide, setSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef(null);
  const touchStartX = useRef(0);

  const slides = [
    {
      id: 'commodities',
      category: 'commodities',
      badge: isFa ? '• OSTIUM · طلا و کالاهای اساسی' : '• OSTIUM · Commodities & Gold',
      title: isFa ? 'طلا و نفت جهانی روی آربیتروم' : 'Global Gold & Crude Oil on Arbitrum',
      accentWord: isFa ? 'طلا و نفت' : 'Gold & Oil',
      subtitle: isFa
        ? 'معامله قراردادهای طلای جهانی (XAU) و نفت خام (WTI) بدون انقضا با اهرم منعطف و تسویه آنی USDC'
        : 'Trade perpetual contracts for Gold (XAU) and Crude Oil (WTI) with fast USDC settlement.',
      cta: isFa ? 'مشاهده کالاها' : 'View Commodities',
      art: <GoldOilArt />
    },
    {
      id: 'forex',
      category: 'forex',
      badge: isFa ? '• OSTIUM · فارکس جهانی ۲۴/۵' : '• OSTIUM · Global Forex Desk',
      title: isFa ? 'بزرگ‌ترین بازار مالی جهان در کیف پول شما' : 'Trade Forex Pairs Non-Custodially',
      accentWord: isFa ? 'فارکس جهانی' : 'Forex Pairs',
      subtitle: isFa
        ? 'جفت‌ارزهای مطرح EUR/USD، GBP/USD و USD/JPY با اسپرد رقابتی و دسترسی بدون تحریم بانکی'
        : 'Major FX currency pairs (EUR/USD, GBP/USD, USD/JPY) with low spreads and on-chain execution.',
      cta: isFa ? 'مشاهده فارکس' : 'View Forex',
      art: <ForexArt />
    },
    {
      id: 'stocks',
      category: 'stocks',
      badge: isFa ? '• OSTIUM · سهام و شاخص‌ها' : '• OSTIUM · Wall Street & Indices',
      title: isFa ? 'شاخص‌های نزدک، S&P 500 و غول‌های فناوری' : 'Nasdaq, S&P 500 & Global Equities',
      accentWord: isFa ? 'شاخص‌های وال‌استریت' : 'Indices & Stocks',
      subtitle: isFa
        ? 'دسترسی مستقیم و غیرحضانتی به نبض وال‌استریت و شرکت‌های پیشروی جهان مستقیم روی آربیتروم'
        : 'Direct non-custodial access to Wall Street indices and leading equities on Arbitrum One.',
      cta: isFa ? 'مشاهده سهام' : 'View Stocks',
      art: <EquitiesArt />
    },
    {
      id: 'security',
      category: 'all',
      badge: isFa ? '• OSTIUM · تسویه آن‌چین آربیتروم' : '• OSTIUM · On-Chain Arbitrum One',
      title: isFa ? 'معامله غیرحضانتی و تسویه ۱۰۰٪ آن‌چین' : '100% Non-Custodial On-Chain Trading',
      accentWord: isFa ? 'غیرحضانتی' : 'Non-Custodial',
      subtitle: isFa
        ? 'کلیدها همیشه در اختیار شماست؛ قراردادهای هوشمند بازرسی‌شده بدون واسطه و بدون حساب بانکی'
        : 'Keys always in your wallet. Audited smart contracts with transparent decentralized execution.',
      cta: isFa ? 'همه بازارها' : 'All Markets',
      art: <SecurityArt />
    }
  ];

  const total = slides.length;

  const nextSlide = () => setSlide((s) => (s + 1) % total);
  const prevSlide = () => setSlide((s) => (s - 1 + total) % total);

  useEffect(() => {
    if (isPaused) return;
    timerRef.current = setInterval(() => {
      nextSlide();
    }, AUTO_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [isPaused, slide]);

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX.current;
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        // swipe right
        isFa ? nextSlide() : prevSlide();
      } else {
        // swipe left
        isFa ? prevSlide() : nextSlide();
      }
    }
  };

  const active = slides[slide];

  return (
    <div
      className="ost-slider"
      data-slide={slide}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="ost-aurora" aria-hidden="true" />

      {/* Header bar: Badge + Live Pill */}
      <div className="ost-header">
        <div className="ost-badge-wrap">
          <span className="ost-brand">OSTIUM</span>
          <span className="ost-tag">
            <span className="ost-tag-dot" />
            {active.badge}
          </span>
        </div>
        <span className={`pill ${feedLive ? 'pill-up' : 'pill-down'}`}>
          {feedLive ? t('ostium.live') : t('ostium.offline')}
        </span>
      </div>

      {/* Viewport with Animated Slides */}
      <div className="ost-viewport">
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            className="ost-slide"
            initial={{ opacity: 0, x: isFa ? -16 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isFa ? 16 : -16 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <div className="ost-content">
              <h2 className="ost-title">
                <span className="ost-title-accent">{active.title}</span>
              </h2>
              <p className="ost-desc">{active.subtitle}</p>
              <div className="ost-actions">
                <button
                  type="button"
                  className="ost-cta-btn"
                  onClick={() => onSelectCategory && onSelectCategory(active.category)}
                >
                  <span>{active.cta}</span>
                  {isFa ? <IconChevronLeft size={13} /> : <IconChevronRight size={13} />}
                </button>
              </div>
            </div>

            <div className="ost-graphic" aria-hidden="true">
              {active.art}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer: Timeline segments & Controls */}
      <div className="ost-footer">
        <div className="ost-segments" role="tablist" aria-label="Slider navigation">
          {slides.map((s, idx) => (
            <div
              key={s.id}
              className={`ost-seg ${slide === idx ? 'is-active' : ''}`}
              onClick={() => setSlide(idx)}
              role="tab"
              aria-selected={slide === idx}
            >
              {slide === idx && (
                <div
                  key={`fill-${slide}-${isPaused}`}
                  className="ost-seg-fill"
                  style={{
                    animationDuration: `${AUTO_INTERVAL}ms`,
                    animationPlayState: isPaused ? 'paused' : 'running'
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="ost-controls">
          <button
            type="button"
            className="ost-arrow"
            onClick={prevSlide}
            aria-label="Previous slide"
          >
            {isFa ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
          </button>
          <button
            type="button"
            className="ost-arrow"
            onClick={nextSlide}
            aria-label="Next slide"
          >
            {isFa ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
