// @vitest-environment jsdom
/**
 * THE OPPORTUNITY ROOM NEVER TAKES THE ROUTE DOWN
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «در موتور فرصت هوش مصنوعی وقتی میزنی روش میگه صفحه به مشکل خورد و دوباره
 *    تلاش کنید»
 *
 * The engine room was dying on `RouteBoundary` — «این صفحه به مشکل خورد» — and
 * the cause was ONE FIELD of ONE feed row:
 *
 *     Error: Objects are not valid as a React child
 *            (found: object with keys {name})          ← {o.chain}
 *
 * A `.map()` over cards has no boundary between a bad row and the route, so a
 * single malformed `chain` (the yield feed emits `{ name, id }` for adapters
 * that grow a chain registry, `url` as an object, `symbol` as a number, `apy`
 * as `'7.4%'`) blanked every good card with it.
 *
 * ─── WHAT THESE TESTS LOCK ──────────────────────────────────────────────────
 *   1. the pure sanitiser: objects become their own label or null, never a
 *      crash and never `[object Object]`; only absolute http(s) may be a tap
 *      target;
 *   2. the ENGINE: a scan built from hostile rows carries no drawable field
 *      that is not a string, and `'7.4%'` still prices as 7.4 (the fix must not
 *      turn a real row into a null);
 *   3. the WHOLE APP, in jsdom, against a hostile yield feed — the real route,
 *      the real card, the real store: it must render the engine room, not the
 *      crash card. This is the assertion that would have caught the report.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import {
  text, httpUrl, sanitizeOpportunityRow, sanitizeScan
} from '../src/lib/opportunity/sanitize.js';
import { scanOpportunities } from '../src/lib/brain/opportunityEngine.js';

const isDrawable = (v) => v === null || v === undefined || typeof v === 'string';

describe('sanitizer: what may be drawn', () => {
  it('turns a self-naming object into its name, and a nameless one into null', () => {
    expect(text({ name: 'Base' })).toBe('Base');
    expect(text({ symbol: 'USDC' })).toBe('USDC');
    expect(text({ 0: 'x' })).toBeNull();
    expect(text([{ name: 'Base' }, 'Ethereum'])).toBe('Base · Ethereum');
    expect(text(7)).toBe('7');
    expect(text('')).toBe(null);
    expect(text(null)).toBe(null);
    /* The one output that must never exist: a stringified object. */
    expect(text({ nested: { deep: true } })).toBeNull();
  });

  it('allows only absolute http(s) as a tap target', () => {
    expect(httpUrl('https://defillama.com/yields/pool/x')).toBe('https://defillama.com/yields/pool/x');
    expect(httpUrl('javascript:alert(1)')).toBe(null);
    expect(httpUrl('/relative/path')).toBe(null);
    expect(httpUrl({ href: 'https://x' })).toBe(null);
  });

  it('sanitises a row so every drawn field is text', () => {
    const row = sanitizeOpportunityRow({
      opportunityId: 'o1',
      title: { name: 'T' },
      symbol: 42,
      chain: { name: 'Base' },
      protocol: ['aave', 'v3'],
      category: 'LENDING',
      evidence: [{ type: { x: 1 }, detail: { name: 'flow' } }],
      exclusionReasons: [{ code: 'risk-above-tolerance', riskScore: 7 }, null, 'junk'],
      ref: { tokenId: 'usd-coin', poolId: { id: 'p' }, venue: 5, externalUrl: 'javascript:x' }
    });
    for (const k of ['title', 'symbol', 'chain', 'protocol']) expect(isDrawable(row[k]), k).toBe(true);
    expect(row.chain).toBe('Base');
    expect(row.symbol).toBe('42');
    expect(row.ref.externalUrl).toBe(null);
    expect(row.ref.venue).toBe('5');
    expect(row.evidence[0].detail).toBe('flow');
    expect(row.exclusionReasons).toHaveLength(1);
  });

  it('drops the shapes a cached scan can hold after a bad write', () => {
    const scan = sanitizeScan({
      opportunities: 'nope', rejected: {}, scanner: 5, coverage: { a: 1 }, feeds: []
    });
    expect(scan.opportunities).toEqual([]);
    expect(scan.rejected).toEqual([]);
    expect(scan.scanner).toEqual([]);
    expect(scan.coverage).toEqual([]);
    expect(scan.feeds).toBe(null);
    expect(sanitizeScan(null)).toBe(null);
  });
});

