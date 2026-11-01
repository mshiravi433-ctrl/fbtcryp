// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { forwardRef } from 'react';
import { useRadioStore } from '../src/store/useRadioStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';
import { fmtUsd } from '../src/lib/format';

vi.mock('../src/lib/audio', () => ({
  getCalm: async () => ({ items: [{ id: 'cinema-test', title: 'Cinematic journey', audioUrl: '/test-score.mp3' }] })
}));

/*
 * The score is spied on, not silenced.
 *
 * jsdom has no AudioContext, so the real controller returns false and the test
 * would learn nothing. What is actually under test here is the CONTRACT: the
 * story opens → `start('cinema')` is called exactly once, with no button being
 * pressed first; a real radio track takes over → `stop()`; the story closes →
 * `stop()`. Those three calls are the whole "autoplay, no transport UI" rule.
 */
const audioSpy = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  playing: false,
  lastMood: null
}));

vi.mock('../src/lib/storyAudio', () => ({
  createStoryAmbientController: () => ({
    start: (mood) => {
      audioSpy.lastMood = mood;
      audioSpy.playing = true;
      audioSpy.start(mood);
      return true;
    },
    stop: () => {
      audioSpy.playing = false;
      audioSpy.stop();
    },
    setMood: () => {},
    destroy: () => {},
    isPlaying: () => audioSpy.playing,
    getMood: () => audioSpy.lastMood
  })
}));

const dict = { fa, en };
let LANG = 'fa';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tFor(LANG),
    i18n: { language: LANG, changeLanguage: (l) => { LANG = l; } }
  })
}));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, forwardRef(({ children, ...p }, ref) => {
          const clean = Object.fromEntries(
            Object.entries(p).filter(
              ([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)
            )
          );
          return <T ref={ref} {...clean}>{children}</T>;
        }));
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

const COINS = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    image: '',
    price: 92450,
    change24h: 3.45,
    volume: 38_000_000_000,
    high24h: 93200,
    low24h: 89500,
    sparkline: [89500, 90200, 91400, 92450],
    rank: 1,
    mcap: 1_820_000_000_000
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    image: '',
    price: 3420,
    change24h: 4.12,
    volume: 19_000_000_000,
    high24h: 3480,
    low24h: 3290,
    sparkline: [3300, 3350, 3400, 3420],
    rank: 2,
    mcap: 410_000_000_000
  }
];

vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: COINS, loading: false }),
  useGlobalStats: () => ({
    data: {
      mcap: 3_150_000_000_000,
      volume: 142_000_000_000,
      btcDominance: 56.4,
      ethDominance: 13.8,
      coins: 14820,
      markets: 1120,
      avgChange: 2.35,
      mcapChange: 2.84
    }
  }),
  useTrending: () => ({ data: [] }),
  useCoinSearch: () => ({ results: [], searching: false })
}));
vi.mock('../src/lib/refresh', () => ({ onSoftRefresh: () => () => {} }));
vi.mock('../src/lib/api', () => ({
  getMarkets: async () => [],
  getCategory: async () => [],
  getGlobal: async () => ({}),
  getTrending: async () => [],
  searchCoins: async () => [],
  onMarketVisualsReady: () => () => {}
}));
vi.mock('../src/lib/marketVisuals', () => ({ mergeVisuals: (c) => c }));
vi.mock('../src/lib/priceAlerts', () => ({ runPriceAlerts: () => {}, runTopMoverAlerts: () => {}, syncPriceWatch: () => Promise.resolve({ ok: true }) }));
vi.mock('../src/components/Ticker', () => ({ default: () => null }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/TrendChart', () => ({ default: () => <div data-testid="global-market-trend-chart" /> }));


/*
 * ─── THIS FILE READS «مرور» ────────────────────────────────────────────────
 * The screen is split into two tabs («مرور» / «توکن», see lib/marketTabs.js).
 * The stories reel, the Bitcoin card and the readings are on the FIRST tab,
 * which is where the screen opens — so these tests mount the page and assert
 * against it unchanged. The token list and its search field live on the other
 * tab and are pinned by market-tabs.test.jsx and market-terminal.test.jsx.
 */
import Market from '../src/pages/Market.jsx';
import AparatVideos, { APARAT_CHANNEL_URL } from '../src/pages/AparatVideos.jsx';
import { MARKET_STORY_ITEMS, STORY_DURATION_MS } from '../src/components/MarketStories.jsx';

function LocationProbe({ onChange }) {
  const loc = useLocation();
  onChange(loc.pathname);
  return null;
}

beforeEach(() => {
  LANG = 'fa';
  useRadioStore.getState().stop();
  audioSpy.start.mockClear();
  audioSpy.stop.mockClear();
  audioSpy.playing = false;
  audioSpy.lastMood = null;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ venues: {}, rows: [] }) }));
});

