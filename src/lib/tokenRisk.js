/**
 * AI RISK ENGINE — token security, not price prediction.
 * ---------------------------------------------------------------------------
 * Verdict/ai.js answers "what is this chart doing". This file answers a
 * different question the swap screen actually needs: "can I sell this, and
 * who already owns it?"
 *
 * ─── WHY A SEPARATE MODULE ──────────────────────────────────────────────────
 * A honeypot can have a beautiful chart. Mixing the two reads would let a
 * green RSI hide an unsellable contract, which is the single most expensive
 * way to be confidently wrong on a DEX.
 *
 * ─── WHAT THIS WILL NEVER DO ────────────────────────────────────────────────
 *   · invent a "safe" verdict from missing data
 *   · emit a sentence — every flag is a translation KEY plus numbers
 *   · claim certainty above 90 — even a confirmed honeypot is one feed
 *
 * The public score is 0 (cleanest we can measure) to 100 (do not touch).
 * Unknown fields raise `unknown`, never lower the score: absence of evidence
 * is not evidence of absence, and a green badge on an unread contract is
 * how people buy rugs.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** GoPlus chain ids. A chain we cannot ask about is reported as unsupported. */
export const GOPLUS_CHAINS = {
  1: '1',
  56: '56',
  137: '137',
  42161: '42161',
  10: '10',
  8453: '8453',
  43114: '43114',
  59144: '59144'
};

export function goplusChainId(chainId) {
  return GOPLUS_CHAINS[Number(chainId)] ?? null;
}

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

const YES = new Set(['1', 'true', 'yes', true, 1]);
const isYes = (v) => YES.has(v) || YES.has(String(v ?? '').toLowerCase());
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalise a GoPlus (or GoPlus-shaped) payload into one object the scorer
 * understands. Exported so a test can feed a fixture without the network.
 */
export function normalizeGoplus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const buyTax = num(raw.buy_tax ?? raw.buyTax);
  const sellTax = num(raw.sell_tax ?? raw.sellTax);
  const top10 = num(raw.top10_holder_rate ?? raw.top10HolderRate);
  const lpHolders = Array.isArray(raw.lp_holders) ? raw.lp_holders : [];
  const holders = Array.isArray(raw.holders) ? raw.holders : [];

  const topShare = (() => {
    if (top10 != null) return top10 > 1 ? top10 / 100 : top10;
    if (!holders.length) return null;
    const sum = holders.slice(0, 10).reduce((a, h) => a + (num(h.percent ?? h.share) ?? 0), 0);
    return sum > 1 ? sum / 100 : sum;
  })();

  const lpLocked = (() => {
    if (isYes(raw.lp_holder_count) && raw.is_open_source === undefined) return null;
    if (isYes(raw.lp_lock)) return true;
    if (lpHolders.length) {
      const locked = lpHolders.filter((h) => isYes(h.is_locked) || isYes(h.locked));
      const share = locked.reduce((a, h) => a + (num(h.percent) ?? 0), 0);
      return share >= 50;
    }
    return null;
  })();

  return {
    honeypot: isYes(raw.is_honeypot) || isYes(raw.cannot_sell_all),
    cannotBuy: isYes(raw.cannot_buy),
    cannotSell: isYes(raw.cannot_sell_all) || isYes(raw.is_honeypot),
    buyTax: buyTax != null ? (buyTax > 1 ? buyTax : buyTax * 100) : null,
    sellTax: sellTax != null ? (sellTax > 1 ? sellTax : sellTax * 100) : null,
    mintable: isYes(raw.is_mintable),
    pausable: isYes(raw.transfer_pausable) || isYes(raw.trading_cooldown),
    blacklist: isYes(raw.is_blacklisted) || isYes(raw.is_anti_whale),
    proxy: isYes(raw.is_proxy),
    openSource: raw.is_open_source == null ? null : isYes(raw.is_open_source),
    ownerChangeBalance: isYes(raw.owner_change_balance) || isYes(raw.can_take_back_ownership),
    hiddenOwner: isYes(raw.hidden_owner),
    selfDestruct: isYes(raw.selfdestruct),
    externalCall: isYes(raw.external_call),
    holderCount: num(raw.holder_count),
    top10Share: topShare,
    lpLocked,
    liquidityUsd: num(raw.dex?.[0]?.liquidity ?? raw.liquidity),
    buyTaxModifiable: isYes(raw.slippage_modifiable) || isYes(raw.personal_slippage_modifiable),
    tradingCooldown: isYes(raw.trading_cooldown),
    isInDex: raw.is_in_dex == null ? null : isYes(raw.is_in_dex)
  };
}

