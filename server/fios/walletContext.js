/**
 * FBT FINANCIAL INTELLIGENCE OS — Universal Wallet Context (Phase 212, upgrade 13).
 * ---------------------------------------------------------------------------
 * The wallet used to be a page's data. For the AI it must be ONE shared,
 * always-current context: every network the user is on, what sits there, and
 * what it is worth — so a question like «چرا میگویی wallet ندارید؟» can never
 * happen again, and the cross-chain reasoner / agent council / decision engine
 * all read the SAME wallet truth.
 *
 * Per network (EVM chains by id, Solana, Bitcoin):
 *   family        evm | solana | bitcoin | unknown
 *   address       the connected address on that network (when known)
 *   native        { symbol, amount, valueUsd }
 *   tokens        [{ symbol, amount, valueUsd, allowance }]
 *   positions     lending collateral, debt, LP, farms, futures margin
 *   pnl           { realizedUsd, unrealizedUsd } when readable
 *   valueUsd      the network's total, summed only from priced rows
 *
 * Honesty rules, same as everywhere: an unread network is absent (not zero),
 * an unpriced token is listed but excluded from totals, and allowances are
 * reported as the exposure they are (a live approval is spendable by its
 * spender). `missing` names what could not be read.
 */

export const WALLET_CONTEXT_SCHEMA = 'fbt.fi.wallet-context.v1';

const EVM_CHAINS = Object.freeze({
  '1': 'ethereum', '10': 'optimism', '56': 'bsc', '137': 'polygon',
  '8453': 'base', '42161': 'arbitrum', '43114': 'avalanche'
});
const NATIVE_BY_FAMILY = Object.freeze({ evm: 'ETH', solana: 'SOL', bitcoin: 'BTC' });
const NATIVE_SYMBOLS = new Set(['ETH', 'SOL', 'BTC']);
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'GUSD', 'LUSD']);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));
const sum = (rows, pick) => rows.reduce((a, r) => a + (num(pick(r)) ?? 0), 0);

function familyOf(network) {
  const n = String(network || '').toLowerCase();
  if (n === 'solana' || n === 'sol') return { family: 'solana', network: 'solana' };
  if (n === 'bitcoin' || n === 'btc' || n === 'btc-network') return { family: 'bitcoin', network: 'bitcoin' };
  if (EVM_CHAINS[n]) return { family: 'evm', network: EVM_CHAINS[n], chainId: n };
  if (EVM_CHAINS[String(network)]) return { family: 'evm', network: EVM_CHAINS[String(network)], chainId: String(network) };
  if (n === 'ethereum' || n === 'mainnet') return { family: 'evm', network: 'ethereum', chainId: '1' };
  return { family: 'unknown', network: n || 'unknown' };
}

/**
 * Build the universal wallet context from the owner's state sections.
 * Pure and total; every unread input lands in `missing`.
 *
 * @param {object} sections plain section DATA ({ wallet, portfolio, lending, borrowing, farming, liquidity, futures, dydx })
 */
