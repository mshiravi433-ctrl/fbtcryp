/**
 * FBT FLASH LIQUIDITY — Phase 152
 * ---------------------------------------------------------------------------
 * Flash-loan (collateral-free) arbitrage planning for the FBT Intent OS.
 *
 * Pipeline (mirrors docs/INTENT-AI-PHASE152-FLASH-LIQUIDITY-FA.md):
 *   Intent OS → Opportunity Scanner → Flash Liquidity Router (provider pick +
 *   optimal size) → MEV/Execution policy → DEX route (hops) → Atomic
 *   Settlement (all-or-revert in one transaction).
 *
 * THE HONEST CORE — read before using anything in this file:
 *   1. A flash loan is NOT free money. Principal + premium must be repaid in
 *      the SAME transaction or the whole transaction reverts (gas is still
 *      spent on a revert).
 *   2. Nothing here broadcasts a transaction. A plan that reaches
 *      EXECUTE_READY still requires (a) a fresh on-chain simulation, and
 *      (b) an explicit wallet signature, against an independently audited
 *      router contract. This module is a deterministic planner and judge.
 *   3. All profits are ESTIMATES computed from indicative reserve snapshots.
 *      Real execution can differ; the on-chain min-profit check reverts the
 *      transaction instead of settling at a loss.
 *   4. Public-mempool submission is refused for arbitrage plans (sandwich
 *      risk). Private relay submission is the only MEV posture offered.
 *
 * Determinism: pure functions, no network, no wallet, no storage. Safe to run
 * in the browser and on the server. BigInt math for exact token accounting;
 * a bounded float ternary search for the optimal loan size, re-verified with
 * BigInt before a plan is produced.
 */

export const FLASH_LIQUIDITY_VERSION = 'flash-liquidity.phase152.v1';

export const BPS_DENOMINATOR = 10000n;

/* ── Honest invariants advertised to UI and API consumers ─────────────────── */
export const FLASH_LIQUIDITY_LIMITS = Object.freeze({
  notFreeMoney: true,
  atomicSameTransactionOnly: true,
  revertOnUnprofitable: true,
  gasIsStillSpentOnRevert: true,
  profitIsAnEstimate: true,
  guaranteedProfit: false,
  requiresAuditedRouterContract: true,
  requiresWalletSignature: true,
  autoBroadcasts: false,
  serverAcceptsFunds: false,
  serverExecutesTransactions: false,
  publicMempoolSubmission: 'refused',
  mevPosture: 'private-relay'
});

export const DEFAULT_MIN_NET_PROFIT_BPS = 50;   // 0.50% of loan size (user intent default)
export const POLICY_FLOOR_NET_PROFIT_BPS = 10;  // policy can never demand less than 0.10%
export const DEFAULT_SLIPPAGE_BPS = 30;         // per-hop minOut buffer
export const DEFAULT_DEADLINE_SECONDS = 60;     // plan expiry; quotes die fast
export const MAX_QUOTE_AGE_MS = 15_000;         // scanner refuses older snapshots
export const MAX_HOPS = 6;
export const DEFAULT_PLATFORM_FEE_BPS = 70;     // matches FBT Swap 0.70% platform fee
export const DEFAULT_MEV_BUFFER_BPS = 10;       // haircut on gross profit for MEV/auction costs
export const DEFAULT_GAS_UNITS = 650_000;       // Aave flashLoan + 2-3 hop reference estimate
export const AAVE_V3_DEFAULT_PREMIUM_BPS = 5;   // 0.05%
export const BALANCER_V2_PREMIUM_BPS = 0;       // Vault flash loans are fee-free today

/* ── Provider registry (fail-closed) ───────────────────────────────────────────
 * Only addresses marked verified:true may be used to build an executable
 * preparation. Chains without a verified address exist in the registry so the
 * UI can show coverage honestly; planning on them fails with
 * PROVIDER_ADDRESS_UNVERIFIED until an operator supplies and verifies the
 * deployment address (see the phase doc's activation checklist).              */
const CHAIN_NAMES = {
  1: 'Ethereum', 10: 'Optimism', 56: 'BNB Chain', 137: 'Polygon',
  146: 'Sonic', 42161: 'Arbitrum', 8453: 'Base', 43114: 'Avalanche', 59144: 'Linea'
};