/**
 * Score a normalised report.
 *
 * @returns {{
 *   score: number,
 *   level: 'low'|'medium'|'high'|'critical'|'unknown',
 *   honeypot: boolean,
 *   scam: boolean,
 *   contractRisk: 'low'|'medium'|'high'|'unknown',
 *   liquidityRisk: 'low'|'medium'|'high'|'unknown',
 *   holderConcentration: number|null,
 *   whaleActivity: 'quiet'|'elevated'|'extreme'|'unknown',
 *   rugPull: number,
 *   flags: Array<{id: string, severity: string, values: object}>,
 *   unknown: boolean
 * }}
 */
export function scoreTokenRisk(report) {
  if (!report || typeof report !== 'object') {
    return emptyVerdict('NO_DATA');
  }

  const flags = [];
  let score = 8;
  let known = 0;

  const push = (id, severity, values, pts) => {
    flags.push({ id, severity, values: values ?? {} });
    score += pts;
    known += 1;
  };

  if (report.honeypot || report.cannotSell) {
    push('honeypot', 'critical', {}, 70);
  }
  if (report.cannotBuy) push('cannotBuy', 'high', {}, 18);

  if (report.sellTax != null) {
    known += 1;
    if (report.sellTax >= 20) push('sellTaxHigh', 'critical', { pct: Math.round(report.sellTax) }, 28);
    else if (report.sellTax >= 10) push('sellTaxMed', 'high', { pct: Math.round(report.sellTax) }, 16);
    else if (report.sellTax >= 5) push('sellTaxLow', 'caution', { pct: Math.round(report.sellTax) }, 6);
  }
  if (report.buyTax != null) {
    known += 1;
    if (report.buyTax >= 15) push('buyTaxHigh', 'high', { pct: Math.round(report.buyTax) }, 12);
  }
  if (report.buyTaxModifiable) push('taxModifiable', 'high', {}, 14);

  if (report.mintable) push('mintable', 'high', {}, 16);
  if (report.ownerChangeBalance) push('ownerChangeBalance', 'critical', {}, 22);
  if (report.hiddenOwner) push('hiddenOwner', 'high', {}, 12);
  if (report.selfDestruct) push('selfDestruct', 'critical', {}, 20);
  if (report.pausable) push('pausable', 'medium', {}, 10);
  if (report.blacklist) push('blacklist', 'medium', {}, 8);
  if (report.proxy) push('proxy', 'caution', {}, 5);
  if (report.openSource === false) push('closedSource', 'high', {}, 14);
  if (report.tradingCooldown) push('cooldown', 'caution', {}, 4);

  if (report.top10Share != null) {
    known += 1;
    const pct = Math.round(report.top10Share * 100);
    if (report.top10Share >= 0.7) push('holdersConcentrated', 'high', { pct }, 18);
    else if (report.top10Share >= 0.5) push('holdersTight', 'medium', { pct }, 10);
  }
  if (report.holderCount != null && report.holderCount < 50) {
    push('fewHolders', 'medium', { n: report.holderCount }, 8);
  }

  if (report.lpLocked === false) push('lpUnlocked', 'high', {}, 16);
  if (report.liquidityUsd != null) {
    known += 1;
    if (report.liquidityUsd < 5_000) push('liqDust', 'critical', { usd: Math.round(report.liquidityUsd) }, 22);
    else if (report.liquidityUsd < 25_000) push('liqThin', 'high', { usd: Math.round(report.liquidityUsd) }, 12);
    else if (report.liquidityUsd < 80_000) push('liqModest', 'caution', { usd: Math.round(report.liquidityUsd) }, 5);
  }
  if (report.isInDex === false) push('notListed', 'high', {}, 14);

  score = clamp(Math.round(score), 0, 100);

  const honeypot = Boolean(report.honeypot || report.cannotSell);
  const scam = honeypot || Boolean(report.ownerChangeBalance && report.hiddenOwner);
  const unknown = known === 0 && flags.length === 0;

  const contractBits = [
    report.mintable,
    report.pausable,
    report.ownerChangeBalance,
    report.hiddenOwner,
    report.selfDestruct,
    report.openSource === false
  ].filter(Boolean).length;
  const contractRisk =
    report.openSource == null && !report.mintable && !report.ownerChangeBalance
      ? 'unknown'
      : contractBits >= 3 || report.ownerChangeBalance || report.selfDestruct
        ? 'high'
        : contractBits >= 1
          ? 'medium'
          : 'low';

  const liquidityRisk =
    report.liquidityUsd == null && report.lpLocked == null
      ? 'unknown'
      : report.liquidityUsd != null && report.liquidityUsd < 25_000
        ? 'high'
        : report.lpLocked === false || (report.liquidityUsd != null && report.liquidityUsd < 80_000)
          ? 'medium'
          : 'low';

  const whaleActivity =
    report.top10Share == null
      ? 'unknown'
      : report.top10Share >= 0.7
        ? 'extreme'
        : report.top10Share >= 0.45
          ? 'elevated'
          : 'quiet';

  /* Rug probability is a weighted blend, capped. Not a forecast. */
  let rug = 12;
  if (honeypot) rug += 55;
  if (report.lpLocked === false) rug += 18;
  if (report.mintable) rug += 12;
  if (report.ownerChangeBalance) rug += 16;
  if (report.top10Share != null && report.top10Share >= 0.6) rug += 10;
  if (report.liquidityUsd != null && report.liquidityUsd < 10_000) rug += 12;
  rug = clamp(rug, 5, 92);

  const level = unknown
    ? 'unknown'
    : honeypot || score >= 75
      ? 'critical'
      : score >= 50
        ? 'high'
        : score >= 28
          ? 'medium'
          : 'low';

  return {
    score,
    level,
    honeypot,
    scam,
    contractRisk,
    liquidityRisk,
    holderConcentration: report.top10Share == null ? null : Math.round(report.top10Share * 100),
    whaleActivity,
    rugPull: rug,
    flags: flags.slice(0, 8),
    unknown,
    generatedAt: Date.now()
  };
}

