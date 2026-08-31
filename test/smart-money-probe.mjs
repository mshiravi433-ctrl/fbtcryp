/**
 * SMART MONEY — ACCEPTANCE PROBE
 * ---------------------------------------------------------------------------
 * Runs the REAL modules and the REAL Express app (no network) and proves the
 * on-chain intelligence layer behaves honestly:
 *
 *   · engines score what they are given and skip missing factors (coverage)
 *   · accumulation/distribution cross their configured thresholds
 *   · risk emits +/- reasons and never a band out of range
 *   · wallets are classified with behaviour tags; "insider" is NEVER asserted,
 *     only "INSIDER_LIKE_BEHAVIOR"
 *   · the exchange registry only labels curated addresses; an unknown
 *     counterparty stays unknown (no fabricated exchange flow)
 *   · data sources fail closed when the upstream returns nothing
 *   · every documented API route exists and answers the documented schema
 *   · watchlist add/delete works and the alert cycle delivers a real push
 *     payload for a matching tracked wallet — and nothing for a non-match
 *
 * External HTTP is stubbed; our own code paths are all the real thing.
 */

/* ── Part 1: pure engines + registry (no server) ───────────────────────── */

const results = [];
const t = (name, ok) => results.push({ name, ok: Boolean(ok) });

import http from 'node:http';

const engines = await import('../server/smartMoney/engines.js');
const registry = await import('../server/smartMoney/registry.js');
const config = await import('../server/smartMoney/config.js');
const ds = await import('../server/smartMoney/dataSources.js');

{
  // Detection thresholds
  const strong = engines.detectAccumulation({ netBuying: 0.95, holderGrowth: 0.9, smartMoneyBuying: 0.9, exchangeOutflow: 0.8, liquidityGrowth: 0.8 });
  t('accumulation detected with strong independent signals', strong.detected === true && strong.confidence >= config.ACCUMULATION.threshold);
  const weak = engines.detectAccumulation({ netBuying: 0.05 });
  t('weak accumulation does NOT cross threshold', weak.detected === false && weak.confidence < config.ACCUMULATION.threshold);

  const distStrong = engines.detectDistribution({ netSelling: 0.9, holderDecline: 0.7, smartMoneySelling: 0.9, exchangeInflow: 0.8, topHolderReduction: 0.7 });
  t('distribution detected with strong signals', distStrong.detected === true && distStrong.confidence >= config.DISTRIBUTION.threshold);

  // Coverage: missing factors reduce coverage, never fabricate
  const partial = engines.calculateSmartMoneyScore({ profitability: 0.9 });
  t('score with one factor reports partial coverage', partial.score > 0 && partial.coverage > 0 && partial.coverage < 1);
  const empty = engines.calculateSmartMoneyScore({});
  t('score with no factors is 0 with 0 coverage', empty.score === 0 && empty.coverage === 0);

  // Risk band + reasons
  const risky = engines.calculateWalletRisk({ scamInteraction: 1, extremeConcentration: 0.95, lowLiquidityTokens: 0.9 });
  t('high-risk wallet lands in HIGH band with reasons', risky.band === 'HIGH' && risky.reasons.minus.length >= 2);
  const safe = engines.calculateWalletRisk({ scamInteraction: 0, extremeConcentration: 0.1, lowLiquidityTokens: 0.05, cexExposure: 0.1, longTermHolding: true });
  t('low-risk wallet lands in LOW band with positive reasons', safe.band === 'LOW' && safe.reasons.plus.length >= 2);

  // Classification: never bare "insider"
  const tags = engines.classifyWallet({ portfolioUsd: 20_000_000, realizedPnlUsd: 2_000_000, winRate: 72, trades: 40, earlyEntries: 6, volume30dUsd: 40_000_000, dexTradeShare: 0.9 });
  t('classified wallet carries SMART_MONEY + WHALE tags', tags.includes('SMART_MONEY') && tags.includes('WHALE'));
  t('never asserts INSIDER — only INSIDER_LIKE_BEHAVIOR', tags.every((x) => x !== 'INSIDER' && x !== 'INSIDER_TRADER'));

  // Registry discipline
  const binance = registry.exchangeFor(1, '0x28c6c06298d514db089934071355e5743bf21d60');
  t('known Binance hot wallet is labelled', !!binance && binance.exchange === 'Binance' && binance.confidence === 'high');
  const unknown = registry.exchangeFor(1, '0x1234567890abcdef1234567890abcdef12345678');
  t('unknown address is NOT labelled (no fabricated flow)', unknown === null);
  const manifest = registry.registryManifest();
  t('registry manifest exposes exchanges and sources', Array.isArray(manifest.exchanges) && manifest.exchanges.includes('Binance') && manifest.sources.length >= 1);
  t('registry contains real DEX routers', registry.routerFor(1, '0x7a250d5630b4cf539739df2c5dacb4c659f2488d')?.dex === 'Uniswap');
}