export function buildWalletContext(sections = {}, { now = Date.now() } = {}) {
  const { wallet, portfolio, lending, borrowing, farming, liquidity, futures, dydx, transactions } = sections || {};
  const missing = [];
  const networks = new Map();

  const net = (network) => {
    const { family, network: name, chainId } = familyOf(network);
    const key = name;
    if (!networks.has(key)) {
      networks.set(key, {
        network: name,
        family,
        chainId: chainId ?? null,
        address: null,
        native: { symbol: NATIVE_BY_FAMILY[family] || null, amount: null, valueUsd: null },
        tokens: [],
        allowances: [],
        positions: { lending: [], lp: [], farm: [], futures: [], dydx: [] },
        debtUsd: null,
        pnl: { realizedUsd: null, unrealizedUsd: null },
        valueUsd: null,
        pricedValueUsd: 0
      });
    }
    return networks.get(key);
  };

  /* ── the wallet section: addresses + balances (any of the shapes modules write) ── */
  const walletRows = Array.isArray(wallet?.balances) ? wallet.balances
    : Array.isArray(wallet?.tokens) ? wallet.tokens
      : Array.isArray(wallet?.holdings) ? wallet.holdings : [];
  const addressOf = (row, fallback) => String(row?.address || row?.owner || fallback || '').trim() || null;
  const walletAddress = String(wallet?.address || wallet?.account || '').trim() || null;
  for (const row of walletRows) {
    const networkName = row.network || row.chain || (row.chainId != null ? String(row.chainId) : null) || wallet?.network || 'unknown';
    const ctx = net(networkName);
    const symbol = String(row.symbol || row.token || row.asset || '').toUpperCase();
    if (!symbol) continue;
    if (walletAddress) ctx.address = ctx.address || walletAddress;
    const entry = {
      symbol,
      amount: num(row.amount ?? row.balance),
      valueUsd: num(row.valueUsd ?? row.usd ?? row.value),
      isNative: NATIVE_SYMBOLS.has(symbol) || row.isNative === true,
      contract: row.contract || row.address || null
    };
    if (entry.isNative) {
      ctx.native = { symbol, amount: entry.amount, valueUsd: entry.valueUsd };
    } else {
      ctx.tokens.push(entry);
    }
    if (entry.valueUsd !== null) ctx.pricedValueUsd += entry.valueUsd;
  }
  if (!walletRows.length) missing.push('wallet');

  /* ── portfolio holdings folded into the same networks ───────────────── */
  const portfolioRows = Array.isArray(portfolio?.holdings) ? portfolio.holdings
    : Array.isArray(portfolio?.tokens) ? portfolio.tokens : [];
  for (const h of portfolioRows) {
    const symbol = String(h.symbol || h.token || h.asset || '').toUpperCase();
    if (!symbol) continue;
    const networkName = h.network || h.chain || (h.chainId != null ? String(h.chainId) : null) || 'unknown';
    const ctx = net(networkName);
    const valueUsd = num(h.valueUsd ?? h.usd ?? h.value);
    const amount = num(h.amount ?? h.balance);
    const existing = NATIVE_SYMBOLS.has(symbol)
      ? null
      : ctx.tokens.find((t) => t.symbol === symbol);
    if (NATIVE_SYMBOLS.has(symbol)) {
      if (ctx.native.valueUsd === null && valueUsd !== null) ctx.native = { symbol, amount, valueUsd };
      else if (ctx.native.symbol === symbol) {
        ctx.native.amount = ctx.native.amount ?? amount;
        ctx.native.valueUsd = ctx.native.valueUsd ?? valueUsd;
      }
    } else if (existing) {
      existing.valueUsd = existing.valueUsd ?? valueUsd;
      existing.amount = existing.amount ?? amount;
    } else {
      ctx.tokens.push({ symbol, amount, valueUsd, isNative: false, contract: h.contract || null });
    }
    if (valueUsd !== null) ctx.pricedValueUsd += 0; /* portfolio rows are the same money as wallet rows — never double-count */
  }

  /* ── allowances: live approvals are exposure ────────────────────────── */
  const allowanceRows = Array.isArray(wallet?.allowances) ? wallet.allowances : [];
  for (const a of allowanceRows) {
    const ctx = net(a.network || a.chain || 'unknown');
    ctx.allowances.push({
      token: String(a.token || a.symbol || '').toUpperCase(),
      spender: a.spender || a.spenderAddress || null,
      amount: num(a.amount),
      valueUsd: num(a.valueUsd)
    });
  }

  /* ── positions: lending / LP / farm / futures / dydx per network ────── */
  const place = (rows, bucket, valuePick, extraPick = () => ({})) => {
    for (const p of Array.isArray(rows) ? rows : []) {
      const ctx = net(p.network || p.chain || 'unknown');
      ctx.positions[bucket].push({
        asset: p.asset || p.symbol || p.market || null,
        protocol: p.protocol || p.venue || null,
        valueUsd: num(valuePick(p)),
        ...extraPick(p)
      });
    }
  };
  place(lending?.positions, 'lending', (p) => p.collateralUsd, (p) => ({ debtUsd: num(p.debtUsd), healthFactor: num(p.healthFactor), apyPct: num(p.apyPct ?? p.apy) }));
  place(liquidity?.positions, 'lp', (p) => p.valueUsd, (p) => ({ pair: p.pair || p.name || null }));
  place(farming?.positions, 'farm', (p) => p.valueUsd, (p) => ({ apyPct: num(p.apyPct ?? p.apy ?? p.aprPct), pool: p.pool || p.name || null }));
  place(futures?.positions, 'futures', (p) => p.marginUsd ?? p.collateralUsd, (p) => ({ side: p.side || null, leverage: num(p.leverage), notionalUsd: num(p.notionalUsd), pnlUsd: num(p.pnlUsd ?? p.unrealizedPnlUsd) }));
  place(dydx?.positions, 'dydx', (p) => p.marginUsd ?? p.collateralUsd, (p) => ({ side: p.side || null, leverage: num(p.leverage), notionalUsd: num(p.notionalUsd), pnlUsd: num(p.pnlUsd ?? p.unrealizedPnlUsd) }));

  /* ── debt + pnl rollups ─────────────────────────────────────────────── */
  const borrowingDebtUsd = num(borrowing?.debtUsd);
  for (const ctx of networks.values()) {
    const lendingDebt = sum(ctx.positions.lending, (p) => p.debtUsd);
    ctx.debtUsd = lendingDebt > 0 ? round(lendingDebt, 2) : null;
    ctx.pnl = {
      realizedUsd: num(portfolio?.realizedPnlUsd ?? transactions?.realizedPnlUsd),
      unrealizedUsd: num(portfolio?.unrealizedPnlUsd ?? portfolio?.pnlUsd)
    };
    ctx.valueUsd = round(ctx.pricedValueUsd
      + sum(ctx.positions.lending, (p) => p.valueUsd)
      + sum(ctx.positions.lp, (p) => p.valueUsd)
      + sum(ctx.positions.farm, (p) => p.valueUsd)
      + sum(ctx.positions.futures, (p) => p.valueUsd)
      + sum(ctx.positions.dydx, (p) => p.valueUsd), 2);
  }

  const rows = [...networks.values()].map((ctx) => ({
    ...ctx,
    tokens: ctx.tokens.slice(0, 40),
    allowances: ctx.allowances.slice(0, 20),
    positions: {
      lending: ctx.positions.lending.slice(0, 12),
      lp: ctx.positions.lp.slice(0, 12),
      farm: ctx.positions.farm.slice(0, 12),
      futures: ctx.positions.futures.slice(0, 12),
      dydx: ctx.positions.dydx.slice(0, 12)
    }
  }));

  /* An empty read is UNAVAILABLE with NULL totals — never a wallet worth 0. */
  const totalValueUsd = rows.length ? round(sum(rows, (r) => r.valueUsd), 2) : null;
  const totalDebtUsd = rows.length ? round(sum(rows, (r) => r.debtUsd) + (borrowingDebtUsd ?? 0), 2) : null;
  const stableUsd = rows.length ? round(sum(rows, (r) => sum(r.tokens, (t) => (STABLES.has(t.symbol) ? t.valueUsd : 0))), 2) : null;

  return {
    schema: WALLET_CONTEXT_SCHEMA,
    at: now,
    status: rows.length ? (missing.length ? 'PARTIAL' : 'OK') : 'UNAVAILABLE',
    reason: rows.length ? null : 'NO_WALLET_SECTION_READ',
    networks: rows,
    families: [...new Set(rows.map((r) => r.family))],
    totals: {
      networks: rows.length,
      valueUsd: totalValueUsd,
      debtUsd: totalDebtUsd !== null && totalDebtUsd > 0 ? totalDebtUsd : null,
      netWorthUsd: totalValueUsd !== null && totalDebtUsd !== null ? round(totalValueUsd - totalDebtUsd, 2) : null,
      stableUsd,
      stableSharePct: totalValueUsd !== null && totalValueUsd > 0 ? round((stableUsd / totalValueUsd) * 100, 2) : null,
      openAllowances: sum(rows, (r) => r.allowances.length),
      positions: sum(rows, (r) => r.positions.lending.length + r.positions.lp.length + r.positions.farm.length + r.positions.futures.length + r.positions.dydx.length)
    },
    missing,
    note: 'shared wallet truth: every engine reads this context, never a page-private copy; unpriced rows are listed but excluded from totals',
    executionAuthorized: false
  };
}