describe('engine: hostile feed rows', () => {
  it('builds rows whose drawn fields are all strings, without losing the numbers', () => {
    const scan = scanOpportunities({
      now: 1_760_000_000_000, userCapitalUsd: 1000, riskProfile: 'MODERATE', horizonDays: 30, limit: 20,
      liquidityPools: [{
        id: { x: 1 }, project: { name: 'uniswap-v3' }, symbol: 42, chain: { name: 'Base' },
        apy: '12%', tvlUsd: '1,000,000', exposure: 'multi', url: { href: 'https://evil' }
      }],
      farms: [{ id: 'f1', project: { label: 'lido' }, symbol: 7, chain: ['Base', 'Ethereum'], apy: '3.1%', tvlUsd: 2e7, url: 42 }],
      lendingMarkets: [{ id: 'l1', project: 'aave-v3', asset: { symbol: 'USDC' }, supplyApy: '7.4%', tvlUsd: 1e7, url: 'javascript:alert(1)' }],
      emergingTokens: [{ symbol: { sym: 'X' }, chain: {}, ageDays: '2', change24h: '5' }],
      whaleFlows: [{ asset: { name: 'ETH' }, chain: 'Base', netFlowUsd: '3000000', walletCount: '5', confidence: '82' }],
      rwaAssets: [{ name: { x: 1 }, symbol: 3, priceUsd: '2.5' }]
    });
    const rows = [...scan.opportunities, ...scan.rejected];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      for (const k of ['title', 'symbol', 'chain', 'protocol', 'type', 'direction']) {
        expect(isDrawable(r[k]), `${k} of ${r.opportunityId}`).toBe(true);
      }
      for (const e of r.evidence) {
        expect(typeof e.detail).toBe('string');
        expect(typeof e.type).toBe('string');
      }
      if (r.ref) for (const v of Object.values(r.ref)) expect(isDrawable(v)).toBe(true);
    }
    /* A percent sign is formatting, not information: stripping it must keep the
       rate, not quietly null it out. */
    const lending = rows.find((r) => /7\.4%/.test(String(r.title)));
    expect(lending?.metrics?.grossApyPct).toBe(7.4);
    const pool = rows.find((r) => /12%/.test(String(r.title)));
    expect(pool?.metrics?.grossApyPct).toBe(12);
    /* An unsafe URL never becomes a tap target. */
    for (const r of rows) {
      if (r.ref?.externalUrl) expect(r.ref.externalUrl).toMatch(/^https?:\/\//);
    }
  });
});

/* ─── THE WHOLE APP, WITH A HOSTILE FEED ─────────────────────────────────── */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/webEntry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  seoEntryHandoff: false
}));
vi.mock('../src/lib/wc/verify.js', () => ({ measureVerifyEnclave: () => {}, warmVerifyEnclave: () => {} }));

const jsonRes = (v) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => v, text: async () => JSON.stringify(v)
});

let mode = 'hostile';

