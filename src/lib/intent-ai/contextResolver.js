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
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const CHAIN_ALIASES = Object.freeze({
  ETHEREUM: 1, 'ETHEREUM MAINNET': 1, MAINNET: 1,
  OPTIMISM: 10, OP: 10,
  BSC: 56, BNB: 56, 'BNB CHAIN': 56, 'BNB SMART CHAIN': 56,
  POLYGON: 137, MATIC: 137, POL: 137,
  SONIC: 146,
  BASE: 8453,
  ARBITRUM: 42161, 'ARBITRUM ONE': 42161,
  AVALANCHE: 43114, AVAX: 43114,
  LINEA: 59144,
  SOLANA: SOLANA_CHAIN_ID
});

export function normalizeChainId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = numOrNull(value);
  if (numeric != null) return numeric;
  return CHAIN_ALIASES[upper(value)] ?? null;
}

function liveUnitPrice(row) {
  if (row?.priceProvenance !== 'live') return null;
  const priceUsd = numOrNull(row?.priceUsd);
  if (priceUsd != null && priceUsd > 0) return priceUsd;
  if (row?.balanceFreshness === 'stale') return null;
  const amount = numOrNull(row?.amount);
  const valueUsd = numOrNull(row?.valueUsd);
  return amount != null && amount > 0 && valueUsd != null && valueUsd > 0 ? valueUsd / amount : null;
}

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
    const chainId = normalizeChainId(b?.chainId ?? b?.chain);
    rows.push({
      symbol,
      chainId,
      chain: chainName(chainId),
      kind: chainKindFor(chainId, symbol),
      amount,
      valueUsd,
      priceUsd: numOrNull(b?.priceUsd),
      priceProvenance: String(b?.priceProvenance || b?.priceDataStatus || b?.dataProvenance || 'unavailable').toLowerCase(),
      decimals: b?.decimals != null && Number.isInteger(Number(b.decimals)) && Number(b.decimals) >= 0 ? Number(b.decimals) : null,
      address: b?.address || b?.mint || null,
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
export function resolveSourceAsset({ requested = null, requestedChainId = null, target = null, balances = [] } = {}) {
  const want = upper(requested);
  const chainId = normalizeChainId(requestedChainId);
  if (want) {
    const matchingSymbol = balances.filter((b) => b.symbol === want);
    const rows = chainId == null
      ? matchingSymbol
      : matchingSymbol.filter((b) => Number(b.chainId) === chainId);
    if (!rows.length) {
      return {
        status: 'NO_BALANCE',
        asset: want,
        requestedChainId: chainId,
        /* Keep alternatives as evidence for a precise explanation, never as
           candidates: a user-named network must not silently change. */
        availableOnOtherChains: chainId == null ? [] : matchingSymbol.map((row) => ({
          symbol: row.symbol, chainId: row.chainId, chain: row.chain, amount: row.amount
        })),
        options: []
      };
    }
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
const DOLLARS = /(?:\$\s*(\d[\d,]*\.?\d*))|(?:(\d[\d,]*\.?\d*)\s*(?:dollars?|دلار|usd\b))/i;

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
export function resolveAmount({
  message = '',
  sourceRow = null,
  explicitAmount = null,
  explicitAmountUnit = null
} = {}) {
  const text = latinDigits(message);
  const haveUnits = numOrNull(sourceRow?.amount);
  const haveUsd = numOrNull(sourceRow?.valueUsd);
  const unitPrice = liveUnitPrice(sourceRow);
  const liveBalanceUsd = sourceRow?.priceProvenance === 'live' && sourceRow?.balanceFreshness !== 'stale' ? haveUsd : null;

  const fromFraction = (fraction) => {
    if (haveUnits == null && haveUsd == null) return { status: 'NEEDS_AMOUNT', reason: 'NO_BALANCE_READ' };
    return {
      status: 'RESOLVED',
      source: 'fraction',
      amountUnit: sourceRow?.symbol || null,
      fraction,
      amount: haveUnits != null ? haveUnits * fraction : null,
      amountUsd: liveBalanceUsd != null ? liveBalanceUsd * fraction : null
    };
  };

  const explicit = numOrNull(explicitAmount);
  if (explicit != null && explicit > 0) {
    const unit = upper(explicitAmountUnit);
    if (unit === 'USD') {
      if (!(unitPrice > 0)) return { status: 'NEEDS_AMOUNT', reason: 'USD_CONVERSION_UNAVAILABLE' };
      return { status: 'RESOLVED', source: 'usd', amount: explicit / unitPrice, amountUsd: explicit, amountUnit: 'USD' };
    }
    if (unit && unit === upper(sourceRow?.symbol)) {
      return {
        status: 'RESOLVED',
        source: 'explicit',
        amount: explicit,
        amountUsd: unitPrice != null ? explicit * unitPrice : null,
        amountUnit: unit
      };
    }
    /* A numeric hint without its unit is not enough to choose between USD and
       source-token units. The user-facing parser may still resolve an explicit
       amount from their sentence below. */
    if (unit) return { status: 'NEEDS_AMOUNT', reason: 'AMOUNT_UNIT_MISMATCH' };
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
      if (!(unitPrice > 0)) return { status: 'NEEDS_AMOUNT', reason: 'USD_CONVERSION_UNAVAILABLE' };
      return { status: 'RESOLVED', source: 'usd', amountUsd: usd, amount: usd / unitPrice, amountUnit: 'USD' };
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
          amountUsd: unitPrice != null ? amount * unitPrice : null,
          amountUnit: upper(sourceRow.symbol)
        };
      }
    }
  }

  /* A bare numeral is deliberately ambiguous: it might mean dollars or units.
     Require an explicit currency/token unit rather than silently choosing. */
  const bare = AMOUNT_WITH_SYMBOL.exec(text);
  if (bare && !bare[2]) return { status: 'NEEDS_AMOUNT', reason: 'AMOUNT_UNIT_REQUIRED' };

  return { status: 'NEEDS_AMOUNT', reason: 'NOT_INFERABLE' };
}

/* ---------------------------- 5. target asset ----------------------------- */

const FIAT_UNITS = Object.freeze(['USD', '$', 'DOLLAR', 'DOLLARS', 'TOMAN', 'IRT', 'IRR']);
const mentionedTokens = (message) => {
  const text = latinDigits(message).toUpperCase();
  return KNOWN_TARGETS.filter((sym) => new RegExp(`(^|[^A-Z])${sym}([^A-Z]|$)`).test(text));
};

/**
 * Which asset does the amount's unit name as the one being spent?
 *   swap/convert/bridge  → the unit asset ("swap 100 USDC to ETH" → USDC)
 *   buy                  → only a stablecoin unit beside ANOTHER named asset
 *                          ("buy ETH with 100 USDC" → USDC); "buy 0.5 ETH" is
 *                          written in the target's units and derives nothing
 *   anything else        → nothing (the resolver asks instead of guessing)
 */
export function sourceFromAmountUnit({ kind = 'SWAP', message = '', unit = null } = {}) {
  const symbol = upper(unit);
  if (!symbol || FIAT_UNITS.includes(symbol) || !/^[A-Z0-9]{2,10}$/.test(symbol)) return null;
  const others = mentionedTokens(message).filter((sym) => sym !== symbol);
  if (kind === 'BUY') return isStable(symbol) && others.length ? symbol : null;
  if (['SWAP', 'CONVERT', 'BRIDGE'].includes(kind)) return symbol;
  return null;
}

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
  /* The asset the user wrote their amount in is the asset they are giving up
     ("swap 100 USDC to ETH", "bridge 10 USDC…"; "buy ETH with 100 USDC" when
     the unit is a stablecoin next to another named asset). It is read from the
     amount's own unit, never from a parser's from/to guess. A BUY written in
     the target's units ("buy 0.5 ETH") deliberately derives nothing. */
  const statedSource = hints.sourceAsset || hints.from || (kind === 'SELL' && hints.asset ? hints.asset : null);
  const strongSource = statedSource || sourceFromAmountUnit({ kind, message, unit: hints.amountUnit });
  const hintedChains = Array.isArray(hints.chainIds) ? hints.chainIds : [];
  const strongSourceChainId = normalizeChainId(
    hints.sourceChainId ?? hints.fromChainId ?? hints.fromChain
      ?? (hintedChains.length ? hintedChains[0] : null)
      ?? hints.network ?? hints.chainId
  );

  /* Destination first: "ETH بخر" names the destination, not the source. */
  let target = resolveTargetAsset({ message, hinted: strongTarget, sourceSymbol: strongSource });
  let source = resolveSourceAsset({ requested: strongSource, requestedChainId: strongSourceChainId, target: target.symbol, balances });

  /* Only when the sentence itself leaves a gap do the orchestrator's guesses
     get a vote — they are frequently inverted, so they may never overrule what
     the user actually wrote. */
  if (!target.symbol) {
    const guess = weakHints.targetAsset || weakHints.to || (kind === 'BUY' ? weakHints.asset : null);
    if (guess && upper(guess) !== upper(source.row?.symbol)) {
      target = { status: 'RESOLVED', symbol: upper(guess) };
      source = resolveSourceAsset({ requested: strongSource, requestedChainId: strongSourceChainId, target: target.symbol, balances });
    }
  }
  if (!strongSource && source.status === 'NEEDS_SELECTION') {
    const guess = weakHints.sourceAsset || weakHints.from || (kind === 'SELL' ? weakHints.asset : null);
    if (guess && upper(guess) !== upper(target.symbol)) {
      const narrowed = resolveSourceAsset({ requested: upper(guess), requestedChainId: strongSourceChainId, target: target.symbol, balances });
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
    return {
      ...base,
      status: 'NO_BALANCE',
      missing: source.requestedChainId != null ? 'SOURCE_NETWORK_BALANCE' : 'SOURCE_BALANCE',
      requestedSourceChainId: source.requestedChainId ?? null,
      unavailableOnOtherChains: source.availableOnOtherChains || [],
      options: source.requestedChainId == null ? balances.slice(0, 4) : []
    };
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

  const explicitAmount = hints.amount ?? hints.amountUsd ?? null;
  const explicitAmountUnit = hints.amountUnit
    || (hints.amountUsd != null && hints.amount == null ? 'USD' : null);
  const amount = resolveAmount({
    message,
    sourceRow: row,
    explicitAmount,
    explicitAmountUnit
  });
  if (amount.status !== 'RESOLVED' || amount.amount == null) {
    return {
      ...base,
      status: 'NEEDS_AMOUNT',
      missing: amount.reason === 'USD_CONVERSION_UNAVAILABLE' ? 'AMOUNT_PRICE_UNAVAILABLE' : 'AMOUNT',
      amountReason: amount.reason || null,
      wallet: walletPick.wallet,
      source: sourceLeg(row, null)
    };
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
    amountUnit: row.symbol,
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
    amount: amount?.amount != null ? tokenAmountString(amount.amount, row.decimals) : null,
    amountUnit: row.symbol,
    amountUsd: amount?.amountUsd != null ? round(amount.amountUsd) : null,
    fraction: amount?.fraction ?? null,
    balanceAmount: row.balanceFreshness === 'stale' ? null : row.amount,
    balanceUsd: row.priceProvenance === 'live' && row.balanceFreshness !== 'stale' ? row.valueUsd : null,
    balanceFreshness: row.balanceFreshness || 'unknown',
    priceProvenance: row.priceProvenance,
    decimals: row.decimals,
    address: row.address,
    walletKind: row.kind
  };
}

function tokenAmountString(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const d = Number.isInteger(decimals) && decimals >= 0 ? Math.min(decimals, 18) : (n >= 1 ? 6 : 9);
  const fixed = n.toFixed(Math.min(22, d + 4));
  const match = /^(\d+)(?:\.(\d+))?$/.exec(fixed);
  if (!match) return String(n);
  const whole = match[1];
  const fraction = (match[2] || '').slice(0, d).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
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