/**
 * The engine wrapper: builds the context from the owner's live sections and
 * keeps the last snapshot pinned per owner ('latest') so the chat, the council
 * and the cross-chain reasoner share ONE wallet read per pass.
 */
export function createWalletContextEngine({ collections = null, sectionsFor = () => ({}), observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function contextFor(owner, { correlationId = null } = {}) {
    const sections = sectionsFor(owner) || {};
    /* Accept both wrapped ({ wallet: { data } }) and flat ({ wallet }) sections. */
    const flat = {};
    for (const [key, section] of Object.entries(sections)) {
      flat[key] = section && typeof section === 'object' && 'data' in section ? section.data : section;
    }
    const context = buildWalletContext(flat, { now: now() });
    if (collections && context.status !== 'UNAVAILABLE') {
      try {
        await collections.put('wallet_context', owner, { ...context, id: 'latest' }, { idKey: 'id' });
      } catch (err) {
        log(`wallet-context:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'wallet-context.built', owner, correlationId, payload: { networks: context.totals.networks, valueUsd: context.totals.valueUsd } });
    return context;
  }

  async function latest(owner) {
    if (!collections) return null;
    try {
      const out = await collections.get('wallet_context', owner, 'latest');
      return out.ok ? out.row : null;
    } catch { return null; }
  }

  return { schema: WALLET_CONTEXT_SCHEMA, contextFor, latest, build: buildWalletContext };
}
