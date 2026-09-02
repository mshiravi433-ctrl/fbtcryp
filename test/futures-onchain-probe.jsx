/**
 * THE FUTURES PAGE, DRIVEN THROUGH THE ON-CHAIN (Velocity · Solana) TAB.
 * ---------------------------------------------------------------------------
 * Product rule for this tab:
 *   · Velocity (Solana, the Drift fork; provider id `drift`) is the ONLY
 *     on-chain venue shown — there is no protocol comparison list, and Ostium
 *     (Arbitrum) belongs to the Stocks tab.
 *   · Markets, prices, funding and OI are live reads from the BFF, which
 *     proxies Velocity's public Data API (data.velocity.exchange).
 *   · The Solana order path is NOT built (the browser SDK still targets the
 *     paused Drift program, not Velocity's), so the venue is READ_ONLY: the
 *     market info and the FBT fee breakdown render from the backend's numbers,
 *     but the action is "View only" and no /prepare, /verify or wallet
 *     signature can ever happen.
 *   · When the Velocity feed is down the registry says UNAVAILABLE, the tab
 *     says so and invents nothing.
 *
 * The probe mounts the REAL /perp page (Perp.jsx → FuturesOnchain.jsx →
 * futuresClient.js) with the BFF stubbed at the network boundary — exactly the
 * envelopes the Velocity adapter/router produce — and drives the UI through it.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes } from 'react-router-dom';
import i18n, { setLanguage } from '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Perp from '../src/pages/Perp.jsx';
import { computeFeeBreakdown, assessFuturesRisk, selectVenue, PROVIDER_CATALOGUE } from '../src/lib/futures-engine/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = null; // Solana — the tab never asks for an EVM chain switch

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

/* ── the BFF, as the Velocity router/adapter would answer it ─────────────── */
const MARKET = {
  marketId: '0', pairId: '0', symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', category: 'crypto',
  maxLeverage: 20, overnightMaxLeverage: null,
  openFeeBps: 4, makerFeeBps: -0.25, openInterestLongUsd: null, openInterestShortUsd: null,
  openInterestUsd: 42_000_000, maxOpenInterestUsd: null,
  fundingAprPct: 8.4, rolloverAprPct: null, bid: 148.92, mid: 149.05, ask: 149.18, spreadBps: 17.4,
  isMarketOpen: true, isDayTradingClosed: false, priceAt: Date.now()
};
const BTC = { ...MARKET, marketId: '1', pairId: '1', symbol: 'BTC/USDT', base: 'BTC', openInterestUsd: 180_000_000, fundingAprPct: 11.2, bid: 67_940, mid: 68_000, ask: 68_060, spreadBps: 17.6 };

function provider(status, extra = {}) {
  const p = PROVIDER_CATALOGUE.drift;
  return {
    providerId: 'drift', name: p.name, status, reason: extra.reason ?? 'NOT_CONFIGURED',
    executable: false, // the Solana order path is not built — never executable
    execution: 'NOT_BUILT', configured: true, family: 'solana', chainId: 'solana:mainnet', chainName: 'Solana',
    custody: 'onchain', collateral: 'USDT', markets: p.markets,
    marketCount: status === 'UNAVAILABLE' ? 0 : 2, capabilities: p.capabilities,
    fbtFeeModel: p.fbtFeeModel, fbtFeeChargedOn: 'fill', venueFeeCapBps: 20, tab: 'onchain',
    recentErrors: 0, dataAgeMs: 1000, checkedAt: Date.now()
  };
}