globalThis.fetch = vi.fn(async (url) => {
  const u = String(url);
  const at = Date.now();
  if (u.includes('/yields/history')) return jsonRes({ pool: 'u1', range: '30d', points: [] });
  if (u.includes('/yields')) {
    if (mode === 'hostile') {
      return jsonRes({
        at,
        pools: [
          { id: 'u1', project: { name: 'uniswap-v3' }, symbol: 'ETH-USDC', chain: { name: 'Base' }, apy: '12%', tvlUsd: '1,000,000', exposure: 'multi', url: { href: 'https://evil.example' } },
          { id: 'u2', project: 'aave-v3', symbol: 7, chain: ['Base'], apy: '7.4%', tvlUsd: 1e7 },
          { apy: '5%', chain: 42 },
          { id: 'u4', project: null, symbol: null, chain: null, apy: null }
        ],
        venues: [{ id: { x: 1 }, venue: 5 }]
      });
    }
    if (mode === 'wrong-root') return jsonRes([{ apy: 5 }]);
    if (mode === 'nulls') return jsonRes({ at, pools: [null, 1, 'x', []], venues: null });
    return jsonRes({ at, pools: [], venues: [] });
  }
  if (u.includes('/early-tokens')) {
    return jsonRes({ at, dataStatus: 'live', tokens: [{ symbol: { n: 'X' }, chain: {}, ageHours: 'x', liquidityUsd: 'y' }, null] });
  }
  if (u.includes('/markets')) {
    return jsonRes([
      { id: 'usd-coin', symbol: 'USDC', price: '1.00', dataProvenance: 'live' },
      { id: 'ethereum', symbol: 'ETH', price: 3000, dataProvenance: 'live' },
      null
    ]);
  }
  return jsonRes({ dataStatus: 'insufficient-evidence', indexedAt: at, consensus: [] });
});

async function mountApp(hash) {
  window.location.hash = hash;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const App = (await import('../src/App.jsx')).default;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const errors = [];
  const realError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  try {
    await act(async () => { root.render(React.createElement(App)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 3000)); });
  } finally {
    console.error = realError;
  }
  const body = document.body.textContent || '';
  const state = {
    crash: /این صفحه به مشکل خورد|خطای غیرمنتظره|ran into a problem/.test(body),
    page: Boolean(document.querySelector('[data-testid="opportunities-page"]')),
    cards: document.querySelectorAll('[data-testid="opportunity-card"]').length,
    body,
    childErrors: errors.filter((e) => /not valid as a React child/.test(e))
  };
  await act(async () => { root.unmount(); });
  el.remove();
  return state;
}

describe('the engine room survives what the feeds actually send', () => {
  beforeAll(async () => {
    const { useSettingsStore } = await import('../src/store/useSettingsStore.js');
    useSettingsStore.setState({ onboarded: true, guideReadAt: Date.now(), biometricEnabled: false, twoFactorEnabled: false });
    if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  });

  for (const m of ['hostile', 'wrong-root', 'nulls']) {
    it(`renders /opportunities, not the crash card, when the yield feed is "${m}"`, async () => {
      mode = m;
      localStorage.clear();
      document.body.innerHTML = '';
      const state = await mountApp('#/opportunities');
      expect(state.childErrors).toEqual([]);
      expect(state.crash).toBe(false);
      expect(state.page).toBe(true);
      if (m === 'hostile') expect(state.cards).toBeGreaterThan(0);
    }, 40000);
  }

  it('renders a deep link whose stored row was written by an older build', async () => {
    mode = 'hostile';
    localStorage.setItem('fbt.opportunity.scan.v1', JSON.stringify({
      schema: 'fbt.opportunity-scan.v1',
      savedAt: Date.now(),
      capitalUsd: 0,
      opportunities: [{
        opportunityId: 'opp_old', category: 'LIQUIDITY_POOL',
        title: { name: 'old shape' }, chain: { name: 'Base' }, symbol: 42,
        metrics: {}, economics: null, evidence: [{ type: {}, detail: { x: 1 } }],
        ref: { poolId: 'u1', externalUrl: { href: 'x' } }
      }],
      rejected: {}, scanner: 'nope', coverage: {}, feeds: []
    }));
    document.body.innerHTML = '';
    const state = await mountApp('#/opportunities/opp_old');
    expect(state.childErrors).toEqual([]);
    expect(state.crash).toBe(false);
    expect(state.body).toMatch(/Opportunity engine|موتور فرصت/);
  }, 40000);
});
