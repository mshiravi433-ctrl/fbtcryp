// @vitest-environment jsdom
/**
 * MARKET GLASS V3 — the Bitcoin box, the showcase centre line, the hot board,
 * the Smart Money beam, the search field and the token rows.
 *
 * Rendering checks run the real components. Style checks read the new layer
 * as text, because the market's motion and material rules are about the
 * declarations themselves (no blur, no mask, transform/opacity loops only).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';
import { trendingUsdQuote } from '../server/providers.js';

const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', resolvedLanguage: 'fa', changeLanguage: () => {} } })
}));

import MarketOverview from '../src/components/market/MarketOverview.jsx';
import HotCoins from '../src/components/market/HotCoins.jsx';
import SmartMoneyBanner from '../src/components/market/SmartMoneyBanner.jsx';

const css = readFileSync('src/styles/market-glass-v3.css', 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const pageSrc = readFileSync('src/pages/Market.jsx', 'utf8');

const BTC = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 92450, change24h: 2.41,
  volume: 3.9e10, mcap: 1.83e12, high24h: 93200, low24h: 89500, sparkline: [89500, 90200, 91400, 92450], rank: 1
};
const GLOBAL = { mcap: 3.15e12, volume: 1.4e11, btcDominance: 56.4, ethDominance: 13.8, coins: 14820, markets: 1124, mcapChange: 2.84 };
const trendOf = (changePct) => ({ points: [1, 2, 3, 4, 5], changePct, days: 7, coins: 60 });

afterEach(cleanup);

const overview = (bitcoin, changePct = 2.84) => render(
  <MemoryRouter>
    <MarketOverview global={GLOBAL} bitcoin={bitcoin} trend={trendOf(changePct)} liveAvgChange={2.1} loading={false} vs="usd" onOpenCoin={() => {}} />
  </MemoryRouter>
);

/* ── 1 · BITCOIN: the move in % and in money, in the tone of its direction ── */
describe('۱ · باکس بیت‌کوین اعداد و درصد سود را با رنگ جهت نشان می‌دهد', () => {
  it('is green and shows a positive percentage and a plus-signed amount', () => {
    overview(BTC);
    const card = screen.getByTestId('market-btc-hero-card');
    expect(card.dataset.dir).toBe('up');
    const delta = screen.getByTestId('market-btc-delta');
    expect(delta.dataset.dir).toBe('up');
    expect(delta.querySelector('.mx-btc-pct').textContent).toContain('+2.41%');
    /* 92450 − 92450/1.0241 ≈ 2,177 — the money move is derived, not invented */
    const abs = screen.getByTestId('market-btc-abs').textContent;
    expect(abs.startsWith('+')).toBe(true);
    expect(abs).toMatch(/2,1[67]\d/);
  });

  it('is red and shows a negative percentage and a minus-signed amount', () => {
    overview({ ...BTC, change24h: -1.82 });
    const card = screen.getByTestId('market-btc-hero-card');
    expect(card.dataset.dir).toBe('down');
    expect(screen.getByTestId('market-btc-delta').querySelector('.mx-btc-pct').textContent).toContain('-1.82%');
    expect(screen.getByTestId('market-btc-abs').textContent.startsWith('-')).toBe(true);
    expect(screen.getByTestId('market-btc-delta').querySelector('.mx-btc-pct svg')).toBeTruthy();
  });

  it('prints a dash, and no tone, when the feed has no move', () => {
    overview({ ...BTC, change24h: null });
    const card = screen.getByTestId('market-btc-hero-card');
    expect(card.hasAttribute('data-dir')).toBe(false);
    expect(screen.getByTestId('market-btc-abs').textContent).toBe('—');
    expect(screen.getByTestId('market-btc-delta').textContent).not.toMatch(/\d+\.\d+%/);
  });

  it('shows the 24h volume and the market cap from the same feed row', () => {
    overview(BTC);
    const stats = screen.getByTestId('market-btc-stats');
    const values = [...stats.querySelectorAll('dd')].map((dd) => dd.textContent);
    expect(values).toEqual(['$39.00B', '$1.83T']);
    expect(stats.querySelectorAll('dt')).toHaveLength(2);
  });

  it('tints the whole card, its rim and its chart by direction', () => {
    expect(bare).toMatch(/\.mx-market \.mx-btc-card\[data-dir='up'\] \{[^}]*--btc-tone: var\(--gv-pos\)/s);
    expect(bare).toMatch(/\.mx-market \.mx-btc-card\[data-dir='down'\] \{[^}]*--btc-tone: var\(--gv-neg\)/s);
    expect(bare).toMatch(/\.mx-market \.mx-btc-card \.mx-spark-line,[\s\S]*?stroke: var\(--btc-tone\)/);
    /* the light theme's own card rule outranks the dark one: repeat the tone there */
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-btc-card\[data-dir='up'\] \{[^}]*--mx-btc-rim-a/s);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-btc-card\[data-dir='down'\] \{[^}]*--mx-btc-rim-a/s);
    expect(bare).toMatch(/--gv-pos: #3cf3a6/);
    expect(bare).toMatch(/--gv-neg: #ff5c7c/);
  });
});

