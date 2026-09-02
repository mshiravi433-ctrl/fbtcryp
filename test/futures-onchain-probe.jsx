/**
 * THE FUTURES PAGE, DRIVEN THROUGH THE ON-CHAIN TAB TO A SIGNED ORDER.
 * ---------------------------------------------------------------------------
 * Spec acceptance: "every button real, every value sourced, no fake data;
 * unavailable → UNAVAILABLE/READ_ONLY; chart visible; Perpetual + dYdX tabs
 * unchanged." A probe that checks "a tab renders" cannot see any of that, so
 * this one mounts the REAL /perp page (Perp.jsx → FuturesOnchain.jsx →
 * futuresClient.js) with:
 *
 *   BFF     → a stubbed /api/v1/futures answering EXACTLY the router's
 *             envelopes (built from the same pure engine the server uses),
 *             so the numbers on screen come from the code path production runs
 *   wallet  → a stub EIP-1193 provider on Arbitrum; every eth_sendTransaction
 *             is captured and decoded here field by field
 *   chain   → ethers read providers answer over the same stubbed JSON-RPC
 *
 * Three scenarios:
 *   A. registry says UNAVAILABLE  → the tab shows it and builds NOTHING
 *   B. registry says READ_ONLY    → the exact Persian/English fallback, no order
 *   C. registry says AVAILABLE    → market · chart · fee · risk from the BFF,
 *      review → /prepare → confirmation preview → wallet signs the BFF's
 *      calldata (decoded: pairIndex, collateral, leverage, builder fee) →
 *      /verify receives the hash → the tab reports the state
 *
 * Nothing about the app is stubbed; only the network boundary is.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { FetchRequest, FetchResponse, Interface } from 'ethers';
import i18n, { setLanguage } from '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Perp from '../src/pages/Perp.jsx';
import { computeFeeBreakdown, assessFuturesRisk, selectVenue, PROVIDER_CATALOGUE } from '../src/lib/futures-engine/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = 42161;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const TRADING = '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const SPENDER = '0xcCd5891083A8acD2074690F65d3024E7D13d66E7';
const BUILDER = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

const openIface = new Interface([
  'function openTrade((uint256 collateral,uint192 openPrice,uint192 tp,uint192 sl,address trader,uint32 leverage,uint16 pairIndex,uint8 index,bool buy,bool isDayTrade) t,(address builder,uint32 builderFee) bf,uint8 orderType,uint256 slippageP)'
]);
const erc20Iface = new Interface(['function approve(address spender,uint256 amount)']);

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

/* ── the BFF, as the router would answer it ─────────────────────────────── */
const MARKET = {
  marketId: '0', pairId: '0', symbol: 'BTC/USD', base: 'BTC', quote: 'USD', category: 'crypto', maxLeverage: 100, overnightMaxLeverage: 100,
  openFeeBps: 8, makerFeeBps: 4, openInterestLongUsd: 4_000_000, openInterestShortUsd: 3_000_000, openInterestUsd: 7_000_000, maxOpenInterestUsd: 20_000_000,
  fundingAprPct: 12.5, rolloverAprPct: 3.1, bid: 63_990, mid: 64_000, ask: 64_010, spreadBps: 3.125, isMarketOpen: true, isDayTradingClosed: false, priceAt: Date.now()
};
const GOLD = { ...MARKET, marketId: '12', pairId: '12', symbol: 'XAU/USD', base: 'XAU', quote: 'USD', category: 'commodities', maxLeverage: 50, bid: 2399, mid: 2400, ask: 2401, isMarketOpen: false };