export async function run(container) {
  const out = [];
  const t = (name, ok) => { out.push([name, Boolean(ok)]); console.log((ok ? '✓ ' : '✗ ') + name); };
  const realError = console.error;
  const errors = [];
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped') || s.includes('Not implemented') || s.includes('is deprecated') || s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  /* mutable scenario state */
  let providerStatus = 'UNAVAILABLE';
  let providerReason = 'FEED_UNAVAILABLE';
  const bff = { quotes: 0, prepares: 0, verifies: 0 };

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const envelope = (data, meta = {}) => ({ ok: true, data, meta: { generatedAt: new Date().toISOString(), ...meta } });
  const failure = (status, code, extra = {}) => json({ ok: false, error: { code, retryable: false, recovery: 'NONE', ...extra } }, status);

  const buildQuote = (body) => {
    const market = body.market === '1' ? BTC : MARKET;
    const side = body.side === 'short' ? 'short' : 'long';
    const collateralUsd = Number(body.collateralUsd);
    const leverage = Number(body.leverage);
    const entry = side === 'long' ? market.ask : market.bid;
    const risk = assessFuturesRisk({ providerId: 'drift', side, collateralUsd, leverage, maxLeverage: market.maxLeverage, entryPrice: entry, takeProfit: body.takeProfit, stopLoss: body.stopLoss, availableBalanceUsd: null, fundingAprPct: market.fundingAprPct, isMarketOpen: market.isMarketOpen, spreadBps: market.spreadBps });
    /* Velocity: 4 bps taker fee from the feed, no flat oracle fee, network fee unknown on the read path. */
    const fee = computeFeeBreakdown({ collateralUsd, leverage, protocolFeeBps: market.openFeeBps, protocolFlatUsd: 0, networkFeeUsd: null, policyId: 'STANDARD', venueCapBps: 20, recipient: null, chargedOn: 'fill' });
    const route = selectVenue([{ providerId: 'drift', status: providerStatus, capabilities: PROVIDER_CATALOGUE.drift.capabilities, isMarketOpen: true, maxLeverage: market.maxLeverage, protocolFeeBps: market.openFeeBps, protocolFlatUsd: 0, networkFeeUsd: null, spreadBps: market.spreadBps, openInterestUsd: market.openInterestUsd, fundingAprPct: market.fundingAprPct, dataAgeMs: 1000, supportsMarket: true }], { notionalUsd: collateralUsd * leverage, leverage });
    return { market, side, collateralUsd, leverage, entry, risk, fee, route };
  };

  const handleBff = async (path, init) => {
    const url = new URL(`http://x${path}`);
    const p = url.pathname.replace(/^\/api\/v1\/futures/, '');
    let reqBody = {};
    try { reqBody = init?.body ? JSON.parse(init.body) : {}; } catch { reqBody = {}; }
    if (p === '/providers') {
      /* The tab's own provider set: Velocity only — Ostium/GMX/… never appear. */
      return json(envelope({ providers: [provider(providerStatus, { reason: providerReason })] }));
    }
    if (p === '/health') return json(envelope({ engine: 'fbt-futures-engine', providers: [] }));
    if (p === '/markets') {
      if (providerStatus === 'UNAVAILABLE') return failure(503, 'PROVIDER_UNAVAILABLE');
      return json(envelope({ provider: 'drift', status: providerStatus, markets: [MARKET, BTC], live: true, stale: false }));
    }
    if (p === '/candles') {
      if (providerStatus === 'UNAVAILABLE') return json(envelope({ provider: 'drift', ok: false, candles: [], live: false, resolution: '60' }));
      const now = Date.now();
      const candles = Array.from({ length: 24 }, (_, i) => ({ startedAt: now - (24 - i) * 3_600_000, open: 146 + i * 0.12, high: 146.4 + i * 0.12, low: 145.6 + i * 0.12, close: 146.1 + i * 0.12 }));
      return json(envelope({ provider: 'drift', ok: true, candles, live: true, resolution: url.searchParams.get('resolution') || '60' }));
    }
    /* Wallet-scoped reads are honestly refused on the read-only Velocity path. */
    if (p.startsWith('/account/')) return failure(503, 'PROVIDER_READ_ONLY');
    if (p.startsWith('/positions/')) return failure(503, 'PROVIDER_READ_ONLY');
    if (p === '/quote') {
      bff.quotes += 1;
      if (providerStatus === 'UNAVAILABLE') return failure(503, 'PROVIDER_UNAVAILABLE');
      const body = reqBody;
      const q = buildQuote(body);
      return json(envelope({
        requestId: body.requestId, provider: 'drift', providerStatus,
        market: { marketId: q.market.marketId, symbol: q.market.symbol, bid: q.market.bid, mid: q.market.mid, ask: q.market.ask, spreadBps: q.market.spreadBps, isMarketOpen: q.market.isMarketOpen, maxLeverage: q.market.maxLeverage, fundingAprPct: q.market.fundingAprPct },
        order: { side: q.side, collateralUsd: q.collateralUsd, leverage: q.leverage, notionalUsd: q.collateralUsd * q.leverage, entryPrice: q.entry, takeProfit: body.takeProfit, stopLoss: body.stopLoss, slippageBps: body.slippageBps },
        account: null, fee: q.fee, risk: q.risk, route: q.route,
        canExecute: false // READ_ONLY: the button must stay a view-only gate
      }));
    }
    if (p === '/prepare' || p === '/execute') { bff.prepares += 1; return failure(409, 'PROVIDER_READ_ONLY'); }
    if (p === '/verify') { bff.verifies += 1; return failure(409, 'PROVIDER_READ_ONLY'); }
    return failure(404, 'NOT_FOUND');
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.includes('/api/v1/futures')) {
      try { return await handleBff(url.replace(/^https?:\/\/[^/]+/, ''), init); }
      catch (err) { console.log('BFF STUB THREW', url, err?.message); return json({ ok: false, error: { code: 'STUB_ERROR' } }, 500); }
    }
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };

  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];
  const byId = (id) => q(`[data-testid="${id}"]`);
  const tabs = () => qa('[role="tablist"][aria-label] [role="tab"]');

  let root = null;
  try {
    await i18n.changeLanguage('en');
    const mountAt = async (hash) => {
      window.location.hash = hash;
      if (root) { await act(async () => { root.unmount(); }); }
      root = createRoot(container);
      await act(async () => {
        root.render(
          <HashRouter>
            <TelegramProvider>
              <WalletProvider>
                <Routes>
                  <Route path="/perp" element={<Perp />} />
                  <Route path="*" element={<div data-testid="elsewhere" />} />
                </Routes>
              </WalletProvider>
            </TelegramProvider>
          </HashRouter>
        );
      });
      await act(async () => { await sleep(120); });
    };

    /* ═══════ THE TAB STRIP ═══════ */
    await mountAt('#/perp');
    const strip = tabs();
    t('the Futures page shows three tabs in one segmented control', strip.length === 3);
    t('the tab labels are Perpetual · dYdX Orbit · On-Chain (i18n, not keys)',
      strip.map((b) => b.textContent.trim()).join('|') === 'Perpetual|dYdX Orbit|On-Chain');
    t('the Perpetual overview still renders its funding panel and liquidation table', !!q('.perp-liq') && qa('table').length >= 1);

    /* ═══════ A. UNAVAILABLE — the tab says so and builds nothing ═══════ */
    await act(async () => { click(strip[2]); });
    await act(async () => { await sleep(500); });
    t('the On-Chain tab mounts lazily when tapped', !!byId('futures-provider-status'));
    t('an unreachable Velocity feed is shown as UNAVAILABLE from the registry', byId('futures-provider-status')?.textContent.trim() === 'Unavailable');
    t('no market list is invented while the feed is down', !!byId('futures-markets-unavailable') && !byId('futures-market-select'));
    t('the unavailable notice names the reason and says no order can be built', /not available right now \(price feed unreachable\)/.test(byId('futures-readonly-notice')?.textContent || '') && /No order can be built/.test(byId('futures-readonly-notice')?.textContent || ''));
    t('NO protocol comparison list is rendered — the protocols section is gone', !qa('[data-testid^="futures-provider-"]').some((el) => el.tagName === 'BUTTON') && !/Ostium|GMX|Hyperliquid|Avantis/i.test(container.textContent));
    t('the venue card names Velocity on Solana and only Velocity', /Velocity/.test(byId('futures-venue-card')?.textContent || '') && /Solana/.test(byId('futures-venue-card')?.textContent || '') && !/Drift/.test(byId('futures-venue-card')?.textContent || ''));
    t('nothing was quoted or prepared while UNAVAILABLE', bff.prepares === 0);

    /* ═══════ B. READ_ONLY — live chart + fees, the view-only gate, no order ═══════ */
    providerStatus = 'READ_ONLY'; providerReason = 'NOT_CONFIGURED';
    await act(async () => { await sleep(200); });
    await act(async () => { click(strip[0]); });
    await act(async () => { click(strip[2]); });
    await act(async () => { await sleep(700); });
    t('a READ_ONLY Velocity venue shows its crypto markets', !!byId('futures-market-select') && qa('[data-testid="futures-market-select"] option').map((o) => o.textContent).join() === 'SOL/USDT,BTC/USDT');
    t('Velocity crypto markets are the only category — no stocks/forex/commodities tabs', qa('.tag').every((b) => !/Stocks|Forex|Commodit|Indices|ETF/i.test(b.textContent)));
    t("the read-only sentence is shown verbatim (en)", byId('futures-readonly-notice')?.textContent.trim() === 'This market is currently available for viewing only.');
    t('the chart is visible in its live state (candles from the BFF), not the unavailable box', !!byId('futures-trend') && !byId('futures-trend-empty') && /on-chain candles/.test(byId('futures-chart')?.textContent || ''));
    t('market info shows funding and the Velocity protocol fee (4 bps) from the BFF', /8\.4/.test(byId('futures-market-info')?.textContent || '') && /4 bps/.test(byId('futures-market-info')?.textContent || ''));
    t('the fee breakdown comes from the engine: 50 × 5 = $250 notional, protocol 5 bps = $0.13, FBT 5 bps = $0.13', /\$250/.test(byId('futures-fee-breakdown')?.textContent || '') && /\$0\.1[23]/.test(byId('futures-fee-breakdown')?.textContent || ''));
    t('the total is NOT printed while the network fee is unknown', /shown at review/.test(byId('futures-fee-breakdown')?.textContent || ''));
    t('the risk verdict is rendered with its score', /\/100/.test(byId('futures-risk')?.textContent || ''));
    t('the status pill reports the read-only venue honestly', byId('futures-provider-status')?.textContent.trim() === 'Read-only');
    t('without a wallet the action still says View only — the venue is read-only, tradeable never', byId('futures-review')?.textContent.trim() === 'View only' && byId('futures-review')?.disabled === true);
    t('no /prepare and no /verify call ever happens on the read-only Velocity tab', bff.prepares === 0 && bff.verifies === 0);
    t('quotes DID run (the fee breakdown is live), they just never execute', bff.quotes >= 1);

    /* ═══════ C. quote input still re-computes fee/risk live ═══════ */
    await act(async () => { setInputValue(byId('futures-collateral'), '100'); });
    await act(async () => { setInputValue(byId('futures-leverage'), '10'); });
    await act(async () => { await sleep(600); });
    t('the live quote re-runs on input: $1,000 notional, Velocity protocol $0.4, FBT fee $0.5', /\$1,000/.test(byId('futures-fee-breakdown')?.textContent || '') && /Protocol fee\$0\.4/.test(byId('futures-fee-breakdown')?.textContent || '') && /FBT fee \(5 bps\)\$0\.5/.test(byId('futures-fee-breakdown')?.textContent || ''));
    await act(async () => { setInputValue(byId('futures-leverage'), '75'); });
    await act(async () => { await sleep(600); });
    t('leverage above the market\'s 20x cap is clamped to the market maximum', Number(byId('futures-leverage')?.value) <= 20);
    t('the (view-only) button stays disabled — no order path exists', byId('futures-review')?.disabled === true);
    t('tapping review on a read-only venue never opens a confirmation sheet', (() => { act(() => { try { click(byId('futures-review')); } catch { /* disabled */ } }); return !document.querySelector('[data-testid="futures-confirm"]'); })());

    /* ═══════ D. the other tabs are untouched ═══════ */
    await act(async () => { click(strip[1]); });
    await act(async () => { await sleep(500); });
    t('the dYdX tab still mounts', /dYdX/.test(container.textContent));
    await act(async () => { click(strip[0]); });
    await act(async () => { await sleep(200); });
    t('the Perpetual overview still renders after the round trip', !!q('.perp-liq'));

    /* ═══════ E. Intent OS hand-off: the URL pre-fills, it never executes ═══════ */
    const preparesBefore = bff.prepares;
    await mountAt('#/perp?tab=onchain&market=BTC&side=short&collateral=120&leverage=7');
    await act(async () => { await sleep(900); });
    t('the deep link opens the On-Chain tab directly', tabs()[2]?.getAttribute('aria-selected') === 'true' && !!byId('futures-market-select'));
    t('the requested Velocity market is selected: BTC/USDT', byId('futures-market-select')?.value === '1');
    t('side, collateral and leverage are pre-filled from the draft', q('.dir-btn.short')?.classList.contains('active') === true && byId('futures-collateral')?.value === '120' && byId('futures-leverage')?.value === '7');
    t('a deep link builds and signs NOTHING by itself', bff.prepares === preparesBefore && !document.querySelector('[data-testid="futures-confirm"]'));

    /* ═══════ F. Persian: RTL strings for the tab ═══════ */
    const faOk = await setLanguage('fa');
    await act(async () => { await sleep(300); });
    t('the Persian locale loads and becomes active', faOk === true && i18n.language === 'fa');
    t('the document flips to RTL for Persian', document.documentElement.getAttribute('dir') === 'rtl');
    t('the tab strip reads پرپچوال · مدار dYdX · آن‌چین in Persian', tabs().map((b) => b.textContent.trim()).join('|') === 'پرپچوال|مدار dYdX|آن‌چین');
    t('the Velocity venue card is Persian-localised (Solana + coming-soon + read-only in fa)', (() => { const tx = byId('futures-venue-card')?.textContent || ''; if (process.env.DEBUG_FA) console.log('FA_CARD>>>', tx); return /سولانا/.test(tx) && /به‌زودی|به زودی/.test(tx) && byId('futures-provider-status')?.textContent.trim() === 'فقط مشاهده'; })());
    t('no unexpected console errors', errors.length === 0 || (console.log(errors.slice(0, 3)), false));
  } finally {
    if (root) await act(async () => { root.unmount(); });
    console.error = realError;
    globalThis.fetch = realFetch;
  }
  return out;
}
