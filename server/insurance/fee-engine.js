/**
 * FBT Insurance OS — Fee Engine (§20, §19, §18, §44).
 *
 * Deterministic, integer-only fee splitting shown transparently before any
 * signature. Sources are configurable by provider agreement — a provider that
 * pays no commission yields fbtFee = 0 (never assumed). `networkFee` is an
 * estimate of the on-chain gas / settlement fee, never a custody charge.
 *
 * All figures in integer micro-units of the settlement token.
 *
 * Rates are expressed in bps of the provider premium (commission/integration)
 * OR as a flat micro-amount (network). Provider-level overrides win over the
 * global default.
 */
import { toMicro, fromMicro } from './constants.js';

export const DEFAULT_FEES = Object.freeze({
  // Global FBT integration/referral bps applied ONLY when a provider has an
  // agreement. Sandbox providers declare commission: { type:'none' } => 0.
  integrationFeeBps: 0,
  // Per-network estimated settlement fee in micro-units (USDC-style). This is
  // an estimate; the wallet's actual gas is shown at signing time.
  networkFeeMicro: { 1: 0n, 56: 0n, 137: 0n, 42161: 0n, 10: 0n, 8453: 0n, 43114: 0n, 59144: 0n, 900: 0n },
  commissionBps: 0
});

/** Determine the provider's effective commission (bps) from its agreement. */
function providerCommissionBps(provider) {
  const model = provider?.commissionModel;
  if (!model) return 0;
  if (model.type === 'bps') return Number(model.bps) || 0;
  return 0; // none / flat / unknown — treat as 0 unless explicit bps agreement
}

function providerIntegrationBps(provider) {
  if (!provider?.integrationBps && provider?.integrationFeeBps === undefined) {
    return Number(provider?.commissionModel?.type === 'shared' ? 0 : DEFAULT_FEES.integrationFeeBps);
  }
  return Number(provider?.integrationFeeBps ?? provider?.integrationBps ?? DEFAULT_FEES.integrationFeeBps);
}

/**
 * computeFees({ premiumMicro, coverageAmountMicro, durationDays, provider,
 *               network, networkFeeMicro? }) -> structured split (§18/§20)
 */
export function computeFees(input) {
  const premium = typeof input.premiumMicro === 'bigint' ? input.premiumMicro : toMicro(input.premiumMicro);
  if (premium === null) throw new Error('INVALID_PREMIUM');
  if (premium < 0n) throw new Error('NEGATIVE_PREMIUM');
  const provider = input.provider || {};
  const network = input.network != null ? Number(input.network) : null;

  const commissionBps = providerCommissionBps(provider);
  const integrationBps = providerIntegrationBps(provider);

  // FBT fee = referral/commission share of premium, but ONLY the integration
  // slice is a real charge if the provider pays it. If no agreement, 0.
  const fbtFee = (premium * BigInt(integrationBps)) / 10000n;
  const commissionMicro = (premium * BigInt(commissionBps)) / 10000n;

  const networkDefault = DEFAULT_FEES.networkFeeMicro;
  let networkFee = 0n;
  if (input.networkFeeMicro !== undefined) {
    const n = typeof input.networkFeeMicro === 'bigint' ? input.networkFeeMicro : toMicro(input.networkFeeMicro);
    networkFee = n ?? 0n;
  } else if (network != null && networkDefault[network] !== undefined) {
    networkFee = networkDefault[network];
  }

  const providerPremium = premium; // provider receives the full labelled premium
  const totalCost = premium + fbtFee + networkFee;

  return {
    providerPremiumMicro: providerPremium,
    providerPremiumUsd: fromMicro(providerPremium),
    fbtFeeMicro: fbtFee,
    fbtFeeUsd: fromMicro(fbtFee),
    networkFeeMicro: networkFee,
    networkFeeUsd: fromMicro(networkFee),
    commissionMicro,
    commissionUsd: fromMicro(commissionMicro),
    totalCostMicro: totalCost,
    totalCostUsd: fromMicro(totalCost),
    commissionModel: provider?.commissionModel?.type || 'none',
    fbtFeeBps: integrationBps,
    commissionBps,
    breakdown: [
      { label: 'Provider Premium', amountMicro: providerPremium, usd: fromMicro(providerPremium) },
      { label: 'FBT Fee', amountMicro: fbtFee, usd: fromMicro(fbtFee) },
      { label: 'Network Fee (est.)', amountMicro: networkFee, usd: fromMicro(networkFee) }
    ]
  };
}
