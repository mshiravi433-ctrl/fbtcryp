/**
 * FBT CENTRAL INTELLIGENCE OS — Module adapters (spec §10, §11, §12, §24, §40).
 * ---------------------------------------------------------------------------
 * One adapter per module, all speaking §11's ten-method interface. The brain
 * imports NOTHING else from the app; a module's business logic stays where it is
 * (§38 — "modules remain independent") and this file is the seam.
 *
 * WHAT AN ADAPTER MAY NOT DO
 * · sign anything, hold a key, or claim it moved funds — every `execute` on a
 *   value-bearing action returns `AWAITING_SIGNATURE` with the exact handoff the
 *   user's wallet must perform. The server has no signer and says so in the reply.
 * · invent a number when its source failed — a failed read is `UNAVAILABLE` with
 *   the source's own reason code, which is what §48's "no generic answer" needs.
 * · bypass the DoD — each definition is passed through `defineModule`, so an
 *   omitted field marks the module INCOMPLETE and the router refuses it.
 *
 * READ-ONLY MODULES ARE NOT AN APOLOGY, THEY ARE A DECLARATION
 * stocks/etf/forex/commodities/rwa/futures/dydx/farming/liquidity declare
 * `execute: NOT_APPLICABLE` with the reason. That is §8 made real: the assistant
 * can quote an Avantis equity price and an Ostium commodity market, and must say
 * "we can read this venue, we cannot trade it from here" when asked to trade.
 */
import { CAPABILITY, PERMISSION } from '../../src/lib/central/schema.js';
import {
  analyzeConcentration, analyzeExposure, assessLendingSafety, computeBorrowCapacity,
  goalFeasibility, scanOpportunities, simulateShock, realizedVolatilityPct, correlate
} from '../../src/lib/central/analysis.js';
import { assessRisk } from '../../src/lib/central/risk.js';
import { defineModule } from '../../src/lib/central/registry.js';
import { ciSource, healthSnapshot, chainIdFor } from './sources.js';
import { storeGet, storeSet, storeDurable } from '../store.js';
import { createGoal, getGoal, validateGoalInput, FINANCIAL_GOAL_LIMITATIONS } from '../financialGoals.js';
import { randomUUID, createHash } from 'node:crypto';

const NA = (reason) => ({ na: true, reason });
const ok = (status, data, extra = {}) => ({ status, data, at: Date.now(), source: data?.source || extra.source || null, ...extra });
const unavailable = (reason, extra = {}) => ({ status: 'UNAVAILABLE', reason: String(reason || 'SOURCE_UNAVAILABLE').slice(0, 160), at: Date.now(), data: null, ...extra });

/** Uniform read: call the source, translate its envelope, keep the staleness flag. */
function readVia(name, prepare = (input) => input) {
  return async (input = {}, ctx = {}) => {
    const source = ciSource(name);
    if (typeof source !== 'function') return unavailable('SOURCE_NOT_WIRED', { source: name });
    const out = await source({ ...prepare(input, ctx), owner: ctx.owner, now: ctx.now });
    if (!out || out.ok !== true) return unavailable(out?.code || 'SOURCE_REJECTED', { detail: String(out?.detail || '').slice(0, 160), source: name });
    return ok(out.stale ? 'PARTIAL' : 'OK', out, {
      stale: out.stale === true,
      reason: out.stale ? (out.staleReason || 'SOURCE_STALE') : (out.partial ? 'PARTIAL_SOURCE' : null),
      unavailable: out.unavailable || null,
      skipped: out.skipped || null
    });
  };
}

/** Health per module: derived from the sources it actually depends on. */
const healthFrom = (sources) => async () => {
  const rows = healthSnapshot(sources);
  if (!rows.length) return { status: 'UNKNOWN', detail: 'no health samples yet for this module', sources };
  const down = rows.filter((r) => r.status === 'DOWN');
  const degraded = rows.filter((r) => r.status === 'DEGRADED');
  return {
    status: down.length === rows.length ? 'DOWN' : down.length || degraded.length ? 'DEGRADED' : 'HEALTHY',
    detail: down.length ? `${down.map((d) => `${d.source}:${d.lastError || 'no answer'}`).join(' ')}`
      : degraded.length ? `${degraded.map((d) => d.source).join(', ')} recovering` : 'all sources answering',
    sources: rows
  };
};

const alertKey = (owner) => `ci:alerts:v1:${String(owner || 'anon').slice(0, 64)}`;
const MAX_ALERTS = 40;
const hash = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);

/**
 * @param {{ owner: string, readState: (key:string)=>any, io?: Function }} ctx
 *   `readState` lets an adapter consult the CENTRAL state instead of re-fetching
 *   (a risk read must see the same portfolio the reply is quoting, not a second
 *   fetch that may disagree with it).
 */
