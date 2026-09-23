/**
 * FBT INTENT OS — TRADING CONSTITUTION
 * ---------------------------------------------------------------------------
 * Pattern from Gordon (general-liquidity/gordon, MIT): "the model proposes,
 * the harness disposes". A small set of IMMUTABLE ceilings sits underneath
 * every AI-originated plan. Nothing the model says, nothing the user types in
 * chat, no aiControl payload and no env var can raise them — they can only be
 * made TIGHTER by the per-user caps that already exist (commandCenter.js).
 *
 * Why a separate layer when guardian.js / commandCenter.js exist:
 *   · commandCenter.validateExecution checks $ caps, chains and surfaces but
 *     not leverage, slippage or per-leg sanity — and the AI /execute route
 *     only runs that one.
 *   · central/policy.js refuses leverage above 50x — far above what the
 *     product will ever route from a chat turn.
 *   · Each article here is a named, testable rule with a stable code, so a
 *     refusal is explainable in the user's language and auditable later.
 *
 * The ceilings mirror DEFAULT_POLICY_CAPS (permissions.js) so there is ONE
 * source of truth for the numbers; the constitution adds the rules those
 * numbers were never enforced by on the AI path.
 *
 * Pure and synchronous: shared by server routes and the browser.
 */

import { DEFAULT_POLICY_CAPS } from './permissions.js';

export const CONSTITUTION_SCHEMA = 'fbt.constitution.v1';

export const CONSTITUTION = Object.freeze({
  version: 1,
  maxLeverage: DEFAULT_POLICY_CAPS.maxLeverage,          // 5x
  maxSlippagePct: DEFAULT_POLICY_CAPS.maxSlippagePct,    // 3%
  maxTransactionUsd: DEFAULT_POLICY_CAPS.maxTransactionUsd,
  maxLegs: 12,
  /** A single leg may not spend more than the wallet visibly holds of it. */
  forbidOverspend: true,
  /** Swapping a token into itself is always a bug, never an intent. */
  forbidSelfSwap: true,
  /** Every leg must name its chain — an unchained leg can be routed anywhere. */
  requireChain: true
});

/** Stable article codes (i18n keys: intentAI.constitution.<code>). */
export const ARTICLES = Object.freeze({
  LEVERAGE_CEILING: 'LEVERAGE_CEILING',
  SLIPPAGE_CEILING: 'SLIPPAGE_CEILING',
  TRANSACTION_CEILING: 'TRANSACTION_CEILING',
  TOO_MANY_LEGS: 'TOO_MANY_LEGS',
  NON_POSITIVE_AMOUNT: 'NON_POSITIVE_AMOUNT',
  OVERSPEND: 'OVERSPEND',
  SELF_SWAP: 'SELF_SWAP',
  CHAIN_REQUIRED: 'CHAIN_REQUIRED'
});

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Slippage can arrive as pct (0.5), bps (50) or fraction (0.005). → pct. */
function slippagePctOf(action) {
  const p = action?.parameters || {};
  const pct = num(action?.slippagePct ?? p.slippagePct);
  if (pct != null) return pct;
  const bps = num(action?.slippageBps ?? p.slippageBps);
  if (bps != null) return bps / 100;
  const raw = num(action?.slippage ?? p.slippage);
  if (raw == null) return null;
  /* 0 < raw < 0.5 is almost certainly a fraction (0.005 = 0.5%). */
  return raw > 0 && raw < 0.5 ? raw * 100 : raw;
}

function holdingOf(balances, symbol, chainId) {
  if (!Array.isArray(balances) || !symbol) return null;
  const sym = String(symbol).toUpperCase();
  const rows = balances.filter((b) => String(b?.symbol || '').toUpperCase() === sym
    && (chainId == null || b?.chainId == null || Number(b.chainId) === Number(chainId)));
  if (!rows.length) return null;
  return rows.reduce((s, b) => s + (num(b.amount ?? b.balance) || 0), 0);
}

/**
 * Check a plan against the constitution.
 *
 * `enforceChain:false` is for the server: its context never learns which
 * chain the wallet is on, so CHAIN_REQUIRED is enforced where that IS known —
 * the client, right before the wallet is asked to sign (`defaultChainId` =
 * the connected wallet's chain, the one the executor will actually use).
 * @returns {{ok:boolean, schema, version, violations:Array<{article,leg,detail}>, checked:number}}
 */
