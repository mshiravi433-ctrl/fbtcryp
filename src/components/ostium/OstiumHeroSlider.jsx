import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import '../../styles/ostium-hero-slider.css';

const AUTO_INTERVAL = 5500;

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
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#b45309" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#451a03" stopOpacity="0.95" />
        </radialGradient>
        <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Ambient background glow ring */}
      <circle cx="50" cy="50" r="38" fill="url(#goldGrad1)" opacity="0.15" className="ost-anim-pulse" />

      {/* Gold Ingot Base */}
      <polygon points="22,66 35,55 75,55 64,66" fill="url(#goldGrad1)" />
      <polygon points="64,66 75,55 81,61 70,72" fill="url(#goldGrad2)" />
      <polygon points="22,66 64,66 70,72 28,72" fill="#d97706" />

      {/* Top Gold Ingot */}
      <polygon points="32,51 43,41 79,41 69,51" fill="url(#goldGrad1)" filter="url(#goldGlow)" />
      <polygon points="69,51 79,41 85,46 75,56" fill="url(#goldGrad2)" />
      <polygon points="32,51 69,51 75,56 38,56" fill="#b45309" />

      {/* Energy Droplet with floating shimmer */}
      <g className="ost-anim-float">
        <path
          d="M32 20 C32 20 20 36 20 44 C20 51 25.5 56 32 56 C38.5 56 44 51 44 44 C44 36 32 20 32 20 Z"
          fill="url(#oilDropGrad)"
          stroke="#fbbf24"
          strokeWidth="1.2"
        />
        <circle cx="28" cy="38" r="3" fill="#fff" opacity="0.65" />
      </g>

      {/* Pulsing Star Sparkles */}
      <g className="ost-anim-sparkle">
        <path d="M78 22 L80 28 L86 30 L80 32 L78 38 L76 32 L70 30 L76 28 Z" fill="#fde047" opacity="0.9" />
        <circle cx="62" cy="24" r="1.5" fill="#fef08a" />
        <circle cx="86" cy="48" r="1.5" fill="#fbbf24" />
      </g>
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
      <circle cx="50" cy="50" r="36" stroke="url(#fxGrad)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" className="ost-anim-spin" />
      <ellipse cx="50" cy="50" rx="36" ry="16" stroke="url(#fxGrad)" strokeWidth="1.2" opacity="0.45" />
      <ellipse cx="50" cy="50" rx="16" ry="36" stroke="url(#fxGrad)" strokeWidth="1.2" opacity="0.45" />
      <line x1="14" y1="50" x2="86" y2="50" stroke="url(#fxGrad)" strokeWidth="1.2" opacity="0.4" />

      {/* Central FX Node */}
      <circle cx="50" cy="50" r="14" fill="url(#fxGrad)" opacity="0.25" className="ost-anim-pulse" />
      <circle cx="50" cy="50" r="8" fill="url(#fxGrad)" opacity="0.85" />
      <text x="50" y="53.5" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="sans-serif">FX</text>

      {/* Orbiting Currency Badges */}
      <g transform="translate(24, 22)">
        <circle cx="8" cy="8" r="8" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11" textAnchor="middle" fill="#34d399" fontSize="8.5" fontWeight="bold">$</text>
      </g>

      <g transform="translate(62, 20)">
        <circle cx="8" cy="8" r="8" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11" textAnchor="middle" fill="#67e8f9" fontSize="8.5" fontWeight="bold">€</text>
      </g>

      <g transform="translate(68, 60)">
        <circle cx="8" cy="8" r="8" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11" textAnchor="middle" fill="#34d399" fontSize="8.5" fontWeight="bold">£</text>
      </g>

      <g transform="translate(18, 62)">
        <circle cx="8" cy="8" r="8" fill="#065f46" stroke="#34d399" strokeWidth="1" />
        <text x="8" y="11" textAnchor="middle" fill="#67e8f9" fontSize="8.5" fontWeight="bold">¥</text>
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
        <linearGradient id="eqAreaGrad" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {/* Grid Guide Lines */}
      <line x1="16" y1="28" x2="84" y2="28" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 3" />
      <line x1="16" y1="50" x2="84" y2="50" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 3" />
      <line x1="16" y1="72" x2="84" y2="72" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2 3" />

      {/* Chart Fill Area */}
      <path d="M16 72 L16 66 L34 52 L50 60 L68 34 L84 22 L84 72 Z" fill="url(#eqAreaGrad)" />

      {/* Glowing Chart Line */}
      <path
        d="M16 66 L34 52 L50 60 L68 34 L84 22"
        stroke="url(#eqGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Candlestick Pillars */}
      <g opacity="0.6">
        <line x1="26" y1="46" x2="26" y2="68" stroke="#a855f7" strokeWidth="1" />
        <rect x="24.5" y="52" width="3" height="10" fill="#a855f7" rx="0.8" />

        <line x1="42" y1="40" x2="42" y2="64" stroke="#a855f7" strokeWidth="1" />
        <rect x="40.5" y="46" width="3" height="8" fill="#a855f7" rx="0.8" />

        <line x1="60" y1="28" x2="60" y2="52" stroke="#60a5fa" strokeWidth="1" />
        <rect x="58.5" y="32" width="3" height="12" fill="#60a5fa" rx="0.8" />
      </g>

      {/* Peak Glowing Node */}
      <circle cx="84" cy="22" r="6" fill="#c084fc" opacity="0.3" className="ost-anim-pulse" />
      <circle cx="84" cy="22" r="3.5" fill="#fff" stroke="#8b5cf6" strokeWidth="1.5" />

      {/* Mini Up-Arrow Badge */}
      <g transform="translate(68, 14)">
        <polygon points="6,2 10,8 8,8 8,12 4,12 4,8 2,8" fill="#4ade80" />
      </g>
    </svg>
  );
}

