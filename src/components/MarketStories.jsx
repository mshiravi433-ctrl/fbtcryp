import { useEffect, useMemo, useRef, useState } from 'react';
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
import { openUrl } from '../lib/browser';
import { APARAT_CHANNEL_URL } from '../pages/AparatVideos';
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternal,
  IconVideo,
  IconVolume,
  IconX
} from './Icons';

/**
 * 1-MINUTE INTERACTIVE MARKET STORIES
 * ---------------------------------------------------------------------------
 * Placed directly beneath the Bitcoin hero card on the Market page.
 * Each story opens a 60-second (60,000 ms) rich interactive popup with
 * custom Illustrator-style vector SVG artwork, live market/stock rankings,
 * optional ambient music synthesizer, and a bottom CTA bar that navigates
 * straight to that section of the app.
 */
export const STORY_DURATION_MS = 60_000;

export const MARKET_STORY_ITEMS = [
  {
    id: 'stocks',
    badge: 'RWA',
    route: '/stocks',
    secondaryRoutes: [
      { to: '/stocks', labelKey: 'stories.quick.xstocks' },
      { to: '/swap', labelKey: 'stories.quick.swapRwa' }
    ],
    ring: 'linear-gradient(135deg, #00ff9d 0%, #ffb300 52%, #00e5ff 100%)',
    accent: '#00ff9d',
    accent2: '#ffb300',
    mood: 'alpha'
  },
  {
    id: 'aparat',
    badge: 'VIDEO',
    route: '/aparat',
    secondaryRoutes: [
      { to: '/learn', labelKey: 'stories.quick.learnHub' }
    ],
    ring: 'linear-gradient(135deg, #ff2d95 0%, #ffb300 50%, #7c4dff 100%)',
    accent: '#ff2d95',
    accent2: '#ffb300',
    mood: 'cinema'
  },
  {
    id: 'swap',
    badge: 'DEX',
    route: '/swap',
    secondaryRoutes: [
      { to: '/solana', labelKey: 'stories.quick.solana' },
      { to: '/bridge', labelKey: 'stories.quick.bridge' }
    ],
    ring: 'linear-gradient(135deg, #00e5ff 0%, #7c4dff 52%, #14f195 100%)',
    accent: '#00e5ff',
    accent2: '#14f195',
    mood: 'alpha'
  },
  {
    id: 'intent',
    badge: 'AI',
    route: '/intent',
    secondaryRoutes: [
      { to: '/signals', labelKey: 'stories.quick.signals' },
      { to: '/smart-money', labelKey: 'stories.quick.smartMoney' }
    ],
    ring: 'linear-gradient(135deg, #7c4dff 0%, #ff2d95 52%, #00e5ff 100%)',
    accent: '#7c4dff',
    accent2: '#ff2d95',
    mood: 'focus'
  },
  {
    id: 'defi',
    badge: 'APY',
    route: '/farm',
    secondaryRoutes: [
      { to: '/loan', labelKey: 'stories.quick.loan' },
      { to: '/rewards', labelKey: 'stories.quick.rewards' }
    ],
    ring: 'linear-gradient(135deg, #14f195 0%, #00e5ff 50%, #3b82f6 100%)',
    accent: '#14f195',
    accent2: '#00e5ff',
    mood: 'alpha'
  },
  {
    id: 'radio',
    badge: 'MUSIC',
    route: '/news',
    secondaryRoutes: [
      { to: '/global', labelKey: 'stories.quick.global' }
    ],
    ring: 'linear-gradient(135deg, #ff2d95 0%, #ffb300 48%, #00e5ff 100%)',
    accent: '#ffb300',
    accent2: '#ff2d95',
    mood: 'cinema'
  },
  {
    id: 'orders',
    badge: 'AUTO',
    route: '/orders',
    secondaryRoutes: [
      { to: '/compare', labelKey: 'stories.quick.compare' }
    ],
    ring: 'linear-gradient(135deg, #ffb300 0%, #00e5ff 52%, #7c4dff 100%)',
    accent: '#ffb300',
    accent2: '#00e5ff',
    mood: 'focus'
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
    ring: 'linear-gradient(135deg, #00e5ff 0%, #ffb300 50%, #7c4dff 100%)',
    accent: '#00e5ff',
    accent2: '#7c4dff',
    mood: 'alpha'
  }
];

