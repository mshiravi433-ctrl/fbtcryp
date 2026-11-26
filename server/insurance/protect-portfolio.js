/**
 * FBT Insurance OS — PROTECT_PORTFOLIO intent pipeline (§55, §4, §57, §15).
 *
 * portfolio → risk → coverage gap → eligible providers → quotes → ranking →
 * explanation → recommendation. `autoExecute` is ALWAYS false here: this
 * module only recommends. Execution requires the user to confirm and sign.
 * Ranking is never purely lowest price (§56).
 */
import * as store from './store.js';
import { analysePortfolioRisk, coverageGap } from './risk-engine.js';
import { aggregateQuotes, discoverProducts, listProviders } from './service.js';
import { toMicro, fromMicro, CHAIN_IDS, RISK_BANDS } from './constants.js';
import { listCoverages } from './coverage.js';

const KINDS = ['smartContract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'protocol'];
const KIND_TO_PROTECTION = {
  smartContract: 'smart-contract', bridge: 'bridge', stablecoin: 'stablecoin',
  lending: 'lending', lp: 'lp', wallet: 'wallet', oracle: 'oracle', protocol: 'defi-protocol'
};

/**
 * Input exposures as [{ kind, amountMicro|amountUsd, chainId, protocol?,
 * protocolRiskBand? }] from the client (real balances — never invented here).
 */
export async function protectPortfolio(input) {
  const owner = String(input.walletAddress || '').toLowerCase();
  const exposures = normalizeExposures(input.exposures || input.portfolio || []);
  const chainId = Number(input.chainId ?? CHAIN_IDS.bsc);
  const targetCoverageMicro = input.targetCoverageMicro ?? (input.targetCoverage ? toMicro(input.targetCoverage) : null);
  const maxPremiumMicro = input.maxPremiumMicro ?? (input.maxPremium ? toMicro(input.maxPremium) : null);
  const durationDays = Number(input.durationDays ?? input.duration ?? 30);
  const autoExecute = input.autoExecute === true; // never honoured by caller

  // Build active-coverage inputs from stored coverages.
  const activeCoverages = await listCoverages(owner);
  const coverageInput = activeCoverages
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => ({ kind: KIND_TO_PROTECTION[c.protectionType] ? kindToRiskKind(c.protectionType) : c.protectionType, amountMicro: c.coverageAmountMicro }));

  const risk = analysePortfolioRisk({ exposures, activeCoverage: coverageInput });
  const gap = coverageGap(risk);

  // Prioritise uncovered kinds by gap amount.
  // Biggest uncovered exposure first. The old comparator returned 1 when b
  // was LARGER, so it silently sorted the smallest gap to the top and the
  // recommendation list answered the wrong question.
  const open = risk.kinds.filter((k) => k.gapMicro > 0n).sort((a, b) => (a.gapMicro > b.gapMicro ? -1 : a.gapMicro < b.gapMicro ? 1 : 0));

  // Decide target allocations: if a global target is given, split proportionally
  // across open kinds by their gap; otherwise recommend closing each gap.
  const targets = [];
  const allocBase = open.reduce((a, k) => a + k.gapMicro, 0n);
  for (const k of open.slice(0, 3)) {
    let target = k.gapMicro;
    if (targetCoverageMicro) {
      const share = allocBase > 0n ? (k.gapMicro * targetCoverageMicro) / allocBase : 0n;
      target = share;
    }
    if (target > 0n) targets.push({ riskKind: k.kind, protectionType: KIND_TO_PROTECTION[k.kind] || k.kind, gapMicro: k.gapMicro, recommendedCoverageMicro: target });
  }

  const options = [];
  let catalogue = null;
  for (const t of targets) {
    const res = await aggregateQuotes({
      walletAddress: owner, chainId, protectionType: t.protectionType,
      coverageAmountMicro: t.recommendedCoverageMicro, durationDays, currency: 'usdc'
    });
    if (!res.ok) {
      /* A priced quote needs the buyer's wallet, terms acceptance and a live
         provider answer. A RECOMMENDATION does not: when those inputs are not
         there, show the REAL catalogue entries for this protection kind and
         send the user to the marketplace with the product preselected. No
         premium, quote id or provider claim is invented. */
      catalogue ??= (await discoverProducts({ chainId }).catch(() => [])) || [];
      const matches = catalogue
        .filter((p) => p.kind === t.protectionType && (!chainId || (p.supportedChains || []).includes(chainId)))
        .slice(0, 4)
        .map((p) => ({
          productId: p.id,
          providerId: p.providerId,
          providerName: p.providerName,
          name: p.name || p.label || p.id,
          chainId,
          termsUrl: p.termsUrl || null
        }));
      if (matches.length) options.push({ ...t, best: null, catalogueOnly: true, catalogue: matches });
      continue;
    }
    const ranked = rankQuotes(res.quotes);
    if (ranked.length === 0) continue;
    const best = ranked[0];
    if (maxPremiumMicro && BigInt(best.totalCostMicro) > BigInt(maxPremiumMicro)) {
      options.push({ ...t, blockedByPremium: true, best: null, cheapest: ranked.reduce((a, b) => (BigInt(b.totalCostMicro) < BigInt(a.totalCostMicro) ? b : a)) });
      continue;
    }
    options.push({ ...t, best, candidates: ranked.map((q) => ({ quoteId: q.quoteId, provider: q.provider, providerName: q.providerName, coverageAmountUsd: q.coverageAmountUsd, premiumUsd: q.premiumUsd, totalCostUsd: q.totalCostUsd, providerHealth: q.providerHealth, providerRiskScore: q.providerHealth, termsHash: q.termsHash })) });
  }

  const protectedUsd = gap.percentProtected;
  const plainLanguage = explain(risk, options);
  return {
    intent: 'PROTECT_PORTFOLIO',
    autoExecute: false,
    wallet: owner,
    riskAnalysis: { overallRiskBand: risk.overallRiskBand, totalExposureUsd: risk.totalExposureUsd, kinds: risk.kinds },
    coverageGap: gap,
    recommendations: options,
    recommendation: options.some((o) => o.catalogueOnly)
      ? `Real catalogue options were found for ${options.length} uncovered exposure(s); request a live quote in the marketplace before any purchase.`
      : options.length ? `Review the ${options.length} recommended protection option(s). Nothing is purchased without your signature.` : gap.coverageGapUsd !== '0' ? 'Coverage gap detected but no eligible protection is currently available.' : 'No coverage gap detected.',
    plainLanguage,
    disclaimers: ['Sandbox protection providers are simulated. Nothing is guaranteed.', 'This is a recommendation only. No coverage is purchased automatically.'],
    expiresAt: Date.now() + 15 * 60 * 1000
  };
}

