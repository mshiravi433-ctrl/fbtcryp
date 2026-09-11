#!/usr/bin/env node
/**
 * PHASE 216 — LENDING ADAPTERS probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The three "pending" lending adapters are implemented, enabled and honest:
 *
 *   1. compound-v3    Comet on Base (8453) — supply/withdraw/borrow/repay +
 *                     health factor, behind the deployment-verified gates in
 *                     src/lib/defi/compoundV3Base.js.
 *   2. morpho         Morpho Blue Base (8453) USDC/cbBTC — same surface,
 *                     pinned market, collateral gate, share-projected debt,
 *                     oracle-derived health factor (morphoBlueBase.js).
 *   3. solana-lending a real adapter whose honest boundary is the pool
 *                     registry: empty registry → NO_POOL_REGISTERED; a
 *                     registered pool without a wired read client →
 *                     CLIENT_REQUIRED. Never a fabricated quote.
 *
 * This probe runs under plain node, where the Vite-shaped on-chain modules
 * CANNOT load — which is itself the test: every adapter path must answer
 * with a value or an error CODE, never a crash, never a success. The real
 * fixture-provider calldata/plan tests live in the vitest suites
 * (test/compound-defi.test.js, test/morpho-defi.test.js) where those
 * modules load.
 *
 * The §31 security gates (BAD_ADDRESS / UNSUPPORTED_CHAIN / POOL_NOT_ALLOWED
 * / TOKEN_NOT_ALLOWED) are re-asserted here: adapters sit behind the gate,
 * enabling an adapter does not open the gate.
 *
 * Run: node test/intent-ai/lending-adapters-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const {
  adapterFor, listAdapters, assertAllowedContract, PROTOCOL_ALLOWLIST,
  registerSolanaLendingPool, unregisterSolanaLendingPool, listSolanaLendingPools
} = await import('../../src/lib/lending-engine/index.js');
const { networkFor, isNetworkEnabled } = await import('../../src/lib/lending-engine/networkConfig.js');

const OWNER = '0x1111111111111111111111111111111111111111';
const CBBTC_BASE = '0x2d0e084cd9d94be23ad9a2e397540e9a8685077b';

/* A fake provider that answers NOTHING useful — it exists to prove the
   adapter's totality (codes, not crashes), not to fake a market. */
const fakeProvider = {
  getNetwork: async () => ({ chainId: 8453n }),
  getBalance: async () => 10n ** 18n,
  call: async () => '0x'
};

/* ── 1. registration: the pending state is over ─────────────────────────── */
const all = listAdapters();
const ids = all.map((a) => a.id);
t('all four wired protocols are registered in the adapter registry',
  ['aave-v3', 'compound-v3', 'morpho', 'solana-lending'].every((id) => ids.includes(id)));

t('every registered adapter is enabled — no "pending" remains',
  all.length >= 4 && all.every((a) => a.enabled === true));

const compound = adapterFor('compound-v3')?.factory();
const morpho = adapterFor('morpho')?.factory();
const solana = adapterFor('solana-lending')?.factory();
t('compound-v3 serves Base (8453) and nothing else',
  !!compound && JSON.stringify(compound.chainIds) === '[8453]');
t('morpho serves Base (8453) — the market is pinned there, not chain 1',
  !!morpho && JSON.stringify(morpho.chainIds) === '[8453]');
t('solana-lending serves Solana (900001)',
  !!solana && JSON.stringify(solana.chainIds) === '[900001]');

/* ── 2. the §31 allowlist matches reality ───────────────────────────────── */
t('the protocol allowlist enables every protocol that has code to drive it',
  PROTOCOL_ALLOWLIST.length === 4 && PROTOCOL_ALLOWLIST.every((p) => p.enabled === true));

t('allowlist notes name the module each adapter is real through',
  (() => {
    const note = (id) => (PROTOCOL_ALLOWLIST.find((p) => p.id === id) || {}).note || '';
    return note('compound-v3').includes('compoundV3Base.js')
      && note('morpho').includes('morphoBlueBase.js')
      && note('solana-lending').includes('NO_POOL_REGISTERED');
  })());

/* ── 3. network config syncs with the effective networks ────────────────── */
t('Base carries aave-v3 + compound-v3 + morpho',
  (() => { const p = networkFor(8453)?.protocols || []; return ['aave-v3', 'compound-v3', 'morpho'].every((x) => p.includes(x)); })());
t('Solana is enabled with the solana-lending protocol and ≥2 RPCs',
  isNetworkEnabled(900001) && (networkFor(900001)?.protocols || []).includes('solana-lending') && (networkFor(900001)?.rpcs || []).length >= 2);
t('Linea and Sonic stay OFF — no adapter, no fake market',
  !isNetworkEnabled(59144) && !isNetworkEnabled(146));

/* ── 4. the §31 security gates are intact — the adapter sits BEHIND them ── */
const POOL = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
t('BAD_ADDRESS: a malformed address is refused before any dial',
  assertAllowedContract({ chainId: 8453, address: '0x123', kind: 'pool', poolByChain: { 8453: POOL } }).code === 'BAD_ADDRESS');

t('UNSUPPORTED_CHAIN: a chain with no pinned pool is refused',
  assertAllowedContract({ chainId: 1, address: POOL, kind: 'pool', poolByChain: { 8453: POOL } }).code === 'UNSUPPORTED_CHAIN');

t('POOL_NOT_ALLOWED: the wrong pool address on the right chain is refused',
  assertAllowedContract({ chainId: 8453, address: CBBTC_BASE, kind: 'pool', poolByChain: { 8453: POOL } }).code === 'POOL_NOT_ALLOWED');