function SecurityArt() {
  return (
    <svg className="ost-vector" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="secGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      {/* Hexagonal Shield Plate */}
      <polygon
        points="50,16 78,28 78,60 50,84 22,60 22,28"
        fill="url(#secGrad)"
        fillOpacity="0.16"
        stroke="url(#secGrad)"
        strokeWidth="2"
      />

      {/* Inner Concentric Shield */}
      <polygon
        points="50,24 72,34 72,56 50,76 28,56 28,34"
        fill="url(#secGrad)"
        fillOpacity="0.25"
        stroke="#38bdf8"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />

      {/* Central Non-Custodial Keyhole / Checkmark Node */}
      <circle cx="50" cy="46" r="10" fill="url(#secGrad)" />
      <circle cx="50" cy="46" r="5" fill="#fff" />
      <path d="M47 46 L47 58 L53 58 L53 46" fill="#fff" />

      {/* Floating Verified Nodes */}
      <circle cx="28" cy="44" r="2.5" fill="#38bdf8" className="ost-anim-pulse" />
      <circle cx="72" cy="44" r="2.5" fill="#38bdf8" className="ost-anim-pulse" />
      <circle cx="50" cy="72" r="2.5" fill="#38bdf8" className="ost-anim-pulse" />
    </svg>
  );
}

export default function OstiumHeroSlider({ feedLive }) {
  const { t, i18n } = useTranslation();
  const isFa = i18n.language === 'fa';
  const [slide, setSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef(null);

  const slides = [
    {
      id: 'commodities',
      badge: isFa ? 'طلا و نفت جهانی' : 'Gold & Global Energy',
      title: isFa ? 'طلا و نفت جهانی روی آربیتروم' : 'Gold & Crude Oil on Arbitrum',
      subtitle: isFa
        ? 'اهرم تا ۱۰۰ برابری با تسویه USDC و بدون اسلیپیج با قیمت‌گذاری شفاف اوراکل'
        : 'Up to 100x leverage settled in USDC with zero price impact or slippage.',
      art: <GoldOilArt />
    },
    {
      id: 'forex',
      badge: isFa ? 'جفت‌ارزهای فارکس' : 'Global Forex Pairs',
      title: isFa ? 'بزرگ‌ترین بازار مالی جهان در کیف پول شما' : 'World’s Deepest Market in Your Wallet',
      subtitle: isFa
        ? 'معامله آن‌چین EUR/USD، GBP/USD، USD/JPY با کمترین کارمزد و بدون احراز هویت'
        : 'Trade EUR, GBP, JPY, and USD pairs on-chain with tight spreads and no KYC.',
      art: <ForexArt />
    },
    {
      id: 'equities',
      badge: isFa ? 'شاخص‌ها و سهام' : 'Global Equities & Indices',
      title: isFa ? 'شاخص‌های بورس جهانی و سهام برتر' : 'Global Indices & Mega-Cap Equities',
      subtitle: isFa
        ? 'پوشش ریسک و پوزیشن‌های ۲۴ ساعته روی S&P 500، نزدک و بزرگ‌ترین غول‌های فناوری'
        : 'Trade S&P 500, Nasdaq, and top global equities with decentralized leverage.',
      art: <EquitiesArt />
    },
    {
      id: 'onchain',
      badge: isFa ? 'تسویه ۱۰۰٪ آن‌چین' : '100% On-Chain Settlement',
      title: isFa ? 'معامله غیرحضانتی و تسویه روی آربیتروم' : '100% Non-Custodial Decentralized Trading',
      subtitle: isFa
        ? 'کلیدها همیشه در اختیار شماست؛ قراردادهای هوشمند بازرسی‌شده بدون واسطه'
        : 'Keys always in your wallet. Audited smart contracts with transparent execution.',
      art: <SecurityArt />
    }
  ];

  const total = slides.length;

  useEffect(() => {
    if (isPaused) return;
    timerRef.current = setInterval(() => {
      setSlide((s) => (s + 1) % total);
    }, AUTO_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [isPaused, slide, total]);

  const active = slides[slide];

  return (
    <div
      className="ost-slider ost-slider-minimal"
      data-slide={slide}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-label="Ostium Horizon Markets Banner"
    >
      <div className="ost-aurora" aria-hidden="true" />

      {/* Header bar: Minimal Brand + Dynamic Tag + Live Pill */}
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

      {/* Compact Viewport with Animated Slides */}
      <div className="ost-viewport">
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            className="ost-slide"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          >
            <div className="ost-content">
              <h2 className="ost-title">
                <span className="ost-title-accent">{active.title}</span>
              </h2>
              <p className="ost-desc">{active.subtitle}</p>
            </div>

            <div className="ost-graphic" aria-hidden="true">
              {active.art}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer: Micro timeline segments without buttons */}
      <div className="ost-footer-minimal">
        <div className="ost-segments" role="tablist" aria-label="Slider progress">
          {slides.map((s, idx) => (
            <div
              key={s.id}
              className={`ost-seg ${slide === idx ? 'is-active' : ''}`}
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
      </div>
    </div>
  );
}
