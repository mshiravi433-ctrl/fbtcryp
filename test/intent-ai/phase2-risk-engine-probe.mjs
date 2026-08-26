export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const { evaluateRisk } = await import('../../src/lib/intent-ai/riskEngine.js');

  const allow = evaluateRisk({
    tokenRisk: { level: 'low' },
    walletRisk: { level: 'low' },
    mev: { state: 'public' },
    simulation: { status: 'simulated-clean' },
    priceImpactPct: 0.2,
    slippagePct: 0.3,
    acknowledgedHigh: true
  });
  t('clean inputs can allow', allow.decision === 'allow' && allow.canProceed);

  const block = evaluateRisk({
    tokenRisk: { level: 'critical', honeypot: true },
    priceImpactPct: 0.1,
    slippagePct: 0.3
  });
  t('honeypot blocks', block.decision === 'block');

  const miss = evaluateRisk({});
  t('missing data is not low/allow', miss.level !== 'low' && miss.decision !== 'allow');

  const impact = evaluateRisk({
    tokenRisk: { level: 'low' },
    priceImpactPct: 12,
    slippagePct: 0.2,
    acknowledgedHigh: true
  });
  t('extreme price impact blocks', impact.decision === 'block');

  const slip = evaluateRisk({
    tokenRisk: { level: 'low' },
    priceImpactPct: 0.1,
    slippagePct: 9
  });
  t('extreme slippage blocks', slip.decision === 'block');
  return rows;
}
