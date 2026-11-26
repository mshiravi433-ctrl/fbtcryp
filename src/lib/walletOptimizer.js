/**
 * WALLET OPTIMIZER — real, explainable portfolio diagnosis.
 *
 * This is deliberately NOT an AI text generator. Every finding comes from the
 * rows the Wallet page already verified: priced holdings, their per-chain
 * totals, and which native coin is available for gas. The UI can therefore
 * say exactly which number produced a suggestion, and the suggestion never
 * invents a balance, a yield, or an approval the app has not read.
 */

export const STABLE_SYMBOLS = Object.freeze([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDE', 'PYUSD', 'USDD', 'CRVUSD'
]);

const isStable = (symbol) => STABLE_SYMBOLS.includes(String(symbol || '').toUpperCase());
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sum = (rows, pick) => rows.reduce((s, r) => s + num(pick(r)), 0);

export function analyzeWallet({ rows = [], chains = [], totalValue = null, activeChainId = null } = {}) {
  const priced = rows.filter((r) => num(r.value) > 0);
  const total = sum(priced, (r) => r.value) || num(totalValue);
  const bySymbol = [...priced].sort((a, b) => num(b.value) - num(a.value));
  const top = bySymbol[0] ?? null;
  const topPct = top && total > 0 ? (num(top.value) / total) * 100 : null;
  const stableRows = priced.filter((r) => isStable(r.symbol));
  const stableValue = sum(stableRows, (r) => r.value);
  const stablePct = total > 0 ? (stableValue / total) * 100 : null;
  const chainCount = new Set(priced.map((r) => r.chainId).filter(Boolean)).size;
  const unpriced = rows.filter((r) => !Number.isFinite(Number(r.value)) || Number(r.value) <= 0).length;
  const activeNative = priced.find((r) => r.native && String(r.chainId) === String(activeChainId));
  const activeNativeUsd = activeNative ? num(activeNative.value) : null;
  const chainTotals = (Array.isArray(chains) ? chains : [])
    .filter((c) => num(c.totalValue) > 0)
    .sort((a, b) => num(b.totalValue) - num(a.totalValue));

  const findings = [];
  const add = (id, severity, weight) => findings.push({ id, severity, weight });

  if (total <= 0) {
    add('noPricedHoldings', 'info', 0);
  } else {
    if (topPct != null && topPct >= 40) add('concentration', 'warn', Math.min(28, Math.round((topPct - 40) * 0.7)));
    else if (topPct != null && topPct >= 25) add('concentration', 'info', 8);
    if (stablePct != null && stablePct < 5) add('stableBuffer', 'info', 10);
    if (chainCount > 0 && chainCount < 2) add('singleChain', 'info', 8);
    if (activeNativeUsd != null && activeNativeUsd < 5) add('gasReserve', 'warn', 12);
    if (unpriced > 0) add('unpriced', 'info', 5);
    if (findings.length === 0) add('balanced', 'good', 0);
  }

  const score = total <= 0 ? null : Math.max(0, 100 - findings.reduce((s, f) => s + f.weight, 0));

  return {
    total,
    score,
    findings,
    top: top ? { symbol: top.symbol, chainId: top.chainId, value: num(top.value), pct: topPct } : null,
    stable: { value: stableValue, pct: stablePct, rows: stableRows.length },
    chains: chainTotals.map((c) => ({ chainId: c.chainId, label: c.chainShort || String(c.chainId), value: num(c.totalValue) })),
    chainCount,
    unpriced,
    activeNativeUsd,
    pricedCount: priced.length
  };
}

export default analyzeWallet;