function provider(status, extra = {}) {
  const p = PROVIDER_CATALOGUE.ostium;
  return {
    providerId: 'ostium', name: 'Ostium', status, reason: extra.reason ?? null, executable: status === 'AVAILABLE' || status === 'DEGRADED',
    execution: 'ONCHAIN_UNSIGNED_TX', configured: true, family: 'evm', chainId: CHAIN, chainName: 'Arbitrum One', custody: 'onchain', collateral: 'USDC',
    markets: p.markets, marketCount: status === 'UNAVAILABLE' ? 0 : 2, capabilities: p.capabilities, fbtFeeModel: p.fbtFeeModel, fbtFeeChargedOn: 'open', venueFeeCapBps: 50, tab: 'onchain', recentErrors: 0, dataAgeMs: 1000, checkedAt: Date.now()
  };
}
const GMX = { providerId: 'gmx', name: 'GMX', status: 'UNAVAILABLE', reason: 'NOT_CONFIGURED', executable: false, execution: 'NOT_BUILT', configured: false, family: 'evm', chainId: CHAIN, chainName: 'Arbitrum One', custody: 'onchain', collateral: 'multi', markets: ['crypto'], marketCount: 0, capabilities: PROVIDER_CATALOGUE.gmx.capabilities, fbtFeeModel: 'none', tab: null, recentErrors: 0, dataAgeMs: null, checkedAt: Date.now() };

