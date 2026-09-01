/**
 * FBT INTENT OS — Context Resolver (wallet · asset · amount · chain).
 * ---------------------------------------------------------------------------
 * THE bug this module closes: the assistant used to print
 *
 *   «جزئیات را آماده کردم. اگر موافق باشید اجرا را با امضای کیف پول شروع می‌کنم.»
 *
 * for an intent whose asset/amount/chain were still null, and then — on OK —
 * answer «جزئیات این درخواست برای اجرا کامل نیست».
 *
 * The rule (spec §24):
 *
 *   Known                 → use it
 *   Inferable             → infer it
 *   Single valid option   → select automatically
 *   Multiple real options → ask ONE short question
 *   Truly missing         → ask ONE short question
 *
 * Everything here is pure: wallets, balances and portfolio come in as the
 * already-read UserExecutionContext. No network, no keys, no signing.
 */

export const ACTION_PLAN_SCHEMA = 'fbt.ai-action-plan.v1';

export const RESOLUTION_STATUS = Object.freeze([
  'READY',
  'NEEDS_WALLET',
  'NEEDS_WALLET_SELECTION',
  'NEEDS_ASSET_SELECTION',
  'NEEDS_AMOUNT',
  'NEEDS_TARGET_ASSET',
  'NO_BALANCE'
]);

export const SOLANA_CHAIN_ID = 501;