export function createModules(ctx = {}) {
  const owner = ctx.owner || 'anon';
  const readState = (key) => ctx.readState?.(key) ?? null;
  const io = (name) => ciSource(name);
  const walletAddress = () => readState('wallet')?.addresses?.evm?.[0] || ctx.walletAddress?.() || null;

  /* ── wallet ─────────────────────────────────────────────────────────── */
  const wallet = defineModule({
    id: 'wallet', name: 'Wallet', capability: CAPABILITY.AVAILABLE,
    state: ['wallet'], tools: ['wallet.read', 'wallet.refresh', 'wallet.send'],
    events: ['WALLET_CONNECTED', 'WALLET_DISCONNECTED', 'BALANCE_CHANGED', 'TRANSACTION_CONFIRMED'],
    errors: ['NO_WALLET_ADDRESS', 'RPC_TIMEOUT', 'RPC_ERROR', 'UNSUPPORTED_CHAIN', 'NETWORK_MISMATCH'],
    permissions: { max: PERMISSION.READ },
    fallback: ['per-chain RPC failover inside the shared reader'],
    getState: async () => ok('OK', readState('wallet')),
    healthCheck: healthFrom(['blockchain', 'market-data']),
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'the server holds no key; sending is a wallet action' }),
    read: readVia('walletBalances', (input) => ({ addresses: { evm: [walletAddress()].filter(Boolean) }, chainIds: input.chainIds })),
    quote: NA('a balance is not quoted'),
    prepare: NA('a balance is not prepared'),
    simulate: NA('a balance is not simulated'),
    execute: NA('sending requires the user wallet signature; this server never signs (§30)'),
    verify: async (input = {}) => {
      const receipt = await io('transactionReceipt')({ chainId: input.chainId || 1, hash: input.txHash });
      return receipt?.ok ? ok(receipt.status === 'CONFIRMED' ? 'VERIFIED' : 'MISMATCH', receipt) : unavailable(receipt?.code || 'RECEIPT_READ_FAILED');
    },
    recover: async (error = {}) => ({ status: 'RECOVERED', data: { strategy: 'retry with the next RPC endpoint, then re-read every section the balance feeds' }, reason: error?.code || 'UNKNOWN' })
  });

  /* ── portfolio ──────────────────────────────────────────────────────── */
  const portfolio = defineModule({
    id: 'portfolio', name: 'Portfolio', capability: CAPABILITY.AVAILABLE,
    state: ['portfolio'], tools: ['portfolio.read', 'portfolio.allocation', 'portfolio.concentration'],
    events: ['POSITION_CHANGED', 'BALANCE_CHANGED'],
    errors: ['NO_WALLET_READ', 'NO_USD_VALUATIONS', 'STALE_DATA'],
    permissions: { max: PERMISSION.READ },
    fallback: ['stale wallet read, labelled as stale'],
    getState: async () => ok('OK', readState('portfolio')),
    healthCheck: healthFrom(['wallet-service', 'market-data']),
    capabilities: async () => ({ operations: ['read', 'simulate'], executes: false, note: 'rebalancing is executed by the swap module, through one action per leg' }),
    read: async () => {
      const walletRead = await wallet.read({});
      if (walletRead.status === 'UNAVAILABLE') return unavailable(walletRead.reason);
      const out = await io('portfolioSummary')({ wallet: walletRead.data });
      if (!out || out.ok !== true) return unavailable(out?.code || 'PORTFOLIO_UNAVAILABLE');
      return ok(out.stale ? 'PARTIAL' : 'OK', out, { stale: out.stale === true, reason: out.stale ? 'STALE_PRICES' : null });
    },
    quote: NA('a portfolio has no price to quote'),
    prepare: NA('portfolio changes are executed as swap legs'),
    simulate: async (input = {}) => {
      const base = readState('portfolio');
      if (!base?.holdings?.length) return unavailable('NO_PORTFOLIO_STATE');
      const shock = Number(input.shockPct ?? 0);
      const after = base.holdings.map((h) => ({ ...h, valueUsd: (h.valueUsd || 0) * (1 + shock / 100) }));
      const total = after.reduce((a, h) => a + h.valueUsd, 0);
      return ok('OK', {
        method: 'linear price shock applied to live holdings',
        shockPct: shock,
        beforeUsd: base.totalValueUsd ?? null,
        afterUsd: Math.round(total * 100) / 100,
        holdings: after.slice(0, 10)
      }, { source: 'portfolio-service' });
    },
    execute: NA('every portfolio mutation is a swap, bridge or lending action with its own confirmation'),
    verify: async () => ok('OK', { note: 'the portfolio is verified by re-reading the wallet after a transaction; see the §16 cascade' }, { source: 'central-state' }),
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 're-read the wallet, then recompute the composition' } })
  });

  /* ── swap ───────────────────────────────────────────────────────────── */
  const swap = defineModule({
    id: 'swap', name: 'Swap', capability: CAPABILITY.AVAILABLE,
    state: ['markets', 'orders', 'transactions'], tools: ['swap.quote', 'swap.prepare', 'swap.simulate', 'swap.execute', 'swap.verify'],
    events: ['SWAP_COMPLETED', 'TRANSACTION_CONFIRMED', 'BALANCE_CHANGED'],
    errors: ['CHAIN_UNSUPPORTED', 'TOKEN_NOT_ALLOWLISTED', 'NO_QUOTE_FROM_ANY_PROVIDER', 'QUOTE_EXPIRED', 'PRICE_IMPACT_TOO_HIGH', 'INSUFFICIENT_BALANCE', 'CONTRACT_MISMATCH'],
    permissions: { max: PERMISSION.EXECUTE },
    riskContext: 'swap',
    quoteTtlMs: 45_000,
    fallback: ['second DEX aggregator (Kyber ↔ OpenOcean)'],
    getState: async () => ok('OK', readState('markets')),
    healthCheck: healthFrom(['dex-aggregator', 'market-data']),
    capabilities: async () => ({ operations: ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'], executes: true, signs: false, aggregators: ['kyber', 'openocean'] }),
    read: readVia('marketSnapshot', (input) => ({ symbols: input.symbols || [] })),
    quote: async (input = {}) => {
      const out = await io('swapQuote')({
        chainId: chainIdFor(input.chainId || input.network) || 1,
        from: input.from || input.fromAsset, to: input.to || input.toAsset,
        amountUsd: input.amountUsd ?? null, fromAmount: input.amount ?? null,
        wallet: walletAddress(), slippagePct: input.slippagePct ?? 0.5
      });
      if (!out || out.ok !== true) return unavailable(out?.code || 'QUOTE_FAILED', { detail: String(out?.detail || '').slice(0, 160), tried: out?.tried || null });
      /* The destination token is checked against the risk oracle BEFORE a quote is
         offered, not after the user has been shown a route: a quote you must not
         take is not information, it is a trap. A blocking verdict returns
         UNAVAILABLE with the security code, which the policy engine treats as a
         hard stop (§23) — retrying is not a recovery here. */
      const chainId = chainIdFor(input.chainId || input.network) || 1;
      const safety = await io('swapTokenSafety')({ chainId, symbol: out.toAsset || input.to || null });
      if (safety?.ok && safety.securityBlock) {
        return unavailable(safety.flags?.[0] || 'TOKEN_RISK_BLOCKED', {
          detail: `destination ${out.toAsset || '?'} carries ${safety.flags.join(', ')}`,
          address: safety.address, flags: safety.flags, chainId, securityBlock: true, safeStop: true
        });
      }
      const enriched = { ...out, tokenRisk: safety?.ok ? { level: safety.riskLevel, flags: safety.flags, address: safety.address, honeypot: safety.flags.includes('HONEYPOT_DETECTED'), source: safety.source, at: safety.at } : null, tokenRiskUnavailable: safety?.ok !== true ? safety?.code || 'TOKEN_RISK_UNREADABLE' : null };
      return ok(out.partial || safety?.ok !== true ? 'PARTIAL' : 'OK', enriched, { expiresAt: out.expiresAt, reason: out.partial ? 'PROVIDER_FIELDS_PARTIAL' : safety?.ok !== true ? `TOKEN_RISK_UNREADABLE (${safety?.code || 'SOURCE_UNAVAILABLE'})` : null });
    },
    prepare: async (input = {}) => {
      const quote = await swap.quote(input);
      if (quote.status === 'UNAVAILABLE') return quote;
      const chainId = chainIdFor(input.chainId || input.network) || 1;
      return ok('OK', {
        quote: quote.data,
        chainId,
        wallet: walletAddress(),
        approvalsNeeded: [],
        gasNote: 'gas is estimated by the wallet at signature time; the aggregator figure is indicative',
        unsignedCalldata: quote.data.route?.calldata ?? null,
        expiry: quote.data.expiresAt ? new Date(quote.data.expiresAt).toISOString() : null
      }, { source: quote.data.source || 'dex-aggregator' });
    },
    simulate: async (input = {}) => {
      const quote = await swap.quote(input);
      if (quote.status === 'UNAVAILABLE') return quote;
      const q = quote.data;
      const walletState = readState('wallet');
      const holding = (walletState?.balances || []).find((b) => String(b.symbol).toUpperCase() === String(q.fromAsset).toUpperCase());
      const enough = holding ? (holding.amount ?? 0) + 1e-9 >= (q.amountIn ?? Infinity) : null;
      const impact = Number(q.priceImpactPct);
      const warnings = [];
      if (enough === false) warnings.push({ code: 'INSUFFICIENT_BALANCE', detail: `holding ${holding?.amount} ${q.fromAsset} is less than the ${q.amountIn} requested` });
      if (Number.isFinite(impact) && impact > 3) warnings.push({ code: 'PRICE_IMPACT_TOO_HIGH', detail: `${impact}% of pool depth` });
      if (Number.isFinite(impact) && impact > 12) warnings.push({ code: 'SIMULATION_REJECTS_ROUTE', detail: 'impact above 12% — no route should be signed on this quote' });
      return ok(warnings.length ? 'PARTIAL' : 'OK', {
        quote: q,
        balanceCheck: { asset: q.fromAsset, held: holding?.amount ?? null, required: q.amountIn ?? null, sufficient: enough, basis: holding ? 'on-chain read' : 'wallet state unreadable' },
        expectedNetUsd: q.expectedOut !== null && q.price ? Math.round((q.expectedOut * 1) * 100) / 100 : null,
        warnings,
        method: 'quote replay + balance + impact thresholds; no fork simulation is claimed because none ran'
      }, { source: 'dex-aggregator + wallet-service' });
    },
    execute: async (input = {}, callCtx = {}) => {
      /* The honest execution boundary: a record, a handoff, and an explicit
         statement that nothing moved until the wallet signs. */
      return ok('AWAITING_SIGNATURE', {
        actionId: input.actionId || null,
        module: 'swap',
        operation: 'execute',
        handoff: { kind: 'wallet-sign', chainId: chainIdFor(input.chainId) || 1, calldata: input.calldata || null, to: input.to || null, value: input.value || '0' },
        serverHoldsKey: false,
        serverSigned: false,
        requiresUserSignature: true,
        intentId: callCtx.intentId || null
      }, { source: 'execution-controller' });
    },
    verify: async (input = {}) => {
      const receipt = await io('transactionReceipt')({ chainId: input.chainId || 1, hash: input.txHash });
      if (!receipt?.ok) return unavailable(receipt?.code || 'RECEIPT_READ_FAILED');
      const consistent = receipt.status === 'CONFIRMED' && receipt.logs > 0;
      return ok(consistent ? 'VERIFIED' : receipt.status === 'FAILED' ? 'MISMATCH' : 'PENDING', {
        ...receipt,
        consistency: consistent ? 'receipt confirmed with emitted events' : `receipt status ${receipt.status} with ${receipt.logs} logs`,
        balanceImpact: 'wallet refresh required (§16)'
      }, { source: 'blockchain' });
    },
    recover: async (error = {}) => {
      const code = error?.code;
      if (code === 'QUOTE_EXPIRED') return { status: 'RECOVERED', data: { strategy: 'REQUOTE', note: 'a fresh quote re-runs policy, including the confirmation gate' } };
      if (code === 'CHAIN_UNSUPPORTED' || code === 'TOKEN_NOT_ALLOWLISTED') return { status: 'NOT_RECOVERABLE', data: { strategy: 'SAFE_ANSWER', note: String(error?.detail || '').slice(0, 140) } };
      return { status: 'RECOVERED', data: { strategy: 'FAILOVER_PROVIDER', note: 'the other aggregator is tried before anything is reported as unavailable' } };
    }
  });

  /* ── bridge ─────────────────────────────────────────────────────────── */
  const bridge = defineModule({
    id: 'bridge', name: 'Bridge', capability: CAPABILITY.AVAILABLE,
    state: ['wallet', 'transactions'], tools: ['bridge.quote', 'bridge.prepare', 'bridge.execute', 'bridge.verify'],
    events: ['BRIDGE_COMPLETED', 'BALANCE_CHANGED', 'TRANSACTION_CONFIRMED'],
    errors: ['NETWORKS_REQUIRED', 'ASSET_NOT_ON_BOTH_CHAINS', 'PRICE_UNAVAILABLE', 'QUOTE_EXPIRED', 'RPC_TIMEOUT'],
    permissions: { max: PERMISSION.EXECUTE },
    riskContext: 'bridge',
    quoteTtlMs: 60_000,
    fallback: ['alternate bridge route (cross-chain quote endpoint)'],
    getState: async () => ok('OK', readState('wallet')),
    healthCheck: healthFrom(['bridge']),
    capabilities: async () => ({ operations: ['quote', 'prepare', 'execute', 'verify'], executes: true, signs: false }),
    read: async () => ok('OK', { provider: 'lifi', note: 'bridge status is read on demand per quote; no standing feed' }, { source: 'bridge' }),
    quote: async (input = {}) => {
      const out = await io('bridgeQuoteSource')({
        fromChain: chainIdFor(input.fromChain || input.fromNetwork), toChain: chainIdFor(input.toChain || input.toNetwork || input.network),
        asset: input.asset, amountUsd: input.amountUsd, fromAddress: walletAddress(), toAddress: input.toAddress || walletAddress()
      });
      if (!out || out.ok !== true) return unavailable(out?.code || 'BRIDGE_QUOTE_FAILED', { detail: String(out?.detail || '').slice(0, 160) });
      return ok('OK', out, { expiresAt: out.expiresAt });
    },
    prepare: async (input = {}) => {
      const quote = await bridge.quote(input);
      if (quote.status === 'UNAVAILABLE') return quote;
      return ok('OK', { quote: quote.data, steps: ['approve on source chain (if not a native gas token)', 'bridge call', 'receipt on destination chain'], minTransportUsd: 5, expiry: quote.data.expiresAt ? new Date(quote.data.expiresAt).toISOString() : null }, { source: 'bridge' });
    },
    simulate: async (input = {}) => {
      const q = await bridge.quote(input);
      if (q.status === 'UNAVAILABLE') return q;
      const fee = Number(q.data.feeUsd) || 0;
      const amount = Number(q.data.amountUsd) || 0;
      return ok('OK', { ...q.data, feePctOfTransfer: amount > 0 ? Math.round((fee / amount) * 10000) / 100 : null, belowMinimum: amount > 0 && amount < 5, estimatedSeconds: q.data.estimatedSeconds ?? null, method: 'provider quote with fee/percentage arithmetic; delivery time is the provider estimate' }, { source: 'bridge' });
    },
    execute: async (input = {}, callCtx = {}) => ok('AWAITING_SIGNATURE', { actionId: input.actionId || null, module: 'bridge', handoff: { kind: 'wallet-sign', txRequests: input.txRequests || [] }, serverSigned: false, intentId: callCtx.intentId || null }, { source: 'execution-controller' }),
    verify: async (input = {}) => {
      const receipt = await io('transactionReceipt')({ chainId: input.chainId || 1, hash: input.txHash });
      if (!receipt?.ok) return unavailable(receipt?.code || 'RECEIPT_READ_FAILED');
      return ok(receipt.status === 'CONFIRMED' ? 'VERIFIED' : 'PENDING', { ...receipt, destinationCheck: 'the destination leg is verified by the destination receipt, not the source one' }, { source: 'blockchain' });
    },
    recover: async (error = {}) => ({ status: error?.code === 'ASSET_NOT_ON_BOTH_CHAINS' ? 'NOT_RECOVERABLE' : 'RECOVERED', data: { strategy: error?.code === 'ASSET_NOT_ON_BOTH_CHAINS' ? 'SAFE_ANSWER' : 'FAILOVER_PROVIDER' } })
  });

  /* ── lending + borrowing ────────────────────────────────────────────── */
  const lending = defineModule({
    id: 'lending', name: 'Lending (Aave V3)', capability: CAPABILITY.AVAILABLE,
    state: ['lending', 'positions'], tools: ['lending.read', 'lending.positions', 'lending.quote', 'lending.verify'],
    events: ['LENDING_COMPLETED', 'POSITION_CHANGED', 'LIQUIDATION_RISK_CHANGED', 'LOAN_CREATED'],
    errors: ['POSITION_READ_FAILED', 'BAD_WALLET_ADDRESS', 'RPC_ERROR', 'ORACLE_STALE', 'UNSUPPORTED_CHAIN', 'CONTRACT_MISMATCH'],
    permissions: { max: PERMISSION.EXECUTE },
    riskContext: 'lending',
    fallback: ['per-chain RPC failover inside the shared reader', 'stale oracle flagged, never hidden'],
    getState: async () => ok('OK', readState('lending')),
    healthCheck: healthFrom(['lending-protocol']),
    capabilities: async () => ({ operations: ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'], executes: true, signs: false, protocol: 'Aave V3', verifiedOnChain: true }),
    read: readVia('lendingPosition', (input) => ({ wallet: walletAddress(), chainId: chainIdFor(input.chainId || input.network) || 1 })),
    quote: async (input = {}) => {
      const reserve = await io('lendingReserve')({ chainId: chainIdFor(input.chainId || input.network) || 1, asset: input.asset || 'USDC' });
      if (!reserve?.ok) return unavailable(reserve?.code || 'RESERVE_UNREADABLE', { detail: String(reserve?.detail || '').slice(0, 140) });
      const position = readState('lending');
      return ok('OK', { reserve, position: position ? { collateralUsd: position.collateralUsd, debtUsd: position.debtUsd, healthFactor: position.healthFactor } : null, effect: estimateLendingEffect({ reserve, position, action: input.action, amountUsd: input.amountUsd }) }, { source: 'lending-protocol' });
    },
    prepare: async (input = {}) => {
      const quote = await lending.quote(input);
      if (quote.status === 'UNAVAILABLE') return quote;
      return ok('OK', {
        quote: quote.data,
        handoffEndpoint: `/api/lending/transaction/${['supply', 'withdraw', 'borrow', 'repay'].includes(input.action) ? input.action : 'supply'}`,
        requiresApproval: input.action === 'supply',
        note: 'calldata is built by the lending BFF and signed by the wallet; the CI layer never builds or signs transactions'
      }, { source: 'lending-protocol' });
    },
    simulate: async (input = {}) => {
      const position = readState('lending');
      if (!position) return unavailable('POSITION_UNREADABLE');
      const amount = Number(input.amountUsd) || 0;
      const after = { ...position, collateralUsd: (position.collateralUsd || 0) + (input.action === 'supply' ? amount : input.action === 'withdraw' ? -amount : 0), debtUsd: (position.debtUsd || 0) + (input.action === 'borrow' ? amount : input.action === 'repay' ? -amount : 0) };
      const ltv = Number(position.ltvPct || 0) / 100;
      const hfBefore = Number(position.healthFactor);
      const hfAfter = after.debtUsd > 0 && ltv > 0 ? Math.max(0, round((after.collateralUsd * (ltv || 1)) / after.debtUsd, 3)) : null;
      const safety = assessLendingSafety({ position: { ...after, ltv: position.ltvPct ? position.ltvPct / 100 : null }, oracle: position.oracle || null });
      const crossesFloor = hfAfter !== null && hfAfter < 1.35 && (Number.isNaN(hfBefore) || hfBefore >= 1.35);
      return ok('OK', {
        healthFactorBefore: Number.isFinite(hfBefore) ? hfBefore : null, healthFactorAfter: hfAfter,
        collateralUsdAfter: round(after.collateralUsd, 2), debtUsdAfter: round(after.debtUsd, 2),
        safety: safety.status === 'OK' ? { level: safety.level, distanceToLiquidationPct: safety.distanceToLiquidationPct } : { level: 'UNKNOWN' },
        crossesPolicyFloor: crossesFloor,
        method: 'protocol account data + linear debt/collateral adjustment; the health-factor curve is the protocol formula, not a model'
      }, { source: 'lending-protocol' });
    },
    execute: async (input = {}, callCtx = {}) => ok('AWAITING_SIGNATURE', { actionId: input.actionId || null, module: 'lending', handoff: { kind: 'wallet-sign', endpoint: `/api/lending/transaction/${input.action || 'supply'}`, args: { chainId: chainIdFor(input.chainId) || 1, asset: input.asset || null, amount: input.amount ?? null } }, serverSigned: false, intentId: callCtx.intentId || null }, { source: 'execution-controller' }),
    verify: async (input = {}) => {
      const receipt = await io('transactionReceipt')({ chainId: input.chainId || 1, hash: input.txHash });
      if (!receipt?.ok) return unavailable(receipt?.code || 'RECEIPT_READ_FAILED');
      const fresh = await lending.read({ chainId: input.chainId });
      return ok(receipt.status === 'CONFIRMED' && fresh.status !== 'UNAVAILABLE' ? 'VERIFIED' : 'PENDING', { receipt, positionAfter: fresh.data }, { source: 'lending-protocol + blockchain' });
    },
    recover: async (error = {}) => ({ status: error?.code === 'ORACLE_STALE' ? 'RECOVERED' : 'NOT_RECOVERABLE', data: { strategy: error?.code === 'ORACLE_STALE' ? 'REVALIDATE: re-read the oracle before quoting any health factor' : 'READ_ONLY: positions are never served from cache (§27 of the lending BFF)' } })
  });

  const borrowing = defineModule({
    ...lendingDefinition(),
    getState: async () => ok('OK', readState('borrowing') || readState('lending')),
    capabilities: async () => ({ operations: ['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'], executes: true, signs: false, view: 'the debt side of the same protocol account' })
  });
  function lendingDefinition() {
    return {
      id: 'borrowing', name: 'Borrowing', capability: CAPABILITY.AVAILABLE,
      state: ['borrowing', 'positions'], tools: ['borrow.capacity', 'borrow.quote', 'borrow.prepare', 'borrow.execute', 'borrow.verify'],
      events: ['LOAN_CREATED', 'LOAN_REPAID', 'LIQUIDATION_RISK_CHANGED'],
      errors: ['POSITION_READ_FAILED', 'HEALTH_FACTOR_BELOW_FLOOR', 'RPC_ERROR'],
      permissions: { max: PERMISSION.EXECUTE },
      riskContext: 'borrowing',
      fallback: ['capacity re-read from the protocol before any answer'],
      healthCheck: healthFrom(['lending-protocol']),
      read: readVia('lendingPosition', (input) => ({ wallet: walletAddress(), chainId: chainIdFor(input.chainId || input.network) || 1 })),
      quote: async (input = {}) => {
        const position = readState('lending') || (await lending.read({})).data;
        if (!position) return unavailable('POSITION_UNREADABLE');
        const capacity = computeBorrowCapacity({ position: { collateralUsd: position.collateralUsd, debtUsd: position.debtUsd, ltv: position.ltvPct ? position.ltvPct / 100 : null }, floorHealthFactor: 1.35 });
        return ok(capacity.status === 'OK' ? 'OK' : 'UNAVAILABLE', capacity.status === 'OK' ? capacity : { reason: capacity.reason }, { source: 'lending-protocol' });
      },
      prepare: async (input = {}) => {
        const q = await borrowing.quote(input);
        if (q.status !== 'OK') return q;
        return ok('OK', { capacity: q.data, handoffEndpoint: '/api/lending/transaction/borrow', note: 'capacity respects the health-factor floor, not the raw LTV ceiling' }, { source: 'lending-protocol' });
      },
      simulate: async (input = {}) => lending.simulate({ ...input, action: 'borrow' }),
      execute: async (input = {}, callCtx = {}) => lending.execute({ ...input, action: input.action || 'borrow' }, callCtx),
      verify: async (input = {}) => lending.verify(input),
      recover: async () => ({ status: 'RECOVERED', data: { strategy: 'REVALIDATE capacity from the protocol, then re-run policy' } })
    };
  }

  /* ── yield surface: farming / liquidity / staking ───────────────────── */
  const farming = defineModule({
    id: 'farming', name: 'Farming & Yield', capability: CAPABILITY.READ_ONLY,
    state: ['farming'], tools: ['yields.read', 'opportunities.scan'],
    events: ['POSITION_CHANGED'],
    errors: ['NO_YIELD_DATA', 'PROVIDER_DOWN'],
    permissions: { max: PERMISSION.READ },
    riskContext: 'farming',
    fallback: ['stale yield snapshot flagged as such'],
    getState: async () => ok('OK', readState('farming')),
    healthCheck: healthFrom(['yields-engine']),
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'no audited deposit route exists in this build; recommending a deposit would be a capability the app does not have' }),
    read: readVia('yields'),
    quote: async (input = {}) => {
      const yields = readState('farming');
      if (!yields?.pools?.length) return unavailable('NO_YIELD_STATE');
      const pool = yields.pools.find((p) => p.id === input.pool || (input.asset && String(p.symbol).toUpperCase() === String(input.asset).toUpperCase()));
      if (!pool) return unavailable('POOL_NOT_FOUND');
      const amount = Number(input.amountUsd) || 0;
      return ok('OK', { pool, amountUsd: amount, projectedYearlyYieldUsd: Math.round(amount * (Number(pool.apy) || 0)) / 100, basis: 'current APR, held for one year, no compounding claim', caveats: ['APR is a trailing figure from the yields engine', 'token price movement is not included'] }, { source: 'yields-engine' });
    },
    prepare: NA('no deposit route is wired; preparing a transaction the app cannot sign would be a lie'),
    simulate: async (input = {}) => {
      const yields = readState('farming');
      const pool = (yields?.pools || []).find((p) => p.id === input.pool);
      if (!pool) return unavailable('POOL_NOT_FOUND');
      const vol = realizedVolatilityPct((readState('markets')?.history || {})[String(pool.symbol || '').toUpperCase()]);
      return ok('OK', { pool, ilRiskFlag: pool.ilRisk === true, apyStability: vol.status === 'OK' ? `underlying daily σ ${vol.volatilityPct}%` : 'underlying volatility unavailable', impermanentLossModel: 'not modelled without pool pair prices', method: 'APR + pool metadata; explicitly NOT an IL model' }, { source: 'yields-engine' });
    },
    execute: NA('farming deposits are not executable from the brain in this build'),
    verify: NA('nothing is executed, so there is nothing to verify'),
    recover: async () => ({ status: 'NOT_RECOVERABLE', data: { strategy: 'SAFE_ANSWER with the yields snapshot and an explicit "we cannot deposit from here"' } })
  });

  const liquidity = defineModule({
    ...farming.definition, id: 'liquidity', name: 'Liquidity (LP)',
    state: ['liquidity'], tools: ['liquidity.read', 'lp.risk'],
    events: ['LIQUIDITY_CHANGED'], riskContext: 'liquidity',
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'no LP mint/burn route is wired into the server' })
  });
  const staking = defineModule({
    ...farming.definition, id: 'staking', name: 'Staking',
    state: ['farming'], tools: ['staking.read'],
    events: [], riskContext: 'staking',
    quote: NA('staking APR comes from the yields engine and is quoted there'),
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'validator delegation is a wallet flow, not a server action' })
  });

  /* ── derivatives ────────────────────────────────────────────────────── */
  const futures = defineModule({
    id: 'futures', name: 'Futures / Perpetuals', capability: CAPABILITY.READ_ONLY,
    state: ['futures'], tools: ['perp.read', 'futures.risk'],
    events: ['POSITION_CHANGED', 'LIQUIDATION_RISK_CHANGED'],
    errors: ['BAD_SHAPE', 'PROVIDER_DOWN', 'NO_ACCOUNT_KEYS'],
    permissions: { max: PERMISSION.READ },
    riskContext: 'futures',
    fallback: ['stale funding snapshot flagged'],
    getState: async () => ok('OK', readState('futures')),
    healthCheck: healthFrom(['futures-engine']),
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'orders need the venue account keys, which live with the user; positions reported here come from the client session' }),
    read: readVia('perpMarkets'),
    quote: NA('no order book access from the server'),
    prepare: NA('no order route'),
    simulate: async (input = {}) => {
      /* The futures module owns no portfolio maths of its own (§38): it asks the
         CENTRAL risk engine what opening this position would do, so a leverage
         warning here and the one on the portfolio page are the same computation. */
      const state = ctx.state?.() || { sections: {} };
      const risk = assessRisk({ state, context: 'futures', quote: { leverage: input.leverage, notionalUsd: input.notionalUsd }, capabilities: { futures: CAPABILITY.READ_ONLY } });
      return ok('OK', { assessment: 'risk-impact-only simulation: what opening this would do to portfolio risk', level: risk.level, reasons: risk.reasons, confidence: risk.confidence, method: 'shared central risk engine (§24), no venue order placed' }, { source: 'risk-engine' });
    },
    execute: NA('the server holds no venue credentials and never places an order'),
    verify: NA('no order is placed, so there is nothing to verify'),
    recover: async () => ({ status: 'NOT_RECOVERABLE', data: { strategy: 'SAFE_ANSWER with the funding/exposure read' } })
  });

  const dydx = defineModule({
    ...futures.definition, id: 'dydx', name: 'dYdX',
    tools: ['dydx.markets', 'dydx.account'], capability: CAPABILITY.AVAILABLE,
    errors: ['NO_ADDRESS', 'DYDX_UNAVAILABLE', 'PROVIDER_DOWN'], riskContext: 'dydx',
    events: ['POSITION_CHANGED'],
    state: ['dydx'],
    read: async (input = {}) => {
      const address = input.address || walletAddress();
      const out = await io('dydxAccount')({ address, subaccountNumber: input.subaccountNumber || 0 });
      if (!out || out.ok !== true) return unavailable(out?.code || 'DYDX_UNAVAILABLE');
      return ok(out.partial ? 'PARTIAL' : 'OK', out, { stale: out.stale === true, reason: out.partial ? (out.unavailable || []).join(',') : null });
    },
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'signing an order requires the user subaccount keys; the brain reads markets and positions only' })
  });

  /* ── global markets ─────────────────────────────────────────────────── */
  const stocks = defineModule({
    id: 'stocks', name: 'Stocks (synthetic equity exposure)', capability: CAPABILITY.READ_ONLY,
    state: ['markets'], tools: ['stocks.read'],
    events: ['PRICE_CHANGED'], errors: ['PROVIDER_DOWN', 'PRICE_PARTIAL'],
    permissions: { max: PERMISSION.READ }, fallback: ['stale equity snapshot flagged'],
    getState: async () => ok('OK', readState('markets')?.equities ?? null),
    healthCheck: healthFrom(['equities-feed']),
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'these are crypto-collateralised synthetic exposures on a venue we can read but cannot trade for the user' }),
    read: readVia('equitiesMarkets'),
    quote: NA('no order route on this venue'),
    prepare: NA('no order route'),
    simulate: NA('no order route'),
    execute: NA('the app cannot open a synthetic equity position from the brain; it can read the market'),
    verify: NA('nothing is executed'),
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 'SERVE_STALE_WITH_FLAG' } })
  });
  const rwaSource = (id, name, label) => defineModule({
    id, name, capability: CAPABILITY.READ_ONLY,
    state: ['markets'], tools: [`${id}.read`], events: ['PRICE_CHANGED'],
    errors: ['PROVIDER_DOWN'], permissions: { max: PERMISSION.READ },
    fallback: ['stale market snapshot flagged'],
    getState: async () => ok('OK', (readState('markets')?.rwa || []).filter((r) => r.category === label || label === 'all')),
    healthCheck: healthFrom(['rwa-feed']),
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'read-only market access; no tradable route is wired into this app' }),
    read: async (input = {}) => {
      const out = await io('rwaMarkets')({});
      if (!out || out.ok !== true) return unavailable(out?.code || 'RWA_FEED_UNAVAILABLE');
      const rows = label === 'all' ? out.rows : out.rows.filter((r) => r.category === label);
      return ok(rows.length ? 'OK' : 'UNAVAILABLE', { ...out, rows, filteredTo: label, instruments: rows.length }, { reason: rows.length ? null : 'NO_INSTRUMENTS_IN_CATEGORY', stale: out.stale === true });
    },
    quote: NA('no order route'), prepare: NA('no order route'), simulate: NA('no order route'),
    execute: NA('the brain cannot open a position on this venue'), verify: NA('nothing is executed'),
    recover: async () => ({ status: 'NOT_RECOVERABLE', data: { strategy: 'SAFE_ANSWER: report the market read only' } })
  });
  const commodities = rwaSource('commodities', 'Commodities (Ostium)', 'commodities');
  const forex = rwaSource('forex', 'Forex (Ostium)', 'forex');
  const etf = defineModule({ ...commodities.definition, id: 'etf', name: 'ETF', capability: CAPABILITY.UNAVAILABLE, tools: ['etf.read'], state: ['markets'], permissions: { max: PERMISSION.READ }, errors: ['NO_DATA_SOURCE'], fallback: [], events: [], quote: NA('no ETF data source exists in this build, so there is nothing to quote'), prepare: NA('no route to prepare; declaring one would let the brain promise an ETF order'), simulate: NA('no ETF instrument to simulate against'), execute: NA('no trading route for ETFs exists server-side'), verify: NA('nothing is executed, so there is nothing to verify'), recover: NA('an absent source has no recovery path; the module reports UNAVAILABLE instead'), healthCheck: async () => ({ status: 'DOWN', detail: 'no ETF data source is wired in this deployment' }), capabilities: async () => ({ operations: [], executes: false, reason: 'no ETF feed exists in this build; the brain must say so rather than approximate from crypto data' }) });
  const funds = defineModule({
    ...etf.definition,
    id: 'funds', name: 'Funds', capability: CAPABILITY.UNAVAILABLE,
    tools: ['funds.read'], state: ['markets'], errors: ['NO_DATA_SOURCE'],
    events: [], fallback: [], permissions: { max: PERMISSION.READ },
    healthCheck: async () => ({ status: 'DOWN', detail: 'no fund data source is wired in this deployment' }),
    capabilities: async () => ({ operations: [], executes: false, reason: 'no fund feed exists in this build' })
  });
  const rwa = defineModule({ ...commodities.definition, id: 'rwa', name: 'Tokenised real-world assets', capability: CAPABILITY.READ_ONLY });

  /* ── crypto market intelligence ─────────────────────────────────────── */
  const crypto = defineModule({
    id: 'crypto', name: 'Crypto market data', capability: CAPABILITY.AVAILABLE,
    state: ['markets'], tools: ['markets.read', 'markets.history', 'markets.assetIntelligence'],
    events: ['PRICE_CHANGED'], errors: ['PROVIDER_DOWN', 'RATE_LIMITED', 'STALE_DATA'],
    permissions: { max: PERMISSION.READ }, fallback: ['stale snapshot flagged', 'coinlore → coingecko inside the provider layer'],
    getState: async () => ok('OK', readState('markets')),
    healthCheck: healthFrom(['market-data']),
    capabilities: async () => ({ operations: ['read'], executes: false, providers: ['coinlore', 'coingecko', 'geckoterminal'] }),
    read: readVia('marketSnapshot', (input) => ({ symbols: input.symbols || input.assets || [] })),
    quote: NA('market data is read, not quoted'),
    prepare: NA('market data is read; there is no transaction to prepare'),
    simulate: NA('a price feed has nothing to simulate; scenarios live in the lab module'),
    execute: NA('market data cannot be executed'),
    verify: async (input = {}) => {
      const fresh = await crypto.read({ symbols: input.symbols || [] });
      const stale = fresh.stale === true;
      return ok(stale ? 'PARTIAL' : 'VERIFIED', { consistent: !stale, prices: fresh.data?.prices || {}, note: 'a market read is verified by re-reading, not by trusting the cache' }, { source: 'market-data' });
    },
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 'SERVE_STALE_WITH_FLAG then REFRESH' } })
  });

  const signals = defineModule({
    id: 'signals', name: 'Signals engine', capability: CAPABILITY.AVAILABLE,
    state: ['signals'], tools: ['signals.read'], events: ['SIGNAL_CHANGED'],
    errors: ['NO_PRICE_HISTORY', 'TOO_FEW_POINTS'], permissions: { max: PERMISSION.READ },
    fallback: ['recompute from the last market snapshot'],
    getState: async () => ok('OK', readState('signals')),
    healthCheck: healthFrom(['market-data']),
    capabilities: async () => ({ operations: ['read'], executes: false, method: 'computed from fetched price history (SMA cross + realized volatility)', proprietary: false }),
    read: readVia('signals', (input) => ({ symbols: input.symbols || (readState('portfolio')?.holdings || []).map((h) => h.symbol).slice(0, 6) })),
    quote: NA('a computed signal has no price to quote'), prepare: NA('a signal is not a transaction'), simulate: NA('signal computation is already a simulation of a rule over history'), execute: NA('a signal is not an order'), verify: NA('a signal is verified by recomputing it on the fresher window'),
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 'RECOMPUTE from the freshest market history' } })
  });

  const news = defineModule({
    id: 'news', name: 'News engine', capability: CAPABILITY.AVAILABLE,
    state: ['news'], tools: ['news.read'], events: ['NEWS_RECEIVED'],
    errors: ['NO_FEEDS_REACHABLE'], permissions: { max: PERMISSION.READ },
    fallback: ['last merged feed, labelled stale'],
    getState: async () => ok('OK', readState('news')),
    healthCheck: healthFrom(['news-engine']),
    capabilities: async () => ({ operations: ['read'], executes: false }),
    read: readVia('news'),
    quote: NA('news has no price'), prepare: NA('a headline is not a transaction'), simulate: NA('nothing to simulate'), execute: NA('the brain never publishes or acts on news'), verify: NA('verifying a headline means opening its source, which is the client job'),
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 'SERVE_STALE_WITH_FLAG: one dead desk must not empty the feed' } })
  });

  const events = defineModule({
    id: 'events', name: 'Event bus', capability: CAPABILITY.AVAILABLE,
    state: ['events'], tools: ['events.recent', 'events.subscribe'], events: [],
    errors: ['RING_BUFFER_OVERFLOW', 'SUBSCRIBER_DISCONNECTED'],
    permissions: { max: PERMISSION.READ }, fallback: ['state is derived from the ring buffer, so a missed event self-heals on the next turn'],
    getState: async () => ok('OK', readState('events')),
    healthCheck: async () => ({ status: 'HEALTHY', detail: 'in-process ring buffer; the SSE stream is the subscriber side' }),
    capabilities: async () => ({ operations: ['read'], executes: false }),
    read: async () => ok('OK', { recent: (ctx.recentEvents?.() || []).slice(0, 30) }, { source: 'events-engine' }),
    quote: NA('an event has no price'), prepare: NA('events are produced by the pipeline, never prepared by a caller'), simulate: NA('the bus carries facts; simulating them would fabricate state'),
    execute: NA('events are produced by the pipeline; publishing from outside would break the audit trail'),
    verify: NA('an event is verified by the state change it produced'), recover: NA('a missed event self-heals because state is re-derived each turn')
  });

  /* ── alerts: durable, real writes (§40 requires execute + verify) ───── */
  const alerts = defineModule({
    id: 'alerts', name: 'Alerts', capability: CAPABILITY.AVAILABLE,
    state: ['alerts'], tools: ['alerts.read', 'alerts.create', 'alerts.delete'],
    events: ['ALERT_FIRED', 'PRICE_CHANGED'],
    errors: ['BAD_CONDITION', 'TOO_MANY_ALERTS', 'DURABLE_STORE_WRITE_FAILED'],
    permissions: { max: PERMISSION.PREPARE },
    fallback: ['in-memory list when no durable store is configured, reported as non-durable'],
    getState: async () => ok('OK', readState('alerts')),
    healthCheck: async () => ({ status: storeDurable() ? 'HEALTHY' : 'DEGRADED', detail: storeDurable() ? 'durable store configured' : 'no blob store: alerts survive this instance only' }),
    capabilities: async () => ({ operations: ['read', 'prepare', 'execute', 'verify'], executes: true, signs: false, note: 'an alert write moves no value; it is still confirmation-gated because it is a user-visible subscription' }),
    read: async () => {
      const rows = await storeGet(alertKey(owner), []);
      return ok('OK', { items: Array.isArray(rows) ? rows : [], durable: storeDurable() }, { source: 'alerts-store' });
    },
    prepare: async (input = {}) => {
      const condition = normaliseAlert(input);
      if (!condition.ok) return unavailable(condition.code);
      const existing = await storeGet(alertKey(owner), []);
      return ok('OK', { alert: condition.value, count: (existing || []).length, limit: MAX_ALERTS }, { source: 'alerts-store' });
    },
    quote: NA('an alert has no price'),
    simulate: async (input = {}) => {
      const condition = normaliseAlert(input);
      if (!condition.ok) return unavailable(condition.code);
      const price = readState('markets')?.prices?.[condition.value.symbol];
      if (price === undefined || price === null) return unavailable('PRICE_UNREADABLE', { detail: `no live price for ${condition.value.symbol}; firing logic cannot be projected` });
      return ok('OK', { condition: condition.value, currentPrice: price, wouldFireNow: evaluateAlert(condition.value, price), distancePct: Math.round((Math.abs(price - condition.value.value) / price) * 10000) / 100 }, { source: 'market-data + alerts-store' });
    },
    execute: async (input = {}) => {
      const condition = normaliseAlert(input);
      if (!condition.ok) return unavailable(condition.code);
      const rows = await storeGet(alertKey(owner), []);
      const list = Array.isArray(rows) ? rows : [];
      if (list.length >= MAX_ALERTS) return unavailable('TOO_MANY_ALERTS');
      const record = { ...condition.value, id: `alert_${randomUUID().slice(0, 8)}`, owner: hash(owner), createdAt: Date.now(), active: true };
      await storeSet(alertKey(owner), [record, ...list].slice(0, MAX_ALERTS));
      return ok('EXECUTED', { alert: record, durable: storeDurable() }, { source: 'alerts-store' });
    },
    verify: async (input = {}) => {
      const rows = await storeGet(alertKey(owner), []);
      const found = (Array.isArray(rows) ? rows : []).find((r) => r.id === input.alertId);
      return found ? ok('VERIFIED', { alert: found, present: true }, { source: 'alerts-store' }) : unavailable('ALERT_NOT_FOUND');
    },
    recover: async (error = {}) => (error?.code === 'DURABLE_STORE_WRITE_FAILED'
      ? { status: 'NOT_RECOVERABLE', data: { strategy: 'STOP: a persistence contract that failed is reported, not silently kept in memory' } }
      : { status: 'RECOVERED', data: { strategy: 'RETRY once, then report' } })
  });

  /* ── goals + profit plan ───────────────────────────────────────────── */
  const goals = defineModule({
    id: 'goals', name: 'Financial goals', capability: CAPABILITY.AVAILABLE,
    state: ['goals'], tools: ['goals.read', 'goals.create', 'goals.plan', 'goals.progress'],
    events: ['GOAL_PROGRESS_CHANGED'],
    errors: ['BAD_NAME', 'BAD_STARTING_CAPITAL', 'BAD_TARGET_AMOUNT', 'TARGET_DATE_TOO_SOON', 'TARGET_DATE_TOO_FAR', 'TOO_MANY_GOALS', 'GOAL_NOT_FOUND'],
    permissions: { max: PERMISSION.EXECUTE },
    riskContext: 'goals',
    fallback: ['last known plan, labelled with its age'],
    getState: async () => ok('OK', readState('goals')),
    healthCheck: async () => ({ status: storeDurable() ? 'HEALTHY' : 'DEGRADED', detail: storeDurable() ? 'durable goals store' : 'goals persist for this instance only' }),
    capabilities: async () => ({ operations: ['read', 'prepare', 'simulate', 'execute', 'verify'], executes: true, signs: false, limitations: [...FINANCIAL_GOAL_LIMITATIONS] }),
    read: readVia('goalList'),
    quote: NA('a goal is not quoted'),
    prepare: async (input = {}) => {
      const checked = validateGoalInput(goalInputFrom(input), { now: Date.now() });
      return checked.ok ? ok('OK', { valid: true, goal: checked.value }, { source: 'goals-engine' }) : unavailable(checked.code);
    },
    simulate: async (input = {}) => {
      const portfolio = readState('portfolio');
      const feasibility = goalFeasibility({
        currentUsd: input.startingCapital ?? portfolio?.totalValueUsd ?? null,
        targetUsd: input.targetAmount ?? input.targetUsd ?? null,
        years: input.years ?? horizonYears(input) ?? null,
        monthlyContributionUsd: input.monthlyContribution ?? 0,
        expectedReturnPct: input.expectedReturnPct ?? 12,
        volatilityPct: input.volatilityPct ?? (readState('markets')?.volatilityPct?.BTC ?? 60)
      });
      return feasibility.status === 'OK' ? ok('OK', feasibility, { source: 'goals-engine + forecast' }) : unavailable(feasibility.reason);
    },
    execute: async (input = {}) => {
      const created = await createGoal(owner, goalInputFrom(input), { now: Date.now() });
      return created.ok ? ok('EXECUTED', { goal: created.public }, { source: 'goals-engine' }) : unavailable(created.code);
    },
    verify: async (input = {}) => {
      const found = await getGoal(owner, input.goalId);
      return found?.ok ? ok('VERIFIED', { goal: found.goal || found.public || found }, { source: 'goals-engine' }) : unavailable(found?.code || 'GOAL_NOT_FOUND');
    },
    recover: async (error = {}) => ({ status: 'NOT_RECOVERABLE', data: { strategy: `fix the input: ${error?.code || 'invalid goal'}` } })
  });

  const profitPlan = defineModule({
    id: 'profit-plan', name: 'Profit plan', capability: CAPABILITY.AVAILABLE,
    state: ['profitPlan', 'goals', 'risk'], tools: ['profitplan.read', 'profitplan.optimize'],
    events: ['GOAL_PROGRESS_CHANGED'], errors: ['NO_PORTFOLIO_STATE', 'NO_GOAL'],
    permissions: { max: PERMISSION.PREPARE }, riskContext: 'profit-plan',
    fallback: ['plan recomputed from the freshest sections on every request'],
    getState: async () => ok('OK', readState('profitPlan')),
    healthCheck: async () => ({ status: 'HEALTHY', detail: 'pure derivation from central state; it has no upstream of its own' }),
    capabilities: async () => ({ operations: ['read', 'simulate'], executes: false, reason: 'a plan is advice plus actions; the actions live in swap/lending/goals and each keeps its own confirmation' }),
    read: async () => {
      const portfolio = readState('portfolio');
      const goalsSection = readState('goals');
      const risk = readState('risk');
      if (!portfolio?.holdings?.length) return unavailable('NO_PORTFOLIO_STATE');
      const concentration = analyzeConcentration(portfolio);
      const exposure = analyzeExposure({ portfolio, lending: readState('lending'), futures: readState('futures'), dydx: readState('dydx'), farming: readState('farming'), liquidity: readState('liquidity') });
      const opportunities = scanOpportunities({ yields: readState('farming'), portfolio, risk, capabilities: { lending: CAPABILITY.AVAILABLE } });
      const goal = Array.isArray(goalsSection?.goals) ? goalsSection.goals[0] : null;
      return ok('OK', {
        generatedAt: Date.now(),
        goal: goal ? { name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate, monthlyContribution: goal.monthlyContribution } : null,
        concentration: concentration.status === 'OK' ? { level: concentration.level, topAsset: concentration.topAsset, sharePct: concentration.topSharePct, shareOfPortfolioPct: concentration.topShareOfPortfolioPct, hhi: concentration.hhi } : { unavailable: concentration.reason },
        exposure: exposure.status === 'OK' ? { equityUsd: exposure.equityUsd, grossUsd: exposure.grossExposureUsd, debtUsd: exposure.debtUsd, leverage: exposure.leverageRatio } : { unavailable: exposure.reason },
        riskLevel: risk?.level || 'UNKNOWN',
        opportunities: opportunities.status === 'OK' ? opportunities.rows : [],
        dataSources: ['portfolio-service', 'market-data', 'yields-engine', 'risk-engine', 'goals-engine'],
        method: 'derived from live sections; every figure below the header comes from a tool result, none from the model',
        notIncluded: ['price forecasts presented as certainties', 'venues this app cannot trade']
      }, { source: 'profit-plan (derived)' });
    },
    quote: NA('a plan has no price to quote; its numbers come from the sections it reads'), 
    prepare: async (input = {}) => {
      const read = await profitPlan.read(input);
      if (read.status === 'UNAVAILABLE') return read;
      return ok('OK', { plan: read.data, nextActions: ['trim concentration', 'park idle stables', 'set alerts'] }, { source: 'profit-plan' });
    },
    simulate: async (input = {}) => {
      const portfolio = readState('portfolio');
      if (!portfolio?.holdings?.length) return unavailable('NO_PORTFOLIO_STATE');
      const base = simulateShock({ portfolio, lending: readState('lending'), futures: readState('futures'), dydx: readState('dydx') }, input.shockPct ?? -20);
      return base.status === 'OK' ? ok('OK', base, { source: 'lab + portfolio-service' }) : unavailable(base.reason);
    },
    execute: NA('executing a plan means executing its actions, each with its own confirmation'),
    verify: NA('a plan is verified by the outcomes of the actions it proposes'),
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 'RECOMPUTE from refreshed sections rather than answer from the last plan' } })
  });

  /* ── lab / forecast / prediction ────────────────────────────────────── */
  const lab = defineModule({
    id: 'lab', name: 'Lab (what-if, backtest, paper trading)', capability: CAPABILITY.AVAILABLE,
    state: ['portfolio', 'markets'], tools: ['lab.whatif', 'lab.backtest', 'lab.paperTrade'],
    events: [], errors: ['NO_PORTFOLIO_STATE', 'NO_PRICE_HISTORY'], permissions: { max: PERMISSION.PREPARE },
    riskContext: 'portfolio',
    fallback: ['recompute against live state; never answer from a saved scenario'],
    getState: async () => ok('OK', { note: 'the lab shares the central state, so a simulation uses the same portfolio the reply quotes' }),
    healthCheck: async () => ({ status: 'HEALTHY', detail: 'shares the market-data and risk engines' }),
    capabilities: async () => ({ operations: ['read', 'simulate'], executes: false, reason: 'paper scenarios only; no order route is reachable from the lab' }),
    read: async () => ok('OK', { scenarios: ['shock', 'rebalance', 'goal'], note: 'simulations run on live central state' }, { source: 'lab' }),
    quote: NA('a scenario is parameterised, not quoted'),
    prepare: async (input = {}) => ok('OK', { scenario: input.scenario || 'shock', parameters: input, uses: ['portfolio', 'markets', 'risk'] }, { source: 'lab' }),
    simulate: async (input = {}) => {
      const portfolio = readState('portfolio');
      if (!portfolio?.holdings?.length) return unavailable('NO_PORTFOLIO_STATE');
      const shock = Number(input.shockPct ?? -30);
      const result = simulateShock({ portfolio, lending: readState('lending'), futures: readState('futures'), dydx: readState('dydx'), liquidity: readState('liquidity') }, shock, { shockByAsset: input.shockByAsset || null });
      if (result.status !== 'OK') return unavailable(result.reason);
      const correlation = correlate(readState('markets')?.history?.BTC || [], readState('markets')?.history?.ETH || []);
      return ok('OK', { ...result, correlation: correlation.status === 'OK' ? { btcEth: correlation.coefficient, samples: correlation.samples, strength: correlation.strength } : { unavailable: correlation.reason } }, { source: 'lab + portfolio-service + market-data' });
    },
    execute: NA('the lab is a simulator; executing a scenario is a real action in the swap or lending module, with its own confirmation'),
    verify: NA('nothing executes in the lab'),
    recover: async () => ({ status: 'NOT_RECOVERABLE', data: { strategy: 'SAFE_ANSWER: state which section is missing' } })
  });

  const forecast = defineModule({
    id: 'forecast', name: 'Forecast', capability: CAPABILITY.READ_ONLY,
    state: ['markets'], tools: ['forecast.range'], events: [], errors: ['NO_PRICE_HISTORY', 'TOO_FEW_POINTS'],
    permissions: { max: PERMISSION.READ }, fallback: ['volatility band recomputed from the latest history'],
    getState: async () => ok('OK', readState('markets')?.volatilityPct ?? null),
    healthCheck: healthFrom(['market-data']),
    capabilities: async () => ({ operations: ['read'], executes: false, note: 'a realised-volatility band, not a price prediction; the label matters' }),
    read: async (input = {}) => {
      const symbol = String(input.symbol || 'BTC').toUpperCase();
      const vol = realizedVolatilityPct((readState('markets')?.history || {})[symbol] || []);
      if (vol.status !== 'OK') return unavailable(vol.reason);
      const price = readState('markets')?.prices?.[symbol];
      if (price === null || price === undefined) return unavailable('PRICE_UNREADABLE');
      const horizonDays = Math.max(1, Number(input.horizonDays || 30));
      const sigma = (vol.volatilityPct / 100) * Math.sqrt(horizonDays);
      return ok('OK', {
        symbol, price, horizonDays,
        bandLowUsd: Math.round(price * (1 - 1.96 * sigma) * 100) / 100,
        bandHighUsd: Math.round(price * (1 + 1.96 * sigma) * 100) / 100,
        method: 'normal 95% band on realised daily volatility from the fetched history',
        notACeiling: true,
        caveat: 'a statistical band on past volatility, not a forecast of direction; tails are heavier than normal',
        samples: vol.samples
      }, { source: 'market-data (realised volatility)' });
    },
    quote: NA('a forecast band is derived from realised volatility; nothing to quote'), prepare: NA('a band is not a transaction'), simulate: NA('the lab runs scenarios; forecast reports the band only'), execute: NA('a forecast cannot be executed'), verify: NA('a statistical band cannot be verified; claiming it was would be a lie'),
    recover: async () => ({ status: 'NOT_RECOVERABLE', data: { strategy: 'report the band or say the history was too short' } })
  });

  const prediction = defineModule({
    id: 'prediction', name: 'Prediction markets', capability: CAPABILITY.UNAVAILABLE,
    state: ['markets'], tools: ['prediction.read'], events: [], errors: ['FEATURE_GATED'], permissions: { max: PERMISSION.READ },
    fallback: [], quote: NA('speculation surfaces are build-gated off'), prepare: NA('no prediction market route is exposed to the brain'), simulate: NA('no market to simulate'), execute: NA('no order route, by build flag'), verify: NA('nothing is executed'), recover: NA('a gated feature has no recovery path; the gate is the answer'),
    read: async () => unavailable('FEATURE_GATED', { detail: 'speculative surfaces are build-gated off (see src/lib/features.js); no server-side feed is exposed to the brain' }),
    getState: async () => ok('UNAVAILABLE', null, { reason: 'FEATURE_GATED' }),
    healthCheck: async () => ({ status: 'DOWN', detail: 'gated off by build flag' }),
    capabilities: async () => ({ operations: [], executes: false, reason: 'prediction markets are unavailable in this build' })
  });

  /* ── transactions + notifications ───────────────────────────────────── */
  const transactions = defineModule({
    id: 'transactions', name: 'Transactions', capability: CAPABILITY.AVAILABLE,
    state: ['transactions', 'recentActions', 'pendingActions'], tools: ['transactions.recent', 'transactions.receipt', 'transactions.verify'],
    events: ['TRANSACTION_CONFIRMED', 'TRANSACTION_FAILED'],
    errors: ['BAD_TX_HASH', 'UNSUPPORTED_CHAIN', 'RPC_ERROR'],
    permissions: { max: PERMISSION.READ },
    fallback: ['re-read the receipt from a second RPC endpoint'],
    getState: async () => ok('OK', readState('transactions')),
    healthCheck: healthFrom(['blockchain']),
    capabilities: async () => ({ operations: ['read', 'verify'], executes: false, reason: 'broadcasting is the wallet job; verification is ours' }),
    read: async () => {
      const actions = readState('recentActions') || [];
      const pending = readState('pendingActions') || [];
      return ok('OK', { recent: actions.slice(0, 12), pending: pending.slice(0, 8), durable: storeDurable() }, { source: 'transaction-service' });
    },
    quote: NA('a transaction has no quote; it has a receipt'), prepare: NA('calldata is built by the module that owns the action, not here'), simulate: NA('simulation belongs to the action module that will run it'),
    execute: NA('the server does not broadcast; the wallet signs and the brain verifies'),
    verify: async (input = {}) => {
      const receipt = await io('transactionReceipt')({ chainId: input.chainId || 1, hash: input.txHash });
      if (!receipt?.ok) return unavailable(receipt?.code || 'RECEIPT_READ_FAILED');
      return ok(receipt.status === 'CONFIRMED' ? 'VERIFIED' : receipt.status === 'FAILED' ? 'MISMATCH' : 'PENDING', receipt, { source: 'blockchain' });
    },
    recover: async (error = {}) => (error?.code === 'BAD_TX_HASH'
      ? { status: 'NOT_RECOVERABLE', data: { strategy: 'SAFE_ANSWER: the hash is not a hash' } }
      : { status: 'RECOVERED', data: { strategy: 'FAILOVER_RPC then RECHECK; a missing receipt is PENDING vs NOT_FOUND, and the difference is reported' } })
  });

  const notifications = defineModule({
    id: 'notifications', name: 'Notifications', capability: CAPABILITY.READ_ONLY,
    state: ['alerts'], tools: ['notifications.status'], events: ['ALERT_FIRED'],
    errors: ['PUSH_NOT_CONFIGURED'], permissions: { max: PERMISSION.READ }, fallback: ['in-app toast path is always available'],
    getState: async () => ok('OK', { configured: false, note: 'transport configuration is read from the push module' }),
    healthCheck: async () => {
      try {
        const { pushConfigured } = await import('../push.js');
        return { status: pushConfigured() ? 'HEALTHY' : 'DEGRADED', detail: pushConfigured() ? 'web-push keys configured' : 'no VAPID keys: in-app alerts only' };
      } catch {
        return { status: 'DEGRADED', detail: 'push module not loadable' };
      }
    },
    capabilities: async () => ({ operations: ['read'], executes: false, reason: 'broadcast is owned by the cron/notification routes; the brain must not send to other users' }),
    read: async () => ok('OK', { alerts: (readState('alerts')?.items || []).length, durable: storeDurable() }, { source: 'notifications' }),
    quote: NA('a notification has no price'), prepare: NA('delivery is configured by the push routes, not by the brain'), simulate: NA('nothing to simulate'), execute: NA('the brain never broadcasts'), verify: NA('delivery receipts come from the push provider; the brain does not claim them'), recover: NA('delivery retries are the transport job (web-push expiry and 410 handling)')
  });

  /* ── risk: the shared engine, exposed as a module so it can be health-checked */
  const risk = defineModule({
    id: 'risk', name: 'Central risk engine', capability: CAPABILITY.AVAILABLE,
    state: ['risk'], tools: ['risk.analyze', 'risk.concentration', 'risk.exposure', 'risk.correlations'],
    events: ['RISK_CHANGED', 'LIQUIDATION_RISK_CHANGED'],
    errors: ['NO_PORTFOLIO_STATE', 'STALE_DATA', 'MISSING_INPUT'],
    permissions: { max: PERMISSION.READ },
    fallback: ['a missing input lowers confidence instead of being guessed'],
    getState: async () => ok('OK', readState('risk')),
    healthCheck: async () => ({ status: 'HEALTHY', detail: 'pure function of the central state; it inherits the health of its inputs' }),
    capabilities: async () => ({ operations: ['read'], executes: false, shared: true, usedBy: ['swap', 'bridge', 'lending', 'borrowing', 'futures', 'dydx', 'goals', 'profit-plan'] }),
    read: async (input = {}) => {
      const state = ctx.state?.() || { sections: {} };
      const verdict = assessRisk({ state, context: input.context || 'portfolio', capabilities: ctx.capabilities?.() || {}, quote: input.quote || null, now: Date.now() });
      return ok('OK', verdict, { source: 'risk-engine' });
    },
    quote: NA('risk is computed from state; it is not quoted'), prepare: NA('a risk verdict is not a transaction'),
    simulate: async (input = {}) => {
      const state = ctx.state?.() || { sections: {} };
      const base = assessRisk({ state, context: input.context || 'portfolio', now: Date.now() });
      const withAction = assessRisk({ state, context: input.context || 'portfolio', quote: input.quote || null, capabilities: ctx.capabilities?.() || {}, now: Date.now() });
      return ok('OK', { before: base.level, after: withAction.level, changed: base.level !== withAction.level, factorsAdded: withAction.factors.filter((f) => !base.factors.some((b) => b.id === f.id)).map((f) => ({ id: f.id, level: f.level, detail: f.detail })) }, { source: 'risk-engine' });
    },
    execute: NA('a risk engine that could execute would be a trading bot'), verify: NA('risk is verified by re-running it on refreshed state'),
    recover: async () => ({ status: 'RECOVERED', data: { strategy: 'recompute after the underlying sections are refreshed' } })
  });

  return [wallet, portfolio, swap, bridge, lending, borrowing, farming, liquidity, staking, futures, dydx, stocks, etf, funds, forex, commodities, rwa, crypto, signals, news, events, alerts, goals, profitPlan, prediction, lab, risk, forecast, transactions, notifications];
}

