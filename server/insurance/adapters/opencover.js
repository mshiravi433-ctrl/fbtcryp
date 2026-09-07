/**
 * FBT Insurance OS — OpenCover "Verified Vault Coverage Registry".
 *
 * OpenCover (opencover.com/vaults) is a reference UI, not an independent
 * underwriter and not a quoting provider: each listed vault points at a real
 * Nexus Mutual product (Policy/Annex links resolve to
 * app.nexusmutual.io/cover/product/{id}/...). OpenCover publishes NO official
 * data API, so per the production spec:
 *
 *   - no scraping, ever;
 *   - OpenCover is registered ONLY as a link/registry/reference layer;
 *   - covered capacity is fetched LIVE from the Nexus Mutual capacity API for
 *     the registry's recorded Nexus productId — never copied, never invented;
 *   - every row carries source (`opencover`), the human-verified date, and
 *     freshness. When the live capacity lookup fails, capacity is UNKNOWN and
 *     the row is flagged stale.
 *
 * The registry below was transcribed by a human from the public
 * opencover.com/vaults page (verified 2026-09-07). Refresh = re-verify the
 * page and update `lastVerifiedAt`. APY figures shown by OpenCover are vault
 * marketing data — deliberately NOT copied here (no yield advertising).
 */
import { CHAIN_IDS } from '../constants.js';

export const REGISTRY_META = Object.freeze({
  registryId: 'opencover-vault-registry',
  displayName: 'OpenCover — Verified Vault Coverage Registry',
  role: 'reference-registry', // never a quoting provider
  upstream: 'https://opencover.com/vaults/',
  source: 'opencover',
  lastHumanVerifiedAt: '2026-09-07',
  note: 'Capacity is fetched live from the Nexus Mutual capacity API for each recorded productId. Rows without a live lookup report UNKNOWN capacity.'
});

/**
 * Human-verified registry rows. vaultUrl is the actual earn surface, policyUrl
 * / annexUrl are the official Nexus Mutual wording links (same URLs OpenCover
 * itself links to).
 */