const STABLES = Object.freeze(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDBC']);
const SOLANA_NATIVE = Object.freeze(['SOL', 'JUP', 'BONK', 'JITOSOL', 'MSOL', 'WIF', 'PYTH', 'RAY', 'ORCA']);

const CHAIN_NAMES = Object.freeze({
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  146: 'Sonic',
  [SOLANA_CHAIN_ID]: 'Solana'
});

/** A balance is only "meaningful" above dust; below it the row is noise. */
const DUST_USD = 1;
const DUST_UNITS = 1e-9;

const upper = (v) => String(v ?? '').trim().toUpperCase();
const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function chainName(chainId) {
  const id = numOrNull(chainId);
  if (id == null) return null;
  return CHAIN_NAMES[id] || `Chain ${id}`;
}

export function isSolanaChain(chainId) {
  const id = numOrNull(chainId);
  return id === SOLANA_CHAIN_ID;
}

export function isStable(symbol) {
  return STABLES.includes(upper(symbol));
}

function chainKindFor(chainId, symbol) {
  if (isSolanaChain(chainId)) return 'solana';
  if (chainId == null && SOLANA_NATIVE.includes(upper(symbol))) return 'solana';
  return 'evm';
}

/* ------------------------------ 1. balances ------------------------------- */

/**
 * Unify EVM + Solana balances into one comparable list.
 * Rows without a symbol or a positive amount are dropped — an empty row can
 * never justify an execution plan.
 */
export function unifyBalances(context = {}) {
  const raw = Array.isArray(context.balances) ? context.balances : [];
  const holdings = Array.isArray(context?.portfolio?.holdings) ? context.portfolio.holdings : [];
  const merged = raw.length ? raw : holdings;
  const rows = [];
  for (const b of merged) {
    const symbol = upper(b?.symbol);
    if (!symbol) continue;
    const amount = numOrNull(b?.amount);
    const valueUsd = numOrNull(b?.valueUsd ?? b?.value);
    if ((amount == null || amount <= DUST_UNITS) && (valueUsd == null || valueUsd <= 0)) continue;
    const chainId = numOrNull(b?.chainId ?? (String(b?.chain).toLowerCase() === 'solana' ? SOLANA_CHAIN_ID : b?.chain));
    rows.push({
      symbol,
      chainId,
      chain: chainName(chainId),
      kind: chainKindFor(chainId, symbol),
      amount,
      valueUsd,
      dataStatus: b?.dataStatus || 'client'
    });
  }
  /* Richest first: when a single option must be auto-selected it is the one
     that can actually fund the trade. */
  rows.sort((a, b) => (b.valueUsd ?? b.amount ?? 0) - (a.valueUsd ?? a.amount ?? 0));
  return rows;
}

function usable(row) {
  if (!row) return false;
  if (row.valueUsd != null) return row.valueUsd >= DUST_USD;
  return (row.amount ?? 0) > DUST_UNITS;
}

/* ------------------------------- 2. wallets ------------------------------- */

/**
 * Every connected wallet, normalised. EVM and Solana are separate wallets even
 * when the same user owns both (spec §3 / §4).
 */
export function listWallets(context = {}) {
  const w = context?.wallet || {};
  const out = [];
  for (const address of (Array.isArray(w.evmAddresses) ? w.evmAddresses : [])) {
    if (!address) continue;
    out.push({ id: `evm:${address}`, kind: 'evm', address: String(address), canSign: w.canSign !== false });
  }
  for (const address of (Array.isArray(w.solanaAddresses) ? w.solanaAddresses : [])) {
    if (!address) continue;
    out.push({ id: `sol:${address}`, kind: 'solana', address: String(address), canSign: w.canSign !== false });
  }
  return out;
}

export function shortAddress(address) {
  const a = String(address || '');
  if (a.length <= 12) return a;
  return `${a.slice(0, 5)}…${a.slice(-3)}`;
}

/**
 * Pick the wallet that can actually carry this intent.
 *   1 compatible wallet  → RESOLVED (never ask)
 *   n compatible wallets → NEEDS_SELECTION (asking changes the outcome)
 *   0                    → NO_WALLET
 */
export function resolveWallet(intent = {}, wallets = []) {
  const need = intent?.chainKind
    || (isSolanaChain(intent?.chainId) ? 'solana' : (intent?.chainId != null ? 'evm' : null));
  const compatible = wallets.filter((w) => (need ? w.kind === need : true));
  if (compatible.length === 1) return { status: 'RESOLVED', wallet: compatible[0], wallets: compatible };
  if (compatible.length > 1) return { status: 'NEEDS_SELECTION', wallet: null, wallets: compatible };
  return { status: 'NO_WALLET', wallet: null, wallets: [] };
}

/* ------------------------------- 3. assets -------------------------------- */

/**
 * Which balance funds this trade?
 *
 * "100 USDC → ETH"  → the user named it, use it.
 * "ETH بخر"          → the stablecoins in the wallet are the only sane source.
 *                      One usable stable → auto-select. Two → ask once.
 */
export function resolveSourceAsset({ requested = null, target = null, balances = [] } = {}) {
  const want = upper(requested);
  if (want) {
    const rows = balances.filter((b) => b.symbol === want);
    if (!rows.length) return { status: 'NO_BALANCE', asset: want, options: [] };
    if (rows.length === 1) return { status: 'RESOLVED', row: rows[0], options: rows };
    return { status: 'NEEDS_SELECTION', row: null, options: rows };
  }
  const tgt = upper(target);
  const candidates = balances.filter((b) => usable(b) && b.symbol !== tgt);
  const stables = candidates.filter((b) => isStable(b.symbol));
  const pool = stables.length ? stables : candidates;
  if (!pool.length) return { status: 'NO_BALANCE', row: null, options: [] };
  if (pool.length === 1) return { status: 'RESOLVED', row: pool[0], options: pool };
  /* One option is only "meaningful" if it can plausibly fund the trade. When a
     single row dwarfs the rest (>=90% of the usable value) asking is noise. */
  const total = pool.reduce((s, r) => s + (r.valueUsd ?? 0), 0);
  const top = pool[0];
  if (total > 0 && (top.valueUsd ?? 0) / total >= 0.9) {
    return { status: 'RESOLVED', row: top, options: pool };
  }
  return { status: 'NEEDS_SELECTION', row: null, options: pool.slice(0, 4) };
}

/* ------------------------------- 4. amount -------------------------------- */

const HALF = /(\bhalf\b|\bhalf of\b|نصف|نیمی از|نصفی)/i;
const ALL = /(\ball of\b|\ball my\b|\beverything\b|\bmax\b|همه|تمام|کل\s)/i;
const PERCENT = /(\d{1,3})\s*(?:%|درصد|percent)/i;
/* "100 USDC" · "$100" · "۱۰۰ دلار" */
const AMOUNT_WITH_SYMBOL = /(\d[\d,]*\.?\d*)\s*(?:\$|dollars?|دلار)?\s*([A-Za-z]{2,8})?/;
const DOLLARS = /(?:\$\s*(\d[\d,]*\.?\d*))|(?:(\d[\d,]*\.?\d*)\s*(?:dollars?|دلار|usd))/i;

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function latinDigits(text) {
  return String(text || '').replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

/**
 * Resolve how much to move, in the SOURCE asset's own units plus a USD view.
 *
 * Fractions ("نصف", "همه", "۳۰٪") are computed from the real balance — the
 * user is never asked to restate a number the wallet already knows (§7).
 */
export function resolveAmount({ message = '', sourceRow = null, explicitAmount = null } = {}) {
  const text = latinDigits(message);
  const haveUnits = sourceRow?.amount ?? null;
  const haveUsd = sourceRow?.valueUsd ?? null;
  const unitPrice = haveUnits && haveUsd ? haveUsd / haveUnits : null;

  const fromFraction = (fraction) => {
    if (haveUnits == null && haveUsd == null) return { status: 'NEEDS_AMOUNT', reason: 'NO_BALANCE_READ' };
    return {
      status: 'RESOLVED',
      source: 'fraction',
      fraction,
      amount: haveUnits != null ? haveUnits * fraction : null,
      amountUsd: haveUsd != null ? haveUsd * fraction : null
    };
  };

  const explicit = numOrNull(explicitAmount);
  if (explicit != null && explicit > 0) {
    return {
      status: 'RESOLVED',
      source: 'explicit',
      amount: explicit,
      amountUsd: unitPrice != null ? explicit * unitPrice : explicit
    };
  }

  const pctMatch = PERCENT.exec(text);
  if (pctMatch) {
    const p = Number(pctMatch[1]);
    if (p > 0 && p <= 100) return fromFraction(p / 100);
  }
  if (ALL.test(text)) return fromFraction(1);
  if (HALF.test(text)) return fromFraction(0.5);

  const dollars = DOLLARS.exec(text);
  if (dollars) {
    const usd = Number(String(dollars[1] || dollars[2]).replace(/,/g, ''));
    if (Number.isFinite(usd) && usd > 0) {
      return {
        status: 'RESOLVED',
        source: 'usd',
        amountUsd: usd,
        amount: unitPrice != null && unitPrice > 0 ? usd / unitPrice : (sourceRow && isStable(sourceRow.symbol) ? usd : null)
      };
    }
  }

  if (sourceRow?.symbol) {
    /* "100 USDC" — the number that sits next to the source symbol. */
    const re = new RegExp(`(\\d[\\d,]*\\.?\\d*)\\s*${sourceRow.symbol}`, 'i');
    const m = re.exec(text);
    if (m) {
      const amount = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(amount) && amount > 0) {
        return {
          status: 'RESOLVED',
          source: 'explicit',
          amount,
          amountUsd: unitPrice != null ? amount * unitPrice : (isStable(sourceRow.symbol) ? amount : null)
        };
      }
    }
  }

  /* A bare number with no symbol at all: "100 دارم، ETH می‌خواهم" */
  const bare = AMOUNT_WITH_SYMBOL.exec(text);
  if (bare && !bare[2]) {
    const amount = Number(bare[1].replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      return {
        status: 'RESOLVED',
        source: 'bare',
        amount,
        amountUsd: unitPrice != null ? amount * unitPrice : (sourceRow && isStable(sourceRow.symbol) ? amount : null)
      };
    }
  }

  return { status: 'NEEDS_AMOUNT', reason: 'NOT_INFERABLE' };
}

/* ---------------------------- 5. target asset ----------------------------- */

const KNOWN_TARGETS = Object.freeze([
  'ETH', 'BTC', 'WBTC', 'SOL', 'USDC', 'USDT', 'DAI', 'ARB', 'OP', 'MATIC', 'AVAX', 'BNB', 'LINK', 'UNI', 'AAVE', 'JUP', 'BONK'
]);

export function resolveTargetAsset({ message = '', hinted = null, sourceSymbol = null } = {}) {
  /* eslint-disable-next-line no-param-reassign */
  hinted = upper(hinted) === upper(sourceSymbol) ? null : hinted;
  const want = upper(hinted);
  if (want && want !== upper(sourceSymbol)) return { status: 'RESOLVED', symbol: want };
  const text = latinDigits(message).toUpperCase();
  const hits = KNOWN_TARGETS.filter((sym) => {
    if (sym === upper(sourceSymbol)) return false;
    return new RegExp(`(^|[^A-Z])${sym}([^A-Z]|$)`).test(text);
  });
  if (hits.length === 1) return { status: 'RESOLVED', symbol: hits[0] };
  if (hits.length > 1) {
    /* "100 USDC to ETH": the source was already removed above, so the first
       remaining mention in reading order is the destination. */
    const ordered = hits.sort((a, b) => text.indexOf(a) - text.indexOf(b));
    return { status: 'RESOLVED', symbol: ordered[ordered.length - 1] };
  }
  return { status: 'NEEDS_TARGET_ASSET', symbol: null };
}

/* --------------------------- 6. the action plan --------------------------- */

/**
 * Build the ActionPlan of spec §11.
 *
 * `ready === true` ONLY when wallet + source chain/token/amount + destination
 * are all known. Nothing downstream may show a confirmation for a plan that is
 * not ready (§10) — that is exactly the bug being fixed.
 */
export function buildActionPlan({
  intentId = null,
  type = 'SWAP',
  message = '',
  context = {},
  hints = {},
  /* Guesses from the upstream orchestrator. They are a FALLBACK only: the
     command-center planner routinely reports from/to inverted, and letting it
     outrank the user's own sentence turned "100 USDC → ETH" into
     "0.02 ETH → USDC" and then into a bogus insufficient-balance answer.
     Anything the user actually said or tapped wins. */
  weakHints = {},
  now = Date.now()
} = {}) {
  const kind = upper(type) || 'SWAP';
  const balances = unifyBalances(context);
  const wallets = listWallets(context);

  if (!wallets.length) {
    return {
      schema: ACTION_PLAN_SCHEMA,
      intentId,
      type: kind,
      ready: false,
      status: 'NEEDS_WALLET',
      wallet: null,
      source: null,
      destination: null,
      actions: [],
      options: [],
      createdAt: now
    };
  }

  const strongTarget = hints.targetAsset || hints.to || (kind === 'BUY' && hints.asset ? hints.asset : null);
  const strongSource = hints.sourceAsset || hints.from || (kind === 'SELL' && hints.asset ? hints.asset : null);

  /* Destination first: "ETH بخر" names the destination, not the source. */
  let target = resolveTargetAsset({ message, hinted: strongTarget, sourceSymbol: strongSource });
  let source = resolveSourceAsset({ requested: strongSource, target: target.symbol, balances });

  /* Only when the sentence itself leaves a gap do the orchestrator's guesses
     get a vote — they are frequently inverted, so they may never overrule what
     the user actually wrote. */
  if (!target.symbol) {
    const guess = weakHints.targetAsset || weakHints.to || (kind === 'BUY' ? weakHints.asset : null);
    if (guess && upper(guess) !== upper(source.row?.symbol)) {
      target = { status: 'RESOLVED', symbol: upper(guess) };
      source = resolveSourceAsset({ requested: strongSource, target: target.symbol, balances });
    }
  }
  if (!strongSource && source.status === 'NEEDS_SELECTION') {
    const guess = weakHints.sourceAsset || weakHints.from || (kind === 'SELL' ? weakHints.asset : null);
    if (guess && upper(guess) !== upper(target.symbol)) {
      const narrowed = resolveSourceAsset({ requested: upper(guess), target: target.symbol, balances });
      if (narrowed.status === 'RESOLVED') source = narrowed;
    }
  }

  const base = {
    schema: ACTION_PLAN_SCHEMA,
    intentId,
    type: kind,
    ready: false,
    status: 'NEEDS_AMOUNT',
    wallet: null,
    source: null,
    destination: target.symbol ? { chain: null, chainId: null, token: target.symbol } : null,
    quote: null,
    actions: [],
    options: [],
    balancesRead: balances.length,
    createdAt: now
  };

  if (source.status === 'NO_BALANCE') {
    return { ...base, status: 'NO_BALANCE', missing: 'SOURCE_BALANCE', options: balances.slice(0, 4) };
  }
  if (source.status === 'NEEDS_SELECTION') {
    return { ...base, status: 'NEEDS_ASSET_SELECTION', missing: 'SOURCE_ASSET', options: source.options };
  }

  const row = source.row;
  const walletPick = resolveWallet({ chainId: row.chainId, chainKind: row.kind }, wallets);
  if (walletPick.status === 'NO_WALLET') {
    return { ...base, status: 'NEEDS_WALLET', missing: 'WALLET', source: sourceLeg(row, null) };
  }
  if (walletPick.status === 'NEEDS_SELECTION') {
    return {
      ...base,
      status: 'NEEDS_WALLET_SELECTION',
      missing: 'WALLET_SELECTION',
      source: sourceLeg(row, null),
      options: walletPick.wallets
    };
  }

  if (!target.symbol && (kind === 'SWAP' || kind === 'BUY' || kind === 'BRIDGE')) {
    return { ...base, status: 'NEEDS_TARGET_ASSET', missing: 'TARGET_ASSET', wallet: walletPick.wallet, source: sourceLeg(row, null) };
  }

  const amount = resolveAmount({
    message,
    sourceRow: row,
    explicitAmount: hints.amount ?? (hints.amountExpression ? null : null)
  });
  if (amount.status !== 'RESOLVED' || (amount.amount == null && amount.amountUsd == null)) {
    return { ...base, status: 'NEEDS_AMOUNT', missing: 'AMOUNT', wallet: walletPick.wallet, source: sourceLeg(row, null) };
  }

  /* Never plan more than the wallet holds. */
  if (row.amount != null && amount.amount != null && amount.amount > row.amount + 1e-9) {
    return {
      ...base,
      status: 'NO_BALANCE',
      missing: 'INSUFFICIENT_BALANCE',
      wallet: walletPick.wallet,
      source: sourceLeg(row, amount),
      haveUsd: row.valueUsd,
      needUsd: amount.amountUsd
    };
  }

  const leg = sourceLeg(row, amount);
  const action = {
    type: kind === 'BUY' || kind === 'SELL' ? 'SWAP' : kind,
    from: row.symbol,
    to: target.symbol || null,
    asset: target.symbol || row.symbol,
    amount: leg.amount,
    amountUsd: leg.amountUsd,
    chainId: row.chainId,
    walletAddress: walletPick.wallet.address,
    parameters: {}
  };

  return {
    ...base,
    ready: true,
    status: 'READY',
    missing: null,
    wallet: walletPick.wallet,
    source: leg,
    destination: { chain: chainName(row.chainId), chainId: row.chainId, token: target.symbol || null },
    actions: [action]
  };
}

function sourceLeg(row, amount) {
  if (!row) return null;
  return {
    chain: row.chain,
    chainId: row.chainId,
    token: row.symbol,
    amount: amount?.amount != null ? String(round(amount.amount)) : null,
    amountUsd: amount?.amountUsd != null ? round(amount.amountUsd) : null,
    fraction: amount?.fraction ?? null,
    balanceAmount: row.amount,
    balanceUsd: row.valueUsd,
    walletKind: row.kind
  };
}

function round(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) >= 1) return Math.round(v * 1e6) / 1e6;
  return Math.round(v * 1e9) / 1e9;
}

/** Spec §10: a confirmation may only be rendered for a ready plan. */
export function isExecutionReady(plan) {
  return Boolean(
    plan
    && plan.ready === true
    && plan.status === 'READY'
    && plan.wallet?.address
    && plan.source?.token
    && (plan.source.amount != null || plan.source.amountUsd != null)
    && Array.isArray(plan.actions)
    && plan.actions.length > 0
  );
}