/* ── Part 2: data sources fail closed with a black-hole fetch ──────────── */

{
  ds.__setFetchForTests(() => { throw new Error('network blocked'); });
  const pairs = await ds.dexPairsForTokens(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48']);
  t('DexScreener source fails closed (no throw, unavailable)', pairs.dataStatus === 'unavailable' && Array.isArray(pairs.pairs));
  const txfrs = await ds.bsTokenTransfers(1, '0x28c6c06298d514db089934071355e5743bf21d60');
  t('Blockscout transfers fail closed', ['unavailable', 'unsupported-chain'].includes(txfrs.dataStatus));
  const sol = await ds.solBalance('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9');
  t('Solana RPC fails closed', sol.dataStatus === 'unavailable');
  ds.__setFetchForTests(null);

  // Query classification (pure, offline)
  t('classifies EVM address', ds.classifyQuery('0x28c6c06298d514db089934071355e5743bf21d60').kind === 'address');
  t('classifies EVM tx hash', ds.classifyQuery('0x' + 'ab'.repeat(32)).kind === 'tx');
  t('classifies symbol', ds.classifyQuery('ETH').kind === 'symbol');
  t('classifies Solana address', ds.classifyQuery('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9').chain === 'solana');
}

/* ── Part 3: real Express app routes ──────────────────────────────────── */

process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve, reject) => {
  const l = app.listen(0, '127.0.0.1', () => resolve(l));
  l.once('error', reject);
});

/*
 * Calls to our OWN localhost server must not go through the global fetch,
 * because earlier probes in the same process may leave a black-hole global
 * fetch in place. Node's built-in http module is a separate binding.
 */
const call = (path, opts = {}) => new Promise((resolve, reject) => {
  const url = new URL(`http://127.0.0.1:${server.address().port}${path}`);
  const payload = opts.body || null;
  const req = http.request(
    {
      method: opts.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) }
    },
    (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch { /* non-json */ }
        resolve({ status: res.statusCode, body });
      });
    }
  );
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

