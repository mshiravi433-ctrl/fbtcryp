// @vitest-environment jsdom
/**
 * THE 2026-11-01 REQUESTS, PINNED
 * ---------------------------------------------------------------------------
 * The owner's list, in order, and the one guarantee each item is allowed to
 * regress into:
 *
 *   ۱ · a horizontal drag changes the TAB of this screen, never the PAGE, and
 *       a screen with no tabs does not move at all;
 *   ۲ · the Bitcoin box is not permanently green: its colour, arrow and sign
 *       come from the digits it prints;
 *   ۳ · the market rail does not offer categories that have no tokens;
 *   ۴ · the «مرور» advertisement sells Global Intelligence, with artwork, an
 *       icon set, a route and motion that can be frozen;
 *   ۵ · the limit order's two execution modes are tabs: equal plates, a real
 *       tablist, drawn marks, and copy that fits a phone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';
import { fmtPct, pctTone } from '../src/lib/format.js';
import {
  HIDDEN_SECTORS,
  VISIBLE_SECTORS,
  isHiddenSector,
  MARKET_CATEGORIES
} from '../src/lib/marketSectors.js';

const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', resolvedLanguage: 'fa', direction: () => 'rtl', dir: () => 'rtl', changeLanguage: () => {} } })
}));

import MarketOverview from '../src/components/market/MarketOverview.jsx';
import SmartMoneyBanner from '../src/components/market/SmartMoneyBanner.jsx';

const read = (rel) => readFileSync(rel, 'utf8');
const ordersSrc = read('src/pages/Orders.jsx');
const ordersCss = read('src/styles/orders-modern.css');
const bannerCss = read('src/styles/market-request-fixes.css');
const marketSrc = read('src/pages/Market.jsx');

const BTC = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 92450, change24h: 0.004,
  volume: 3.9e10, mcap: 1.83e12, high24h: 93200, low24h: 89500, sparkline: [89500, 90200, 91400, 92450], rank: 1
};
const GLOBAL = { mcap: 3.15e12, volume: 1.4e11, btcDominance: 56.4, ethDominance: 13.8, coins: 14820, markets: 1124, mcapChange: 2.84 };
const trendOf = (changePct) => ({ points: [1, 2, 3, 4, 5], changePct, days: 7, coins: 60 });

afterEach(cleanup);

const overview = (bitcoin, extra = {}) => render(
  <MemoryRouter>
    <MarketOverview
      global={GLOBAL}
      bitcoin={bitcoin}
      trend={trendOf(2.84)}
      liveAvgChange={2.1}
      loading={false}
      vs="usd"
      onOpenCoin={() => {}}
      {...extra}
    />
  </MemoryRouter>
);

/* ── ۲ · «همیشه سبز نیست» ─────────────────────────────────────────────────── */
describe('۲ · باکس بیت‌کوین: رنگ از رقمِ چاپ‌شده می‌آید', () => {
  it('a move that rounds to zero is neutral, not a green gain', () => {
    overview(BTC);
    const card = screen.getByTestId('market-btc-hero-card');
    expect(card.dataset.dir).toBe('neutral');
    const delta = screen.getByTestId('market-btc-delta');
    expect(delta.dataset.tone).toBe('flat');
    /* no arrow, and no `+` in front of a zero */
    expect(delta.querySelector('.mx-btc-pct svg')).toBeNull();
    expect(delta.querySelector('.mx-btc-pct').textContent).toBe('0.00%');
  });

  it('a visible gain is green with a plus, a visible loss is red with a minus', () => {
    const up = overview({ ...BTC, change24h: 1.24 });
    const gain = screen.getByTestId('market-btc-hero-card');
    const gainPct = screen.getByTestId('market-btc-delta').querySelector('.mx-btc-pct');
    expect(gain.dataset.dir).toBe('up');
    expect(gainPct.textContent).toBe('+1.24%');
    expect(gainPct.querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('market-btc-abs').textContent.startsWith('+')).toBe(true);
    up.unmount();

    overview({ ...BTC, change24h: -1.24 });
    const lossPct = screen.getByTestId('market-btc-delta').querySelector('.mx-btc-pct');
    expect(screen.getByTestId('market-btc-hero-card').dataset.dir).toBe('down');
    expect(lossPct.textContent).toBe('-1.24%');
    expect(lossPct.querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('market-btc-abs').textContent.startsWith('-')).toBe(true);
  });

  it('fmtPct never prints a signed zero, and pctTone agrees with it', () => {
    expect(fmtPct(0, 2)).toBe('0.00%');
    expect(fmtPct(0.004, 2)).toBe('0.00%');
    expect(fmtPct(-0.004, 2)).toBe('0.00%');
    expect(fmtPct(0.006, 2)).toBe('+0.01%');
    expect(fmtPct(-0.006, 2)).toBe('-0.01%');
    expect(pctTone(0.004, 2)).toBe('flat');
    expect(pctTone(0.02, 2)).toBe('up');
    expect(pctTone(-0.02, 2)).toBe('down');
    expect(pctTone(null)).toBeNull();
  });

  it('says when the reading was taken, and says when it is not live', () => {
    const view = overview(BTC, { updatedAt: Date.now() - 5000 });
    const live = screen.getByTestId('market-btc-live');
    expect(live.dataset.state).toBe('live');
    expect(live.textContent).toContain(fa.marketIntel.btcLive);
    view.unmount();

    overview({ ...BTC, offline: true }, { updatedAt: Date.now() });
    const stale = screen.getByTestId('market-btc-live');
    expect(stale.dataset.state).toBe('stale');
    expect(stale.textContent).toContain(fa.marketGlobalAd.unavailable);
    expect(stale.textContent).not.toContain(fa.marketIntel.btcLive);
  });

  it('declares the neutral tone once, in the layer that wins', () => {
    expect(bannerCss).toMatch(/\.mx-market \.mx-btc-card\[data-dir='neutral'\] \{[^}]*--btc-tone: var\(--mx-muted\)/s);
    expect(bannerCss).toMatch(/\.mx-market \.mx-btc-pct\[data-dir='none'\]/);
  });
});