function normalizeExposures(exposures) {
  if (!Array.isArray(exposures)) return [];
  return exposures.map((e) => {
    const micro = e.amountMicro != null ? e.amountMicro : (e.amountUsd != null ? toMicro(e.amountUsd) : null);
    if (micro === null) return null;
    return { kind: e.kind, amountMicro: typeof micro === 'bigint' ? micro : toMicro(micro), chainId: e.chainId, protocol: e.protocol, protocolRiskBand: e.protocolRiskBand };
  }).filter(Boolean);
}

function kindToRiskKind(protection) {
  return { 'smart-contract': 'smartContract', bridge: 'bridge', stablecoin: 'stablecoin', lending: 'lending', lp: 'lp', wallet: 'wallet', oracle: 'oracle', 'defi-protocol': 'protocol' }[protection] || protection;
}

/** Composite ranking — never purely lowest price (§56). */
function rankQuotes(quotes) {
  if (!quotes?.length) return [];
  const priceMin = quotes.reduce((a, q) => (BigInt(q.totalCostMicro) < BigInt(a.totalCostMicro) ? q : a)).totalCostMicro;
  const riskWeight = { LOW: 0, MEDIUM: 0.08, HIGH: 0.2, CRITICAL: 0.4 };
  return quotes
    .map((q) => {
      const priceScore = Number((BigInt(priceMin) * 100n) / BigInt(q.totalCostMicro)); // higher better (cheapest=100)
      const healthPenalty = q.providerHealth === 'HEALTHY' ? 0 : q.providerHealth === 'DEGRADED' ? 0.12 : 0.3;
      const riskPenalty = riskWeight[q.providerRiskScore] ?? 0.05;
      const score = Math.max(0, priceScore - healthPenalty * 100 - riskPenalty * 100);
      return { ...q, rankScore: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}

function explain(risk, options) {
  const lines = [];
  lines.push(`Your portfolio has ${risk.totalExposureUsd || '0'} of eligible exposure and ${risk.totalCoverageUsd || '0'} of active coverage.`);
  lines.push(`Unprotected exposure (coverage gap): ${risk.coverageGapUsd || '0'}.`);
  for (const k of risk.kinds.filter((x) => x.gapUsd !== '0').slice(0, 3)) {
    lines.push(`${k.label}: ${k.riskBand.toLowerCase()} risk, ${k.gapUsd} uncovered.`);
  }
  if (options.some((o) => o.catalogueOnly)) {
    lines.push('Live protection options exist for the open exposure, but a price could not be quoted without a wallet, accepted terms or a provider answer. Review the real provider catalogue and request a live quote in the marketplace.');
  } else if (options.length) {
    lines.push('Recommended protection has been quoted. Review terms, exclusions and every fee before signing — the maximum eligible payout per certificate is what you select.');
  } else {
    lines.push('No eligible protection is currently available for the open exposure.');
  }
  return lines;
}
