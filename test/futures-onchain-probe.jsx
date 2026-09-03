/**
 * THE FUTURES PAGE, DRIVEN THROUGH THE ON-CHAIN (Velocity · Solana) TAB.
 * ---------------------------------------------------------------------------
 * Product rule for this tab:
 *   · Velocity (Solana, the Drift fork; provider id `drift`) is the ONLY
 *     on-chain venue shown — there is no protocol comparison list, and Ostium
 *     (Arbitrum) belongs to the Stocks tab.
 *   · Markets, prices, funding and OI are live reads from the BFF, which
 *     proxies Velocity's public Data API (data.velocity.exchange).
 *   · The order path is built in this tab: @velocity-exchange/sdk (prebundled
 *     to public/vendor/velocity-sdk.js) builds Velocity instructions and the
 *     user's OWN Solana wallet signs and sends them, so an AVAILABLE registry
 *     row means the CTA is a real Review/Confirm flow — never a server-side
 *     key. When the registry cannot serve the venue (dead feed, error budget)
 *     the tab drops back to "View only" and builds nothing.
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
/* The REAL wallet page — the hand-off target the On-Chain tab navigates to
   (?tab=solana&return=…): the probe drives its Solana tab end to end. */
import WalletPage from '../src/pages/Wallet.jsx';
import { computeFeeBreakdown, assessFuturesRisk, selectVenue, PROVIDER_CATALOGUE } from '../src/lib/futures-engine/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = null; // Solana — the tab never asks for an EVM chain switch

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

/* A fake injected Phantom: enough surface for detection (publicKey), connect
   and the hook's provider-event listeners. Never signs anything real. */