/* ── ۳ · دسته‌های بدون توکن ───────────────────────────────────────────────── */
describe('۳ · دسته‌بندی‌های سید، تحت نظر و لانچ‌پد حذف شده‌اند', () => {
  it('keeps exactly those three out of the rail, and every other category in', () => {
    expect([...HIDDEN_SECTORS]).toEqual(['seed', 'monitoring', 'launchpad']);
    for (const hidden of HIDDEN_SECTORS) {
      expect(isHiddenSector(hidden)).toBe(true);
      expect(VISIBLE_SECTORS).not.toContain(hidden);
      /* the provider model still knows the slug: only the SCREEN hides it */
      expect(MARKET_CATEGORIES[hidden]).toBeTruthy();
    }
    expect(VISIBLE_SECTORS).toContain('gold');
    expect(VISIBLE_SECTORS).toContain('ai');
    expect(VISIBLE_SECTORS).toHaveLength(Object.keys(MARKET_CATEGORIES).length - 3);
  });

  it('the market page reads the shared list instead of filtering its own copy', () => {
    expect(marketSrc).toContain('const SECTORS = VISIBLE_SECTORS;');
    expect(marketSrc).not.toMatch(/\['seed', 'monitoring', 'launchpad'\]\.includes/);
  });
});

/* ── ۴ · تبلیغ هوش جهانی ──────────────────────────────────────────────────── */
describe('۴ · بنر «هوش جهانی»: عکس، آیکون، جمله و انیمیشن', () => {
  const mount = () => render(<MemoryRouter><SmartMoneyBanner /></MemoryRouter>);

  it('sells Global Intelligence and links to /global', () => {
    mount();
    const banner = screen.getByTestId('market-smart-money-banner');
    expect(banner.textContent).toContain(fa.marketGlobalAd.eyebrow);
    expect(banner.textContent).toContain(fa.marketGlobalAd.title);
    expect(banner.textContent).toContain(fa.marketGlobalAd.desc);
    expect(banner.textContent).toContain(fa.marketGlobalAd.cta);
    expect(banner.querySelector('a').getAttribute('href')).toBe('/global');
    /* the old Smart Money headline is no longer what this box advertises */
    expect(banner.textContent).not.toContain(fa.marketIntel.smartTitle);
  });

  it('carries the local artwork, three drawn capability chips and the route', () => {
    mount();
    const banner = screen.getByTestId('market-smart-money-banner');
    const img = banner.querySelector('.mx-global-art img');
    expect(img.getAttribute('src')).toBe('/images/market-banner/globe.webp');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(banner.querySelector('.mx-smart-mark svg')).toBeTruthy();
    expect([...banner.querySelectorAll('.mx-pool svg')]).toHaveLength(3);
    expect(banner.querySelector('.mx-smart-route').querySelectorAll('.mx-route-node')).toHaveLength(3);
    /* two orbit rings and three satellites: motion with something to move */
    expect(banner.querySelectorAll('.mx-global-orbit')).toHaveLength(2);
    expect(banner.querySelectorAll('.mx-global-sat')).toHaveLength(3);
  });

  it('invents no number, so it cannot disagree with the feed', () => {
    mount();
    expect(screen.getByTestId('market-smart-money-banner').textContent).not.toMatch(/\d+([.,]\d+)?\s?%/);
  });

  it('animates transform and opacity only, and every loop can be frozen', () => {
    const block = bannerCss.slice(bannerCss.indexOf('THE MARKET SCREEN'));
    expect(block).not.toMatch(/backdrop-filter/);
    for (const name of ['mx-global-float', 'mx-global-tilt', 'mx-global-sat']) {
      const frames = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`, 'g');
      const found = [...block.matchAll(frames)].map((m) => m[1]).join('\n');
      expect(found, name).toBeTruthy();
      expect(found, name).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding|filter|box-shadow)\s*:/);
    }
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
    expect(block).toMatch(/:root\[data-native='true'\][\s\S]*animation: none/);
    expect(block).toMatch(/:root\[data-lite='true'\][\s\S]*animation: none/);
    /* The lite guard must key on `data-theme`, exactly like market-perf.css:
       without a theme the attribute is never written, and a bare
       `:root:not([data-motion='full'])` would freeze the banner for everyone. */
    expect(block).toMatch(/:root\[data-theme\]:not\(\[data-motion='full'\]\) \.mx-market \.mx-global-banner/);
    expect(block).not.toMatch(/^:root:not\(\[data-motion/m);
    /* no SMIL: CSS is the only thing that can be stopped */
    expect(read('src/components/market/SmartMoneyBanner.jsx')).not.toMatch(/<animate/);
  });
});

/* ── ۵ · دو تبِ سفارش محدود ───────────────────────────────────────────────── */
describe('۵ · سفارش محدود: دو تبِ اجرای خودکار و رصد قیمت', () => {
  it('is a real tablist with roving focus, not two loose buttons', () => {
    expect(ordersSrc).toContain('role="tablist"');
    expect(ordersSrc).toMatch(/data-exec="keeper"/);
    expect(ordersSrc).toMatch(/data-exec="watch"/);
    expect(ordersSrc).toMatch(/aria-selected=\{mode === 'keeper'\}/);
    expect(ordersSrc).toMatch(/tabIndex=\{mode === 'keeper' \? 0 : -1\}/);
    expect(ordersSrc).toMatch(/aria-selected=\{mode === 'watch'\}/);
    expect(ordersSrc).toMatch(/tabIndex=\{mode === 'watch' \? 0 : -1\}/);
    expect(ordersSrc).toContain("['ArrowRight', 'ArrowLeft', 'Home', 'End']");
  });

  it('draws its two marks instead of typing a glyph', () => {
    const control = ordersSrc.slice(ordersSrc.indexOf('className="ord-mode"'), ordersSrc.indexOf('AUTOPILOT, ABOVE'));
    /* The only two marks in the control are the two <svg> elements — and the
       comment above them is stripped before the check, because it quotes the
       glyphs it replaced in order to explain why they are gone. */
    const markup = control.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(markup).not.toMatch(/[⚡◎★☆✦✧]/);
    expect(markup.match(/<svg /g)).toHaveLength(2);
  });

  it('gives both plates the same height, spacing and a 44px target', () => {
    const plate = /\.ord-mode \.ord-exec-option \{([\s\S]*?)\n\}/.exec(ordersCss)[1];
    expect(plate).toMatch(/grid-template-rows: auto auto/);
    expect(plate).toMatch(/min-height: 84px/);
    expect(plate).toMatch(/gap: 8px/);
    expect(plate).toMatch(/padding: 13px 12px/);
    /* the two columns are equal, so neither plate can win by content */
    expect(ordersCss).toMatch(/\.ord-mode \.ord-execution-tabs \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    /* one thumb, moved by a transform — no second element to keep in sync */
    expect(ordersCss).toMatch(/\.ord-mode\[data-mode='watch'\] \.ord-exec-thumb \{\s*transform: translateX/);
    /* and a light theme that is re-graded, not inverted */
    expect(ordersCss).toMatch(/:root\[data-theme='light'\] \.ord-mode \{/);
  });
});