try {
  const ov = await call('/api/v1/smart-money/overview?window=24h');
  t('overview route responds 200 with schema', ov.status === 200 && ov.body.schema === 'fbt.smart-money-overview.v1');
  t('overview carries metrics + flows + windows', !!ov.body.metrics && !!ov.body.flows?.windows?.['24h']);

  const whales = await call('/api/v1/smart-money/whales');
  t('whales route responds with wallet board schema', whales.status === 200 && whales.body.schema === 'fbt.smart-money-whales.v1' && Array.isArray(whales.body.wallets));

  const flows = await call('/api/v1/smart-money/flows');
  t('flows route responds with inflow/outflow windows', flows.status === 200 && typeof flows.body.windows?.['24h']?.inflowUsd === 'number');

  const exchanges = await call('/api/v1/smart-money/exchanges');
  t('exchanges registry route lists exchanges + sources', exchanges.status === 200 && Array.isArray(exchanges.body.exchanges) && exchanges.body.count > 0);

  const liq = await call('/api/v1/smart-money/liquidity');
  t('liquidity route responds with events array', liq.status === 200 && Array.isArray(liq.body.events));

  const early = await call('/api/v1/smart-money/early-tokens');
  t('early tokens route responds', early.status === 200 && Array.isArray(early.body.tokens));

  const fresh = await call('/api/v1/smart-money/fresh-wallets');
  t('fresh wallets route responds', fresh.status === 200 && Array.isArray(fresh.body.wallets));

  // Wallet lookup: bad address rejected 400
  const badWallet = await call('/api/v1/smart-money/wallet/1/0xnotanaddress');
  t('wallet route rejects malformed address with 400', badWallet.status === 400 && badWallet.body.error === 'BAD_ADDRESS');

  // Token lookup: bad address rejected
  const badToken = await call('/api/v1/smart-money/token/1/0xdead');
  t('token route rejects malformed address with 400', badToken.status === 400);

  // Solana wallet route exists
  const solWallet = await call('/api/v1/smart-money/wallet/solana/5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9');
  t('solana wallet route responds 200', solWallet.status === 200 && solWallet.body.chainKind === 'solana');

  /* Watchlist + alerts */
  const identity = 'https://push.example.com/smart-money-probe-subscription';
  const tracked = '0x28c6c06298d514db089934071355e5743bf21d60'; // a labelled Binance wallet
  const addRes = await call('/api/v1/smart-money/watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identity, lang: 'en',
      rows: [{ id: 'w1', chain: 1, address: tracked, target: 'wallet', label: 'Test whale', types: ['LARGE_BUY', 'EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL', 'TRANSFER'] }]
    })
  });
  t('watchlist POST stores a tracked wallet', addRes.status === 200 && addRes.body.ok === true && addRes.body.count === 1);

  const listRes = await call(`/api/v1/smart-money/watchlist?identity=${encodeURIComponent(identity)}`);
  t('watchlist GET returns the tracked row', listRes.status === 200 && listRes.body.rows?.length === 1 && listRes.body.rows[0].address === tracked);

  // Alert cycle with a delivering transport → should evaluate without crashing.
  // (Network is black-holed, so the event source degrades to empty: fired may
  //  be 0, but the cycle MUST return a well-formed result and not throw.)
  const sm = await import('../server/smartMoney/index.js');
  let delivered = 0;
  const cycle = await sm.runAlertCycle(async () => { delivered += 1; return true; });
  t('alert cycle evaluates and returns checked/fired/delivered', typeof cycle.checked === 'number' && typeof cycle.fired === 'number' && typeof cycle.delivered === 'number');

  // DELETE the row
  const delRes = await call(`/api/v1/smart-money/watchlist/w1?identity=${encodeURIComponent(identity)}`, { method: 'DELETE' });
  t('watchlist DELETE removes the tracked row', delRes.status === 200 && delRes.body.ok === true);
  const after = await call(`/api/v1/smart-money/watchlist?identity=${encodeURIComponent(identity)}`);
  t('watchlist empty after delete', after.body.rows.length === 0);

  // Alerts route for an identity
  const alerts = await call(`/api/v1/smart-money/alerts?identity=${encodeURIComponent(identity)}`);
  t('alerts route responds with alerts array', alerts.status === 200 && Array.isArray(alerts.body.alerts));

  /* Positive alert delivery: re-add a watch, then run a cycle with an injected
     REAL-shape event in which the tracked wallet withdraws from a labelled
     exchange. The push transport must receive exactly one SMART_MONEY payload;
     a non-matching wallet must not. This proves detect → alert → notify. */
  const watchWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await call('/api/v1/smart-money/watchlist', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identity, lang: 'en',
      rows: [{ id: 'pos1', chain: 1, address: watchWallet, target: 'wallet', types: ['EXCHANGE_WITHDRAWAL', 'EXCHANGE_DEPOSIT'] }]
    })
  });
  const smWatch = await import('../server/smartMoney/watchlist.js');
  let pushes = [];
  const matchingEvent = {
    id: 'ev-1', chainId: 1, hash: '0x' + 'cd'.repeat(32), timestamp: Date.now(),
    valueUsd: 1_400_000,
    token: { symbol: 'ETH', address: null },
    from: { address: '0x28c6c06298d514db089934071355e5743bf21d60' }, // Binance
    to: { address: watchWallet },
    flow: 'cex_out', exchange: 'Binance', explorerTx: 'https://etherscan.io/tx/x'
  };
  const otherEvent = { ...matchingEvent, id: 'ev-2', to: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } };
  const posCycle = await smWatch.runAlertCycle(
    async (ep, lang, payload) => { pushes.push({ ep, lang, payload }); return true; },
    { events: [matchingEvent, otherEvent] }
  );
  t('alert cycle fires+delivers for the tracked wallet only', posCycle.fired === 1 && posCycle.delivered === 1 && pushes.length === 1);
  t('delivered push is tagged SMART_MONEY and links to the wallet', pushes[0]?.payload?.type === 'SMART_MONEY' && /wallet/.test(pushes[0]?.payload?.url || ''));
  t('push never carries an execution instruction (observe/notify only)', !/^(buy|sell|swap|execute)/i.test(pushes[0]?.payload?.title || ''));
  // cleanup
  await call(`/api/v1/smart-money/watchlist/pos1?identity=${encodeURIComponent(identity)}`, { method: 'DELETE' });
} catch (e) {
  t(`probe runtime did not throw: ${e.message}`, false);
  console.error(e);
} finally {
  server.close();
}

/* ── report ───────────────────────────────────────────────────────────── */

export default results;