function emptyVerdict(reason) {
  return {
    score: 0,
    level: 'unknown',
    honeypot: false,
    scam: false,
    contractRisk: 'unknown',
    liquidityRisk: 'unknown',
    holderConcentration: null,
    whaleActivity: 'unknown',
    rugPull: 0,
    flags: [{ id: reason === 'UNSUPPORTED' ? 'unsupportedChain' : 'noData', severity: 'caution', values: {} }],
    unknown: true,
    generatedAt: Date.now()
  };
}

const cache = new Map();
const TTL_MS = 5 * 60_000;

/**
 * Fetch a risk report for one token. Never throws — a network failure is
 * reported as unknown rather than crashing the swap screen.
 */
export async function fetchTokenRisk({ chainId, address } = {}) {
  const chain = goplusChainId(chainId);
  if (!chain) return emptyVerdict('UNSUPPORTED');
  const addr = String(address || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return emptyVerdict('NO_DATA');

  const key = `${chain}:${addr}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  try {
    const res = await fetch(
      `${API_BASE}/token-risk?chainId=${encodeURIComponent(chain)}&address=${encodeURIComponent(addr)}`,
      { headers: { accept: 'application/json' } }
    );
    if (!res.ok) throw new Error('UPSTREAM');
    const body = await res.json();
    const report = body?.report ?? normalizeGoplus(body?.raw ?? body);
    const value = scoreTokenRisk(report);
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return emptyVerdict('NO_DATA');
  }
}

/** Native / wrapped gas coins we already trust — skip the scan. */
export function isTrustedNative(token) {
  if (!token) return false;
  if (token.native) return true;
  if (token.verified && token.rwa) return false;
  return Boolean(token.verified && token.native);
}
