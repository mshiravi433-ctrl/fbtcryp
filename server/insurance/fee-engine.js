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
import {
  FBT_INSURANCE_FEE_BPS, FBT_INSURANCE_FLAT_FEE_MICRO, FBT_PROVIDER_COMMISSION_BPS
} from './env.js';

export const DEFAULT_FEES = Object.freeze({
  /**
   * FBT marketplace fee. DEFAULT EXACT ZERO (env: FBT_INSURANCE_FEE_BPS=0).
   * The UI shows "FBT Marketplace Fee: $0". Any non-zero value is a deliberate
   * operator configuration and must still be displayed before signing (§18).
   */
  integrationFeeBps: FBT_INSURANCE_FEE_BPS,
  // Per-network estimated settlement fee in micro-units (USDC-style). This is
  // an estimate; the wallet's actual gas is shown at signing time. Estimates
  // are opt-in via networkFeeMicro from a real gas source — never invented.
  networkFeeMicro: { 1: 0n, 56: 0n, 137: 0n, 42161: 0n, 10: 0n, 8453: 0n, 43114: 0n, 59144: 0n, 900: 0n },
  // Provider commission: NEVER assumed. Zero unless FBT_PROVIDER_COMMISSION_BPS
  // is set after a real agreement, or the provider record itself declares bps.
  commissionBps: FBT_PROVIDER_COMMISSION_BPS
});

/** Determine the provider's effective commission (bps) from its agreement. */
function providerCommissionBps(provider) {
  const model = provider?.commissionModel;
  if (!model) return DEFAULT_FEES.commissionBps;
  if (model.type === 'bps') return Number(model.bps) || 0;
  return DEFAULT_FEES.commissionBps; // none / flat / unknown — 0 unless an explicit agreement exists
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
  const flatFee = FBT_INSURANCE_FLAT_FEE_MICRO; // default 0n — exact, never rounded
  const fbtFeeTotal = fbtFee + flatFee;
  const totalCost = premium + fbtFeeTotal + networkFee;

  return {
    providerPremiumMicro: providerPremium,
    providerPremiumUsd: fromMicro(providerPremium),
    fbtFeeMicro: fbtFeeTotal,
    fbtFeeUsd: fromMicro(fbtFeeTotal),
    fbtMarketplaceFeeMicro: fbtFeeTotal,
    fbtMarketplaceFeeUsd: fromMicro(fbtFeeTotal),
    // Exact-zero disclosure: the UI prints this verbatim when fee == 0.
    fbtMarketplaceFeeDisclosure: fbtFeeTotal === 0n ? 'FBT Marketplace Fee: $0' : `FBT Marketplace Fee: $${fromMicro(fbtFeeTotal)}`,
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
      { label: 'Provider Premium', labelKey: 'insurance.fee.providerPremium', amountMicro: providerPremium, usd: fromMicro(providerPremium) },
      { label: 'FBT Marketplace Fee', labelKey: 'insurance.fee.fbtFee', amountMicro: fbtFeeTotal, usd: fromMicro(fbtFeeTotal) },
      { label: 'Network Fee (est.)', labelKey: 'insurance.fee.networkFee', amountMicro: networkFee, usd: fromMicro(networkFee) }
    ]
  };
}