export const VAULTS = Object.freeze([
  { protocol: 'Maple', vault: 'Syrup USDC', asset: 'USDC', chainId: CHAIN_IDS.ethereum, nexusProductId: 455,
    vaultUrl: 'https://app.maple.finance/earn',
    policyUrl: 'https://app.nexusmutual.io/cover/product/455/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/455/annex' },
  { protocol: 'Origin', vault: 'sUSDe ARM', asset: 'USDe', chainId: CHAIN_IDS.ethereum, nexusProductId: 469,
    vaultUrl: 'https://app.originprotocol.com/#/arm/1:ARM-sUSDe-USDe',
    policyUrl: 'https://app.nexusmutual.io/cover/product/469/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/469/annex' },
  { protocol: 'IPOR Fusion', vault: 'Liquity ETH Carry', asset: 'WETH', chainId: CHAIN_IDS.ethereum, nexusProductId: 437,
    vaultUrl: 'https://app.ipor.io/fusion/ethereum/0xb9e806e8f2d94c015ffefa90cd24ecce18f1663c',
    policyUrl: 'https://app.nexusmutual.io/cover/product/437/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/437/annex' },
  { protocol: 'Morpho', vault: 'Steakhouse High Yield I. (AUSD)', asset: 'AUSD', chainId: CHAIN_IDS.ethereum, nexusProductId: 399,
    vaultUrl: 'https://app.morpho.org/ethereum/vault/0xbEeFf89ABb7815cCD5182BD1FF82C4a4F8FCb13D/steakhouse-high-yield-instant',
    policyUrl: 'https://app.nexusmutual.io/cover/product/399/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/399/annex' },
  { protocol: 'Steakhouse', vault: 'AUSD Turbo', asset: 'AUSD', chainId: CHAIN_IDS.ethereum, nexusProductId: 415,
    vaultUrl: 'https://app.steakhouse.financial/earn/1/0xBEEFFF7e4EedD83A4a4aB53A68D03eC77C9a57a8/ausd-turbo',
    policyUrl: 'https://app.nexusmutual.io/cover/product/415/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/415/annex' },
  { protocol: 'Morpho', vault: 'KPK USDC Yield', asset: 'USDC', chainId: CHAIN_IDS.ethereum, nexusProductId: 445,
    vaultUrl: 'https://app.morpho.org/ethereum/vault/0xD5cCe260E7a755DDf0Fb9cdF06443d593AaeaA13/kpk-usdc-yield',
    policyUrl: 'https://app.nexusmutual.io/cover/product/445/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/445/annex' },
  { protocol: 'Morpho', vault: 'USDC Frontier (Gauntlet)', asset: 'USDC', chainId: CHAIN_IDS.ethereum, nexusProductId: 432,
    vaultUrl: 'https://app.morpho.org/ethereum/vault/0x9a1D6bd5b8642C41F25e0958129B85f8E1176F3e/gauntlet-usdc-frontier',
    policyUrl: 'https://app.nexusmutual.io/cover/product/432/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/432/annex' },
  { protocol: 'Morpho', vault: 'Steakhouse High Yield I. (USDC)', asset: 'USDC', chainId: CHAIN_IDS.ethereum, nexusProductId: 400,
    vaultUrl: 'https://app.morpho.org/ethereum/vault/0xbeeff2C5bF38f90e3482a8b19F12E5a6D2FCa757/steakhouse-high-yield-instant',
    policyUrl: 'https://app.nexusmutual.io/cover/product/400/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/400/annex' },
  { protocol: 'Morpho', vault: 'Sentora PYUSD Main', asset: 'PYUSD', chainId: CHAIN_IDS.ethereum, nexusProductId: 396,
    vaultUrl: 'https://app.morpho.org/ethereum/vault/0xb576765fB15505433aF24FEe2c0325895C559FB2/sentora-pyusd-main',
    policyUrl: 'https://app.nexusmutual.io/cover/product/396/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/396/annex' },
  { protocol: 'Morpho', vault: 'Smokehouse USDC', asset: 'USDC', chainId: CHAIN_IDS.ethereum, nexusProductId: 393,
    vaultUrl: 'https://app.morpho.org/ethereum/vault/0xBEeFFF209270748ddd194831b3fa287a5386f5bC/smokehouse-usdc',
    policyUrl: 'https://app.nexusmutual.io/cover/product/393/cover-wording',
    annexUrl: 'https://app.nexusmutual.io/cover/product/393/annex' }
]);

/**
 * listVaultRows({ nexusCapacity }) — decorate the registry with live capacity.
 * `nexusCapacity(productId)` -> { ok, capacity } from the Nexus adapter.
 */
export async function listVaultRows({ nexusCapacity, chainId } = {}) {
  const rows = [];
  for (const v of VAULTS) {
    if (chainId && v.chainId !== Number(chainId)) continue;
    let capacity = null;
    let capacitySource = 'UNKNOWN';
    let stale = true;
    if (typeof nexusCapacity === 'function') {
      const res = await nexusCapacity(v.nexusProductId);
      if (res?.ok) {
        capacity = res.capacity;
        capacitySource = 'nexus-mutual-api';
        stale = false;
      }
    }
    rows.push({
      ...v,
      chain: v.chainId === CHAIN_IDS.ethereum ? 'Ethereum' : `chain-${v.chainId}`,
      coveredCapacity: capacity, // raw Nexus capacity payload or null (UNKNOWN)
      capacitySource,
      proofOfCover: { nexusProductId: v.nexusProductId, verifyUrl: v.policyUrl },
      source: REGISTRY_META.source,
      registryUrl: REGISTRY_META.upstream,
      lastVerifiedAt: REGISTRY_META.lastHumanVerifiedAt,
      stale
    });
  }
  return rows;
}