t('POOL allowed: only the pinned address passes',
  assertAllowedContract({ chainId: 8453, address: POOL, kind: 'pool', poolByChain: { 8453: POOL } }).ok === true);

t('TOKEN_NOT_ALLOWED: an unregistered token is refused',
  assertAllowedContract({
    chainId: 8453, address: CBBTC_BASE, kind: 'token',
    tokenLookup: (chainId, addr) => (chainId === 8453 && addr === '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead00' ? { symbol: 'FAKE' } : null)
  }).code === 'TOKEN_NOT_ALLOWED');

/* ── 5. totality: in a runtime that cannot load the on-chain module, ────── */
/* every path answers with a code — never a crash, never a success.         */
const rNoProviderC = await compound.getMarkets({});
t('compound adapter without provider → PROVIDER_REQUIRED (a code, not a crash)',
  rNoProviderC.ok === false && rNoProviderC.code === 'PROVIDER_REQUIRED');

const rNoProviderM = await morpho.getMarkets({});
t('morpho adapter without provider → the registered market is reported, live state unread',
  rNoProviderM.ok === true && rNoProviderM.live === false && rNoProviderM.reserves?.[0]?.symbol === 'USDC');

const rWithProviderC = await compound.getMarkets({ provider: fakeProvider });
t('compound adapter in a module-less runtime → ADAPTER_MODULE_UNAVAILABLE, never a success',
  rWithProviderC.ok === false && rWithProviderC.code === 'ADAPTER_MODULE_UNAVAILABLE');

const rWithProviderM = await morpho.getMarkets({ provider: fakeProvider });
t('morpho adapter in a module-less runtime → ADAPTER_MODULE_UNAVAILABLE, never a success',
  rWithProviderM.ok === false && rWithProviderM.code === 'ADAPTER_MODULE_UNAVAILABLE');

const rBorrowNoProvider = await compound.getBorrowQuote({ provider: null, wallet: OWNER, asset: 'USDC', amount: 100 });
t('compound borrow quote without provider → a refusal code, never an estimated quote',
  rBorrowNoProvider.ok === false && rBorrowNoProvider.code === 'PROVIDER_REQUIRED');

const rBorrowNoWallet = await compound.getBorrowQuote({ provider: fakeProvider, wallet: null, asset: 'USDC', amount: 100 });
t('compound borrow quote without a wallet → WALLET_REQUIRED (a plan is per-account)',
  rBorrowNoWallet.ok === false && rBorrowNoWallet.code === 'WALLET_REQUIRED');

const rAsset = await compound.getMarket({ provider: fakeProvider, asset: 'WETH' });
t('compound market lookup for a non-registered asset → ASSET_NOT_SUPPORTED',
  rAsset.ok === false && rAsset.code === 'ASSET_NOT_SUPPORTED');

/* ── 6. Solana: honest two-stage refusal through the pool registry ──────── */
const sMarkets = await solana.getMarkets({});
t('solana getMarkets with an empty registry → ok:true, zero pools, a truthful note',
  sMarkets.ok === true && Array.isArray(sMarkets.reserves) && sMarkets.reserves.length === 0);

const sNoPool = await solana.buildBorrowTransaction({ chainId: 900001, asset: 'SOL', amountWei: '1', onBehalfOf: OWNER });
t('solana borrow build with an empty registry → NO_POOL_REGISTERED (never a fabricated quote)',
  sNoPool.ok === false && sNoPool.code === 'NO_POOL_REGISTERED');

const sQuoteNoPool = await solana.getSupplyQuote({ chainId: 900001, wallet: OWNER, asset: 'SOL', amount: 100 });
t('solana supply quote with an empty registry → NO_POOL_REGISTERED',
  sQuoteNoPool.ok === false && sQuoteNoPool.code === 'NO_POOL_REGISTERED');

let threwNoSource = false;
try {
  registerSolanaLendingPool({ id: 'fake-pool', programId: 'Prog1', mint: 'Mint1' });
} catch { threwNoSource = true; }
t('registering a Solana pool WITHOUT a provenance source is refused',
  threwNoSource === true && listSolanaLendingPools().length === 0);

registerSolanaLendingPool({
  id: 'probe-pool',
  programId: '4fF4buh4f2gYm6gZGy9gRcHfGfGfGfGfGfGfGfGfGfGf',
  mint: 'So11111111111111111111111111111111111111112',
  vault: 'Vau1t11111111111111111111111111111111111111',
  source: 'probe-fixture — not a real deployment',
  chainId: 900001
});
t('registering a pool WITH a source lands in the registry',
  listSolanaLendingPools().length === 1 && listSolanaLendingPools()[0].id === 'probe-pool');

const sMarkets2 = await solana.getMarkets({});
t('solana getMarkets now lists the registered pool',
  sMarkets2.ok === true && sMarkets2.reserves.length === 1 && sMarkets2.reserves[0].programId.startsWith('4fF4'));

const sNoClient = await solana.buildBorrowTransaction({ chainId: 900001, asset: 'SOL', amountWei: '1', onBehalfOf: OWNER });
t('registered pool without a wired read client → CLIENT_REQUIRED, still never a success',
  sNoClient.ok === false && sNoClient.code === 'CLIENT_REQUIRED');

unregisterSolanaLendingPool('probe-pool');
const sAfterUnreg = await solana.getHealthFactor({ chainId: 900001, wallet: OWNER });
t('after unregister the refusal is back to NO_POOL_REGISTERED',
  sAfterUnreg.ok === false && sAfterUnreg.code === 'NO_POOL_REGISTERED');

/* ── report ─────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.error('\nFAILED checks:');
  for (const [name] of failed) console.error(`  ✗ ${name}`);
  process.exit(1);
}
console.log('lending adapters probe passed (Phase 216)');
process.exit(0);