const CURATED_TOP_STOCKS = [
  { symbol: 'NVDA', name: 'NVIDIA xStock', price: 138.40, change24h: 6.45, tag: 'AI Chip Leader' },
  { symbol: 'TSLA', name: 'Tesla xStock', price: 258.90, change24h: 5.18, tag: 'EV & Robotics' },
  { symbol: 'AAPL', name: 'Apple xStock', price: 231.50, change24h: 3.92, tag: 'Consumer Tech' },
  { symbol: 'META', name: 'Meta Platforms', price: 592.10, change24h: 3.64, tag: 'AI & Social' },
  { symbol: 'MSFT', name: 'Microsoft xStock', price: 428.75, change24h: 2.85, tag: 'Cloud & AI' }
];

const DEFI_HIGHLIGHTS = [
  { id: 'kamino', protocol: 'Kamino / Solana', asset: 'USDC · SOL', apy: '14.8%', badge: 'Non-Custodial' },
  { id: 'aave', protocol: 'Aave V3 · Base & Arb', asset: 'USDC · WETH', apy: '9.4%', badge: 'Blue-Chip' },
  { id: 'morpho', protocol: 'Morpho Vaults', asset: 'USDT · wstETH', apy: '12.2%', badge: 'Curated' },
  { id: 'lido', protocol: 'Lido Liquid Staking', asset: 'stETH · wstETH', apy: '3.6%', badge: 'Liquid' }
];

