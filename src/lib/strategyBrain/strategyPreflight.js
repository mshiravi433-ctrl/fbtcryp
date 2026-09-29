/** Read-only local preflight. No signature, approvals, or quote are inferred.
 *
 * ─── WHY EVERY REFUSAL CARRIES A REMEDY ─────────────────────────────────────
 * Reported from the live app: «پیش‌پرواز تأیید نشد (WALLET_REQUIRED). هیچ
 * مرحله‌ای اجرا یا تأیید نشد.» — a correct refusal that left the user with no
 * way forward: the same button was the only control, and pressing it again
 * produced the same sentence. A gate that says *no* without saying *what would
 * make it yes* is a dead end, and a dead end in a staged plan reads as "the
 * buttons do not work".
 *
 * So each refusal now names the EXACT missing fact (`detail`) and the ONE
 * action that can supply it (`remedy`). The remedy is data, not UI: the chat
 * turns it into a real control (open the wallet sheet, refresh the portfolio,
 * rebuild with the balance that was actually read, switch networks). Nothing
 * here executes, signs, quotes or approves — the remedy only describes the
 * read that has to succeed before the plan may continue.
 */
import { RISK_PROFILES } from './strategyEngine.js';

const amount = (v) => v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const chainId = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * Every chain this plan will actually read, sign on, or bridge to.
 *
 * ─── WHY THE PLAN'S OWN CHAINS DECIDE, NOT ALL SIXTEEN ─────────────────────
 * The reported dead plan («هیچ مرحله‌ای اجرا یا تأیید نشد») was, on the wallet
 * side, a whole-book rule: the portfolio reader polls sixteen EVM networks,
 * one public RPC timing out is normal on a phone, and `partial` was set for
 * the entire book. The preflight then refused a plan that signs on ONE chain
 * because an unrelated network's read was slow — and a refusal with the same
 * button is indistinguishable from a broken button.
 *
 * A chain the plan never touches cannot invalidate the plan's capital. When
 * the snapshot carries per-chain reads, completeness is judged on the plan's
 * networks; the whole-book rule still stands when that detail is absent (older
 * snapshots, unit fixtures), so nothing gets looser where it cannot be proven.
 */