afterEach(() => {
  cleanup();
});

describe('Glassmorphic Market Cap & Bitcoin Hero Cards + 1-Minute Stories + Aparat Academy', () => {
  it('renders the compact intelligence overview and Bitcoin panel with tabular numerals', async () => {
    render(
      <MemoryRouter>
        <Market />
      </MemoryRouter>
    );

    const globalCard = screen.getByTestId('market-global-card');
    const btcCard = screen.getByTestId('market-btc-hero-card');
    expect(globalCard).toBeTruthy();
    expect(btcCard).toBeTruthy();
    expect(btcCard.textContent).toContain('Bitcoin');
    expect(document.querySelector('.market-global-watermark')).toBeNull();
    expect(document.querySelector('.market-btc-watermark')).toBeNull();
    expect(document.querySelector('.market-hero-action-chip')).toBeNull();

    const intelCss = readFileSync('src/styles/market-intelligence.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(intelCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(intelCss).toMatch(/:root\[data-theme='light'\]\s*\.mx-market/);
    expect(intelCss).not.toMatch(/backdrop-filter/);
  });

  it('renders Instagram-style story icons below the Bitcoin box and opens a 1-minute (60s) popup for Stocks with top gainers & CTA', async () => {
    expect(STORY_DURATION_MS).toBe(60_000);
    expect(MARKET_STORY_ITEMS.length).toBeGreaterThanOrEqual(8);

    let currentPath = '/';
    render(
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe onChange={(p) => { currentPath = p; }} />
        <Market />
      </MemoryRouter>
    );

    const rail = screen.getByTestId('market-stories-rail');
    expect(rail).toBeTruthy();
    expect(screen.getByTestId('market-story-item-aparat')).toBeTruthy();

    const stocksBubble = screen.getByTestId('market-story-item-stocks');
    expect(stocksBubble).toBeTruthy();

    fireEvent.click(stocksBubble);

    const popup = await screen.findByTestId('market-story-popup');
    expect(popup).toBeTruthy();
    expect(screen.getByTestId('story-panel-stocks')).toBeTruthy();
    expect(popup.textContent).toContain('NVDA');
    expect(popup.textContent).toContain('TSLA');
    expect(popup.textContent).toContain('AAPL');
    expect(popup.textContent).toContain('60s');

    expect(screen.queryByTestId('story-audio-toggle')).toBeNull();
    expect(screen.queryByTestId('story-pause-toggle')).toBeNull();
    expect(popup.querySelectorAll('.market-story-progress-seg svg').length).toBe(8);

    // Click bottom CTA button to open Stocks page
    const ctaBtn = screen.getByTestId('story-cta-stocks');
    fireEvent.click(ctaBtn);
    await waitFor(() => expect(currentPath).toBe('/stocks'));
  });

  it('shows the Aparat story only in Persian and keeps the non-Persian progress rail aligned', async () => {
    LANG = 'en';
    render(<MemoryRouter><Market /></MemoryRouter>);

    const rail = screen.getByTestId('market-stories-rail');
    expect(screen.queryByTestId('market-story-item-aparat')).toBeNull();
    expect(rail.querySelectorAll('.market-story-Bubble')).toHaveLength(MARKET_STORY_ITEMS.length - 1);

    fireEvent.click(screen.getByTestId('market-story-item-stocks'));
    const popup = await screen.findByTestId('market-story-popup');
    expect(popup.querySelectorAll('.market-story-progress-seg')).toHaveLength(MARKET_STORY_ITEMS.length - 1);
    expect(screen.queryByTestId('story-panel-aparat')).toBeNull();
  });

  it('shares News music queue and keeps radio selected after closing the story', async () => {
    render(<MemoryRouter><Market /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('market-story-item-radio'));
    fireEvent.click(await screen.findByText('Cinematic journey'));
    expect(useRadioStore.getState().track.id).toBe('cinema-test');
    expect(useRadioStore.getState().queue).toHaveLength(1);
    fireEvent.click(screen.getByTestId('story-close-btn'));
    expect(useRadioStore.getState().track.id).toBe('cinema-test');
    expect(screen.queryByTestId('market-story-popup')).toBeNull();
  });

  it('renders the dedicated Aparat educational videos page with https://www.aparat.com/Fbtcompany and interactive courses', async () => {
    expect(APARAT_CHANNEL_URL).toBe('https://www.aparat.com/Fbtcompany');

    render(
      <MemoryRouter initialEntries={['/aparat']}>
        <AparatVideos />
      </MemoryRouter>
    );

    const page = screen.getByTestId('aparat-videos-page');
    expect(page).toBeTruthy();
    expect(document.querySelector('.aparat-audio-cta')).toBeNull();
    expect(page.textContent).toContain('https://www.aparat.com/Fbtcompany');
    expect(page.textContent).toContain('@Fbtcompany');
    expect(screen.getByTestId('aparat-open-channel-btn')).toBeTruthy();
    expect(screen.getByTestId('aparat-interactive-stage')).toBeTruthy();
    expect(screen.getByTestId('aparat-course-stocks')).toBeTruthy();
    expect(screen.getByTestId('aparat-course-swap')).toBeTruthy();
    expect(screen.getByTestId('aparat-course-wallet')).toBeTruthy();

    const stocksPreview = page.querySelector('[data-testid="aparat-course-stocks"] .aparat-course-thumb');
    const walletPreview = page.querySelector('[data-testid="aparat-course-wallet"] .aparat-course-thumb');
    expect(stocksPreview.tagName).toBe('BUTTON');
    expect(stocksPreview.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(walletPreview);
    expect(walletPreview.getAttribute('aria-pressed')).toBe('true');
    expect(page.querySelector('.aparat-stage-title').textContent).toContain('کیف پول');
  });

  /* ══════════════════════════════════════════════════════════════════════
     THE 2026-10 GLASS PASS
     «باکس ارزش کل بازار پشتش یک کره هست که زشته» · «باکس بیت‌کوین در
      پس‌زمینه لوگوی بیت‌کوین زشته، ببرش» · «دکمه swap btc را ببر»
     Each assertion below is one sentence of that request, pinned so a later
     refactor cannot quietly put the sphere or the button back.
     ══════════════════════════════════════════════════════════════════════ */

  it('replaces decorative aurora cards with one compact intelligence surface', () => {
    render(<MemoryRouter><Market /></MemoryRouter>);

    expect(document.querySelectorAll('.market-glass-orb')).toHaveLength(0);
    const overview = screen.getByTestId('market-overview');
    expect(overview.querySelector('.market-glass-aurora')).toBeNull();
    expect(overview.querySelector('.market-glass-bloom--a')).toBeNull();

    const globalCard = screen.getByTestId('market-global-card');
    const dominance = globalCard.querySelector('.mx-dominance');
    expect(dominance).toBeTruthy();
    expect(dominance.querySelector('.is-btc')).toBeTruthy();
    expect(dominance.querySelector('.is-eth')).toBeTruthy();
    expect(globalCard.textContent).toContain(fa.market.btcDominance);
    expect(globalCard.textContent).toContain(fa.market.ethDominance);

    const css = readFileSync('src/styles/market-intelligence.css', 'utf8');
    expect(css).toMatch(/\.mx-overview/);
    expect(css).toMatch(/@keyframes mx-float/);
    expect(css).not.toMatch(/animation:[^;]*filter/);
  });

  it('renders the Bitcoin panel with one identity control, an interactive chart and a 24h range', () => {
    render(<MemoryRouter><Market /></MemoryRouter>);

    const btcCard = screen.getByTestId('market-btc-hero-card');
    expect(btcCard.querySelectorAll('button')).toHaveLength(1);
    expect(btcCard.textContent).not.toMatch(/swap/i);
    expect(btcCard.querySelector('.market-btc-watermark')).toBeNull();
    expect(screen.getByTestId('market-btc-chart')).toBeTruthy();

    const range = screen.getByTestId('market-hero-range');
    expect(range).toBeTruthy();
    expect(range.textContent).toContain(fmtUsd(89500));
    expect(range.textContent).toContain(fmtUsd(93200));
  });

  it('opens the story full-screen, autoplays a cinematic score, and offers no transport control', async () => {
    render(<MemoryRouter><Market /></MemoryRouter>);

    /* Nothing has started before the tap. */
    expect(audioSpy.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('market-story-item-stocks'));
    const popup = await screen.findByTestId('market-story-popup');

    /* «موسیقی خودکار پلی بشه بدون دکمه توقف یا پخش و موسیقی یک فیلم باشد» */
    expect(audioSpy.start).toHaveBeenCalledTimes(1);
    expect(audioSpy.lastMood).toBe('cinema');
    expect(screen.queryByTestId('story-audio-toggle')).toBeNull();
    expect(screen.queryByTestId('story-pause-toggle')).toBeNull();
    /* The play glyph is a non-interactive status cue, never a fake control. */
    expect(popup.querySelectorAll('.market-story-playing-indicator')).toHaveLength(1);
    expect(popup.querySelector('.market-story-playing-indicator').tagName).toBe('SPAN');
    expect(popup.querySelector('.market-story-playing-indicator svg')).toBeTruthy();
    expect(popup.textContent).not.toContain('موسیقی سینمایی در حال پخش');
    expect(popup.textContent).not.toContain('Cinematic score playing');

    /* «صفحه پاپ‌آپ کامل باشد، تمام صفحه» */
    const css = readFileSync('src/styles/market-modern.css', 'utf8');
    expect(css).toMatch(/\.market-story-overlay\s*\{[^}]*padding:\s*0/s);
    expect(css).toMatch(/\.market-story-dialog\.market-glass-surface\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100dvh;[\s\S]*?border-radius:\s*0/);

    /* «دایره‌هایی که بالا قرار می‌گیرد و پر می‌شود، با آیکون و رنگ‌بندی درست» —
       eight circles, one glyph each, the live one carrying its fill as --p. */
    const segs = popup.querySelectorAll('.market-story-progress-seg');
    expect(segs).toHaveLength(8);
    expect(popup.querySelectorAll('.market-story-progress-seg svg')).toHaveLength(8);
    const live = popup.querySelector('.market-story-progress-seg.is-live');
    expect(live).toBeTruthy();
    expect(live.style.getPropertyValue('--p')).not.toBe('');
    expect(live.style.getPropertyValue('--story-accent')).not.toBe('');
    expect(popup.querySelector('.market-story-progress-fill')).toBeTruthy();

    /* «عنوان‌های کامل» — kicker, full title and three fact chips. */
    expect(popup.querySelector('.market-story-head-kicker').textContent.trim().length).toBeGreaterThan(4);
    expect(popup.querySelectorAll('.market-story-fact')).toHaveLength(3);
  });

  it('hands the radio story over to the app player, which keeps running in the background', async () => {
    render(<MemoryRouter><Market /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('market-story-item-radio'));
    await screen.findByTestId('market-story-popup');

    /* The synthesized score is running before a track is chosen… */
    expect(audioSpy.playing).toBe(true);

    fireEvent.click(await screen.findByText('Cinematic journey'));

    /* …and steps aside the instant a real track starts: two sources at once is
       the one thing an audio UI must never do. */
    expect(audioSpy.stop).toHaveBeenCalled();
    expect(audioSpy.playing).toBe(false);

    /* The track and the queue came from getCalm() — the very call the News
       screen's Calm tab makes, through the same five-minute client cache, so
       the two lists cannot disagree. */
    expect(useRadioStore.getState().track.id).toBe('cinema-test');
    expect(useRadioStore.getState().queue).toHaveLength(1);

    /* And the story says so out loud. */
    const popup = screen.getByTestId('market-story-popup');
    expect(popup.textContent).toContain('پس‌زمینه');

    /* Closing the story stops the SCORE, never the radio: RadioDock is mounted
       above the router in App.jsx, so the track survives both the close and
       every navigation after it. */
    fireEvent.click(screen.getByTestId('story-close-btn'));
    expect(screen.queryByTestId('market-story-popup')).toBeNull();
    expect(useRadioStore.getState().track.id).toBe('cinema-test');
    expect(useRadioStore.getState().playing).toBe(false);
  });

  it('does not start a second score when the app radio is already playing', () => {
    useRadioStore.getState().play({ id: 'already', title: 'Already on', audioUrl: '/a.mp3' }, []);
    useRadioStore.getState().setPlaying(true);

    render(<MemoryRouter><Market /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('market-story-item-stocks'));

    expect(audioSpy.start).not.toHaveBeenCalled();
  });

  it('gives every story bubble one modern glyph, a fixed label box and a badge', () => {
    render(<MemoryRouter><Market /></MemoryRouter>);

    const rail = screen.getByTestId('market-stories-rail');
    const bubbles = rail.querySelectorAll('.market-story-Bubble');
    expect(bubbles).toHaveLength(MARKET_STORY_ITEMS.length);

    for (const b of bubbles) {
      /* One glyph, inside the ring, painted from that story's own two accents. */
      expect(b.querySelectorAll('.market-story-ring svg')).toHaveLength(1);
      expect(b.querySelector('.market-story-chip').textContent.trim().length).toBeGreaterThan(0);
      /* A non-empty label: «با عنوان‌های کامل». */
      expect(b.querySelector('.market-story-label').textContent.trim().length).toBeGreaterThan(1);
      /* Both accents are handed to CSS so the ring, chip and glow agree. */
      expect(b.style.getPropertyValue('--story-accent')).not.toBe('');
      expect(b.style.getPropertyValue('--story-accent2')).not.toBe('');
    }

    /* «زیر باکس‌ها اندازه و فاصله درست داشته باشد» — the label is a fixed
       two-line box, so eight labels of different lengths leave the rail with
       one clean baseline instead of a ragged one. */
    const css = readFileSync('src/styles/market-modern.css', 'utf8');
    expect(css).toMatch(/\.market-story-label\s*\{[\s\S]*?min-height:[\s\S]*?-webkit-line-clamp:\s*2/);
  });

  it('ships the stories, market cards and Aparat page with no emoji left in their icons', () => {
    /* Emoji were the "not modern" part of the old rail: they cannot be
       recoloured by an accent token and they render differently per OS. */
    const src = readFileSync('src/components/MarketStories.jsx', 'utf8');
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(src)).toBe(false);
  });
});
