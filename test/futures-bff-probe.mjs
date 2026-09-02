/**
 * FBT FUTURES BFF PROBE — real HTTP against the real server/app.js.
 * ---------------------------------------------------------------------------
 * What only an HTTP test can pin (spec §19, §21, §24, §26):
 *   · every /api/v1/futures route exists and answers JSON (no 404 on the
 *     published surface);
 *   · the provider registry answers with the six-word status vocabulary and
 *     never lists a centralized exchange;
 *   · write routes refuse without an Idempotency-Key and without a wallet,
 *     with stable error codes and a requestId;
 *   · when the venue feed is unreachable (CI has no egress) the answer is
 *     UNAVAILABLE / PROVIDER_UNAVAILABLE — never a fabricated market, quote,
 *     position or fee total;
 *   · the fee preview is computed server-side and its total is null while a
 *     component is unknown;
 *   · the ledger reports its durability honestly.
 *
 * Network-dependent outcomes (a live Ostium quote) are asserted only as
 * invariants: unsigned by construction, allowlisted target, fee ≤ ceiling.
 */
const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
const base = `http://127.0.0.1:${server.address().port}`;

const get = async (path) => { const res = await fetch(base + path); let json = null; try { json = await res.json(); } catch { /* not json */ } return { status: res.status, json, headers: res.headers }; };
const post = async (path, body, headers = {}) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};