export function planChainIds(strategy) {
  const ids = new Set();
  for (const sleeve of strategy?.sleeves || []) {
    const id = chainId(sleeve?.chainId);
    if (id) ids.add(id);
  }
  for (const stage of strategy?.stages || []) {
    for (const action of stage?.actions || []) {
      for (const key of ['chainId', 'toChainId', 'fromChainId', 'sourceChainId', 'destChainId']) {
        const id = chainId(action?.params?.[key]);
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

/** The closed set of remedies. Adding a refusal means adding its way out. */
export const PREFLIGHT_REMEDIES = Object.freeze([
  'CONNECT_WALLET',        // no signer / no address in the snapshot
  'UNLOCK_WALLET',         // connected but cannot sign (locked / pairing)
  'REFRESH_PORTFOLIO',     // balances or prices are not a fresh live read
  'REBUILD_WITH_BALANCE',  // the read balance does not cover the stated capital
  'SWITCH_CHAIN_OR_REBUILD', // plan targets chains the connected wallet cannot reach yet
  'FUND_BRIDGE_SOURCE',    // bridging needs spendable USDC on the source chain
  'RESTART_PLAN'           // the plan itself is stale/over-budget: rebuild it
]);

function refuse(base, code, remedy, detail) {
  return { ...base, ok: false, code, remedy: remedy || null, detail: detail || null };
}

export function evaluateStrategyPreflight({ strategy, wallet, portfolio, now = Date.now() } = {}) {
  const base = { ok: false, capitalUsd: amount(strategy?.goal?.capitalUsd),
    availableUsd: null, checkedAt: now, unverified: ['gas', 'allowances', 'venue quote', 'wallet signature'] };
  if (!strategy?.ok || !(base.capitalUsd > 0)) {
    return refuse(base, 'PLAN_REQUIRED', 'RESTART_PLAN', 'the plan has no verified capital target');
  }
  /*
   * ATTACHED vs ABLE TO SIGN.
   *
   * The in-app vault attaches in a LOCKED state on purpose: the address is on
   * screen, the lease is live, and only the password is missing. `isConnected`
   * is false in exactly that state (WalletContext: `Boolean(address) &&
   * !locked`), so reading it as «no wallet» produced the report this file
   * opens with — «(WALLET_REQUIRED) کیف پول را وصل کن» shown to a user whose
   * wallet was attached, with the ONE control that fixes it (unlock) never
   * offered. Attached-but-locked is WALLET_CANNOT_SIGN, whose remedy unlocks;
   * WALLET_REQUIRED is reserved for a snapshot with no session at all.
   */
  const connected = Boolean(wallet?.connected || wallet?.isConnected);
  const attached = Boolean(wallet?.attached ?? connected);
  const addressPresent = Boolean(wallet?.address || wallet?.solanaAddresses?.length);
  if (!attached || !addressPresent) {
    return refuse(base, 'WALLET_REQUIRED', 'CONNECT_WALLET', connected
      ? 'the wallet connection has no readable address yet'
      : 'no wallet session is attached to this snapshot');
  }
  if (wallet?.canSign !== true) {
    return refuse(base, 'WALLET_CANNOT_SIGN', 'UNLOCK_WALLET',
      wallet?.hydrating ? 'the wallet session is still re-attaching'
        : wallet?.locked === true ? 'the wallet is attached but locked'
          : 'the wallet is connected but cannot sign yet');
  }
  const chainReads = Array.isArray(portfolio?.chains) ? portfolio.chains : null;
  const planChains = planChainIds(strategy);
  const readOf = (id) => (chainReads || []).find((c) => Number(c?.chainId) === id) || null;
  /* A plan chain is a gap when its read failed, is a kept previous read, or
     has an unpriced NON-ZERO row (a zero balance needs no price — see the
     portfolio reader). Unknown chains are a gap too: we cannot verify what was
     never read. */
  const planChainGaps = chainReads && planChains.length
    ? planChains.filter((id) => {
      const read = readOf(id);
      return !read || read.failed === true || read.stale === true || Number(read.unpriced || 0) > 0;
    })
    : [];
  const scoped = Boolean(chainReads && planChains.length);
  const canScope = scoped && planChainGaps.length === 0;
  /* `partial` (and the `partial` dataStatus derived from it) is a statement
     about the WHOLE book. It stops the plan only when the gap is on a chain the
     plan itself uses; a slow read on a network the plan never touches is not
     evidence against the plan's capital. A read that is still RUNNING or has
     FAILED outright is never scoped away. */
  const readBlocked = portfolio?.dataStatus === 'pending' || portfolio?.dataStatus === 'error'
    || portfolio?.dataStatus === 'unavailable'
    || (portfolio?.dataStatus === 'partial' && !canScope)
    || (portfolio?.partial === true && !canScope);
  if (readBlocked) {
    return refuse(base, 'PORTFOLIO_NOT_LIVE', 'REFRESH_PORTFOLIO',
      portfolio?.dataStatus === 'pending' ? 'the balance read is still running'
        : portfolio?.dataStatus === 'error' ? 'every chain read failed'
          : portfolio?.partial === true || portfolio?.dataStatus === 'partial'
            ? (scoped ? `chains the plan uses did not read completely (${planChainGaps.join(', ')})`
              : 'some chains did not answer, so the total is a floor')
            : 'no live balance read is available');
  }
  // A freshly read token amount multiplied by an expired/offline market quote
  // is not freshly verified dollar capital. Unknown provenance also fails.
  if (portfolio?.priceDataStatus !== 'live') {
    return refuse(base, 'PRICE_NOT_LIVE', 'REFRESH_PORTFOLIO',
      `USD prices are ${portfolio?.priceDataStatus || 'unavailable'}, so the balance has no verified dollar value`);
  }
  const fetchedAt = amount(portfolio.fetchedAt);
  if (!fetchedAt || fetchedAt > now + 5_000 || now - fetchedAt > 120_000) {
    return refuse(base, 'PORTFOLIO_STALE', 'REFRESH_PORTFOLIO',
      fetchedAt ? `the read is ${Math.round((now - fetchedAt) / 1000)}s old` : 'the read has no timestamp');
  }
  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  /* The number that matters is the capital the plan can actually spend, read
     on the plan's own chains. `totalValueUsd` stays the fallback for snapshots
     without chain detail (and is what the card shows), but it must never be
     the reason a single-chain plan is refused: a failed read on an unrelated
     network could only ever LOWER it. */
  const planRows = scoped ? holdings.filter((h) => planChains.includes(Number(h?.chainId))) : holdings;
  const planCapitalUsd = scoped
    ? planRows.reduce((sum, h) => sum + (amount(h?.valueUsd) || 0), 0)
    : amount(portfolio.totalValueUsd);
  const availableUsd = planCapitalUsd;
  if (availableUsd == null || availableUsd < base.capitalUsd) {
    return refuse({ ...base, availableUsd }, 'CAPITAL_NOT_VERIFIED', 'REBUILD_WITH_BALANCE',
      availableUsd == null ? 'the read produced no total'
        : `the read total $${Math.round(availableUsd)} is below the plan's $${Math.round(base.capitalUsd)}`);
  }
  const targetChains = new Set((strategy.sleeves || []).map((s) => Number(s.chainId)).filter((n) => n > 0));
  const walletChain = Number(wallet.chainId);
  const otherChains = [...targetChains].filter((id) => id !== walletChain);
  const bridgeActions = strategy.stages?.find((s) => s.id === 'consolidate')?.actions || [];
  const bridgedChains = new Set(bridgeActions.map((a) => Number(a.params?.toChainId)));
  if (targetChains.size && (!walletChain || otherChains.length > 1
    || otherChains.some((id) => !bridgedChains.has(id)))) {
    return refuse({ ...base, availableUsd }, 'WALLET_CHAIN_DIFFERS_REBUILD', 'SWITCH_CHAIN_OR_REBUILD',
      walletChain ? `the plan spreads across ${[...targetChains].join(', ')} while the signer is on ${walletChain}`
        : 'the wallet snapshot carries no chain id');
  }
  // A cross-chain portfolio sum can cover the goal even when the selected
  // signer has none of that capital. Bridge only the capital observed on the
  // SOURCE chain and never imply that BTC can be sent as USDC.
  if (bridgeActions.length) {
    const onSource = holdings.filter((h) => Number(h.chainId) === walletChain);
    const sourceUsd = onSource.reduce((sum, h) => sum + (amount(h.valueUsd) || 0), 0);
    if (sourceUsd < base.capitalUsd) {
      return refuse({ ...base, availableUsd, sourceUsd }, 'SOURCE_CHAIN_CAPITAL_NOT_VERIFIED',
        'FUND_BRIDGE_SOURCE',
        `$${Math.round(sourceUsd)} sits on the signer's chain ${walletChain}; the plan bridges $${Math.round(base.capitalUsd)}`);
    }
    const usdcUsd = onSource.filter((h) => String(h.symbol || '').toUpperCase() === 'USDC')
      .reduce((sum, h) => sum + (amount(h.valueUsd) || 0), 0);
    const bridgeUsd = bridgeActions.reduce((sum, a) => sum + (amount(a.params?.amountUsd) || 0), 0);
    if (usdcUsd < bridgeUsd) {
      return refuse({ ...base, availableUsd, sourceUsd, usdcUsd, bridgeUsd },
        'BRIDGE_USDC_NOT_VERIFIED', 'FUND_BRIDGE_SOURCE',
        `$${Math.round(usdcUsd)} of USDC is spendable on chain ${walletChain} but the bridge leg needs $${Math.round(bridgeUsd)}`);
    }
  }
  const profile = RISK_PROFILES[strategy.goal.riskProfile];
  if (!profile || amount(strategy.risk?.weightedRiskRank) == null
    || amount(strategy.risk.weightedRiskRank) > profile.maxRiskRank
    || (strategy.risk?.breaches || []).some((b) => b.code === 'RISK_BAND_BREACH' || b.code === 'DRAWDOWN_ABOVE_BUDGET')) {
    return refuse({ ...base, availableUsd }, 'RISK_LIMIT', 'RESTART_PLAN',
      'the allocation breaches the risk budget it was built for');
  }
  // This confirms only the facts above; the live venue must still quote, check
  // gas/allowances and obtain an explicit wallet signature for each action.
  return { ...base, ok: true, code: 'LOCAL_PREFLIGHT_PASSED', remedy: null, detail: null, availableUsd };
}
