/** Transparent, evidence-linked candidate ranking. This is not an order router. */
export function volumeBaseline(history = [], currentAt = Date.now()) {
  const rows = history.filter((r) => r.received_at < currentAt - 60000).slice(0, 30).map((r) => r.value_num).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (rows.length < 3) return { samples: rows.length, median: null, ratio: null };
  const mid = Math.floor(rows.length / 2);
  const median = rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
  return { samples: rows.length, median, ratio: null };
}
export function detectOpportunities({ pairs = [], tokenActivity = [], coverage = {}, historyFor = () => [], evidenceIds = [], now = Date.now() }) {
  const opportunities = [];
  for (const p of pairs.slice(0, 30)) {
    const liquidity = Number(p.liquidityUsd), volume = Number(p.volume?.h24), price = Number(p.priceUsd);
    if (![liquidity, volume, price].every(Number.isFinite) || liquidity < 50000 || price <= 0 || volume < 25000) continue;
    const instrument = `crypto:${p.chain}:${p.baseToken?.address}`;
    const baseline = volumeBaseline(historyFor(instrument, 'volume24h'), now);
    const turnover = volume / liquidity;
    const change = Number(p.priceChange?.h6 ?? p.change6h ?? 0);
    const flow = tokenActivity.find((t) => t.chainShort === p.chain && String(t.address).toLowerCase() === String(p.baseToken?.address).toLowerCase());
    const whaleInflow = flow && flow.labelled > 0 && flow.netUsd > 0 ? flow.netUsd : null;
    const unusualVolume = baseline.ratio == null && baseline.median > 0 ? volume / baseline.median : baseline.ratio;
    const signals = [
      turnover >= 0.5 ? 'ACTIVE_VOLUME' : null,
      change >= 2 ? 'POSITIVE_TREND' : change <= -2 ? 'NEGATIVE_TREND' : null,
      whaleInflow !== null ? 'LABELLED_NET_INFLOW' : null,
      unusualVolume >= 2 ? 'UNUSUAL_VOLUME_VS_OBSERVED_BASELINE' : null
    ].filter(Boolean);
    if (!signals.length) continue;
    const risk = liquidity < 100000 || turnover > 5 ? 'HIGH' : liquidity < 250000 || turnover > 2 ? 'ELEVATED' : 'MODERATE';
    const confidence = Math.min(0.9, 0.45 + signals.length * 0.08 + Math.min(0.12, (coverage.windowCoverage || 0) * 0.12));
    const score = Math.round(Math.min(95, 30 + signals.length * 12 + Math.min(15, Math.log10(volume / liquidity + 1) * 15) - (risk === 'HIGH' ? 15 : 0)));
    opportunities.push({
      id: `opp_${instrument}_${Math.floor(now / 3600000)}`, instrument, symbol: p.baseToken?.symbol || null,
      chain: p.chain, address: p.baseToken?.address || null, pairAddress: p.pairAddress,
      discoveredAt: now, expiresAt: now + 3600000, risk, confidence, score, signals,
      metrics: { priceUsd: price, liquidityUsd: liquidity, volume24h: volume, turnover, change6h: change, whaleInflow, unusualVolume, baselineSamples: baseline.samples },
      evidenceIds, sourceUrls: [p.url].filter((u) => /^https:\/\//.test(String(u))),
      limitations: ['Observed DEX activity, not a guarantee of return', 'Whale inflow requires labelled counterparties', baseline.samples < 3 ? 'No three-sample volume baseline yet' : 'Baseline includes only observed scans'],
      prediction: { direction: change < 0 ? 'down' : 'up', probability: Math.min(0.7, confidence), baseline: price }
    });
  }
  return opportunities.sort((a, b) => b.score - a.score).slice(0, 10);
}
