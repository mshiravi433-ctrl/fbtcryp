/** Read-only local preflight. No signature, approvals, or quote are inferred. */
import { RISK_PROFILES } from './strategyEngine.js';

const amount = (v) => v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

export function evaluateStrategyPreflight({ strategy, wallet, portfolio, now = Date.now() } = {}) {
  const base = { ok: false, capitalUsd: amount(strategy?.goal?.capitalUsd),
    availableUsd: null, checkedAt: now, unverified: ['gas', 'allowances', 'venue quote', 'wallet signature'] };
  if (!strategy?.ok || !(base.capitalUsd > 0)) return { ...base, code: 'PLAN_REQUIRED' };
  const connected = Boolean(wallet?.connected || wallet?.isConnected);
  const addressPresent = Boolean(wallet?.address || wallet?.solanaAddresses?.length);
  if (!connected || !addressPresent) return { ...base, code: 'WALLET_REQUIRED' };
  if (wallet?.canSign !== true) return { ...base, code: 'WALLET_CANNOT_SIGN' };
  if (portfolio?.dataStatus !== 'live' || portfolio?.partial === true) {
    return { ...base, code: 'PORTFOLIO_NOT_LIVE' };
  }
  // A freshly read token amount multiplied by an expired/offline market quote
  // is not freshly verified dollar capital. Unknown provenance also fails.
  if (portfolio?.priceDataStatus !== 'live') return { ...base, code: 'PRICE_NOT_LIVE' };
  const fetchedAt = amount(portfolio.fetchedAt);
  if (!fetchedAt || fetchedAt > now + 5_000 || now - fetchedAt > 120_000) {
    return { ...base, code: 'PORTFOLIO_STALE' };
  }
  const availableUsd = amount(portfolio.totalValueUsd);
  if (availableUsd == null || availableUsd < base.capitalUsd) {
    return { ...base, availableUsd, code: 'CAPITAL_NOT_VERIFIED' };
  }
  const targetChains = new Set((strategy.sleeves || []).map((s) => Number(s.chainId)).filter((n) => n > 0));
  const walletChain = Number(wallet.chainId);
  const otherChains = [...targetChains].filter((id) => id !== walletChain);
  const bridgeActions = strategy.stages?.find((s) => s.id === 'consolidate')?.actions || [];
  const bridgedChains = new Set(bridgeActions.map((a) => Number(a.params?.toChainId)));
  if (targetChains.size && (!walletChain || otherChains.length > 1
    || otherChains.some((id) => !bridgedChains.has(id)))) {
    return { ...base, availableUsd, code: 'WALLET_CHAIN_DIFFERS_REBUILD' };
  }
  // A cross-chain portfolio sum can cover the goal even when the selected
  // signer has none of that capital. Bridge only the capital observed on the
  // SOURCE chain and never imply that BTC can be sent as USDC.
  if (bridgeActions.length) {
    const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
    const onSource = holdings.filter((h) => Number(h.chainId) === walletChain);
    const sourceUsd = onSource.reduce((sum, h) => sum + (amount(h.valueUsd) || 0), 0);
    if (sourceUsd < base.capitalUsd) {
      return { ...base, availableUsd, sourceUsd, code: 'SOURCE_CHAIN_CAPITAL_NOT_VERIFIED' };
    }
    const usdcUsd = onSource.filter((h) => String(h.symbol || '').toUpperCase() === 'USDC')
      .reduce((sum, h) => sum + (amount(h.valueUsd) || 0), 0);
    const bridgeUsd = bridgeActions.reduce((sum, a) => sum + (amount(a.params?.amountUsd) || 0), 0);
    if (usdcUsd < bridgeUsd) {
      return { ...base, availableUsd, sourceUsd, usdcUsd, bridgeUsd,
        code: 'BRIDGE_USDC_NOT_VERIFIED' };
    }
  }
  const profile = RISK_PROFILES[strategy.goal.riskProfile];
  if (!profile || amount(strategy.risk?.weightedRiskRank) == null
    || amount(strategy.risk.weightedRiskRank) > profile.maxRiskRank
    || (strategy.risk?.breaches || []).some((b) => b.code === 'RISK_BAND_BREACH' || b.code === 'DRAWDOWN_ABOVE_BUDGET')) {
    return { ...base, availableUsd, code: 'RISK_LIMIT' };
  }
  // This confirms only the facts above; the live venue must still quote, check
  // gas/allowances and obtain an explicit wallet signature for each action.
  return { ...base, ok: true, code: 'LOCAL_PREFLIGHT_PASSED', availableUsd };
}