export async function run(container) {
  const out = [];
  const t = (name, ok) => { out.push([name, Boolean(ok)]); console.log((ok ? '✓ ' : '✗ ') + name); };
  const realError = console.error;
  const realFetch = globalThis.fetch;
  const errors = [];
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped') || s.includes('Not implemented') || s.includes('is deprecated') || s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  /* mutable scenario state */
  let providerStatus = 'UNAVAILABLE';
  let providerReason = 'FEED_UNAVAILABLE';
  let allowanceUsd = 0;
  const balanceUsd = 500;
  const bff = { quotes: 0, prepares: 0, verifies: [], prepareBodies: [], idempotencyKeys: [] };
  const sent = [];
  const hashes = [];
  let executionCounter = 0;

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const envelope = (data, meta = {}) => ({ ok: true, data, meta: { generatedAt: new Date().toISOString(), ...meta } });
  const failure = (status, code, extra = {}) => json({ ok: false, error: { code, retryable: false, recovery: 'NONE', ...extra } }, status);

  const buildQuote = (body, wallet) => {
    const market = body.market === '12' ? GOLD : MARKET;
    const side = body.side === 'short' ? 'short' : 'long';
    const collateralUsd = Number(body.collateralUsd);
    const leverage = Number(body.leverage);
    const entry = side === 'long' ? market.ask : market.bid;
    const risk = assessFuturesRisk({ providerId: 'ostium', side, collateralUsd, leverage, maxLeverage: market.maxLeverage, entryPrice: entry, takeProfit: body.takeProfit, stopLoss: body.stopLoss, availableBalanceUsd: wallet ? balanceUsd : null, fundingAprPct: market.fundingAprPct, isMarketOpen: market.isMarketOpen, spreadBps: market.spreadBps });
    const fee = computeFeeBreakdown({ collateralUsd, leverage, protocolFeeBps: market.openFeeBps, protocolFlatUsd: 0.1, networkFeeUsd: null, policyId: 'STANDARD', venueCapBps: 50, recipient: BUILDER, chargedOn: 'open' });
    const route = selectVenue([{ providerId: 'ostium', status: providerStatus, capabilities: PROVIDER_CATALOGUE.ostium.capabilities, isMarketOpen: market.isMarketOpen, maxLeverage: market.maxLeverage, protocolFeeBps: market.openFeeBps, protocolFlatUsd: 0.1, networkFeeUsd: null, spreadBps: market.spreadBps, openInterestUsd: market.openInterestUsd, fundingAprPct: market.fundingAprPct, dataAgeMs: 1000, supportsMarket: true }], { notionalUsd: collateralUsd * leverage, leverage });
    return { market, side, collateralUsd, leverage, entry, risk, fee, route };
  };

  const handleBff = async (path, init) => {
    const url = new URL(`http://x${path}`);
    const p = url.pathname.replace(/^\/api\/v1\/futures/, '');
    const body = init?.body ? JSON.parse(init.body) : {};
    const method = (init?.method || 'GET').toUpperCase();
    if (p === '/providers') return json(envelope({ providers: [provider(providerStatus, { reason: providerReason }), GMX] }));
    if (p === '/health') return json(envelope({ engine: 'fbt-futures-engine', providers: [] }));
    if (p === '/markets') {
      if (providerStatus === 'UNAVAILABLE') return failure(503, 'PROVIDER_UNAVAILABLE');
      return json(envelope({ provider: 'ostium', status: providerStatus, markets: [MARKET, GOLD], live: true, stale: false }));
    }
    if (p === '/candles') {
      if (providerStatus === 'UNAVAILABLE') return json(envelope({ provider: 'ostium', ok: false, candles: [], live: false, resolution: '60' }));
      const now = Date.now();
      const candles = Array.from({ length: 24 }, (_, i) => ({ startedAt: now - (24 - i) * 3_600_000, open: 63_000 + i * 40, high: 63_100 + i * 40, low: 62_900 + i * 40, close: 63_050 + i * 40 }));
      return json(envelope({ provider: 'ostium', ok: true, candles, live: true, resolution: url.searchParams.get('resolution') || '60' }));
    }
    if (p.startsWith('/account/')) return json(envelope({ provider: 'ostium', wallet: ACCOUNT, chainId: CHAIN, collateral: 'USDC', balanceUsd, allowanceUsd }));
    if (p.startsWith('/positions/')) return json(envelope({ provider: 'ostium', wallet: ACCOUNT, positions: [], marketsLive: true }));
    if (p === '/quote' && method === 'POST') {
      bff.quotes += 1;
      if (providerStatus === 'UNAVAILABLE') return failure(503, 'PROVIDER_UNAVAILABLE', { requestId: body.requestId });
      const q = buildQuote(body, body.wallet);
      return json(envelope({
        requestId: body.requestId, provider: 'ostium', providerStatus,
        market: { marketId: q.market.marketId, symbol: q.market.symbol, bid: q.market.bid, mid: q.market.mid, ask: q.market.ask, spreadBps: q.market.spreadBps, isMarketOpen: q.market.isMarketOpen, maxLeverage: q.market.maxLeverage, fundingAprPct: q.market.fundingAprPct },
        order: { side: q.side, collateralUsd: q.collateralUsd, leverage: q.leverage, notionalUsd: q.collateralUsd * q.leverage, entryPrice: q.entry, takeProfit: body.takeProfit, stopLoss: body.stopLoss, slippageBps: body.slippageBps },
        account: body.wallet ? { balanceUsd, allowanceUsd, needsApproval: allowanceUsd + 1e-9 < q.collateralUsd } : null,
        fee: q.fee, risk: q.risk, route: q.route, canExecute: providerStatus === 'AVAILABLE' && !q.risk.blocked && q.route.ok
      }));
    }
    if (p === '/prepare' && method === 'POST') {
      bff.prepares += 1;
      bff.prepareBodies.push(body);
      bff.idempotencyKeys.push(init.headers['idempotency-key']);
      if (!init.headers['idempotency-key']) return failure(400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (providerStatus !== 'AVAILABLE') return failure(409, providerStatus === 'READ_ONLY' ? 'PROVIDER_READ_ONLY' : 'PROVIDER_UNAVAILABLE', { requestId: body.requestId, provider: provider(providerStatus, { reason: providerReason }) });
      const q = buildQuote(body, body.wallet);
      if (q.risk.blocked) return failure(422, 'RISK_BLOCKED', { requestId: body.requestId, risk: q.risk });
      const { buildOpenTrade, buildApprove } = await import('../server/futures/adapters/ostium.js');
      const unsigned = buildOpenTrade({ trader: body.wallet, pairId: q.market.pairId, buy: q.side === 'long', price: String(q.market.mid), collateralUsd: q.collateralUsd, leverage: q.leverage, takeProfit: body.takeProfit > 0 ? String(body.takeProfit) : '0', stopLoss: body.stopLoss > 0 ? String(body.stopLoss) : '0', slippageBps: body.slippageBps, builder: BUILDER, builderFeeBps: q.fee.fbt.bps });
      const needsApproval = allowanceUsd + 1e-9 < q.collateralUsd;
      const approval = needsApproval ? buildApprove({ amountUsd: q.collateralUsd }) : null;
      const fee = computeFeeBreakdown({ collateralUsd: q.collateralUsd, leverage: q.leverage, protocolFeeBps: q.market.openFeeBps, protocolFlatUsd: 0.1, networkFeeUsd: 0.04, policyId: 'STANDARD', venueCapBps: 50, recipient: BUILDER, chargedOn: 'open' });
      executionCounter += 1;
      const wrap = (tx, kind) => tx ? ({ kind, to: tx.to, data: tx.data, value: '0x0', chainId: CHAIN, signed: false, broadcast: false, capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' } }) : null;
      return json({
        ok: true,
        data: {
          requestId: body.requestId, intentId: null, executionId: `fut_exec_00000000-0000-4000-8000-${String(executionCounter).padStart(12, '0')}`, idempotencyKey: init.headers['idempotency-key'],
          provider: 'ostium', providerStatus, action: 'open',
          market: { marketId: q.market.marketId, symbol: q.market.symbol, mid: q.market.mid, bid: q.market.bid, ask: q.market.ask, maxLeverage: q.market.maxLeverage },
          order: { side: q.side, collateralUsd: q.collateralUsd, leverage: q.leverage, notionalUsd: q.collateralUsd * q.leverage, entryPrice: q.entry, takeProfit: body.takeProfit, stopLoss: body.stopLoss, slippageBps: body.slippageBps },
          account: { balanceUsd, allowanceUsd, needsApproval }, fee, risk: q.risk, route: q.route,
          simulation: { attempted: !needsApproval, ok: needsApproval ? null : true, gas: '300000', networkFeeUsd: 0.04, code: needsApproval ? 'APPROVAL_REQUIRED_FIRST' : null },
          transactions: [wrap(approval, 'approve'), wrap(unsigned, 'open')].filter(Boolean), state: 'PREPARED', expiresAt: Date.now() + 45_000
        },
        meta: { schema: 'fbt.futures-prepare.v1', dataStatus: 'live' }
      });
    }
    if (p === '/verify' && method === 'POST') {
      bff.verifies.push(body);
      const confirmed = hashes.includes(body.txHash);
      return json(envelope({ executionId: body.executionId, txHash: body.txHash, state: body.status === 'REJECTED' ? 'REJECTED' : confirmed ? 'COMPLETED' : 'PENDING', verification: { status: confirmed ? 'CONFIRMED' : 'PENDING' } }));
    }
    return failure(404, 'NOT_FOUND');
  };

  /* ── the chain + wallet ──────────────────────────────────────────────── */
  let nonce = 0;
  const rpc = async (method, params = []) => {
    switch (method) {
      case 'eth_chainId': return `0x${CHAIN.toString(16)}`;
      case 'net_version': return String(CHAIN);
      case 'eth_accounts': case 'eth_requestAccounts': return [ACCOUNT];
      case 'eth_blockNumber': return '0x100';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return `0x${nonce.toString(16)}`;
      case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
      case 'eth_estimateGas': return '0x30d40';
      case 'eth_call': return '0x0000000000000000000000000000000000000000000000000000000000000000';
      case 'eth_sendTransaction': {
        const tx = params[0] || {};
        sent.push(tx);
        nonce += 1;
        const hash = `0x${(nonce + 0xaa).toString(16).padStart(2, '0').repeat(32)}`;
        hashes.push(hash);
        if (String(tx.data || '').startsWith(erc20Iface.getFunction('approve').selector)) {
          const [, amount] = erc20Iface.decodeFunctionData('approve', tx.data);
          allowanceUsd = Number(amount) / 1e6;
        }
        return hash;
      }
      case 'eth_getTransactionReceipt': {
        const hash = params[0];
        if (!hashes.includes(hash)) return null;
        return { transactionHash: hash, blockHash: `0x${'11'.repeat(32)}`, blockNumber: '0x100', from: ACCOUNT, to: sent[hashes.indexOf(hash)]?.to || null, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', type: '0x2', transactionIndex: '0x0' };
      }
      case 'eth_getTransactionByHash': {
        const hash = params[0]; const index = hashes.indexOf(hash);
        if (index < 0) return null;
        const tx = sent[index] || {};
        return { hash, blockHash: `0x${'11'.repeat(32)}`, blockNumber: '0x100', transactionIndex: '0x0', from: ACCOUNT, to: tx.to || null, value: '0x0', gas: '0x30d40', gasPrice: '0x3b9aca00', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00', input: tx.data || '0x', nonce: `0x${index.toString(16)}`, type: '0x2', accessList: [], chainId: `0x${CHAIN.toString(16)}`, v: '0x1', r: `0x${'11'.repeat(32)}`, s: `0x${'22'.repeat(32)}`, yParity: '0x1' };
      }
      case 'eth_getBlockByNumber': return { number: '0x100', hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`, timestamp: '0x66000000', gasLimit: '0x1c9c380', gasUsed: '0x5208', baseFeePerGas: '0x3b9aca00', miner: ACCOUNT, extraData: '0x', transactions: [] };
      default: return null;
    }
  };
  const serveRpc = async (bodyText) => {
    let body = null; try { body = JSON.parse(bodyText || 'null'); } catch { body = null; }
    if (!body) return JSON.stringify({ error: 'bad request' });
    const one = async (call) => ({ jsonrpc: '2.0', id: call.id, result: await rpc(call.method, call.params) });
    return JSON.stringify(Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body));
  };
  FetchRequest.registerGetUrl(async (req) => {
    const text = await serveRpc(req.body ? new TextDecoder().decode(req.body) : null);
    return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
  });
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/v1/futures')) {
      try { return await handleBff(u.replace(/^https?:\/\/[^/]+/, ''), init); }
      catch (err) { console.log('BFF STUB THREW', u, err?.message); return json({ ok: false, error: { code: 'STUB_ERROR' } }, 500); }
    }
    if (u.includes('/api/')) return json({ error: 'NOT_FOUND' }, 404);
    return new Response(await serveRpc(init?.body || null), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  window.ethereum = { isMetaMask: true, request: ({ method, params }) => rpc(method, params), on() {}, removeListener() {} };

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
    t('the third tab has the same tab role/aria contract as the first two', strip.every((b) => b.getAttribute('role') === 'tab' && b.hasAttribute('aria-selected')));

    /* ═══════ A. UNAVAILABLE — the tab says so and builds nothing ═══════ */
    await act(async () => { click(strip[2]); });
    await act(async () => { await sleep(500); });
    t('the On-Chain tab mounts lazily when tapped', !!byId('futures-provider-status'));
    t('an unreachable venue is shown as UNAVAILABLE from the registry', byId('futures-provider-status')?.textContent.trim() === 'Unavailable');
    t('no market list is invented while the feed is down', !!byId('futures-markets-unavailable') && !byId('futures-market-select'));
    t('the unavailable notice names the reason and says no order can be built', /not available right now \(price feed unreachable\)/.test(byId('futures-readonly-notice')?.textContent || '') && /No order can be built/.test(byId('futures-readonly-notice')?.textContent || ''));
    t('GMX is listed as a comparison row but marked not configured, never tradeable', /not configured/i.test(byId('futures-provider-gmx')?.textContent || ''));
    t('nothing was quoted or prepared while UNAVAILABLE', bff.prepares === 0);

    /* ═══════ B. READ_ONLY — data shows, the exact fallback sentence, no order ═══════ */
    providerStatus = 'READ_ONLY'; providerReason = 'NOT_CONFIGURED';
    await act(async () => { await sleep(200); });
    await act(async () => { click(strip[0]); });
    await act(async () => { click(strip[2]); });
    await act(async () => { await sleep(700); });
    t('a READ_ONLY venue shows its markets, grouped by category (Crypto first)', !!byId('futures-market-select') && qa('[data-testid="futures-market-select"] option').map((o) => o.textContent).join() === 'BTC/USD' && qa('.tag').some((b) => /Commodities/.test(b.textContent)));
    t('the spec\'s read-only sentence is shown verbatim (en)', byId('futures-readonly-notice')?.textContent.trim() === 'This market is currently available for viewing only.');
    /* jsdom measures every element at 0px wide, so the SVG itself cannot draw
       here (same limit as the dYdX chart probe); the contract we can pin is
       that the chart mounted in its LIVE state — not the "unavailable" box. */
    t('the chart is visible in its live state (candles from the BFF), not the unavailable box', !!byId('futures-trend') && !byId('futures-trend-empty') && /on-chain candles/.test(byId('futures-chart')?.textContent || ''));
    t('market info shows funding, OI and protocol fee from the BFF', /12\.5/.test(byId('futures-market-info')?.textContent || '') && /8 bps/.test(byId('futures-market-info')?.textContent || ''));
    t('the fee breakdown comes from the BFT engine: 50 × 5 = $250 notional, FBT 5 bps = $0.13', /\$250/.test(byId('futures-fee-breakdown')?.textContent || '') && /\$0\.1[23]/.test(byId('futures-fee-breakdown')?.textContent || ''));
    t('the total is NOT printed while the network fee is unknown', /shown at review/.test(byId('futures-fee-breakdown')?.textContent || ''));
    t('the risk verdict is rendered with its score', /\/100/.test(byId('futures-risk')?.textContent || ''));
    t('without a wallet the action is the connect gate', byId('futures-review')?.textContent.trim() === 'Connect wallet');

    /* connect the injected wallet through the same sheet the rest of the app uses */
    await act(async () => { click(byId('futures-review')); });
    await act(async () => { await sleep(150); });
    /* The sheet portals to document.body; pick the INJECTED option (MetaMask
       is what the stub announces), never the WalletConnect one listed first. */
    const injectedBtn = [...document.querySelectorAll('button.wallet-option')].find((b) => /^MetaMask/.test((b.textContent || '').trim())) || null;
    t('the wallet connect sheet opens', !!injectedBtn);
    if (injectedBtn) await act(async () => { click(injectedBtn); });
    await act(async () => { await sleep(600); });
    t('connecting arms the button as "View only" — no order can be built on a READ_ONLY venue', byId('futures-review')?.textContent.trim() === 'View only' && byId('futures-review')?.disabled === true);
    /* the quote re-runs with the wallet attached (debounced 350ms) */
    await act(async () => { await sleep(700); });
    t('the wallet balance shown is the BFF account read, not a placeholder', /500\.00 USDC/.test(container.textContent));
    t('no /prepare call was made while READ_ONLY', bff.prepares === 0);

    /* ═══════ C. AVAILABLE — review → confirm → sign the BFF's calldata ═══════ */
    providerStatus = 'AVAILABLE'; providerReason = null;
    await act(async () => { click(strip[0]); });
    await act(async () => { click(strip[2]); });
    await act(async () => { await sleep(700); });
    t('the status pill flips to Available', byId('futures-provider-status')?.textContent.trim() === 'Available');
    await act(async () => { setInputValue(byId('futures-collateral'), '100'); });
    await act(async () => { setInputValue(byId('futures-leverage'), '10'); });
    await act(async () => { await sleep(600); });
    t('the live quote re-runs on input: $1,000 notional, protocol $0.9, FBT fee $0.5', /\$1,000/.test(byId('futures-fee-breakdown')?.textContent || '') && /Protocol fee\$0\.9/.test(byId('futures-fee-breakdown')?.textContent || '') && /FBT fee \(5 bps\)\$0\.5/.test(byId('futures-fee-breakdown')?.textContent || ''));
    t('allowance is zero so the button offers approve + review', byId('futures-review')?.textContent.trim() === 'Approve exact amount & review' && byId('futures-review')?.disabled === false);

    /* a blocked order: leverage above policy */
    await act(async () => { setInputValue(byId('futures-leverage'), '75'); });
    await act(async () => { await sleep(600); });
    t('75x is BLOCKED by the risk engine and the button is disabled', /50×/.test(byId('futures-risk')?.textContent || '') && byId('futures-review')?.disabled === true);
    await act(async () => { setInputValue(byId('futures-leverage'), '10'); });
    await act(async () => { await sleep(600); });

    await act(async () => { click(byId('futures-review')); });
    await act(async () => { await sleep(800); });
    t('review calls /prepare exactly once with an Idempotency-Key', bff.prepares === 1 && /^fut_open_ostium_[0-9a-f]{16}$/.test(bff.idempotencyKeys[0] || ''));
    t('the prepare body carries the wallet, market, side, size and leverage', (() => { const b = bff.prepareBodies[0] || {}; return b.wallet === ACCOUNT && b.market === '0' && b.side === 'long' && b.collateralUsd === 100 && b.leverage === 10; })());
    const confirm = document.querySelector('[data-testid="futures-confirm"]');
    t('the confirmation preview opens', !!confirm);
    t('the preview shows provider, market, side, notional, entry, fees and risk from /prepare',
      /Ostium/.test(confirm?.textContent || '') && /BTC\/USD/.test(confirm?.textContent || '') && /\$1,000/.test(confirm?.textContent || '') && /\$64,010/.test(confirm?.textContent || '') && /FBT fee \(5 bps\)\$0\.5/.test(confirm?.textContent || '') && /Liquidation distance9\.75% → \$57,769/.test(confirm?.textContent || '') && /RiskLow/.test(confirm?.textContent || ''));
    t('the preview total is complete now that the network fee is estimated: 0.9 + 0.04 + 0.5 = $1.44', /\$1\.44/.test(confirm?.textContent || ''));
    t('the preview announces the approval step', /approve exactly \$100/.test(confirm?.textContent || ''));
    t('the preview carries the execution id for the ledger', /fut_exec_/.test(confirm?.textContent || ''));

    await act(async () => { click(document.querySelector('[data-testid="futures-confirm-submit"]')); });
    await act(async () => { await sleep(1200); });

    t('the wallet signed exactly two transactions: approve, then open', sent.length === 2);
    const approveTx = sent[0] || {}; const openTx = sent[1] || {};
    t('the approval is an EXACT USDC allowance to TradingStorage, not the Trading contract and not unlimited', (() => {
      if (String(approveTx.to || '').toLowerCase() !== USDC.toLowerCase()) return false;
      const [spender, amount] = erc20Iface.decodeFunctionData('approve', approveTx.data);
      return String(spender).toLowerCase() === SPENDER.toLowerCase() && BigInt(amount) === 100_000_000n;
    })());
    t('the order is openTrade on the Ostium Trading contract with the reviewed fields', (() => {
      if (String(openTx.to || '').toLowerCase() !== TRADING.toLowerCase()) return false;
      const [trade, bf, orderType, slippage] = openIface.decodeFunctionData('openTrade', openTx.data);
      return BigInt(trade.collateral) === 100_000_000n && Number(trade.leverage) === 1000 && Number(trade.pairIndex) === 0 && trade.buy === true
        && String(trade.trader).toLowerCase() === ACCOUNT && String(bf.builder).toLowerCase() === BUILDER.toLowerCase() && Number(bf.builderFee) === 50_000 && Number(orderType) === 0 && Number(slippage) === 50;
    })());
    t('the fee in the calldata equals the fee the preview showed (5 bps → 50000 units)', (() => { const [, bf] = openIface.decodeFunctionData('openTrade', openTx.data || '0x'); return Number(bf.builderFee) === 50_000; })());
    t('the tx hash was reported to /verify', bff.verifies.some((v) => v.txHash === hashes[1] && /^fut_exec_/.test(v.executionId)));
    t('the tab reports the submitted transaction with an explorer link', !!byId('futures-last-tx') && /arbiscan\.io\/tx\//.test(byId('futures-last-tx')?.querySelector('a')?.getAttribute('href') || ''));
    t('the page is still /perp — no hand-off anywhere', window.location.hash.startsWith('#/perp'));
    await act(async () => { await sleep(600); });
    t('after confirmation the tab shows the COMPLETED state', /confirmed on-chain/i.test(byId('futures-last-tx')?.textContent || ''));

    /* ═══════ D. the other tabs are untouched ═══════ */
    await act(async () => { click(strip[1]); });
    await act(async () => { await sleep(500); });
    t('the dYdX tab still mounts', /dYdX/.test(container.textContent));
    await act(async () => { click(strip[0]); });
    await act(async () => { await sleep(200); });
    t('the Perpetual overview still renders after the round trip', !!q('.perp-liq'));

    /* ═══════ D2. the dYdX tab shows no demo markets while its indexer is down ═══════ */
    /* The stub answers 404 for every non-futures /api route, i.e. the dYdX
       indexer proxy is unreachable. The old client swapped in a fabricated
       catalogue here; Futures Engine v3 forbids that on a leverage screen. */
    await act(async () => { click(strip[1]); });
    await act(async () => { await sleep(600); });
    t('with the indexer unreachable the dYdX tab lists NO markets and says the indexer is unavailable',
      !container.querySelector('select option[value="BTC-USD"]') && /indexer is unavailable/i.test(container.textContent));
    t('...and never labels anything as a sample/demo series', !/sample|demo/i.test(container.textContent));
    await act(async () => { click(strip[0]); });

    /* ═══════ D3. Intent OS hand-off: the URL pre-fills, it never executes ═══════ */
    /* «BTC → لانگ → 5x → 100$ → انجامش بده» arrives as a deep link. */
    const preparesBefore = bff.prepares; const sentBefore = sent.length;
    await mountAt('#/perp?tab=onchain&market=XAU&side=short&collateral=120&leverage=7');
    await act(async () => { await sleep(900); });
    t('the deep link opens the On-Chain tab directly', tabs()[2]?.getAttribute('aria-selected') === 'true' && !!byId('futures-market-select'));
    t('the requested market is selected (and its category tab followed): XAU/USD', byId('futures-market-select')?.value === '12' && qa('.tag').some((b) => /Commodities/.test(b.textContent) && b.classList.contains('active')));
    t('side, collateral and leverage are pre-filled from the draft', q('.dir-btn.short')?.classList.contains('active') === true && byId('futures-collateral')?.value === '120' && byId('futures-leverage')?.value === '7');
    t('a deep link builds and signs NOTHING by itself', bff.prepares === preparesBefore && sent.length === sentBefore && !document.querySelector('[data-testid="futures-confirm"]'));
    /* A fresh mount has no wallet session, so the action is the connect gate;
       the verdict itself must already be the backend's: XAU is closed → BLOCKED. */
    t('the quote/risk for the prefilled leg is re-derived by the backend (closed market → blocked)', /closed right now/i.test(byId('futures-risk')?.textContent || '') && /Extreme/.test(byId('futures-risk')?.textContent || '') && byId('futures-review')?.textContent.trim() === 'Connect wallet');
    /* leverage beyond protocol limits in a link is clamped, never honoured */
    await mountAt('#/perp?tab=onchain&market=XAU&leverage=400');
    await act(async () => { await sleep(900); });
    t('a link asking for 400× is clamped to the market maximum (50×) — never above protocol limits', Number(byId('futures-leverage')?.value) <= 50);
    await mountAt('#/perp');
    const strip2 = tabs();
    await act(async () => { click(strip2[2]); });
    await act(async () => { await sleep(500); });

    /* ═══════ E. Persian: RTL strings for the tab and the fallback ═══════ */
    /* Locales are lazy-loaded; setLanguage fetches fa.json then switches. */
    const faOk = await setLanguage('fa');
    await act(async () => { await sleep(300); });
    t('the Persian locale loads and becomes active', faOk === true && i18n.language === 'fa');
    t('the document flips to RTL for Persian', document.documentElement.getAttribute('dir') === 'rtl');
    t('the tab strip reads پرپچوال · مدار dYdX · آن‌چین in Persian', tabs().map((b) => b.textContent.trim()).join('|') === 'پرپچوال|مدار dYdX|آن‌چین');
    t('no unexpected console errors', errors.length === 0 || (console.log(errors.slice(0, 3)), false));
  } finally {
    if (root) await act(async () => { root.unmount(); });
    console.error = realError;
    globalThis.fetch = realFetch;
    delete window.ethereum;
  }
  return out;
}