/* ── helpers ───────────────────────────────────────────────────────────── */
function estimateLendingEffect({ reserve, position, action, amountUsd }) {
  const amount = Number(amountUsd) || 0;
  const borrowApr = Number(reserve?.borrowApy) || 0;
  const supplyApr = Number(reserve?.supplyApy) || 0;
  const debt = Number(position?.debtUsd) || 0;
  const collateral = Number(position?.collateralUsd) || 0;
  const yearlyCost = action === 'borrow' ? amount * (borrowApr / 100) : 0;
  const yearlyEarnings = action === 'supply' ? amount * (supplyApr / 100) : 0;
  return {
    action: action || 'supply',
    amountUsd: round(amount, 2),
    yearlyCostUsd: round(yearlyCost, 2),
    yearlyEarningsUsd: round(yearlyEarnings, 2),
    debtAfterUsd: round(debt + (action === 'borrow' ? amount : action === 'repay' ? -amount : 0), 2),
    collateralAfterUsd: round(collateral + (action === 'supply' ? amount : action === 'withdraw' ? -amount : 0), 2),
    basis: 'current protocol rates; they move, so this is a snapshot not a schedule'
  };
}

function goalInputFrom(input = {}) {
  const targetDate = input.targetDate || (input.years ? Date.now() + Number(input.years) * 365 * 24 * 3600_000 : (input.months ? Date.now() + Number(input.months) * 30 * 24 * 3600_000 : null));
  return {
    name: input.name || input.title || 'FBT goal',
    startingCapital: input.startingCapital ?? input.currentUsd ?? null,
    targetAmount: input.targetAmount ?? input.targetUsd ?? null,
    targetDate,
    monthlyContribution: input.monthlyContribution ?? input.contributionUsdMonthly ?? 0,
    currency: input.currency || 'USD',
    riskProfile: input.riskProfile || 'balanced'
  };
}