export const FLASH_PROVIDER_REGISTRY = Object.freeze({
  'aave-v3': Object.freeze({
    id: 'aave-v3',
    label: 'Aave V3',
    kind: 'lending-pool',
    entryFunction: 'flashLoanSimple',
    callback: 'executeOperation',
    assetsPerLoan: 1,
    premiumBps: AAVE_V3_DEFAULT_PREMIUM_BPS,
    premiumSource: 'reserve factor-based premium, default 0.05%; verified per-asset at plan time',
    docs: 'https://aave.com/docs/developers/flash-loans',
    chains: Object.freeze({
      1: Object.freeze({ pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', verified: true }),
      10: Object.freeze({ pool: null, verified: false }),
      56: Object.freeze({ pool: null, verified: false }),
      137: Object.freeze({ pool: null, verified: false }),
      146: Object.freeze({ pool: null, verified: false }),
      42161: Object.freeze({ pool: null, verified: false }),
      8453: Object.freeze({ pool: null, verified: false }),
      43114: Object.freeze({ pool: null, verified: false }),
      59144: Object.freeze({ pool: null, verified: false })
    })
  }),
  'balancer-v2': Object.freeze({
    id: 'balancer-v2',
    label: 'Balancer Vault',
    kind: 'vault',
    entryFunction: 'flashLoan',
    callback: 'receiveFlashLoan',
    assetsPerLoan: 'multi',
    premiumBps: BALANCER_V2_PREMIUM_BPS,
    premiumSource: 'Balancer Vault flash loans are fee-free (protocol-verified constant)',
    docs: 'https://docs.balancer.fi/concepts/vault/flashloans.html',
    chains: Object.freeze({
      1: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      10: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      56: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      137: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      42161: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      8453: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      43114: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      59144: Object.freeze({ vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', verified: true }),
      146: Object.freeze({ vault: null, verified: false })
    })
  })
});

export function chainName(chainId) {
  return CHAIN_NAMES[chainId] || `chain ${chainId}`;
}

/* ── Intent parsing (fa / en, Persian & Arabic digits) ─────────────────────── */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalize Persian/Arabic digits, Arabic percent sign and separators. */
export function normalizeDigits(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const fa = FA_DIGITS.indexOf(ch);
    if (fa >= 0) { out += String(fa); continue; }
    const ar = AR_DIGITS.indexOf(ch);
    if (ar >= 0) { out += String(ar); continue; }
    if (ch === '٪') { out += '%'; continue; }
    out += ch === '،' ? ',' : ch;
  }
  return out;
}

const CHAIN_ALIASES = [
  [1, /ethereum|اتریوم|اتریوم/i],
  [10, /optimism|اپتیمیزم|اپتيمايزم/i],
  [56, /\bnb\b|bnb\s*chain|binance|بایننس|بيانس/i],
  [137, /polygon|پالیگان|پولیگان|متیک/i],
  [146, /sonic|سونیک/i],
  [42161, /arbitrum|اربیتروم|آربیتروم|أربيتروم/i],
  [8453, /\bbase\b|بیس/i],
  [43114, /avalanche|آوالانچ|اوالانچ|aventure/i],
  [59144, /linea|لینه|لينيا/i]
];

const ASSET_ALIASES = [
  ['USDC', /\busdc|یو\s*اس\s*دی\s*c|استیبل\s*coined/i],
  ['USDT', /\busdt|تتر|تِتر/i],
  ['DAI', /\bdai\b|دای\b/i],
  ['WETH', /\bweth\b/],
  ['ETH', /\beth\b|اتریوم\s*خود|اتریوم\b|\bether\b/i],
  ['WBTC', /\bwbtc\b|بیت\s*کوین\s*پیچ/i],
  ['BNB', /\bbnb\b/]
];

/**
 * Parse a natural-language flash-arbitrage intent.
 * Example (the canonical one, from the FBT spec conversation):
 *   «با ۰ سرمایه اولیه، هر آربیتراژی که بعد از Gas + Flash Fee حداقل ۰.۵٪
 *    سود دارد اجرا کن»
 *   "With zero initial capital, execute any arbitrage netting at least 0.5%
 *    profit after gas + flash fee."
 */
export function parseFlashIntent(rawText) {
  const text = normalizeDigits(String(rawText || ''));
  if (!text.trim()) return { ok: false, code: 'EMPTY_INTENT' };

  const lower = text.toLowerCase();
  const isFlash = /flash\s*loan|فلاش\s*لان|فلش\s*لان|وام\s*فلاش|وام\s*برون\s*زنجیره‌ای|بدون\s*وثیقه/i.test(text)
    || /آربیتراژ|arbitrage/i.test(text);
  if (!isFlash) return { ok: false, code: 'NOT_FLASH_INTENT' };

  const zeroCapital = /سرمایه\s*(اولیه\s*)?(صفر|0)|با\s*0\s*سرمایه|بدون\s*سرمایه|zero(\s*initial)?\s*capital|no\s*capital/i.test(text);
  const mentionsArbitrage = /آربیتراژ|arbitrage/i.test(text);

  // Minimum net profit: a percent figure near profit words.
  let minNetProfitPct = null;
  const pctRe = /(\d+(?:[.,]\d+)?)\s*(?:%|٪|درصد|percent)/gi;
  const profitWord = /(سود|profit|بازده|return|بهره)/i;
  for (const m of text.matchAll(pctRe)) {
    const value = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const around = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (profitWord.test(around)) {
      minNetProfitPct = minNetProfitPct === null ? value : Math.max(minNetProfitPct, value);
    }
  }

  let chainId = null;
  for (const [id, re] of CHAIN_ALIASES) {
    if (re.test(text)) { chainId = id; break; }
  }

  let asset = null;
  for (const [symbol, re] of ASSET_ALIASES) {
    if (re.test(lower)) { asset = symbol; break; }
  }

  const clampedPct = minNetProfitPct === null
    ? DEFAULT_MIN_NET_PROFIT_BPS / 100
    : Math.min(5, Math.max(0.01, minNetProfitPct));

  return {
    ok: true,
    kind: 'flash-arbitrage',
    initialCapital: 0,
    zeroCapital,
    minNetProfitPct: clampedPct,
    minNetProfitBps: Math.round(clampedPct * 100),
    asset,
    chainId,
    atomic: true,
    settlement: 'same-transaction',
    raw: String(rawText || '')
  };
}

/* ── Exact AMM math (Uniswap V2-style constant product, fee on input) ─────── */

/** amountOut = floor(in·(1−fee)·R_out / (R_in + in·(1−fee))) — BigInt exact. */
export function constantProductOut(amountIn, reserveIn, reserveOut, feeBps) {
  const inBig = BigInt(amountIn);
  const rIn = BigInt(reserveIn);
  const rOut = BigInt(reserveOut);
  const fee = BigInt(feeBps);
  if (inBig <= 0n || rIn <= 0n || rOut <= 0n) return 0n;
  if (fee < 0n || fee >= BPS_DENOMINATOR) return 0n;
  const inWithFee = inBig * (BPS_DENOMINATOR - fee);
  const numerator = inWithFee * rOut;
  const denominator = rIn * BPS_DENOMINATOR + inWithFee;
  return numerator / denominator;
}

/**
 * Evaluate a hop chain with an exact input of `amountIn` (base units of the
 * settlement asset). hops: [{ reserveIn, reserveOut, feeBps }, ...].
 * Returns { amountOut, hops: [out per hop] }.
 */
export function evaluateHops(hops, amountIn) {
  if (!Array.isArray(hops) || hops.length === 0 || hops.length > MAX_HOPS) {
    return { amountOut: 0n, hops: [] };
  }
  let current = BigInt(amountIn);
  const perHop = [];
  for (const hop of hops) {
    current = constantProductOut(current, hop.reserveIn, hop.reserveOut, hop.feeBps);
    perHop.push(current);
    if (current === 0n) break;
  }
  return { amountOut: current, hops: perHop };
}

/** Net profit in settlement-asset base units after repaying loan + premium. */
export function netProfitAsset(amountIn, hops, loanPremiumBps) {
  const { amountOut } = evaluateHops(hops, amountIn);
  const repay = (BigInt(amountIn) * (BPS_DENOMINATOR + BigInt(loanPremiumBps))) / BPS_DENOMINATOR;
  return amountOut - repay;
}

/**
 * Closed-form optimal loan size for the 2-pool case (see phase doc for the
 * derivation). a1,b1 = buy-pool reserves (A→B); b2,a2 = sell-pool (B→A);
 * swapFeeBps applies to both pools; loanPremiumBps is the flash premium.
 * Returns the optimal input as a float (0 when no profitable size exists).
 */
export function closedFormOptimalTwoPool(a1, b1, b2, a2, swapFeeBps, loanPremiumBps) {
  const gamma = (10000 - swapFeeBps) / 10000;
  const p = loanPremiumBps / 10000;
  const root = Math.sqrt((a1 * a2 * b1 * b2) / (1 + p));
  const numerator = gamma * root - a1 * b2;
  const denominator = gamma * b2 + gamma * gamma * b1;
  if (denominator <= 0) return 0;
  const x = numerator / denominator;
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Optimal flash-loan size for any hop count: bounded ternary search on the
 * unimodal net-profit curve, followed by a deterministic BigInt refinement so
 * the final plan is exact in base units. Returns BigInt amountIn (0n when no
 * profitable size exists).
 *
 * `hops` may carry `assetIn`/`assetOut` labels; use validateHopChain to check
 * token continuity — the math itself is token-agnostic on purpose.
 */
export function optimalFlashLoanAmount(hops, loanPremiumBps) {
  if (!Array.isArray(hops) || hops.length === 0 || hops.length > MAX_HOPS) return 0n;

  // Float pass: search in "reserve units" using the tightest hop reserve.
  let hi = Infinity;
  for (const hop of hops) {
    const rIn = Number(hop.reserveIn);
    if (!Number.isFinite(rIn) || rIn <= 0) return 0n;
    hi = Math.min(hi, rIn);
  }
  const lo = 0;
  const profitAt = (x) => {
    let current = x;
    for (const hop of hops) {
      const gamma = (10000 - hop.feeBps) / 10000;
      current = (current * gamma * Number(hop.reserveOut)) / (Number(hop.reserveIn) + current * gamma);
    }
    return current - x * (1 + loanPremiumBps / 10000);
  };
  let left = lo;
  let right = hi;
  for (let i = 0; i < 220; i += 1) {
    const m1 = left + (right - left) / 3;
    const m2 = right - (right - left) / 3;
    if (profitAt(m1) < profitAt(m2)) left = m1; else right = m2;
  }
  const approx = (left + right) / 2;

  // Exact pass: local search around the float optimum with a shrinking step
  // ladder, so the integer answer converges to within ~1e-4 of the peak.
  let bestAmount = BigInt(Math.max(1, Math.floor(approx)));
  let bestProfit = netProfitAsset(bestAmount, hops, loanPremiumBps);
  const stepBps = [500, 200, 100, 50, 20, 10, 5, 2, 1]; // 5% … 0.01%
  let improved = true;
  let guard = 0;
  while (improved && guard < 64) {
    improved = false;
    guard += 1;
    for (const step of stepBps) {
      for (const sign of [1n, -1n]) {
        const candidate = bestAmount + sign * (bestAmount * BigInt(step)) / 10000n;
        if (candidate <= 0n) continue;
        const profit = netProfitAsset(candidate, hops, loanPremiumBps);
        if (profit > bestProfit) {
          bestProfit = profit;
          bestAmount = candidate;
          improved = true;
        }
      }
    }
  }
  return bestProfit > 0n ? bestAmount : 0n;
}

/**
 * Token-continuity check for labeled hops: hops[i].assetOut must equal
 * hops[i+1].assetIn, and the chain must close back to the settlement asset.
 * Unlabeled hops are accepted only via the raw math functions; planners and
 * scanners must label and validate.
 */
export function validateHopChain(hops, settlementAsset) {
  if (!Array.isArray(hops) || hops.length === 0 || hops.length > MAX_HOPS) {
    return { ok: false, code: 'BAD_HOP_COUNT' };
  }
  for (const hop of hops) {
    if (typeof hop.assetIn !== 'string' || typeof hop.assetOut !== 'string' || !hop.assetIn || !hop.assetOut) {
      return { ok: false, code: 'HOP_TOKENS_UNLABELED' };
    }
  }
  for (let i = 0; i < hops.length - 1; i += 1) {
    if (hops[i].assetOut !== hops[i + 1].assetIn) {
      return { ok: false, code: 'HOP_TOKEN_MISMATCH', at: i, detail: `${hops[i].assetOut} → ${hops[i + 1].assetIn}` };
    }
  }
  if (hops[hops.length - 1].assetOut !== settlementAsset) {
    return { ok: false, code: 'ROUTE_DOES_NOT_CLOSE', detail: `ends in ${hops[hops.length - 1].assetOut}, expected ${settlementAsset}` };
  }
  if (hops[0].assetIn !== settlementAsset) {
    return { ok: false, code: 'ROUTE_WRONG_SETTLEMENT', detail: `starts in ${hops[0].assetIn}, expected ${settlementAsset}` };
  }
  return { ok: true };
}

/* ── Policy (user-owned caps; Guardian-style immutable gates) ──────────────── */

export const FLASH_POLICY_SCHEMA = Object.freeze({
  chainAllowlist: 'int[]',
  maxLoanUsd: 'number',
  maxGasUsd: 'number',
  maxHops: 'int',
  minNetProfitBps: 'int (≥ 10)',
  mevPosture: '"private-relay" (only value accepted)',
  dailyMaxAttempts: 'int',
  killSwitch: 'bool'
});

export function createFlashPolicy(overrides = {}) {
  const minBps = overrides.minNetProfitBps == null
    ? DEFAULT_MIN_NET_PROFIT_BPS
    : Math.max(POLICY_FLOOR_NET_PROFIT_BPS, Math.round(Number(overrides.minNetProfitBps) || 0));
  return Object.freeze({
    chainAllowlist: Array.isArray(overrides.chainAllowlist) && overrides.chainAllowlist.length
      ? overrides.chainAllowlist.map(Number)
      : Object.keys(CHAIN_NAMES).map(Number),
    maxLoanUsd: Math.max(1, Number(overrides.maxLoanUsd) || 250_000),
    maxGasUsd: Math.max(0.1, Number(overrides.maxGasUsd) || 25),
    maxHops: Math.min(MAX_HOPS, Math.max(1, Math.round(Number(overrides.maxHops) || 4))),
    minNetProfitBps: minBps,
    mevPosture: 'private-relay',
    dailyMaxAttempts: Math.max(1, Math.round(Number(overrides.dailyMaxAttempts) || 20)),
    killSwitch: Boolean(overrides.killSwitch),
    requireSimulation: true,       // immutable — a plan without simulation is never ready
    requireWalletSignature: true,  // immutable — nothing executes without the user
    promisesFixedProfit: false     // honest label, same convention as phase 151-200
  });
}

/**
 * Judge a plan against policy. `attemptsToday` comes from the caller's own
 * counter (the planner never persists state).
 */
export function flashPolicyAllows(policy, plan, context = {}) {
  const blockers = [];
  const p = policy || createFlashPolicy();
  if (p.killSwitch) blockers.push('KILL_SWITCH_ENGAGED');
  const chainId = Number(context.chainId || plan?.market?.chainId || 0);
  if (chainId && !p.chainAllowlist.includes(chainId)) blockers.push('CHAIN_NOT_ALLOWED');
  if (Number.isFinite(p.maxLoanUsd) && Number(plan?.economics?.loanUsd) > p.maxLoanUsd) blockers.push('LOAN_CAP_EXCEEDED');
  if (Number.isFinite(p.maxGasUsd) && Number(plan?.economics?.gasUsd) > p.maxGasUsd) blockers.push('GAS_CAP_EXCEEDED');
  const hops = Number(plan?.route?.hopCount || (plan?.route?.hops && plan.route.hops.length) || 0);
  if (hops > p.maxHops) blockers.push('TOO_MANY_HOPS');
  if (Number(plan?.economics?.netProfitBps) < p.minNetProfitBps) blockers.push('MIN_NET_PROFIT_BPS');
  if (Number(plan?.economics?.netProfitUsd) <= 0) blockers.push('NET_PROFIT_NOT_POSITIVE');
  const attempts = Number(context.attemptsToday || 0);
  if (attempts >= p.dailyMaxAttempts) blockers.push('DAILY_ATTEMPT_CAP');
  if (context.simulationOk !== true) blockers.push('SIMULATION_REQUIRED');
  if (context.mevPosture && context.mevPosture !== 'private-relay') blockers.push('MEV_POSTURE_REFUSED');
  return { allowed: blockers.length === 0, blockers };
}

/* ── Opportunity scanner (indicative, TTL-bounded) ─────────────────────────── */

function validSnapshot(s) {
  return s
    && typeof s.venueId === 'string' && s.venueId.length <= 48
    && /^\d+$/.test(String(s.reserveA)) && /^\d+$/.test(String(s.reserveB))
    && BigInt(s.reserveA) > 0n && BigInt(s.reserveB) > 0n
    && Number.isInteger(s.feeBps) && s.feeBps >= 0 && s.feeBps < 1000
    && Number.isFinite(s.observedAtMs);
}

/**
 * Scan all ordered 2-venue cycles for one pair (A→B→A). Snapshots are pool
 * reserves of the same token pair on different venues — e.g. from venue APIs
 * or on-chain reads. Stale snapshots (> MAX_QUOTE_AGE_MS) are skipped with an
 * explicit reason; the scanner never silently uses old data.
 */
export function scanOpportunities({ chainId, asset, snapshots, loanPremiumBps = null, now = Date.now() }) {
  if (!Number.isInteger(chainId)) return { ok: false, code: 'BAD_CHAIN' };
  if (!Array.isArray(snapshots) || snapshots.length < 2) return { ok: false, code: 'NEED_AT_LEAST_TWO_VENUES' };
  if (snapshots.length > 24) return { ok: false, code: 'TOO_MANY_SNAPSHOTS' };
  const good = snapshots.filter(validSnapshot);
  if (good.length !== snapshots.length) {
    return { ok: false, code: 'INVALID_SNAPSHOT', rejected: snapshots.length - good.length };
  }

  const premium = loanPremiumBps == null ? null : Number(loanPremiumBps);
  const opportunities = [];
  const skipped = [];

  for (let i = 0; i < good.length; i += 1) {
    for (let j = 0; j < good.length; j += 1) {
      if (i === j) continue;
      const buy = good[i];
      const sell = good[j];
      const ageBuy = now - buy.observedAtMs;
      const ageSell = now - sell.observedAtMs;
      if (ageBuy > MAX_QUOTE_AGE_MS || ageBuy < -2000) { skipped.push({ pair: [buy.venueId, sell.venueId], reason: 'BUY_QUOTE_STALE', ageMs: ageBuy }); continue; }
      if (ageSell > MAX_QUOTE_AGE_MS || ageSell < -2000) { skipped.push({ pair: [buy.venueId, sell.venueId], reason: 'SELL_QUOTE_STALE', ageMs: ageSell }); continue; }

      const baseLabel = asset || 'base';
      const quoteLabel = asset ? `${asset}-pair` : 'quote';
      const hops = [
        { assetIn: baseLabel, assetOut: quoteLabel, reserveIn: BigInt(buy.reserveA), reserveOut: BigInt(buy.reserveB), feeBps: buy.feeBps },
        { assetIn: quoteLabel, assetOut: baseLabel, reserveIn: BigInt(sell.reserveB), reserveOut: BigInt(sell.reserveA), feeBps: sell.feeBps }
      ];
      const premiumBps = premium == null ? BALANCER_V2_PREMIUM_BPS : premium;
      const amount = optimalFlashLoanAmount(hops, premiumBps);
      const { amountOut } = evaluateHops(hops, amount || 1n);
      const net = amount > 0n ? netProfitAsset(amount, hops, premiumBps) : 0n;
      /* Same-direction spot prices on both venues; the old code compared one
         venue's price against the other venue's INVERSE price and reported a
         200 % "spread" on a 1 % gap. */
      const spotBuy = Number(buy.reserveB) / Number(buy.reserveA);
      const spotSell = Number(sell.reserveB) / Number(sell.reserveA);
      const spreadBps = Math.abs((spotSell - spotBuy) / ((spotBuy + spotSell) / 2) * 10000);
      opportunities.push({
        id: `cycle:${buy.venueId}->${sell.venueId}`,
        kind: 'two-pool-cycle',
        asset: asset || null,
        chainId,
        buyVenue: buy.venueId,
        sellVenue: sell.venueId,
        spreadBps: Number(spreadBps.toFixed(2)),
        optimalLoanAsset: amount.toString(),
        expectedOutAsset: (amount > 0n ? amountOut : 0n).toString(),
        grossProfitAsset: (amount > 0n ? netProfitAsset(amount, hops, premiumBps) + (BigInt(amount) * BigInt(premiumBps)) / BPS_DENOMINATOR : 0n).toString(),
        netProfitBeforeCostsAsset: net.toString(),
        loanPremiumBps,
        quoteAgeMs: Math.max(ageBuy, ageSell),
        hops: hops.map((h) => ({ assetIn: h.assetIn, assetOut: h.assetOut, reserveIn: h.reserveIn.toString(), reserveOut: h.reserveOut.toString(), feeBps: h.feeBps })),
        profitable: net > 0n,
        indicative: true
      });
    }
  }

  opportunities.sort((a, b) => BigInt(b.netProfitBeforeCostsAsset) > BigInt(a.netProfitBeforeCostsAsset) ? 1 : BigInt(b.netProfitBeforeCostsAsset) < BigInt(a.netProfitBeforeCostsAsset) ? -1 : 0);
  return {
    ok: true,
    chainId,
    asset: asset || null,
    scannedAtMs: now,
    quoteMaxAgeMs: MAX_QUOTE_AGE_MS,
    venuesScanned: good.length,
    cyclesEvaluated: opportunities.length,
    opportunities,
    skipped,
    disclaimer: 'Reserve snapshots are indicative. Every plan requires a fresh simulation and wallet signature before anything is sent.'
  };
}

/* ── Provider selection ─────────────────────────────────────────────────────── */

/**
 * Pick the flash provider for a chain + asset count. Multi-asset loans go to
 * Balancer; single-asset loans go to the cheapest verified premium (usually
 * Balancer's 0 bps — Aave's deeper single-asset liquidity can matter at size,
 * so operators can force a provider with `prefer`). Fail-closed on unverified
 * addresses.
 */
export function selectFlashProvider({ chainId, assetCount = 1, prefer = null }) {
  const usable = [];
  for (const provider of Object.values(FLASH_PROVIDER_REGISTRY)) {
    const entry = provider.chains[Number(chainId)];
    if (!entry) continue;
    if (!entry.verified) continue;
    usable.push(provider);
  }
  if (prefer && FLASH_PROVIDER_REGISTRY[prefer]) {
    const preferred = FLASH_PROVIDER_REGISTRY[prefer];
    const entry = preferred.chains[Number(chainId)];
    if (entry && entry.verified) return { ok: true, provider: preferred, reason: 'OPERATOR_PREFERENCE' };
    return {
      ok: false,
      code: 'PROVIDER_ADDRESS_UNVERIFIED',
      detail: `${preferred.id} has no verified contract address on ${chainName(chainId)}; refusing to fail open.`
    };
  }
  if (usable.length === 0) {
    return {
      ok: false,
      code: 'PROVIDER_ADDRESS_UNVERIFIED',
      detail: `No flash provider with a verified contract address on ${chainName(chainId)}. Configure one before planning execution.`
    };
  }
  if (Number(assetCount) > 1) {
    const balancer = usable.find((p) => p.id === 'balancer-v2');
    if (!balancer) return { ok: false, code: 'MULTI_ASSET_NEEDS_BALANCER', detail: 'Multi-asset flash loans require the Balancer Vault on this chain.' };
    return { ok: true, provider: balancer, reason: 'MULTI_ASSET' };
  }
  const sorted = usable.slice().sort((a, b) => a.premiumBps - b.premiumBps);
  const cheapest = sorted[0];
  return {
    ok: true,
    provider: cheapest,
    reason: sorted.length > 1 ? `LOWEST_PREMIUM (${cheapest.premiumBps} bps vs alternatives)` : 'ONLY_VERIFIED_PROVIDER'
  };
}

/* ── Cost model ─────────────────────────────────────────────────────────────── */

/**
 * USD cost/profit breakdown for a candidate route. All inputs are numbers
 * except asset amounts, which stay strings (base units) to avoid float loss.
 */
export function computeEconomics({ loanAmount, hops, loanPremiumBps, assetPriceUsd, assetDecimals, gasUnits, gasPriceGwei, nativePriceUsd, platformFeeBps, mevBufferBps }) {
  const price = Number(assetPriceUsd);
  const decimals = Math.round(Number(assetDecimals));
  if (!(price > 0) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return { ok: false, code: 'BAD_ASSET_PRICE_OR_DECIMALS' };
  }
  const gas = Number(gasUnits);
  const gwei = Number(gasPriceGwei);
  const nativeUsd = Number(nativePriceUsd);
  if (!(gas > 0) || !(gwei > 0) || !(nativeUsd > 0)) return { ok: false, code: 'BAD_GAS_INPUTS' };

  const loan = BigInt(loanAmount);
  if (loan <= 0n) return { ok: false, code: 'BAD_LOAN_AMOUNT' };
  const { amountOut } = evaluateHops(hops, loan);
  const repay = (loan * (BPS_DENOMINATOR + BigInt(loanPremiumBps))) / BPS_DENOMINATOR;
  const grossAsset = amountOut - repay;
  if (grossAsset < 0n) return { ok: false, code: 'ROUTE_NOT_PROFITABLE_BEFORE_COSTS', grossAsset: grossAsset.toString() };

  const unit = 10n ** BigInt(decimals);
  const loanUsd = Number(loan * 1000000n / unit) / 1000000 * price;
  const grossUsd = Number(grossAsset * 1000000n / unit) / 1000000 * price;

  const gasUsd = (gas * gwei * 1e-9) * nativeUsd;
  const platformFeeUsd = grossUsd * (Number(platformFeeBps) / 10000);
  const mevBufferUsd = grossUsd * (Number(mevBufferBps) / 10000);
  const netProfitUsd = grossUsd - gasUsd - platformFeeUsd - mevBufferUsd;
  const netProfitBps = loanUsd > 0 ? (netProfitUsd / loanUsd) * 10000 : 0;

  return {
    ok: true,
    loanAmount: loan.toString(),
    expectedOutAsset: amountOut.toString(),
    repayAsset: repay.toString(),
    grossProfitAsset: grossAsset.toString(),
    loanUsd,
    grossProfitUsd: grossUsd,
    gasUsd,
    platformFeeUsd,
    platformFeeBps: Number(platformFeeBps),
    mevBufferUsd,
    mevBufferBps: Number(mevBufferBps),
    netProfitUsd,
    netProfitBps,
    profitable: netProfitUsd > 0
  };
}

/* ── The 9-step planner ─────────────────────────────────────────────────────── */

const PIPELINE_STEPS = [
  'collect-prices',
  'find-arbitrage',
  'optimal-size',
  'gas-estimate',
  'flash-fee',
  'slippage',
  'simulation',
  'send-gate',
  'abort-or-emit'
];

/**
 * The full pipeline. Inputs:
 *   intent   — from parseFlashIntent (or an equivalent structured object)
 *   market   — { chainId, asset, assetDecimals, assetPriceUsd, snapshots[] }
 *   config   — { gasUnits, gasPriceGwei, nativePriceUsd, platformFeeBps,
 *                mevBufferBps, slippageBps, deadlineSeconds, providerId,
 *                routerAddress?, routerAudited?, simulation? }
 *   policy   — from createFlashPolicy
 *   context  — { now, attemptsToday }
 *
 * Output decision values:
 *   'EXECUTE_READY' — economically valid and gate-clean; STILL requires a
 *                     fresh simulation pass plus wallet signature.
 *   'NO_TRADE'      — not profitable enough; the honest outcome is to send
 *                     nothing (step 9 of the spec).
 *   'BLOCKED'       — a safety gate refused (stale quotes, unverified
 *                     provider, MEV posture, policy cap…).
 */
export function planFlashArbitrage({ intent, market, config = {}, policy = null, context = {} }) {
  const now = Number(context.now || Date.now());
  const pol = policy || createFlashPolicy();
  const steps = [];
  const record = (id, ok, detail, extra = {}) => steps.push({ id, ok, detail, ...extra });

  /* 1 — collect prices */
  const snapshots = Array.isArray(market?.snapshots) ? market.snapshots : [];
  record('collect-prices', snapshots.length >= 2, `${snapshots.length} venue snapshot(s) for ${market?.asset || 'asset'} on ${chainName(Number(market?.chainId))}`);

  /* 2 — find arbitrage */
  if (steps[0].ok) {
    const scan = scanOpportunities({
      chainId: Number(market.chainId),
      asset: market.asset,
      snapshots,
      loanPremiumBps: config.loanPremiumBps ?? null,
      now
    });
    if (!scan.ok) {
      record('find-arbitrage', false, `scan failed: ${scan.code}`);
      return { ok: false, decision: 'BLOCKED', code: scan.code, steps, version: FLASH_LIQUIDITY_VERSION };
    }
    market = { ...market, _scan: scan };
    const best = scan.opportunities[0];
    record('find-arbitrage', Boolean(best), best
      ? `best cycle ${best.id}: spread ${best.spreadBps} bps, net-before-costs ${best.netProfitBeforeCostsAsset} base units`
      : 'no 2-venue cycle found');
  }

  const scan = market?._scan;
  const best = scan?.opportunities?.[0];
  if (!best || !best.profitable) {
    record('abort-or-emit', true, 'NO_TRADE — nothing sent, no gas spent');
    return {
      ok: true,
      decision: 'NO_TRADE',
      reasons: ['NO_PROFITABLE_CYCLE'],
      steps,
      version: FLASH_LIQUIDITY_VERSION
    };
  }

  /* 3 — optimal flash-loan size */
  const chainCheck = validateHopChain(best.hops, best.hops[0]?.assetIn);
  if (!chainCheck.ok) {
    record('optimal-size', false, `route rejected: ${chainCheck.code} ${chainCheck.detail || ''}`.trim());
    return { ok: false, decision: 'BLOCKED', code: chainCheck.code, steps, version: FLASH_LIQUIDITY_VERSION };
  }
  const loanAmount = BigInt(best.optimalLoanAsset);
  record('optimal-size', loanAmount > 0n, `optimal loan ${loanAmount.toString()} base units (${best.buyVenue} → ${best.sellVenue})`);

  /* provider */
  const selection = selectFlashProvider({
    chainId: Number(market.chainId),
    assetCount: 1,
    prefer: config.providerId || null
  });
  if (!selection.ok) {
    record('flash-fee', false, selection.detail);
    return { ok: false, decision: 'BLOCKED', code: selection.code, detail: selection.detail, steps, version: FLASH_LIQUIDITY_VERSION };
  }
  const provider = selection.provider;
  const providerEntry = provider.chains[Number(market.chainId)];
  const sourceAddress = providerEntry.pool || providerEntry.vault;

  /* Operator-attested source override (fork/rehearsal or a newly deployed
     provider the operator has verified from official docs). It replaces the
     address the caller will actually target and is HONESTLY labeled as
     attested, not registry-verified. */
  const override = config.flashSourceOverride;
  const overrideValid = override
    && /^0x[a-fA-F0-9]{40}$/.test(String(override.address || ''))
    && typeof override.attestedBy === 'string' && override.attestedBy.length > 0;

  /* 4 — gas estimate */
  const gasUnits = Number(config.gasUnits) > 0 ? Number(config.gasUnits) : DEFAULT_GAS_UNITS;
  const gasPriceGwei = Number(config.gasPriceGwei);
  const nativePriceUsd = Number(config.nativePriceUsd);
  const gasInputsOk = gasPriceGwei > 0 && nativePriceUsd > 0;
  record('gas-estimate', gasInputsOk, gasInputsOk
    ? `${gasUnits} units @ ${gasPriceGwei} gwei, native @ $${nativePriceUsd}`
    : 'missing gasPriceGwei / nativePriceUsd');

  /* 5 — flash fee */
  const premiumBps = provider.premiumBps;
  record('flash-fee', true, `${provider.label} premium ${premiumBps} bps (${provider.premiumSource})`);

  /* 6 — slippage + deadline */
  const slippageBps = Math.max(1, Math.min(1000, Math.round(Number(config.slippageBps) || DEFAULT_SLIPPAGE_BPS)));
  const deadlineSeconds = Math.max(10, Math.min(600, Math.round(Number(config.deadlineSeconds) || DEFAULT_DEADLINE_SECONDS)));
  const perHopMinOut = best.hops.map((hop, index) => {
    const expected = evaluateHops(best.hops.slice(0, index + 1), loanAmount).hops[index] || 0n;
    return ((expected * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR).toString();
  });
  record('slippage', true, `minOut per hop with ${slippageBps} bps buffer; deadline ${deadlineSeconds}s`, { perHopMinOut, deadlineSeconds });

  /* economics */
  const economics = computeEconomics({
    loanAmount: loanAmount.toString(),
    hops: best.hops.map((h) => ({ reserveIn: BigInt(h.reserveIn), reserveOut: BigInt(h.reserveOut), feeBps: h.feeBps })),
    loanPremiumBps: premiumBps,
    assetPriceUsd: market.assetPriceUsd,
    assetDecimals: market.assetDecimals,
    gasUnits,
    gasPriceGwei,
    nativePriceUsd,
    platformFeeBps: config.platformFeeBps == null ? DEFAULT_PLATFORM_FEE_BPS : config.platformFeeBps,
    mevBufferBps: config.mevBufferBps == null ? DEFAULT_MEV_BUFFER_BPS : config.mevBufferBps
  });
  if (!economics.ok) {
    record('abort-or-emit', true, `NO_TRADE — ${economics.code}`);
    return { ok: true, decision: 'NO_TRADE', reasons: [economics.code], steps, economics, version: FLASH_LIQUIDITY_VERSION };
  }

  /* policy verdict */
  const intentMinBps = Number(intent?.minNetProfitBps ?? DEFAULT_MIN_NET_PROFIT_BPS);
  const requiredBps = Math.max(pol.minNetProfitBps, intentMinBps);
  const verdict = flashPolicyAllows(pol, { economics, route: { hopCount: best.hops.length }, market }, {
    chainId: Number(market.chainId),
    attemptsToday: context.attemptsToday || 0,
    simulationOk: false, // simulation is checked separately below; the gate is advisory here
    mevPosture: 'private-relay'
  });
  const profitGateOk = economics.netProfitUsd > 0 && economics.netProfitBps >= requiredBps;
  const policyBlockers = verdict.blockers.filter((b) => !['SIMULATION_REQUIRED', 'MEV_POSTURE_REFUSED'].includes(b));

  /* 7 — simulation gate (mandatory before signature) */
  const simulationProvided = config.simulation && config.simulation.ok === true && config.simulation.blockNumber > 0;
  record('simulation', simulationProvided, simulationProvided
    ? `on-chain simulation passed at block ${config.simulation.blockNumber}`
    : 'required: eth_call / bundle simulation must pass before any signature is requested');

  /* 8 — send gate */
  const routerConfigured = typeof config.routerAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(config.routerAddress);
  const routerAudited = config.routerAudited === true;
  const sendReady = profitGateOk && policyBlockers.length === 0 && simulationProvided && routerConfigured && routerAudited && (context.attemptsToday || 0) < pol.dailyMaxAttempts;
  const sendReasons = [];
  if (!profitGateOk) sendReasons.push(economics.netProfitUsd <= 0 ? 'NET_PROFIT_NOT_POSITIVE' : 'MIN_NET_PROFIT_BPS');
  sendReasons.push(...policyBlockers);
  if (!simulationProvided) sendReasons.push('SIMULATION_PENDING');
  if (!routerConfigured) sendReasons.push('ROUTER_CONTRACT_NOT_CONFIGURED');
  if (!routerAudited) sendReasons.push('ROUTER_CONTRACT_NOT_AUDITED');
  record('send-gate', sendReady, sendReady
    ? 'all gates green — plan is wallet-ready (signature still required)'
    : `holding: ${sendReasons.join(', ')}`);

  /* 9 — abort or emit preparation */
  const decision = sendReady ? 'EXECUTE_READY' : (economics.netProfitUsd <= 0 || economics.netProfitBps < requiredBps ? 'NO_TRADE' : 'GATED');
  record('abort-or-emit', true, decision === 'NO_TRADE'
    ? 'NO_TRADE — nothing sent, no gas spent'
    : `${decision} — atomic preparation emitted for wallet confirmation`);

  return {
    ok: true,
    decision,
    reasons: decision === 'EXECUTE_READY' ? [] : sendReasons,
    steps,
    pipeline: PIPELINE_STEPS,
    intent: {
      kind: intent?.kind || 'flash-arbitrage',
      initialCapital: 0,
      minNetProfitBps: intentMinBps,
      atomic: true,
      settlement: 'same-transaction'
    },
    provider: {
      id: provider.id,
      label: provider.label,
      entryFunction: provider.entryFunction,
      callback: provider.callback,
      sourceAddress: overrideValid ? override.address : sourceAddress,
      sourceVerified: providerEntry.verified,
      sourceAttestedBy: overrideValid ? override.attestedBy : undefined,
      premiumBps
    },
    market: {
      chainId: Number(market.chainId),
      chain: chainName(Number(market.chainId)),
      asset: market.asset || null,
      assetPriceUsd: Number(market.assetPriceUsd),
      route: `${best.buyVenue} → ${best.sellVenue}`,
      spreadBps: best.spreadBps
    },
    route: {
      hopCount: best.hops.length,
      hops: best.hops.map((h, i) => ({ ...h, minOut: perHopMinOut[i] })),
      slippageBps,
      deadlineSeconds,
      revertPolicy: 'abort-all'
    },
    economics,
    mev: {
      posture: 'private-relay',
      publicMempoolRefused: true,
      reason: 'arbitrage is sandwich-vulnerable; submission goes through a private relay / bundle'
    },
    safety: {
      ...FLASH_LIQUIDITY_LIMITS,
      router: {
        configured: routerConfigured,
        audited: routerAudited,
        address: routerConfigured ? config.routerAddress : null
      },
      executionContractRequired: true
    },
    version: FLASH_LIQUIDITY_VERSION
  };
}

/* ── Receipt (content-addressed execution evidence seed) ───────────────────── */

/** Deterministic 64-bit FNV-1a fingerprint over a canonical JSON encoding —
 *  a tamper-evidence seed, not a cryptographic attestation. The enforceable
 *  proof path remains the Proof-of-Execution protocol
 *  (docs/PROOF-OF-EXECUTION.md). */
export function receiptFingerprint(obj) {
  const canonical = canonicalJson(obj);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = (hash * prime) & 0xFFFFFFFFFFFFFFFFn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Key-sorted JSON so fingerprints are stable across engines. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Post-execution receipt. `outcome` is produced after the wallet transaction
 * is mined: 'profit-realized' | 'reverted-no-profit' | 'reverted-too-slow' |
 * 'not-sent'. The receipt never contains keys, calldata, or raw signatures.
 */
export function buildFlashReceipt({ plan, outcome, txHash = null, netProfitUsd = null, now = Date.now() }) {
  const allowedOutcomes = ['profit-realized', 'reverted-no-profit', 'reverted-too-slow', 'not-sent'];
  if (!allowedOutcomes.includes(outcome)) return { ok: false, code: 'BAD_OUTCOME' };
  const body = {
    version: FLASH_LIQUIDITY_VERSION,
    createdAtMs: now,
    outcome,
    txHash,
    netProfitUsd,
    decision: plan?.decision || null,
    provider: plan?.provider?.id || null,
    chainId: plan?.market?.chainId || null,
    loanUsd: plan?.economics?.loanUsd ?? null,
    estimatedNetProfitUsd: plan?.economics?.netProfitUsd ?? null,
    route: plan?.market?.route || null,
    notFreeMoney: true
  };
  return { ok: true, receipt: { ...body, fingerprint: receiptFingerprint(body) } };
}

/* ── Capability report (what this deployment may honestly claim) ───────────── */

export function flashLiquidityCapabilityReport({ routerConfigured = false, routerAudited = false, simulationAvailable = false } = {}) {
  let status = 'planning-only';
  const missing = [];
  if (!routerConfigured) missing.push('ROUTER_CONTRACT_NOT_CONFIGURED');
  if (!routerAudited) missing.push('ROUTER_CONTRACT_NOT_AUDITED');
  if (!simulationAvailable) missing.push('SIMULATION_UNAVAILABLE');
  if (missing.length === 0) status = 'execution-gated-by-wallet';
  return {
    status,
    missing,
    executionEnabled: missing.length === 0,
    ...FLASH_LIQUIDITY_LIMITS,
    providers: Object.values(FLASH_PROVIDER_REGISTRY).map((p) => ({
      id: p.id,
      label: p.label,
      entryFunction: p.entryFunction,
      premiumBps: p.premiumBps,
      chains: Object.entries(p.chains).map(([chainId, entry]) => ({
        chainId: Number(chainId),
        chain: chainName(Number(chainId)),
        verified: entry.verified,
        address: entry.pool || entry.vault || null
      }))
    }))
  };
}

/* ── Demo snapshots (clearly labeled educational data, never live) ─────────── */

export const DEMO_SNAPSHOTS = Object.freeze({
  label: 'demo-educational',
  live: false,
  sets: Object.freeze({
    /* Spreads must beat 2×30 bps swap fees + the 0.70 % platform fee on gross
       + MEV buffer before the pipeline's own 0.50 % min-profit gate lets a
       plan through — a "profitable" demo that nets less than the gate teaches
       the wrong lesson (nothing ever EXECUTE_READY/GATED). ~1.3 % / ~1.2 %
       gaps net ≈ 95 bps after every cost line. */
    profitable: Object.freeze([
      Object.freeze({ venueId: 'demo-dex-alpha', reserveA: '2500000000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 }),
      Object.freeze({ venueId: 'demo-dex-beta', reserveA: '2532500000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 }),
      Object.freeze({ venueId: 'demo-dex-gamma', reserveA: '2470000000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 })
    ]),
    flat: Object.freeze([
      Object.freeze({ venueId: 'demo-dex-alpha', reserveA: '2500000000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 }),
      Object.freeze({ venueId: 'demo-dex-beta', reserveA: '2500005000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 })
    ]),
    inverted: Object.freeze([
      Object.freeze({ venueId: 'demo-dex-alpha', reserveA: '2500000000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 }),
      Object.freeze({ venueId: 'demo-dex-beta', reserveA: '2495000000000', reserveB: '2500000000', feeBps: 30, observedAtMs: 0 })
    ])
  }),
  marketDefaults: Object.freeze({
    asset: 'USDC',
    assetDecimals: 6,
    assetPriceUsd: 1.0,
    chainId: 42161
  })
});