/* ── 2 · THE SHOWCASE: a centre line in the sign and weight of the move ───── */
describe('۲ · ویترین بازار: خط وسط با جهت و شدت حرکت، و حرکت مارپیچی', () => {
  it('colours the centre line by sign and weighs it by the size of the move', () => {
    const { unmount } = overview(BTC, 2.84);
    const up = screen.getByTestId('market-trend-mid');
    expect(up.dataset.dir).toBe('up');
    expect(Number(up.style.getPropertyValue('--mx-mid-strength'))).toBeCloseTo(0.95, 2);
    expect(screen.getByTestId('market-trend-plot').dataset.dir).toBe('up');
    unmount();

    overview(BTC, -0.4);
    const down = screen.getByTestId('market-trend-mid');
    expect(down.dataset.dir).toBe('down');
    /* a small move is faint, never zero: the line stays visible */
    expect(Number(down.style.getPropertyValue('--mx-mid-strength'))).toBe(0.25);
  });

  it('draws a double helix over the line, decorative and out of the reading order', () => {
    overview(BTC);
    const field = document.querySelector('.mx-helix-field');
    expect(field.getAttribute('aria-hidden')).toBe('true');
    const strands = field.querySelectorAll('.mx-helix-strand');
    expect(strands).toHaveLength(2);
    expect(strands[0].getAttribute('d')).toMatch(/^M0 /);
  });

  it('moves the helix and the centre line with transform only', () => {
    expect(bare).toMatch(/\.mx-helix-scroll \{[^}]*animation: gv-helix-scroll 9s linear infinite/s);
    expect(bare).toMatch(/\.mx-trend-mid::after \{[^}]*animation: gv-mid-breathe/s);
    expect(bare).toMatch(/@keyframes gv-helix-scroll \{\s*from \{ transform: translate3d\(0, 0, 0\); \}\s*to \{ transform: translate3d\(-50%, 0, 0\); \}/);
  });
});

/* ── 3 · HOT COINS: the feed's numbers, never a made-up zero ──────────────── */
describe('۳ · داغ‌ترین‌ها داده‌ی درست نشان می‌دهد', () => {
  const card = (over) => ({
    id: 'pepe', symbol: 'PEPE', name: 'Pepe', image: '', place: 1, price: 0.000012,
    change24h: 4.2, volume: 1e9, sparkline: [1, 2, 3], ...over
  });

  it('prints the move with its sign and direction when it is measured', () => {
    render(<HotCoins coins={[card({})]} onOpen={() => {}} vs="usd" />);
    const el = document.querySelector('.mx-hot-card');
    expect(el.dataset.dir).toBe('up');
    expect(el.querySelector('.mx-change').textContent).toContain('+4.2%');
  });

  it('prints no chip and no tone when the move is missing, not 0.00%', () => {
    render(<HotCoins coins={[card({ change24h: null, price: null, sparkline: null })]} onOpen={() => {}} vs="usd" />);
    const el = document.querySelector('.mx-hot-card');
    expect(el.hasAttribute('data-dir')).toBe(false);
    expect(el.querySelector('.mx-change')).toBeNull();
    expect(el.textContent).not.toMatch(/0\.0+%/);
    expect(el.querySelector('.mx-hot-price').textContent).toBe('—');
  });

  it('is smaller than the 190px card it replaces', () => {
    expect(bare).toMatch(/\.mx-market \.mx-hot-card \{[^}]*flex: 0 0 136px/s);
    expect(bare).not.toMatch(/flex: 0 0 190px/);
  });

  it('reads a USD quote from the trending feed only when that quote exists', () => {
    expect(trendingUsdQuote({ data: { price: 0.5, price_change_percentage_24h: { usd: -3.1 } } }))
      .toEqual({ price: 0.5, change24h: -3.1 });
    expect(trendingUsdQuote({ data: {} })).toEqual({ price: null, change24h: null });
    expect(trendingUsdQuote({ data: { price: 0, price_change_percentage_24h: {} } }))
      .toEqual({ price: null, change24h: null });
    expect(trendingUsdQuote(undefined)).toEqual({ price: null, change24h: null });
  });

  it('keeps the page from turning a null change into zero', () => {
    expect(pageSrc).toMatch(/change24h: finiteOrNull\(live\?\.change24h\) \?\? finiteOrNull\(quote\?\.change24h\)/);
    expect(pageSrc).not.toMatch(/const change = Number\(live\?\.change24h\)/);
  });
});

/* ── 4 · SMART MONEY: the beam, the radar and three lanes ─────────────────── */
describe('۴ · بنر پول هوشمند', () => {
  it('keeps its existing contract and adds the new layers', () => {
    render(<MemoryRouter><SmartMoneyBanner /></MemoryRouter>);
    const blade = screen.getByTestId('market-smart-money-banner');
    expect(blade.querySelectorAll('.mx-route-node')).toHaveLength(3);
    expect(blade.querySelectorAll('.mx-pool')).toHaveLength(3);
    expect(blade.querySelectorAll('.mx-route-traveller')).toHaveLength(3);
    expect(blade.querySelector('.mx-smart-radar')).toBeTruthy();
    expect(blade.querySelectorAll('.mx-smart-ring')).toHaveLength(2);
    expect(blade.textContent).not.toMatch(/\d+%/);
  });

  it('runs a rotating beam on the rim and paints the four-colour palette', () => {
    expect(bare).toMatch(/\.mx-market \.mx-smart-banner::before \{[^}]*animation: gv-beam-spin 12s/s);
    expect(bare).toMatch(/\.mx-market \.mx-smart-banner::after \{[^}]*inset: 1\.5px/s);
    expect(bare).toMatch(/--gv-smart-a: #5dffc8/);
    expect(bare).toMatch(/--gv-smart-c: #ff7bd8/);
  });

  it('gives each lane its own speed so the three never move in step', () => {
    const durations = [...bare.matchAll(/\.mx-route-traveller(?:\.is-\d)?\s*\{[^}]*?animation:[^;]*?(\d+\.?\d*)s/gs)].map((m) => m[1]);
    expect(new Set(durations).size).toBeGreaterThanOrEqual(2);
    expect(bare).toMatch(/\.mx-route-traveller\.is-2 \{[^}]*mx-flow-travel 4\.6s/s);
    expect(bare).toMatch(/\.mx-route-traveller\.is-3 \{[^}]*mx-flow-travel 7\.4s/s);
  });
});

/* ── 5 · SEARCH: a glass field with a painted rim ─────────────────────────── */
describe('۵ · باکس جستجو', () => {
  it('paints the rim in the four accents and the field in glass', () => {
    expect(bare).toMatch(/\.mx-market \.mx-search \{[^}]*padding-box[^}]*border-box/s);
    expect(bare).toMatch(/\.mx-market \.mx-search:focus-within \{[^}]*0 0 34px/s);
  });

  it('wears a glass tile around its search icon', () => {
    expect(pageSrc).toBeTruthy();
    const search = readFileSync('src/components/market/MarketSearch.jsx', 'utf8');
    expect(search).toContain('mx-search-tile');
    expect(bare).toMatch(/\.mx-market \.mx-search-tile \{/);
  });
});

/* ── 6 · TOKEN ROWS: more glass, and the page shows through them ───────────── */
describe('۶ · باکس توکن‌ها شفاف‌تر', () => {
  it('replaces the opaque panel of each row with translucent glass', () => {
    const rule = bare.match(/\.mx-market \.mx-coin-row > \.coin-row \{([^}]*)\}/s);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/rgba\(255, 255, 255, \.075\)/);
    expect(rule[1]).not.toMatch(/var\(--mx-panel\)/);
  });
});

/* ── 7 · MATERIAL AND MOTION RULES FOR THE NEW LAYER ──────────────────────── */
describe('material and motion rules', () => {
  it('ships no blur, no mask and no will-change', () => {
    expect(bare).not.toMatch(/backdrop-filter/);
    expect(bare).not.toMatch(/-webkit-backdrop-filter/);
    expect(bare).not.toMatch(/mask(-image|-composite)?:/);
    expect(bare).not.toMatch(/will-change/);
  });

  it('animates transform and opacity only, in every keyframe it ships', () => {
    const frames = [];
    for (const m of bare.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < bare.length && depth > 0) {
        if (bare[i] === '{') depth += 1;
        else if (bare[i] === '}') depth -= 1;
        i += 1;
      }
      frames.push([m[1], bare.slice(start, i - 1)]);
    }
    expect(frames.length).toBeGreaterThanOrEqual(6);
    for (const [name, body] of frames) {
      const props = new Set([...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((x) => x[1]));
      const illegal = [...props].filter((p) => !['transform', 'opacity'].includes(p));
      expect(illegal, `${name} animates ${illegal.join(', ')}`).toEqual([]);
    }
  });

  it('parks every loop it adds for reduced motion, native and lite', () => {
    const guard = bare.slice(bare.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const selector of ['.mx-helix-scroll', '.mx-smart-banner::before', '.mx-smart-radar', '.mx-trend-mid::after']) {
      expect(guard, selector).toContain(selector);
    }
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-helix-scroll/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market \.mx-helix-field \{ display: none; \}/);
  });

  it('is loaded by the market page after the two layers it finishes', () => {
    const modern = pageSrc.indexOf("import '../styles/market-modern.css'");
    const intel = pageSrc.indexOf("import '../styles/market-intelligence.css'");
    const glass = pageSrc.indexOf("import '../styles/market-glass-v3.css'");
    expect(modern).toBeGreaterThan(-1);
    expect(glass).toBeGreaterThan(intel);
    expect(intel).toBeGreaterThan(modern);
  });

  it('has its strings in both locales, and the new keys exist in each', () => {
    for (const key of ['marketIntel.btcMcap', 'marketIntel.btcPeriod']) {
      expect(get(fa, key), `fa.${key}`).toBeTruthy();
      expect(get(en, key), `en.${key}`).toBeTruthy();
    }
  });
});