const WALLET = '0x1111111111111111111111111111111111111111';
const STATUSES = new Set(['AVAILABLE', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE', 'MAINTENANCE', 'BLOCKED']);
const CEX = ['binance', 'bybit', 'kucoin', 'mexc', 'okx'];

try {
  /* ── registry / health ─────────────────────────────────────────────── */
  const health = await get('/api/v1/futures/health');
  t('GET /health answers the engine snapshot', health.status === 200 && health.json?.ok === true && health.json.data.engine === 'fbt-futures-engine');
  t('health declares no keys, wallet-only signing and no CEX trading APIs',
    health.json?.data?.security?.privateKeys === 'never-held' && health.json.data.security.signing === 'wallet-only' && health.json.data.security.cexTradingApis === 'none');
  t('health reports ledger durability as a boolean, not a promise', typeof health.json?.data?.ledger?.durable === 'boolean');

  const prov = await get('/api/v1/futures/providers');
  const providers = prov.json?.data?.providers || [];
  t('GET /providers lists the registry', prov.status === 200 && providers.length >= 2);
  t('every provider status is one of the six spec words', providers.every((p) => STATUSES.has(p.status)));
  t('no centralized exchange appears as a provider', providers.every((p) => !CEX.includes(p.providerId)));
  t('a provider without a built order path is never executable', providers.filter((p) => p.execution === 'NOT_BUILT').every((p) => p.executable === false && p.status !== 'AVAILABLE'));
  t('only AVAILABLE/DEGRADED providers can be executable', providers.every((p) => !p.executable || ['AVAILABLE', 'DEGRADED'].includes(p.status)));
  t('each provider carries capability flags and a reason when not AVAILABLE',
    providers.every((p) => p.capabilities && typeof p.capabilities.canExecute === 'boolean' && (p.status === 'AVAILABLE' || p.reason)));
  const ostium = providers.find((p) => p.providerId === 'ostium');
  const ostiumLive = Boolean(ostium && ['AVAILABLE', 'DEGRADED'].includes(ostium.status));

  /* ── market data: honest when the feed is down ─────────────────────── */
  const mk = await get('/api/v1/futures/markets?provider=ostium');
  if (ostiumLive) {
    t('markets answer with live rows when the feed is up', mk.status === 200 && Array.isArray(mk.json?.data?.markets) && mk.json.data.markets.length > 0);
    t('every market row has a real mid price and a max leverage', mk.json.data.markets.every((m) => m.mid > 0 && (m.maxLeverage == null || m.maxLeverage > 0)));
  } else {
    t('markets answer PROVIDER_UNAVAILABLE (503) instead of an invented list', mk.status === 503 && mk.json?.error?.code === 'PROVIDER_UNAVAILABLE');
  }
  const gmx = await get('/api/v1/futures/markets?provider=gmx');
  t('an unbuilt provider is refused honestly, not served from a cache', gmx.status === 409 && ['NOT_CONFIGURED', 'PROVIDER_READ_ONLY'].includes(gmx.json?.error?.code));
  const cex = await get('/api/v1/futures/markets?provider=binance');
  t('a CEX id is not a provider at all', cex.status === 404);
  const candles = await get('/api/v1/futures/candles?provider=ostium&market=0&resolution=60&limit=10');
  t('candles never fabricate: empty + live:false when the feed is down', candles.status === 200 && (candles.json?.data?.live === true ? candles.json.data.candles.length > 1 : candles.json?.data?.candles?.length === 0));
  const badRes = await get('/api/v1/futures/candles?provider=ostium&market=0&resolution=7D');
  t('an unknown candle resolution is normalised, never forwarded upstream', badRes.status === 200 && badRes.json?.data?.resolution === '60');

  /* ── fees: backend truth ───────────────────────────────────────────── */
  const fees = await get('/api/v1/futures/fees?provider=ostium&collateral=100&leverage=10');
  t('GET /fees computes the FBT fee server-side on notional', fees.status === 200 && fees.json?.data?.fee?.notionalUsd === 1000 && fees.json.data.fee.fbt.feeUsd === (1000 * fees.json.data.fee.fbt.bps) / 10_000);
  t('the FBT fee never exceeds 10 bps', fees.json?.data?.fee?.fbt?.bps <= 10);
  t('the total is null while the network fee is unknown (no partial "total")', fees.json?.data?.fee?.totalFeeUsd === null && fees.json.data.fee.complete === false);
  t('the fee breakdown names its recipient and when it is charged', /^0x[0-9a-fA-F]{40}$/.test(fees.json?.data?.fee?.fbt?.recipient || '') && fees.json.data.fee.fbt.chargedOn === 'open');
  const feesBad = await get('/api/v1/futures/fees?provider=ostium&collateral=abc');
  t('a fee preview with bad input is INVALID_INPUT', feesBad.status === 400 && feesBad.json?.error?.code === 'INVALID_INPUT');
  const ledger = await get('/api/v1/futures/fees/ledger');
  t('GET /fees/ledger answers summary + rows and states durability', ledger.status === 200 && ledger.json?.data?.summary && Array.isArray(ledger.json.data.rows) && typeof ledger.json.meta.durable === 'boolean');

  /* ── write routes: gates before any provider call ──────────────────── */
  const noIdem = await post('/api/v1/futures/prepare', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: WALLET });
  t('POST /prepare without Idempotency-Key is refused', noIdem.status === 400 && noIdem.json?.error?.code === 'IDEMPOTENCY_KEY_REQUIRED' && /^fut_req_/.test(noIdem.json.error.requestId));
  const noWallet = await post('/api/v1/futures/prepare', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10 }, { 'idempotency-key': 'fut_probe_nowallet_01' });
  t('POST /prepare without a wallet is WALLET_NOT_CONNECTED (never assumes one)', noWallet.status === 400 && noWallet.json?.error?.code === 'WALLET_NOT_CONNECTED');
  const badWallet = await post('/api/v1/futures/prepare', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: '0xnot-an-address' }, { 'idempotency-key': 'fut_probe_badwallet_01' });
  t('a malformed wallet is refused', badWallet.status === 400);
  const noIdemExec = await post('/api/v1/futures/execute', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: WALLET });
  t('POST /execute has the same idempotency gate as /prepare', noIdemExec.status === 400 && noIdemExec.json?.error?.code === 'IDEMPOTENCY_KEY_REQUIRED');
  const noIdemClose = await post('/api/v1/futures/positions/ostium:0:0/close', { wallet: WALLET });
  t('position management requires an Idempotency-Key too', noIdemClose.status === 400 && noIdemClose.json?.error?.code === 'IDEMPOTENCY_KEY_REQUIRED');
  const badPos = await post('/api/v1/futures/positions/garbage/close', { wallet: WALLET }, { 'idempotency-key': 'fut_probe_badpos_01' });
  t('a malformed position id is INVALID_INPUT or a provider refusal, never a build', badPos.status >= 400 && badPos.json?.ok === false);

  const prep = await post('/api/v1/futures/prepare', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: WALLET }, { 'idempotency-key': 'fut_probe_prepare_01' });
  if (ostiumLive && prep.status === 200) {
    const d = prep.json.data;
    t('a live prepare returns request/execution ids and the idempotency key', /^fut_req_/.test(d.requestId) && /^fut_exec_/.test(d.executionId) && d.idempotencyKey === 'fut_probe_prepare_01');
    t('every returned transaction is UNSIGNED and wallet-only', d.transactions.length > 0 && d.transactions.every((tx) => tx.signed === false && tx.broadcast === false && tx.capabilities.sign === 'wallet-only'));
    t('every transaction target is an allowlisted Ostium contract', d.transactions.every((tx) => ['0x6d0ba1f9996dbd8885827e1b2e8f6593e7702411', '0xaf88d065e77c8cc2239327c5edb3a432268e5831'].includes(String(tx.to).toLowerCase())));
    t('the prepared fee breakdown is complete or explains what is unknown', d.fee && (d.fee.complete || d.fee.totalFeeUsd === null));
    t('the risk verdict travels with the prepared order', d.risk && typeof d.risk.riskScore === 'number' && Array.isArray(d.risk.warnings));
    const replay = await post('/api/v1/futures/prepare', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: WALLET }, { 'idempotency-key': 'fut_probe_prepare_01' });
    t('the same key replays the same execution (no second build)', replay.status === 200 && replay.json?.data?.executionId === d.executionId && replay.json.meta.replay === true);
    const conflict = await post('/api/v1/futures/prepare', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 101, leverage: 10, wallet: WALLET }, { 'idempotency-key': 'fut_probe_prepare_01' });
    t('the same key with different content is IDEMPOTENCY_CONFLICT', conflict.status === 409 && conflict.json?.error?.code === 'IDEMPOTENCY_CONFLICT');
  } else {
    t('with the feed down, prepare refuses with a provider status — no unsigned tx is built', [409, 503].includes(prep.status) && prep.json?.ok === false && ['PROVIDER_UNAVAILABLE', 'PROVIDER_READ_ONLY', 'FEED_STALE'].includes(prep.json.error.code) && !prep.json.data);
    t('...and the refusal carries the provider health it was based on', Boolean(prep.json?.error?.provider?.status || prep.json?.error?.detail));
  }

  const quote = await post('/api/v1/futures/quote', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 100, leverage: 10 });
  t('quote never invents a market: 200 with live data or a provider error', quote.status === 200 ? quote.json.data.market.mid > 0 && quote.json.data.fee && quote.json.data.risk : quote.json?.ok === false);
  const quoteBad = await post('/api/v1/futures/quote', { provider: 'ostium', market: '0', side: 'long', collateralUsd: 0, leverage: 10 });
  t('quote with zero collateral is INVALID_INPUT or a provider error, never a number', quoteBad.json?.ok === false);

  const pos = await get(`/api/v1/futures/positions/${WALLET}`);
  /* The default on-chain venue is Drift (Solana): its read-only adapter answers
     PROVIDER_READ_ONLY — an honest refusal, never an invented position list. */
  t('positions are never cached and never invented', pos.headers.get('cache-control') === 'no-store' && (pos.status === 200 ? Array.isArray(pos.json.data.positions) : ['PROVIDER_UNAVAILABLE', 'PROVIDER_READ_ONLY'].includes(pos.json?.error?.code)));

  /* Drift (Solana) is the on-chain tab venue: markets/candles/fees must answer
     live data or an honest provider error — never an Ostium-shaped payload. */
  const driftProviders = await get('/api/v1/futures/providers');
  const driftRow = driftProviders.json?.data?.providers?.find((p) => p.providerId === 'drift');
  t('Drift is registered for the on-chain tab on Solana', driftRow && driftRow.chainName === 'Solana' && driftRow.tab === 'onchain');
  const driftMarkets = await get('/api/v1/futures/markets?provider=drift');
  t('Drift markets answer live crypto perps or an honest provider error', driftMarkets.status === 200
    ? driftMarkets.json.data.markets.every((m) => m.category === 'crypto' && m.mid > 0)
    : driftMarkets.json?.ok === false);
  const driftFees = await get('/api/v1/futures/fees?provider=drift&collateral=100&leverage=10&market=0');
  t('Drift fee preview uses Drift venue fees (no Ostium oracle flat fee)', driftFees.status === 200
    ? driftFees.json.data.fee.protocol.flatUsd === 0 && (driftFees.json.data.fee.protocol.bps === 5 || driftFees.json.data.fee.protocol.bps === null)
    : driftFees.json?.ok === false);
  /* Drift order path: the server builds NO calldata and holds no key. With a
     live feed it returns a client-builds payload (empty transactions[],
     clientSign.buildsInTab, Solana program id); with the feed down in CI it
     refuses honestly with the provider health — never an EVM unsigned tx. */
  const SOL_WALLET = 'DRfFtYV4BHJoJEZx8LZ4FqfKnGkm8fQaLt8QxN3FgGd';
  const driftPrepare = await post('/api/v1/futures/prepare', { provider: 'drift', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: SOL_WALLET }, { 'idempotency-key': 'fut_probe_drift_prep_01' });
  const d = driftPrepare.json?.data;
  t('Drift /prepare returns the client-builds-tx payload or an honest refusal',
    driftPrepare.json?.ok === true
      ? d.clientSign?.family === 'solana' && d.clientSign?.buildsInTab === true
        && Array.isArray(d.transactions) && d.transactions.length === 0
        && d.market?.marketIndex === 0 && d.state === 'PREPARED'
        && d.clientSign?.program === 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'
      : ['PROVIDER_UNAVAILABLE', 'PROVIDER_READ_ONLY', 'FEED_STALE'].includes(driftPrepare.json?.error?.code));
  const driftBadWallet = await post('/api/v1/futures/prepare', { provider: 'drift', market: '0', side: 'long', collateralUsd: 100, leverage: 10, wallet: 'not-a-wallet' }, { 'idempotency-key': 'fut_probe_drift_badw_01' });
  t('Drift /prepare rejects a wallet that is neither an EVM nor a Solana address', driftBadWallet.status === 400 && driftBadWallet.json?.error?.code === 'WALLET_NOT_CONNECTED');
  /* An EVM-shaped hash must never be accepted as a Drift receipt: the unknown
     execution still 404s first, but a well-formed id + Solana record would
     hit isSolanaSignature; here we pin that the route never fabricates a
     confirmation for a non-existent execution regardless of hash shape. */
  const driftVerify = await post('/api/v1/futures/verify', { executionId: 'fut_exec_00000000-0000-0000-0000-000000000000', txHash: `${'1'.repeat(87)}` });
  t('verify of an unknown execution still 404s even with a Solana-shaped signature', driftVerify.status === 404);
  const posBad = await get('/api/v1/futures/positions/not-a-wallet');
  t('positions for a malformed wallet are INVALID_INPUT', posBad.status === 400);
  const verify = await post('/api/v1/futures/verify', { executionId: 'fut_exec_00000000-0000-0000-0000-000000000000', txHash: `0x${'1'.repeat(64)}` });
  t('verify of an unknown execution is a 404, not a fabricated confirmation', verify.status === 404);
  const execs = await get(`/api/v1/futures/executions/${WALLET}`);
  t('executions per wallet answer an array', execs.status === 200 && Array.isArray(execs.json?.data?.executions));
} finally {
  server.close();
}

export default rows;