export function checkConstitution({ actions = [], balances = null, defaultChainId = null, enforceChain = true } = {}) {
  const legs = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
  const violations = [];
  const flag = (article, leg, detail) => violations.push({ article, leg, detail });

  if (legs.length > CONSTITUTION.maxLegs) {
    flag(ARTICLES.TOO_MANY_LEGS, null, `${legs.length} legs > ${CONSTITUTION.maxLegs}`);
  }

  legs.forEach((a, i) => {
    const p = a.parameters || {};
    const leverage = num(a.leverage ?? p.leverage);
    if (leverage != null && leverage > CONSTITUTION.maxLeverage) {
      flag(ARTICLES.LEVERAGE_CEILING, i, `${leverage}x > ${CONSTITUTION.maxLeverage}x`);
    }
    const slip = slippagePctOf(a);
    if (slip != null && slip > CONSTITUTION.maxSlippagePct) {
      flag(ARTICLES.SLIPPAGE_CEILING, i, `${slip}% > ${CONSTITUTION.maxSlippagePct}%`);
    }
    const usd = num(a.amountUsd);
    if (usd != null && usd > CONSTITUTION.maxTransactionUsd) {
      flag(ARTICLES.TRANSACTION_CEILING, i, `$${usd} > $${CONSTITUTION.maxTransactionUsd}`);
    }
    const amount = num(a.amount);
    if ((amount != null && amount <= 0) || (usd != null && usd <= 0)) {
      flag(ARTICLES.NON_POSITIVE_AMOUNT, i, 'amount must be > 0');
    }
    const type = String(a.type || '').toUpperCase();
    if (CONSTITUTION.forbidSelfSwap && type === 'SWAP' && a.from && a.to
        && String(a.from).toUpperCase() === String(a.to).toUpperCase()
        && (a.toChainId == null || Number(a.toChainId) === Number(a.chainId))) {
      flag(ARTICLES.SELF_SWAP, i, `${a.from} → ${a.to}`);
    }
    const moves = ['SWAP', 'SELL', 'BRIDGE', 'SEND', 'TRANSFER', 'LEND', 'SUPPLY', 'STAKE'].includes(type);
    /* A leg is chained when it names a chain (EVM id or `chain: 'solana'`)
       or the caller supplies the connected wallet's chain as the default the
       executor will use. Only a leg with NO resolvable chain is refused. */
    if (CONSTITUTION.requireChain && enforceChain && moves && a.chainId == null && !a.chain && !p.chainId && !p.chain && defaultChainId == null) {
      flag(ARTICLES.CHAIN_REQUIRED, i, 'leg has no chainId');
    }
    if (CONSTITUTION.forbidOverspend && moves && amount != null && Array.isArray(balances)) {
      const source = a.from || a.asset;
      const held = holdingOf(balances, source, a.chainId);
      /* 0.1% tolerance for display rounding («همه» = 99.9996 of 100). */
      if (held != null && amount > held * 1.001) {
        flag(ARTICLES.OVERSPEND, i, `${amount} ${source} > held ${held}`);
      }
    }
  });

  return {
    ok: violations.length === 0,
    schema: CONSTITUTION_SCHEMA,
    version: CONSTITUTION.version,
    checked: legs.length,
    violations
  };
}

/** One-line, user-facing explanation of the first violation. */
export function explainConstitution(result, locale = 'fa') {
  if (!result || result.ok) return null;
  const v = result.violations[0];
  const fa = String(locale || 'fa').startsWith('fa');
  const c = CONSTITUTION;
  const text = {
    LEVERAGE_CEILING: fa ? `اهرم بیشتر از ${c.maxLeverage} برابر از طریق دستیار هوشمند مجاز نیست.` : `Leverage above ${c.maxLeverage}x is not allowed through the assistant.`,
    SLIPPAGE_CEILING: fa ? `لغزش قیمت بیش از ${c.maxSlippagePct}٪ پذیرفته نمی‌شود؛ ممکن است بخش بزرگی از مبلغ از دست برود.` : `Slippage above ${c.maxSlippagePct}% is refused — it can cost a large part of the amount.`,
    TRANSACTION_CEILING: fa ? 'مبلغ این تراکنش از سقف ثابت محصول بیشتر است.' : 'This transaction is above the product\'s fixed ceiling.',
    TOO_MANY_LEGS: fa ? 'این برنامه مراحل بیش از حد دارد؛ آن را به چند درخواست کوچک‌تر تقسیم کنید.' : 'This plan has too many steps; split it into smaller requests.',
    NON_POSITIVE_AMOUNT: fa ? 'مبلغ باید بیشتر از صفر باشد.' : 'The amount must be greater than zero.',
    OVERSPEND: fa ? 'مبلغ این مرحله از موجودی واقعی کیف پول شما بیشتر است.' : 'This step spends more than your wallet actually holds.',
    SELF_SWAP: fa ? 'تبدیل یک توکن به خودش معنی ندارد.' : 'Swapping a token into itself does nothing.',
    CHAIN_REQUIRED: fa ? 'شبکهٔ این مرحله مشخص نیست؛ بدون شبکهٔ مشخص اجرا نمی‌شود.' : 'This step has no network; it will not run without one.'
  };
  return text[v.article] || (fa ? 'این برنامه با قوانین ثابت ایمنی سازگار نیست.' : 'This plan breaks a fixed safety rule.');
}
