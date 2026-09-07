/**
 * FBT Insurance OS — Product catalogue builder.
 *
 * Products are owned by providers (a provider advertises what it can actually
 * sell). Real providers must supply their own catalogue; v1 ships sandbox
 * products whose terms are explicit SIMULATION defaults, never presented as a
 * real underwriting offer. The UI labels these sandbox products accordingly
 * and product detail always surfaces exclusions + terms-hash link.
 *
 * Sandbox premium basis: bps-per-day per protection type on the covered
 * amount, configurable. Deterministic and cheap for testing the full flow.
 */
import { PROTECTION_TYPES } from './constants.js';

/** Sandbox per-type annual rate proxy used to derive a per-day bps figure. */
const SANDBOX_RATE_BPS_PER_DAY = {
  'smart-contract': 3, // 0.03% of covered amount per day (~11% p.a. style proxy)
  'bridge': 4,
  'stablecoin': 2,
  'lending': 3,
  'lp': 5,
  'wallet': 2,
  'oracle': 4,
  'defi-protocol': 4
};

const SANDBOX_EXCLUSIONS = [
  'ordinary market price movements and volatility',
  'losses caused by your own unauthorised or negligent action',
  'losses on protocols/assets not expressly listed on the certificate',
  'any event excluded by the provider certificate at the time of purchase'
];

const SANDBOX_CONDITIONS = [
  'a valid, verifiable incident must be reported within the covered window',
  'the covered wallet/protocol must match the certificate on chain',
  'payout is subject to the sandbox provider certificate terms (simulated)'
];

/** Build a product row for a protection type on a chain. */
export function sandboxProduct({ kindId, chainId, currency = 'usdc' }) {
  const t = PROTECTION_TYPES.find((p) => p.id === kindId) || {
    id: kindId, label: kindId, riskKind: kindId
  };
  const rate = SANDBOX_RATE_BPS_PER_DAY[kindId] ?? 3;
  return {
    id: `sandbox-${kindId}-${chainId}`,
    providerProductId: `${kindId}-${chainId}`,
    kind: t.id,
    label: t.label,
    riskKind: t.riskKind,
    name: `${t.label} Protection (sandbox)`,
    supportedChains: [chainId],
    currency,
    claimMethod: 'on-chain-proof',
    sandbox: true,
    rateBpsPerDay: rate,
    exclusions: SANDBOX_EXCLUSIONS,
    conditions: SANDBOX_CONDITIONS,
    coverageCurrencies: [currency],
    deductibleOptional: true,
    minCoverageMicro: '1000000000', // $1,000 sandbox minimum
    auditStatus: 'none'
  };
}

/** Catalogue for a provider across its kinds+chains. */
export function catalogueFor(provider) {
  if (!provider?.configured) return [];
  const chains = provider.supportedChains || [];
  const kinds = provider.supportedProducts || ['smart-contract', 'bridge', 'stablecoin'];
  const out = [];
  for (const kindId of kinds) {
    for (const chainId of chains) {
      out.push(sandboxProduct({ kindId, chainId }));
    }
  }
  return out;
}

export function findProduct(products, { productId, kind, chainId }) {
  return (products || []).find(
    (p) =>
      (productId && p.id === productId) ||
      (kind && p.kind === kind && (!chainId || p.supportedChains.includes(Number(chainId))))
  ) || null;
}
