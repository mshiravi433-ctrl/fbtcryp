/**
 * LENDING BFF PROBE — real HTTP against the real server/app.js.
 * ---------------------------------------------------------------------------
 * What only an HTTP test can pin (§30/§31/§17/§26-§28 of the lending spec):
 *   · the BFF is a build-only surface: every transaction payload it returns
 *     is UNSIGNED by construction, with sign/broadcast pinned to wallet-only
 *     — a backend that cannot move funds, proven over the wire;
 *   · the contract-address allowlist rejects unknown assets BEFORE any RPC is
 *     dialed (this probe asserts the offline paths, so it passes even where
 *     egress to public RPCs is blocked — and it must not hang there);
 *   · POSTs without a valid Idempotency-Key header are refused;
 *   · the circuit breaker's READ_ONLY gate refuses transaction builds and the
 *     /status payload is exactly the banner the UI renders;
 *   · invalid wallets/amounts fail closed with stable error codes.
 *
 * Network-dependent outcomes (a real quote against a live RPC) are asserted
 * only as invariants — never fabricated success, never a signed payload —
 * because CI may or may not have egress. The invariant is the security
 * property, not the upstream's mood.
 */
import { LENDING_ERRORS } from '../src/lib/lending-engine/index.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;

const get = async (path) => {
  const res = await fetch(base + path);
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};

const post = async (path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};

const WALLET = '0x1111111111111111111111111111111111111111';
const IDEM = 'lnd_probe_0000000001';

try {
  /* ── §27/§28: status + read-only invariants ─────────────────────────── */
  const status1 = await get('/api/lending/status');
  t('GET /status answers the circuit snapshot', status1.status === 200 && status1.json?.data?.state);
  t('read-only always implies transactions are refused',
    !status1.json?.data?.readOnly || status1.json?.data?.canTransact === false);

  /* ── §5: network registry with feature flags ────────────────────────── */
  const networks = await get('/api/lending/networks');
  const nets = networks.json?.data || [];
  t('GET /networks lists the wired chains with feature flags and pool addresses',
    networks.status === 200 && nets.length >= 5
    && nets.every((n) => n.enabled === true && /^0x[0-9a-fA-F]{40}$/.test(n.pool) && n.chainId > 0));
  t('the response says which protocol and oracle feed each chain uses',
    nets.every((n) => n.protocols.includes('aave-v3') && n.oracle === 'aave-oracle'));

  /* ── offline validation paths (§31 allowlist, §17 idempotency) ───────── */
  const badNet = await get('/api/lending/markets?network=999999');
  t('an unwired network is refused 404 without dialing anything',
    badNet.status === 404 && badNet.json?.error?.code === 'UNSUPPORTED_CHAIN');

  const badMarket = await get('/api/lending/markets/SCAM?network=42161');
  t('an asset outside the allowlist is refused 404 before any RPC',
    badMarket.status === 404 && badMarket.json?.error?.code === 'NOT_A_RESERVE');

  const badWalletPos = await get('/api/lending/positions/not-a-wallet');
  t('a malformed wallet is refused 400',
    badWalletPos.status === 400 && badWalletPos.json?.error?.code === 'BAD_REQUEST');

  const txList = await get(`/api/lending/transactions/${WALLET}`);
  t('GET /transactions/:wallet returns the unsigned build log',
    txList.status === 200 && Array.isArray(txList.json?.data) && txList.json?.meta?.source === 'memory'
    && /nothing is ever broadcast/i.test(txList.json?.meta?.note || ''));

  const noKey = await post('/api/lending/quote/supply', { network: 42161, asset: 'USDC', amount: '1', wallet: WALLET });
  t('a quote POST without Idempotency-Key is refused',
    noKey.status === 400 && (noKey.json?.error?.code === 'IDEMPOTENCY_KEY_REQUIRED' || noKey.json?.error?.code === 'READ_ONLY_MODE'));

  const badKey = await post('/api/lending/quote/supply',
    { network: 42161, asset: 'USDC', amount: '1', wallet: WALLET }, { 'Idempotency-Key': 'short' });
  t('a malformed Idempotency-Key is refused',
    badKey.status === 400 && badKey.json?.error?.code === 'IDEMPOTENCY_KEY_REQUIRED');

  const scam = await post('/api/lending/quote/supply',
    { network: 42161, asset: 'SCAM', amount: '1', wallet: WALLET }, { 'Idempotency-Key': IDEM });
  t('a non-allowlisted asset never reaches an RPC',
    scam.status === 400 && scam.json?.error?.code === 'NOT_A_RESERVE');

  const badWallet = await post('/api/lending/quote/supply',
    { network: 42161, asset: 'USDC', amount: '1', wallet: 'nope' }, { 'Idempotency-Key': `${IDEM}b` });
  t('a malformed wallet in a quote is refused 400',
    badWallet.status === 400 && badWallet.json?.error?.code === 'BAD_REQUEST');

  const zero = await post('/api/lending/quote/supply',
    { network: 42161, asset: 'USDC', amount: '0', wallet: WALLET }, { 'Idempotency-Key': `${IDEM}c` });
  t('a zero amount is refused with AMOUNT_REQUIRED',
    zero.status === 400 && zero.json?.error?.code === 'AMOUNT_REQUIRED');

  /* ── the network-dependent path: never fabricated, never signed ──────── */
  const live = await post('/api/lending/quote/supply',
    { network: 42161, asset: 'USDC', amount: '1', wallet: WALLET }, { 'Idempotency-Key': `${IDEM}d` });
  if (live.status === 200) {
    t('a successful build returns unsigned transactions with wallet-only capabilities',
      Array.isArray(live.json?.data?.transactions)
      && live.json.data.transactions.length >= 1
      && live.json.data.transactions.every((tx) => tx.signed === false && tx.broadcast === false
        && tx.capabilities?.sign === 'wallet-only' && tx.capabilities?.broadcast === 'wallet-only'));
    t('the success payload carries the §31 security statement and request ids',
      live.json?.meta?.security?.privateKeys === 'never-held'
      && typeof live.json?.data?.requestId === 'string'
      && live.json?.data?.idempotencyKey === `${IDEM}d`);
    t('the success payload contains no key material anywhere',
      !/privateKey|secret|mnemonic|seed/i.test(JSON.stringify(live.json)));
  } else {
    t('an unavailable network fails closed with a known lending error code',
      live.status >= 400 && live.json?.error?.code && LENDING_ERRORS[live.json.error.code]);
    t('the failure message is a human sentence, not a raw RPC error',
      typeof live.json?.error?.message === 'string' && !/0x[0-9a-fA-F]{8}/.test(live.json.error.message));
  }

  /* ── after whatever happened above, the breaker ladder must hold ─────── */
  const status2 = await get('/api/lending/status');
  t('the breaker ladder is consistent after traffic',
    status2.status === 200
    && (status2.json?.data?.state === 'READ_ONLY' ? status2.json.data.canTransact === false : true)
    && ['NORMAL', 'DEGRADED', 'READ_ONLY'].includes(status2.json?.data?.state));
} catch (error) {
  rows.push([`probe crashed: ${String(error?.message || error).slice(0, 160)}`, false]);
  console.error('CRASH', error);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

export default rows;