function horizonYears(input = {}) {
  if (input.years) return Number(input.years);
  if (input.months) return Number(input.months) / 12;
  if (input.targetDate) return Math.max(0.08, (Number(input.targetDate) - Date.now()) / (365 * 24 * 3600_000));
  return null;
}

function normaliseAlert(input = {}) {
  const symbol = String(input.symbol || input.asset || '').toUpperCase().slice(0, 12);
  const kind = String(input.below !== undefined ? 'below' : input.above !== undefined ? 'above' : input.condition || '').toLowerCase();
  const value = Number(input.below ?? input.above ?? input.value ?? input.price);
  if (!symbol) return { ok: false, code: 'BAD_CONDITION', detail: 'no asset named' };
  if (!Number.isFinite(value) || value <= 0) return { ok: false, code: 'BAD_CONDITION', detail: 'no numeric threshold' };
  if (!['above', 'below'].includes(kind)) return { ok: false, code: 'BAD_CONDITION', detail: 'condition must be above or below' };
  return { ok: true, value: { symbol, kind, value: Math.round(value * 1e6) / 1e6, label: `${symbol} ${kind} ${value} USD` } };
}

function evaluateAlert(alert, price) {
  const p = Number(price);
  if (!Number.isFinite(p)) return null;
  return alert.kind === 'above' ? p >= alert.value : p <= alert.value;
}

const round = (v, d = 2) => { const f = 10 ** d; const n = Number(v); return Number.isFinite(n) ? Math.round(n * f) / f : null; };

export { healthFrom, readVia };