const FAKE_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const fakePhantom = (addr) => ({
  isPhantom: true,
  publicKey: { toString: () => addr },
  connect: async () => ({ publicKey: { toString: () => addr } }),
  disconnect: async () => {},
  on: () => {},
  off: () => {},
  removeListener: () => {},
  signTransaction: async (tx) => tx,
  signAndSendTransaction: async () => ({ signature: 'probe' })
});

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
  /* Same derivation the registry uses: the catalogue's execution model is
     CLIENT_BUILDS_TX (the tab signs), so only AVAILABLE/DEGRADED are
     executable — READ_ONLY/UNAVAILABLE are not, however the order path is
     built. */
  const executable = extra.executable ?? ['AVAILABLE', 'DEGRADED'].includes(status);
  return {
    providerId: 'drift', name: p.name, status,
    reason: extra.reason === undefined ? (executable ? null : 'NOT_CONFIGURED') : extra.reason,
    executable,
    execution: extra.execution ?? p.execution, configured: true, family: 'solana', chainId: 'solana:mainnet', chainName: 'Solana',
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
      /* The NORMALIZED rows the real adapter emits from Velocity's live
         /market/:symbol/candles endpoint (raw payload + its mapping are pinned
         by test/futures-velocity-feed-probe.mjs): startedAt in ms, fill-series
         OHLC. 24 hourly buckets, rising gently. */
      const nowSec = Math.floor(Date.now() / 1000);
      const candles = Array.from({ length: 24 }, (_, i) => {
        const px = 146 + i * 0.12;
        return { startedAt: (nowSec - (24 - i) * 3_600) * 1000, open: px, high: px + 0.4, low: px - 0.4, close: px + 0.1 };
      });
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
        /* mirrors the registry row the tab already has */
        canExecute: ['AVAILABLE', 'DEGRADED'].includes(providerStatus)
      }));
    }
    if (p === '/prepare' || p === '/execute') {
      bff.prepares += 1;
      if (!['AVAILABLE', 'DEGRADED'].includes(providerStatus)) return failure(409, 'PROVIDER_READ_ONLY');
      /* exactly what server/futures/router.js hands back for Velocity: the
         quote/risk/fee truth plus the on-chain facts the SDK needs, and a
         clientSign descriptor — no server calldata. */
      const market = reqBody.market === '1' ? BTC : MARKET;
      const prepared = buildQuote(reqBody);
      return json(envelope({
        requestId: reqBody.requestId, executionId: `fut_exec_probe_${bff.prepares}`, idempotencyKey: 'probe',
        provider: 'drift', providerStatus, action: 'open',
        market: { marketId: market.marketId, symbol: market.symbol, mid: market.mid, bid: market.bid, ask: market.ask, priceAt: market.priceAt, maxLeverage: market.maxLeverage, marketIndex: Number(market.marketId), collateralToken: 'USDT' },
        order: { side: prepared.side, collateralUsd: prepared.collateralUsd, leverage: prepared.leverage, notionalUsd: prepared.collateralUsd * prepared.leverage, entryPrice: prepared.entry, takeProfit: reqBody.takeProfit ?? null, stopLoss: reqBody.stopLoss ?? null, slippageBps: reqBody.slippageBps ?? 25 },
        account: { balanceUsd: null, allowanceUsd: null, needsApproval: false },
        fee: prepared.fee, risk: prepared.risk, route: prepared.route,
        simulation: { attempted: false, ok: null, gas: null, networkFeeUsd: null, code: 'CLIENT_BUILDS_TX' },
        transactions: [],
        clientSign: { family: 'solana', program: 'vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P', sdk: '@velocity-exchange/sdk', buildsInTab: true },
        state: 'PREPARED', expiresAt: Date.now() + 45_000
      }));
    }
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
                  <Route path="/wallet" element={<WalletPage />} />
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
    let strip = tabs();
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

    /* ═══════ C2. AVAILABLE — the order path is built, so the tab trades ═══════ */
    providerStatus = 'AVAILABLE'; providerReason = null;
    /* remount the tab so it re-reads the registry, exactly as a user tapping
       back into On-Chain after a recovery would */
    await act(async () => { click(strip[0]); });
    await act(async () => { click(strip[2]); });
    await act(async () => { await sleep(700); });
    t('an AVAILABLE Velocity venue reports Available from the registry', byId('futures-provider-status')?.textContent.trim() === 'Available', byId('futures-provider-status')?.textContent);
    t('the venue card drops the coming-soon pill once the order path is built', !/Coming soon/.test(byId('futures-venue-card')?.textContent || ''));
    t('the venue card says the order path is ready with the live market count', /Order path ready · 2 markets/.test(byId('futures-venue-card')?.textContent || ''), byId('futures-venue-card')?.textContent);
    t('the read-only notice disappears on an executable venue', !byId('futures-readonly-notice'));
    t('without a wallet the CTA is Connect wallet — enabled, and never a server-side key', byId('futures-review')?.textContent.trim() === 'Connect wallet' && byId('futures-review')?.disabled === false, byId('futures-review')?.textContent);
    t('no order is prepared before the user reviews it', bff.prepares === 0 && bff.verifies === 0);

    /* ═══════ C3. THE WALLET HAND-OFF — no wallet → the wallet page, order in tow ═══════ */
    act(() => { click(byId('futures-review')); });
    await act(async () => { await sleep(80); });
    const hashAfterConnect = String(window.location.hash || '');
    t('tapping Connect with no wallet opens the wallet page (Solana tab), not a dead end',
      /#\/wallet\?/.test(hashAfterConnect) && hashAfterConnect.includes('tab=solana'), hashAfterConnect);
    const backParam = new URLSearchParams(hashAfterConnect.split('?')[1] || '').get('return');
    t('the return path carries this exact order: market/side/collateral/leverage',
      backParam === '/perp?tab=onchain&market=SOL&side=long&collateral=50&leverage=5', String(backParam));
    t('the detour built and signed nothing', bff.prepares === 0 && bff.verifies === 0);

    /* ═══════ C3b. THE WALLET PAGE HALF — connect there, come back here ═══════
       Phantom installed but not yet authorized for the site: the provider
       object exists (so Connect is enabled) while publicKey is null (so the
       page has nothing to return to yet). */
    window.solana = { ...fakePhantom(FAKE_SOL), publicKey: null };
    await mountAt(hashAfterConnect.replace(/^#/, ''));
    await act(async () => { await sleep(600); });
    const solanaConnect = [...container.querySelectorAll('button.btn-primary.btn-sm')]
      .find((b) => b.textContent.trim() === 'Connect wallet');
    t('the wallet page opens on its Solana tab with the real Connect button ready',
      /#\/wallet\?/.test(String(window.location.hash)) && Boolean(solanaConnect) && solanaConnect.disabled === false,
      `${solanaConnect?.disabled}/${String(window.location.hash).slice(0, 40)}`);
    t('with no wallet authorized yet it stays on the wallet page (no premature return)',
      /#\/wallet\?/.test(String(window.location.hash)) && !/#\/perp/.test(String(window.location.hash)));
    act(() => { click(solanaConnect); });
    await act(async () => { await sleep(500); });
    t('connecting the Solana wallet returns to the exact order automatically',
      /#\/perp\?tab=onchain/.test(String(window.location.hash)) && !/return=/.test(String(window.location.hash)),
      String(window.location.hash));

    /* ═══════ C4. A CONNECTED WALLET IS DETECTED INSTANTLY → Review order ═══════ */
    window.solana = fakePhantom(FAKE_SOL);
    await mountAt(backParam || '#/perp?tab=onchain&market=SOL&side=long&collateral=50&leverage=5');
    await act(async () => { await sleep(800); });
    t('a connected Phantom is detected with no tap: the short address is shown',
      !!byId('futures-wallet-row') && byId('futures-wallet-row')?.textContent.includes(FAKE_SOL.slice(0, 4)),
      byId('futures-wallet-row')?.textContent || '');
    t('the CTA flips to Review order and is ENABLED',
      byId('futures-review')?.textContent.trim() === 'Review order' && byId('futures-review')?.disabled === false,
      `${byId('futures-review')?.textContent}/${byId('futures-review')?.disabled}`);
    act(() => { click(byId('futures-review')); });
    await act(async () => { await sleep(500); });
    /* the confirmation sheet portals to document.body — query the document */
    t('Review with a connected wallet runs /prepare and opens the confirmation sheet',
      !!document.querySelector('[data-testid="futures-confirm"]') && bff.prepares === 1, `prepares=${bff.prepares}`);
    await act(async () => {
      const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel');
      if (cancel) click(cancel);
    });
    delete window.solana;
    await mountAt('#/perp?tab=onchain');
    await act(async () => { await sleep(400); });
    strip = tabs(); /* the remounts above replaced the DOM — re-grab the strip */

    /* The trade module the tab hands the confirmed order to. */
    const venue = await import('../src/lib/velocityTrade.js');
    t('the trade module exports the whole Velocity order surface',
      ['openVelocityPosition', 'closeVelocityPosition', 'setVelocityTpSl', 'cancelVelocityOrders', 'getVelocityPositions']
        .every((fn) => typeof venue[fn] === 'function'));
    t('the trade module pins Velocity\'s USDT quote mint, not Drift\'s USDC',
      venue.VELOCITY_QUOTE_MINT === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' && venue.VELOCITY_QUOTE_DECIMALS === 6);
    /* No wallet and no vendor bundle in this harness: the module must fail
       closed with a stable code instead of throwing a raw import error. */
    const noBundle = await venue.openVelocityPosition({ wallet: 'DRfFtYV4BHJoJEZx8LZ4FqfKnGkm8fQaLt8QxN3FgGd', marketIndex: 0, side: 'long', notionalUsd: 100, oraclePrice: 149.05 }).then(() => null, (e) => e);
    t('a missing SDK bundle fails closed as PROVIDER_UNAVAILABLE, never a raw import error',
      noBundle?.code === 'PROVIDER_UNAVAILABLE' && /vendor\/velocity-sdk\.js/.test(String(noBundle?.message)), String(noBundle?.message).slice(0, 90));
    const noBundleRead = await venue.getVelocityPositions({ wallet: 'DRfFtYV4BHJoJEZx8LZ4FqfKnGkm8fQaLt8QxN3FgGd' }).then(() => null, (e) => e);
    t('the position read fails closed the same way', noBundleRead?.code === 'PROVIDER_UNAVAILABLE');

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
    t('the Velocity venue card is Persian-localised (Solana + order path ready + available in fa)', (() => { const tx = byId('futures-venue-card')?.textContent || ''; if (process.env.DEBUG_FA) console.log('FA_CARD>>>', tx); return /سولانا/.test(tx) && /مسیر سفارش آماده/.test(tx) && !/به‌زودی|به زودی/.test(tx) && byId('futures-provider-status')?.textContent.trim() === 'در دسترس'; })());
    t('no unexpected console errors', errors.length === 0 || (console.log(errors.slice(0, 3)), false));
  } finally {
    if (root) await act(async () => { root.unmount(); });
    console.error = realError;
    globalThis.fetch = realFetch;
  }
  return out;
}