function StoryAvatarSvg({ id, accent, accent2 }) {
  const gId = `st-av-${id}`;
  return (
    <svg viewBox="0 0 48 48" fill="none" className="market-story-avatar-svg" aria-hidden="true">
      <defs>
        <linearGradient id={gId} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={accent2} />
        </linearGradient>
      </defs>

      {id === 'stocks' && (
        <g>
          <rect x="9" y="25" width="6" height="13" rx="2" fill={accent} fillOpacity="0.55" />
          <rect x="18" y="19" width="6" height="19" rx="2" fill={accent} fillOpacity="0.8" />
          <rect x="27" y="13" width="6" height="25" rx="2" fill={`url(#${gId})`} />
          <path d="M9 21l10-7 8 4 12-10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="39" cy="8" r="3" fill={accent2} />
        </g>
      )}

      {id === 'aparat' && (
        <g>
          <rect x="7" y="10" width="34" height="28" rx="8" stroke={`url(#${gId})`} strokeWidth="2.2" fill="rgba(255,45,149,0.14)" />
          <polygon points="20,17 32,24 20,31" fill="#fff" />
          <circle cx="13" cy="15" r="1.8" fill={accent2} />
          <circle cx="35" cy="15" r="1.8" fill={accent} />
        </g>
      )}

      {id === 'swap' && (
        <g>
          <circle cx="17" cy="18" r="8" stroke={accent} strokeWidth="2.2" fill="rgba(0,229,255,0.15)" />
          <circle cx="31" cy="30" r="8" stroke={accent2} strokeWidth="2.2" fill="rgba(20,241,149,0.15)" />
          <path d="M27 13h9v9M21 35h-9v-9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {id === 'intent' && (
        <g>
          <circle cx="24" cy="24" r="13" stroke={`url(#${gId})`} strokeWidth="2.2" fill="rgba(124,77,255,0.16)" />
          <circle cx="24" cy="24" r="5" fill="#fff" />
          <path d="M24 7v4M24 37v4M7 24h4M37 24h4" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}

      {id === 'defi' && (
        <g>
          <polygon points="24,7 39,24 24,41 9,24" stroke={`url(#${gId})`} strokeWidth="2.2" fill="rgba(20,241,149,0.16)" />
          <polygon points="24,14 32,24 24,34 16,24" fill="#fff" fillOpacity="0.85" />
        </g>
      )}

      {id === 'radio' && (
        <g>
          <path d="M12 26v-3a12 12 0 0 1 24 0v3" stroke={`url(#${gId})`} strokeWidth="2.4" strokeLinecap="round" />
          <rect x="9" y="25" width="6" height="11" rx="3" fill={accent} />
          <rect x="33" y="25" width="6" height="11" rx="3" fill={accent2} />
          <path d="M20 28v6M24 24v12M28 27v7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}

      {id === 'orders' && (
        <g>
          <circle cx="24" cy="24" r="14" stroke={`url(#${gId})`} strokeWidth="2.2" fill="rgba(255,179,0,0.14)" />
          <path d="M24 15v9l6 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="35" cy="13" r="3.5" fill={accent2} />
        </g>
      )}

      {id === 'ecosystem' && (
        <g>
          <path d="M24 8l14 5.5v9.5c0 9.5-6 16.5-14 19-8-2.5-14-9.5-14-19v-9.5L24 8z" stroke={`url(#${gId})`} strokeWidth="2.2" fill="rgba(0,229,255,0.14)" />
          <path d="m19 24 3.5 3.5L30 20" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}

function StoryStageIllustration({ id, accent, accent2 }) {
  const gradId = `story-stage-grad-${id}`;
  return (
    <svg viewBox="0 0 360 120" fill="none" className="market-story-stage-svg" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="360" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="55%" stopColor={accent2} stopOpacity="0.2" />
          <stop offset="100%" stopColor="#090d1a" stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="356" height="116" rx="20" fill={`url(#${gradId})`} />
      <circle cx="305" cy="28" r="46" fill={accent} fillOpacity="0.14" />
      <circle cx="52" cy="96" r="38" fill={accent2} fillOpacity="0.14" />

      {id === 'stocks' && (
        <g>
          <path d="M24 96h312" stroke="rgba(255,255,255,0.16)" strokeWidth="1.4" />
          <rect x="42" y="60" width="20" height="36" rx="5" fill={accent} fillOpacity="0.4" />
          <rect x="76" y="48" width="20" height="48" rx="5" fill={accent} fillOpacity="0.6" />
          <rect x="110" y="34" width="20" height="62" rx="5" fill={accent2} fillOpacity="0.75" />
          <rect x="144" y="20" width="20" height="76" rx="5" fill="#00ff9d" fillOpacity="0.92" />
          <path d="M34 80 C82 68, 124 44, 178 24 L250 16" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <circle cx="250" cy="16" r="5.5" fill="#00ff9d" />
          <rect x="218" y="38" width="114" height="52" rx="14" fill="rgba(8,13,26,0.72)" stroke={accent} strokeWidth="1.6" />
          <text x="275" y="61" textAnchor="middle" fill="#00ff9d" fontSize="13" fontWeight="800" fontFamily="monospace">xSTOCKS · RWA</text>
          <text x="275" y="79" textAnchor="middle" fill="#fff" fontSize="10.5" fontFamily="monospace">NVDA · AAPL · TSLA</text>
        </g>
      )}

      {id === 'aparat' && (
        <g>
          <rect x="34" y="18" width="168" height="84" rx="16" fill="rgba(10,14,28,0.75)" stroke={accent} strokeWidth="2" />
          <polygon points="106,44 138,60 106,76" fill="#ff2d95" />
          <circle cx="54" cy="34" r="4" fill="#ffb300" />
          <circle cx="276" cy="60" r="34" fill="rgba(255,45,149,0.16)" stroke={accent2} strokeWidth="2" strokeDasharray="6 4" />
          <text x="276" y="57" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="800" fontFamily="monospace">APARAT</text>
          <text x="276" y="73" textAnchor="middle" fill="#ffb300" fontSize="10" fontFamily="monospace">@Fbtcompany</text>
        </g>
      )}

      {id === 'swap' && (
        <g>
          <circle cx="88" cy="60" r="34" fill="rgba(0,229,255,0.15)" stroke={accent} strokeWidth="2" />
          <circle cx="272" cy="60" r="34" fill="rgba(20,241,149,0.15)" stroke={accent2} strokeWidth="2" />
          <path d="M134 46h92l-12-12M226 74h-92l12 12" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          <text x="88" y="64" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="800" fontFamily="monospace">EVM</text>
          <text x="272" y="64" textAnchor="middle" fill="#14f195" fontSize="12" fontWeight="800" fontFamily="monospace">SOL</text>
        </g>
      )}

      {id === 'intent' && (
        <g>
          <circle cx="180" cy="60" r="38" fill="rgba(124,77,255,0.2)" stroke={accent} strokeWidth="2.2" />
          <circle cx="180" cy="60" r="20" stroke="#fff" strokeWidth="1.6" strokeDasharray="4 4" />
          <circle cx="180" cy="60" r="7" fill="#00e5ff" />
          <line x1="142" y1="60" x2="72" y2="34" stroke={accent2} strokeWidth="2" />
          <line x1="142" y1="60" x2="72" y2="86" stroke="#00e5ff" strokeWidth="2" />
          <line x1="218" y1="60" x2="288" y2="34" stroke="#00e5ff" strokeWidth="2" />
          <line x1="218" y1="60" x2="288" y2="86" stroke={accent2} strokeWidth="2" />
          <circle cx="72" cy="34" r="7" fill={accent2} />
          <circle cx="72" cy="86" r="7" fill="#00e5ff" />
          <circle cx="288" cy="34" r="7" fill="#00e5ff" />
          <circle cx="288" cy="86" r="7" fill={accent2} />
        </g>
      )}

      {id === 'defi' && (
        <g>
          <polygon points="104,18 148,60 104,102 60,60" fill="rgba(20,241,149,0.2)" stroke={accent} strokeWidth="2.2" />
          <rect x="176" y="26" width="148" height="68" rx="14" fill="rgba(8,13,26,0.7)" stroke={accent2} strokeWidth="1.8" />
          <text x="250" y="54" textAnchor="middle" fill="#14f195" fontSize="14" fontWeight="800" fontFamily="monospace">DEFI YIELD</text>
          <text x="250" y="75" textAnchor="middle" fill="#fff" fontSize="10.5" fontFamily="monospace">AAVE · MORPHO · KAMINO</text>
        </g>
      )}

      {id === 'radio' && (
        <g>
          {[42, 62, 82, 102, 122, 142, 162, 182, 202, 222, 242, 262, 282, 302, 322].map((x, idx) => {
            const h = 22 + ((idx * 19) % 58);
            const y = 60 - h / 2;
            return (
              <rect
                key={x}
                x={x - 4}
                y={y}
                width="8"
                height={h}
                rx="4"
                fill={idx % 2 === 0 ? accent : accent2}
                fillOpacity="0.88"
              />
            );
          })}
        </g>
      )}

      {id === 'orders' && (
        <g>
          <circle cx="88" cy="60" r="34" fill="rgba(255,179,0,0.16)" stroke={accent} strokeWidth="2.2" />
          <path d="M88 38v22l15 9" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
          <rect x="156" y="24" width="166" height="72" rx="14" fill="rgba(8,13,26,0.72)" stroke={accent2} strokeWidth="1.8" />
          <text x="239" y="53" textAnchor="middle" fill="#ffb300" fontSize="13" fontWeight="800" fontFamily="monospace">DCA · LIMIT · TWAP</text>
          <text x="239" y="74" textAnchor="middle" fill="#00e5ff" fontSize="10.5" fontFamily="monospace">24/7 AUTO EXECUTION</text>
        </g>
      )}

      {id === 'ecosystem' && (
        <g>
          <path d="M92 20l36 14v22c0 22-15 38-36 44-21-6-36-22-36-44V34l36-14z" fill="rgba(0,229,255,0.18)" stroke={accent} strokeWidth="2.2" />
          <path d="m79 58 9 9 19-19" stroke="#00ff9d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="158" y="26" width="166" height="68" rx="14" fill="rgba(8,13,26,0.72)" stroke={accent2} strokeWidth="1.8" />
          <text x="241" y="54" textAnchor="middle" fill="#fff" fontSize="12.5" fontWeight="800" fontFamily="monospace">WALLET · SHOP · INSURE</text>
          <text x="241" y="74" textAnchor="middle" fill="#00e5ff" fontSize="10.5" fontFamily="monospace">NON-CUSTODIAL SUPERAPP</text>
        </g>
      )}
    </svg>
  );
}

export default function MarketStories({ coins = [], global = null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const isRtl = i18n.language === 'fa' || i18n.language === 'ar' || i18n.language === 'ur';

  const [openIndex, setOpenIndex] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [audioMood, setAudioMood] = useState('alpha');
  const [seenIds, setSeenIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem('fbt-seen-stories-v1');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [liveEquities, setLiveEquities] = useState([]);

  const audioRef = useRef(null);
  if (!audioRef.current) {
    audioRef.current = createStoryAmbientController();
  }

  useEffect(() => {
    const ctrl = audioRef.current;
    return () => ctrl?.destroy();
  }, []);

  const activeStory = openIndex != null ? MARKET_STORY_ITEMS[openIndex] ?? null : null;

  const markSeen = (id) => {
    setSeenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        sessionStorage.setItem('fbt-seen-stories-v1', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const openStoryAt = (idx) => {
    const item = MARKET_STORY_ITEMS[idx];
    if (!item) return;
    setOpenIndex(idx);
    setElapsedMs(0);
    setPaused(false);
    markSeen(item.id);
    if (audioOn && audioRef.current) {
      audioRef.current.setMood(item.mood);
    }
  };

  const closeModal = () => {
    setOpenIndex(null);
    setElapsedMs(0);
    setPaused(false);
    if (audioRef.current?.isPlaying()) {
      audioRef.current.stop();
    }
    setAudioOn(false);
  };

  const goNextStory = () => {
    if (openIndex == null) return;
    if (openIndex + 1 < MARKET_STORY_ITEMS.length) {
      openStoryAt(openIndex + 1);
    } else {
      closeModal();
    }
  };

  const goPrevStory = () => {
    if (openIndex == null) return;
    if (openIndex > 0) {
      openStoryAt(openIndex - 1);
    } else {
      setElapsedMs(0);
    }
  };

  // Lazy-fetch live equities ONLY when the story modal is opened
  useEffect(() => {
    if (openIndex == null || liveEquities.length > 0) return undefined;
    let alive = true;
    fetchAvantisEquities()
      .then((res) => {
        if (alive && Array.isArray(res?.rows) && res.rows.length > 0) {
          setLiveEquities(res.rows);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [openIndex, liveEquities.length]);

  // Lock body scroll and bind keyboard navigation when open
  useEffect(() => {
    if (openIndex == null) return undefined;
    const unlock = lockBodyScroll();
    const onKey = (e) => {
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'ArrowRight') (isRtl ? goPrevStory() : goNextStory());
      else if (e.key === 'ArrowLeft') (isRtl ? goNextStory() : goPrevStory());
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndex, isRtl]);

  // 60-second (1-minute) timer per story
  useEffect(() => {
    if (openIndex == null || paused) return undefined;
    const stepMs = 200;
    const id = setInterval(() => {
      setElapsedMs((prev) => {
        const next = prev + stepMs;
        if (next >= STORY_DURATION_MS) {
          return STORY_DURATION_MS;
        }
        return next;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [openIndex, paused]);

  useEffect(() => {
    if (openIndex != null && elapsedMs >= STORY_DURATION_MS) {
      goNextStory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, openIndex]);

  // Top gaining / highest-returning stocks for the Stocks story
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

  // Top gaining crypto coins for the Swap story
  const topGainerCoins = useMemo(() => {
    if (!Array.isArray(coins) || !coins.length) return [];
    return [...coins]
      .filter((c) => Number.isFinite(Number(c.change24h)))
      .sort((a, b) => (b.change24h || 0) - (a.change24h || 0))
      .slice(0, 4);
  }, [coins]);

  // Top volume coins for the Orders/Trading story
  const topVolumeCoins = useMemo(() => {
    if (!Array.isArray(coins) || !coins.length) return [];
    return [...coins]
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 4);
  }, [coins]);

  const toggleStoryAudio = () => {
    const ctrl = audioRef.current;
    if (!ctrl) return;
    if (audioOn) {
      ctrl.stop();
      setAudioOn(false);
    } else {
      const m = activeStory?.mood || audioMood;
      setAudioMood(m);
      ctrl.start(m);
      setAudioOn(true);
    }
  };

  const selectMoodAndPlay = (mood) => {
    setAudioMood(mood);
    if (audioRef.current) {
      audioRef.current.start(mood);
      setAudioOn(true);
    }
  };

  const handlePrimaryNavigate = (route) => {
    closeModal();
    requestAnimationFrame(() => navigate(route));
  };

  const remainingSeconds = Math.max(0, Math.ceil((STORY_DURATION_MS - elapsedMs) / 1000));
  const progressPct = Math.min(100, (elapsedMs / STORY_DURATION_MS) * 100);

  return (
    <section
      className="market-stories-section"
      aria-label={t('stories.railTitle')}
      data-testid="market-stories-rail"
    >
      <div className="row-between market-stories-head">
        <div className="row" style={{ gap: 8 }}>
          <span className="market-stories-live-dot" aria-hidden="true" />
          <span className="section-label" style={{ margin: 0 }}>
            {t('stories.railTitle')}
          </span>
        </div>
        <span className="market-stories-badge mono">
          {t('stories.railBadge')}
        </span>
      </div>

      <div className="market-stories-rail" role="list">
        {MARKET_STORY_ITEMS.map((item, idx) => {
          const isSeen = seenIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`market-story-Bubble ${isSeen ? 'is-seen' : ''}`}
              onClick={() => openStoryAt(idx)}
              data-testid={`market-story-item-${item.id}`}
            >
              <span
                className="market-story-ring"
                style={{ '--story-ring': item.ring, '--story-accent': item.accent }}
              >
                <span className="market-story-avatar-inner">
                  <StoryAvatarSvg id={item.id} accent={item.accent} accent2={item.accent2} />
                </span>
                <span
                  className="market-story-chip mono"
                  style={{ background: item.accent, color: '#060a14' }}
                >
                  {item.badge}
                </span>
              </span>
              <span className="market-story-label">
                {t(`stories.items.${item.id}.short`)}
              </span>
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
                  className="market-story-dialog market-glass-surface"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t(`stories.items.${activeStory.id}.title`)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 14 }}
                  transition={{ duration: still ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  {/* ─── 60-SECOND SEGMENTED STORY PROGRESS BARS ────────── */}
                  <div className="market-story-progress-row" data-testid="story-progress-bars">
                    {MARKET_STORY_ITEMS.map((st, idx) => {
                      const widthPct =
                        idx < openIndex ? 100 : idx === openIndex ? progressPct : 0;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          className="market-story-progress-seg"
                          onClick={() => openStoryAt(idx)}
                          aria-label={t(`stories.items.${st.id}.short`)}
                        >
                          <span
                            className="market-story-progress-fill"
                            style={{
                              width: `${widthPct}%`,
                              background: st.ring
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {/* ─── STORY HEADER BAR ───────────────────────────────── */}
                  <div className="market-story-top-bar">
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <span
                        className="market-story-mini-ring"
                        style={{ background: activeStory.ring }}
                      >
                        <StoryAvatarSvg
                          id={activeStory.id}
                          accent={activeStory.accent}
                          accent2={activeStory.accent2}
                        />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="market-story-head-title">
                          {t(`stories.items.${activeStory.id}.title`)}
                        </div>
                        <div className="market-story-head-sub mono">
                          {activeStory.badge} · {remainingSeconds}s
                        </div>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className={`market-story-ctrl-btn ${audioOn ? 'is-active' : ''}`}
                        onClick={toggleStoryAudio}
                        aria-label={audioOn ? t('stories.controls.mute') : t('stories.controls.music')}
                        data-testid="story-audio-toggle"
                      >
                        <IconVolume width={15} height={15} />
                        <span className="mono" style={{ fontSize: 10 }}>
                          {audioOn ? t('stories.controls.musicOn') : t('stories.controls.music')}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="market-story-ctrl-btn mono"
                        onClick={() => setPaused((p) => !p)}
                        data-testid="story-pause-toggle"
                      >
                        {paused ? t('stories.controls.resume') : t('stories.controls.pause')}
                      </button>

                      <button
                        type="button"
                        className="market-story-ctrl-btn"
                        onClick={closeModal}
                        aria-label={t('common.close')}
                        data-testid="story-close-btn"
                      >
                        <IconX width={15} height={15} />
                      </button>
                    </div>
                  </div>

                  {/* ─── ILLUSTRATOR STAGE ARTWORK ──────────────────────── */}
                  <div className="market-story-stage-wrap">
                    <StoryStageIllustration
                      id={activeStory.id}
                      accent={activeStory.accent}
                      accent2={activeStory.accent2}
                    />
                  </div>

                  {/* ─── STORY BODY CONTENT PER SECTION ─────────────────── */}
                  <div className="market-story-body">
                    <p className="market-story-lead">
                      {t(`stories.items.${activeStory.id}.subtitle`)}
                    </p>

                    {/* 1. STOCKS & RWA STORY: Top Gainers & Highest-Yielding Stocks */}
                    {activeStory.id === 'stocks' && (
                      <div className="market-story-panel" data-testid="story-panel-stocks">
                        <div className="row-between" style={{ marginBottom: 8 }}>
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
                              <div
                                key={stk.symbol}
                                className="market-story-stock-row"
                                onClick={() => handlePrimaryNavigate('/stocks')}
                              >
                                <span className="market-story-rank mono">#{i + 1}</span>
                                <img
                                  src={tickerLogo(stk.symbol)}
                                  alt={stk.symbol}
                                  className="market-story-stock-logo"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="row" style={{ gap: 6 }}>
                                    <span className="market-story-stock-sym mono">{stk.symbol}</span>
                                    <span className="market-story-stock-tag">{stk.tag}</span>
                                  </div>
                                  <div className="market-story-stock-name">{stk.name}</div>
                                  <div className="market-story-return-bar">
                                    <span
                                      style={{
                                        width: `${barW}%`,
                                        background: up ? 'var(--up)' : 'var(--down)'
                                      }}
                                    />
                                  </div>
                                </div>
                                <div style={{ textAlign: 'end' }}>
                                  <div className="mono market-story-stock-price">
                                    {fmtUsd(stk.price)}
                                  </div>
                                  <span className={`pill ${up ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 10.5 }}>
                                    {fmtPct(stk.change24h)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 2. APARAT VIDEO ACADEMY STORY */}
                    {activeStory.id === 'aparat' && (
                      <div className="market-story-panel" data-testid="story-panel-aparat">
                        <div className="row-between" style={{ marginBottom: 8 }}>
                          <span className="market-story-panel-title">
                            {t('stories.aparat.featuredTitle')}
                          </span>
                          <span className="mono market-story-tag-accent" dir="ltr">
                            aparat.com/Fbtcompany
                          </span>
                        </div>

                        <div className="market-story-feature-grid">
                          {['wallet', 'swap', 'stocks', 'ai'].map((cid, i) => (
                            <div
                              key={cid}
                              className="market-story-feature-card"
                              onClick={() => handlePrimaryNavigate('/aparat')}
                            >
                              <div className="row-between">
                                <span className="mono market-story-rank">0{i + 1}</span>
                                <IconVideo width={14} height={14} />
                              </div>
                              <div className="market-story-feature-name">
                                {t(`aparat.courses.${cid}.title`)}
                              </div>
                              <div className="faint" style={{ fontSize: 10.5 }}>
                                {t(`aparat.courses.${cid}.step1`)}
                              </div>
                            </div>
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

                    {/* 3. SMART SWAP & SOLANA STORY */}
                    {activeStory.id === 'swap' && (
                      <div className="market-story-panel" data-testid="story-panel-swap">
                        <div className="row-between" style={{ marginBottom: 8 }}>
                          <span className="market-story-panel-title">
                            {t('stories.swap.topMoversTitle')}
                          </span>
                          <span className="mono market-story-tag-accent">EVM + SOLANA</span>
                        </div>

                        <div className="market-story-stock-list">
                          {topGainerCoins.map((c, i) => (
                            <div
                              key={c.id}
                              className="market-story-stock-row"
                              onClick={() => handlePrimaryNavigate(`/coin/${c.id}`)}
                            >
                              <span className="market-story-rank mono">#{i + 1}</span>
                              <CoinLogo coin={c} size="thumb" px={28} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="market-story-stock-sym mono">{c.symbol}</div>
                                <div className="market-story-stock-name">{c.name}</div>
                              </div>
                              <div style={{ textAlign: 'end' }}>
                                <div className="mono market-story-stock-price">
                                  {fmtUsd(c.price)}
                                </div>
                                <span className={`pill ${(c.change24h ?? 0) >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 10.5 }}>
                                  {fmtPct(c.change24h ?? 0)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 4. INTENT AI & SMART MONEY STORY */}
                    {activeStory.id === 'intent' && (
                      <div className="market-story-panel" data-testid="story-panel-intent">
                        <div className="market-story-feature-grid">
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/intent')}>
                            <span className="mono market-story-tag-accent">NEURAL OS</span>
                            <div className="market-story-feature-name">{t('stories.intent.cmd1Title')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.intent.cmd1Desc')}</div>
                          </div>
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/smart-money')}>
                            <span className="mono market-story-tag-accent">WHALE RADAR</span>
                            <div className="market-story-feature-name">{t('stories.intent.cmd2Title')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.intent.cmd2Desc')}</div>
                          </div>
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/signals')}>
                            <span className="mono market-story-tag-accent">SIGNALS</span>
                            <div className="market-story-feature-name">{t('stories.intent.cmd3Title')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.intent.cmd3Desc')}</div>
                          </div>
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/global')}>
                            <span className="mono market-story-tag-accent">MACRO AI</span>
                            <div className="market-story-feature-name">{t('stories.intent.cmd4Title')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.intent.cmd4Desc')}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 5. DEFI FARM & LENDING STORY */}
                    {activeStory.id === 'defi' && (
                      <div className="market-story-panel" data-testid="story-panel-defi">
                        <div className="market-story-stock-list">
                          {DEFI_HIGHLIGHTS.map((d) => (
                            <div
                              key={d.id}
                              className="market-story-stock-row"
                              onClick={() => handlePrimaryNavigate('/farm')}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="market-story-stock-sym">{d.protocol}</div>
                                <div className="market-story-stock-name mono">{d.asset}</div>
                              </div>
                              <span className="market-story-stock-tag">{d.badge}</span>
                              <span className="pill pill-up mono" style={{ fontSize: 11.5 }}>
                                APY {d.apy}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 6. CRYPTO RADIO & AMBIENT MUSIC STORY */}
                    {activeStory.id === 'radio' && (
                      <div className="market-story-panel" data-testid="story-panel-radio">
                        <div className="row-between" style={{ marginBottom: 8 }}>
                          <span className="market-story-panel-title">
                            {t('stories.radio.studioTitle')}
                          </span>
                          <span className="mono market-story-tag-accent">
                            {audioOn ? t('stories.controls.musicOn') : 'SYNTH + LIVE'}
                          </span>
                        </div>

                        <div className="market-story-mood-row">
                          {['alpha', 'focus', 'cinema'].map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={`market-story-mood-btn ${audioOn && audioMood === m ? 'is-active' : ''}`}
                              onClick={() => selectMoodAndPlay(m)}
                            >
                              <IconVolume width={14} height={14} />
                              <span>{t(`stories.radio.mood.${m}`)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 7. AUTO ORDERS & TRADING STORY */}
                    {activeStory.id === 'orders' && (
                      <div className="market-story-panel" data-testid="story-panel-orders">
                        <div className="market-story-stock-list">
                          {topVolumeCoins.map((c) => (
                            <div
                              key={c.id}
                              className="market-story-stock-row"
                              onClick={() => handlePrimaryNavigate('/orders')}
                            >
                              <CoinLogo coin={c} size="thumb" px={26} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="market-story-stock-sym mono">{c.symbol}</div>
                                <div className="market-story-stock-name">
                                  {t('market.volume24h')}: {fmtCompact(c.volume || 0)}
                                </div>
                              </div>
                              <span className="mono market-story-stock-price">
                                {fmtUsd(c.price)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 8. WALLET, SHOP, LAUNCHPAD & INSURANCE STORY */}
                    {activeStory.id === 'ecosystem' && (
                      <div className="market-story-panel" data-testid="story-panel-ecosystem">
                        <div className="market-story-feature-grid">
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/wallet')}>
                            <span className="mono market-story-tag-accent">WALLET</span>
                            <div className="market-story-feature-name">{t('stories.ecosystem.walletTitle')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>
                              {global?.coins ? `${global.coins.toLocaleString()}+ Assets` : 'EVM · Solana · BTC'}
                            </div>
                          </div>
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/shop')}>
                            <span className="mono market-story-tag-accent">SHOP</span>
                            <div className="market-story-feature-name">{t('stories.ecosystem.shopTitle')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.ecosystem.shopDesc')}</div>
                          </div>
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/launch')}>
                            <span className="mono market-story-tag-accent">LAUNCH</span>
                            <div className="market-story-feature-name">{t('stories.ecosystem.launchTitle')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.ecosystem.launchDesc')}</div>
                          </div>
                          <div className="market-story-feature-card" onClick={() => handlePrimaryNavigate('/insurance')}>
                            <span className="mono market-story-tag-accent">SHIELD</span>
                            <div className="market-story-feature-name">{t('stories.ecosystem.insureTitle')}</div>
                            <div className="faint" style={{ fontSize: 10.5 }}>{t('stories.ecosystem.insureDesc')}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ─── STORY FOOTER: PREV / NEXT + PRIMARY SECTION CTA ─ */}
                  <div className="market-story-footer">
                    {activeStory.secondaryRoutes?.length > 0 && (
                      <div className="market-story-quick-links">
                        {activeStory.secondaryRoutes.map((sr) => (
                          <button
                            key={sr.to + sr.labelKey}
                            type="button"
                            className="tag market-story-quick-chip"
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
                        className="btn btn-primary market-story-primary-cta"
                        style={{ background: activeStory.ring }}
                        onClick={() => handlePrimaryNavigate(activeStory.route)}
                        data-testid={`story-cta-${activeStory.id}`}
                      >
                        <span>{t(`stories.items.${activeStory.id}.cta`)}</span>
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
